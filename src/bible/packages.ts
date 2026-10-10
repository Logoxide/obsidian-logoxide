import { Notice, TFile, TFolder } from "obsidian";
import { Logoxide, PackageKind, type LogoxidePackage, type LockedEntry, type MediaFile, type PackageFile, type Passage, type LogoxideBook, type ToposTranslations } from "logoxide";
import { RESERVED, STUB_EXTENSION, parseStub, staleStubs, stubNames, stubPath, stubText } from "../core/stubs.ts";
import type ToposPlugin from "../main.ts";
import type { Timing } from "../core/timings.ts";
import type { BookEdition } from "./reader.ts";

/** The vault's manifest: at its root, else in the library's folder */
export const MANIFEST = "logoxide.toml";
export const LOCK = "logoxide.lock";

/** How many parsed books each package keeps */
const BOOKS_KEPT = 3;

/** A Bible from a logoxide package */
interface PackageBible {
  id: string;
  /** What the vault's `logoxide.toml` calls it (its id, or a fork's own name) */
  dependency: string;
  /** What references name it by (`BSB`) */
  name: string;
  aliases: string[];
  pkg: LogoxidePackage;
  /** Books read last */
  books: Map<number, LogoxideBook>;
  /** The package's folder, from the vault's root */
  dir: string;
  /** Each book's stub (see `core/stubs.ts`), by book id */
  stubs: Map<number, string>;
  /** Each book's stub, by its file's path in the package */
  stubFiles: Map<string, string>;
  /** The version installed */
  version: string;
  /** Each book's verse hashes (8 hex digits) by `chapter:verse`, as read */
  hashes: Map<number, Map<string, string>>;
  /** Each book's recording and where it reads each verse, once looked for (null: none) */
  recordings: Map<number, Recording | null>;
}

/** A recording of a package Bible's book (its `[media]`), and where it reads each verse */
export interface Recording {
  file: MediaFile;
  /** The Bible's name (`BSB`) */
  bible: string;
  /** In the recording's order */
  timings: Timing[];
}

/** A package the vault's lock file names, for the settings */
export interface InstalledPackage {
  id: string;
  /** What the vault's logoxide.toml calls it (its id, or a fork's own name) */
  name: string;
  version: string;
  /** The package logoxide.toml asks for that brings it in (a collection), when it doesn't ask for this one itself */
  dependencyOf: string | null;
  /** Its folder, from the vault's root */
  dir: string;
  /** From an import (`imports/<id>`) or a path package rather than the library */
  path: boolean;
  /** What it is, once read (else why it couldn't be) */
  info: { name: string; abbreviation: string; license: string | null; kind: PackageKind } | null;
  problem: string | null;
  /** Whether it's in use: `enabled = false` in logoxide.toml turns it (and what it brings in) off, keeping it installed */
  enabled: boolean;
}

/** A book package's EPUBs, copied into the packages folder (EPUB++ opens only vault files) */
interface PackageBook {
  dependency: string;
  /** The package's folder, from the vault's root */
  dir: string;
  /** Its EPUBs, relative to its folder, and their titles */
  files: { path: string; title: string | null }[];
}

/** A copy of a book package's file in the packages folder, as recorded */
interface Copy {
  path: string;
  /** The package (as logoxide.toml calls it) and its file, when recorded (older records have neither) */
  package?: string;
  file?: string;
}

/** Where the copies of book packages' EPUBs are recorded (in the plugin's folder), so only those are ever removed */
const COPIES = "logoxide-copies.json";

/** A package Bible's book files in the vault, for the reader */
export interface PackageFiles {
  dir: string;
  name: string;
  books: Map<number, string>;
}

/**
 * The Bibles and books a vault's `logoxide.toml` asks for (and those its collections bring in), as
 * its `logoxide.lock` pins them, read with logoxide from the library (`.logoxide/` by default: hidden and
 * not synced, so each device installs what the lock pins) or a path package's folder. They show in
 * the packages folder (`Logoxide/` by default, with the vault's `logoxide.toml`): a stub for each Bible
 * book, which the reader opens, and a copy of each book package's EPUBs, which EPUB++ opens and
 * verse search reads. Bibles give the translations references can name, with their own verse
 * counts. Their parsed cache is kept in the plugin's folder.
 *
 * `lx install` (with `LOGOXIDE_HOME` set to the library, in the packages folder) installs them too.
 */
export class LogoxideBibles {
  private bibles: PackageBible[] = [];
  private books: PackageBook[] = [];
  /** The EPUB copies in the packages folder, as last written */
  private copies = new Set<string>();
  /** The lock file last installed from on its own (missing packages are installed once per lock) */
  private installedFrom: string | null = null;
  private defaultName: string | null = null;
  /** What couldn't be read, to show */
  problems: string[] = [];
  /** Every package the lock file names, as last read */
  installed: InstalledPackage[] = [];
  /** Packages whose own files changed since the lock was written (edited in the library): restore them */
  changedPackages: string[] = [];
  /** The folder of the vault's logoxide.toml ("" for its root), as last read */
  base = "";
  private loading: Promise<void> | null = null;

  constructor(
    private readonly plugin: ToposPlugin,
    /** Called when the packages were read again */
    private readonly changed: () => void,
  ) {}

  /** The library's folder in the vault: installed packages (the setting; `.logoxide` by default) */
  libraryDir(): string {
    return this.plugin.settings.logoxideLibrary.trim().replace(/^\/+|\/+$/g, "") || ".logoxide";
  }

  /** The packages folder: logoxide.toml, imports, stubs, and EPUB copies (the setting; `Logoxide` by default) */
  booksDir(): string {
    return this.plugin.settings.logoxideBooks.trim().replace(/^\/+|\/+$/g, "") || "Logoxide";
  }

  /**
   * Installed packages in the packages folder (from before the library was its own folder) move to
   * the library, when it has none
   */
  private async moveOldLibrary(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    const from = `${this.booksDir()}/packages`;
    const to = `${this.libraryDir()}/packages`;
    if (from === to || !(await adapter.exists(from)) || (await adapter.exists(to))) return;
    await mkdirs(this.plugin, this.libraryDir());
    await adapter.rename(from, to);
  }

  private cacheDir(): string | null {
    const dir = this.plugin.manifest?.dir;
    return dir ? `${dir}/logoxide-cache` : null;
  }

  /** The names of the Bibles read */
  names(): string[] {
    return this.bibles.map((b) => b.name);
  }

  /** Reads the manifest and its packages (again), once at a time */
  load(): Promise<void> {
    this.loading ??= this.read().finally(() => (this.loading = null));
    return this.loading;
  }

  private async read(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    try {
      await this.moveOldLibrary();
    } catch (error) {
      console.warn("Logoxide: moving the installed packages into the library", error);
    }
    const base = (await adapter.exists(MANIFEST)) ? "" : this.booksDir();
    const at = (name: string) => (base ? `${base}/${name}` : name);
    const problems: string[] = [];
    const bibles: PackageBible[] = [];
    const books: PackageBook[] = [];
    const installed: InstalledPackage[] = [];
    const changed: string[] = [];
    let defaultName: string | null = null;
    let lock: string | null = null;
    let missing = false;
    if (await adapter.exists(at(MANIFEST))) {
      await this.plugin.engine();
      const logoxide = Logoxide.new();
      try {
        lock = (await adapter.exists(at(LOCK))) ? await adapter.read(at(LOCK)) : null;
        const project = logoxide.parseProject(await adapter.read(at(MANIFEST)), lock);
        for (const name of project.unlocked()) problems.push(`${name}: not installed yet (run lx install)`);
        // What each package logoxide.toml asks for is, so a collection's packages count as the vault's
        const kinds = new Map<string, PackageKind>();
        for (const entry of project.packages()) {
          const dir = this.dirOf(entry, base);
          const listed: InstalledPackage = { id: entry.id, name: entry.name, version: entry.version, dependencyOf: entry.dependencyOf, dir, path: entry.location.tag === "Path", info: null, problem: null, enabled: entry.enabled };
          installed.push(listed);
          // Turned off: named from its logoxide.toml alone, and not read (its Bible, books, and stubs leave the vault until it's on)
          if (!entry.enabled) {
            if (await adapter.exists(`${dir}/${MANIFEST}`)) {
              try {
                const info = logoxide.readPackageInfo(await adapter.read(`${dir}/${MANIFEST}`));
                listed.info = { name: info.name, abbreviation: info.abbreviation, license: info.license ?? info.licenseFile ?? null, kind: info.kind };
                if (entry.dependencyOf === null) kinds.set(entry.name, info.kind);
              } catch {
                // Named by its id
              }
            }
            continue;
          }
          // Another package's own dependencies (a commentary's Bible) are its, not the vault's
          const ours = entry.dependencyOf === null || kinds.get(entry.dependencyOf) === PackageKind.Collection;
          try {
            if (!(await adapter.exists(`${dir}/${MANIFEST}`))) {
              missing = true;
              throw new Error(`not installed in ${dir} yet`);
            }
            const opened = await this.open(logoxide, entry, base, problems, changed);
            listed.info = opened.info;
            if (entry.dependencyOf === null) kinds.set(entry.name, opened.info.kind);
            if (opened.bible && ours) bibles.push(opened.bible);
            else opened.bible?.pkg.dispose();
            if (opened.book && ours) books.push(opened.book);
          } catch (error) {
            listed.problem = message(error);
            problems.push(`${entry.id} ${entry.version}: ${listed.problem}`);
          }
        }
        const chosen = project.defaultBible();
        defaultName = bibles.find((b) => b.id === chosen)?.name ?? null;
        project.dispose();
      } catch (error) {
        problems.push(`${at(MANIFEST)}: ${message(error)}`);
      }
    }
    for (const old of this.bibles) this.dispose(old);
    this.bibles = bibles;
    this.books = books;
    this.defaultName = defaultName;
    this.problems = problems;
    this.installed = installed;
    this.base = base;
    // Said once each time the set of edited packages changes
    if (changed.length > 0 && changed.join() !== this.changedPackages.join()) {
      new Notice(`Logoxide: the files of ${changed.join(", ")} were edited in the library. Run "Restore edited Bible packages" to put them back (notes beside them stay).`, 15000);
    }
    this.changedPackages = changed;
    try {
      await this.syncStubs();
    } catch (error) {
      problems.push(`book stubs: ${message(error)}`);
    }
    try {
      await this.syncCopies();
    } catch (error) {
      problems.push(`books: ${message(error)}`);
    }
    if (problems.length > 0) console.warn("Logoxide: logoxide packages", problems);
    this.changed();
    // A device the lock was synced to installs what it pins (once for each lock file)
    if (missing && lock !== null && lock !== this.installedFrom) {
      this.installedFrom = lock;
      void this.plugin.bibleManager.installLocked().catch((error: unknown) => {
        new Notice(`Logoxide: couldn't install the vault's Bible packages: ${message(error)}`, 10000);
      });
    }
  }

  /** Whether a package logoxide.toml asks for is on (`enabled = false` turns one off without removing it) */
  isEnabled(name: string): boolean {
    return this.installed.find((p) => p.name === name && p.dependencyOf === null)?.enabled ?? true;
  }

  /** The packages in use (with what they bring in) */
  enabledPackages(): InstalledPackage[] {
    return this.installed.filter((p) => p.enabled);
  }

  /** The packages turned off (with what only they bring in): installed, but not read */
  disabledPackages(): InstalledPackage[] {
    return this.installed.filter((p) => !p.enabled);
  }

  /** A locked package's folder, from the vault's root */
  dirOf(entry: LockedEntry, base = this.base): string {
    return entry.location.tag === "Library" ? `${this.libraryDir()}/${entry.location.dir}` : join(base, entry.location.dir);
  }

  /** A locked package: what it is, and its Bible or its books */
  private async open(
    logoxide: Logoxide,
    entry: LockedEntry,
    base: string,
    problems: string[],
    changed: string[],
  ): Promise<{ info: NonNullable<InstalledPackage["info"]>; bible: PackageBible | null; book: PackageBook | null }> {
    const adapter = this.plugin.app.vault.adapter;
    const dir = this.dirOf(entry, base);
    const files = await readTree(this.plugin, dir);
    const cacheDir = this.cacheDir();
    // The cache is per package (`<id>/<version>-<checksum>/`)
    const cache = cacheDir && (await adapter.exists(`${cacheDir}/${entry.id}`)) ? await readTree(this.plugin, `${cacheDir}/${entry.id}`, `${entry.id}/`) : [];
    const pkg = logoxide.openPackage(files, entry.features, cache);
    if (entry.checksum && pkg.checksum() !== entry.checksum) {
      problems.push(`${entry.id} ${entry.version}: its files changed since logoxide.lock was written (Restore puts them back)`);
      changed.push(entry.name);
    }
    await this.saveCache(pkg);
    const info = pkg.info();
    const summary = { name: info.name, abbreviation: info.abbreviation, license: info.license ?? info.licenseFile ?? null, kind: info.kind };
    if (info.kind !== PackageKind.Bible) {
      const titles = pkg.titles();
      const files = pkg.epubFiles().map((path) => ({ path, title: titles.find((t) => t.path === path)?.title ?? null }));
      pkg.dispose();
      return { info: summary, bible: null, book: files.length > 0 ? { dependency: entry.name, dir, files } : null };
    }
    // The vault's own names for it, when its logoxide.toml gives them (a fork's)
    const name = entry.abbreviation ?? info.abbreviation;
    const aliases = entry.aliases ?? info.aliases;
    return { info: summary, bible: { id: info.id, dependency: entry.name, name, aliases, pkg, books: new Map(), dir, stubs: new Map(), stubFiles: new Map(), version: entry.version, hashes: new Map(), recordings: new Map() }, book: null };
  }

  /** Writes what a package's cache wrote into the plugin's folder */
  private async saveCache(pkg: LogoxidePackage): Promise<void> {
    const cacheDir = this.cacheDir();
    const writes = pkg.cacheWrites();
    if (!cacheDir) return;
    const adapter = this.plugin.app.vault.adapter;
    for (const file of writes) {
      const path = `${cacheDir}/${file.path}`;
      await mkdirs(this.plugin, path.slice(0, path.lastIndexOf("/")));
      await adapter.writeBinary(path, buffer(file.bytes));
    }
  }

  /** `translations` with every package Bible's name, aliases, and verse counts added */
  addTo(translations: ToposTranslations): ToposTranslations {
    for (const bible of this.bibles) {
      const next = bible.pkg.addTo(translations);
      translations.dispose();
      translations = next;
    }
    return translations;
  }

  /** A package Bible by its name or an alias (ignoring case); without one, the manifest's default */
  private named(name?: string | null): PackageBible | null {
    if (name) {
      const lower = name.toLowerCase();
      return this.bibles.find((b) => b.name.toLowerCase() === lower || b.id === lower || b.aliases.some((a) => a.toLowerCase() === lower)) ?? null;
    }
    return this.bibles.find((b) => b.name === this.defaultName) ?? this.bibles[0] ?? null;
  }

  /**
   * Each package Bible's books, as their stubs (`Logoxide/bsb/usx/JHN.bible`): the reader, hover, and
   * embeds open those, so links and annotations point at a path no update moves
   */
  files(): PackageFiles[] {
    return this.bibles.map((bible) => ({
      dir: this.stubDir(bible),
      name: bible.name,
      books: new Map(bible.pkg.bookFiles().map((f) => [f.bookId, bible.stubs.get(f.bookId) ?? `${bible.dir}/${f.path}`])),
    }));
  }

  /** The folder of a package's stubs */
  private stubDir(bible: PackageBible): string {
    return `${this.booksDir()}/${bible.dependency}`;
  }

  /**
   * Copies each book package's EPUBs into the packages folder (`Logoxide/<package>/epub/book.epub`),
   * where EPUB++ opens them and verse search reads them; a copy that differs from the package (an
   * update, or an edit) is written again, so links and highlights keep their path. Copies of books
   * the vault no longer has are removed: only files this wrote, never others
   */
  private async syncCopies(): Promise<void> {
    const { vault } = this.plugin.app;
    const adapter = vault.adapter;
    const root = this.booksDir();
    const record = this.plugin.manifest?.dir ? `${this.plugin.manifest.dir}/${COPIES}` : null;
    // Each copy written, and the package file it's of (older records have paths alone)
    const saved = record && (await adapter.exists(record)) ? (JSON.parse(await adapter.read(record)) as (string | Copy)[]) : [];
    const written = new Map<string, Copy>(saved.map((c) => (typeof c === "string" ? [c, { path: c }] : [c.path, c])));
    const books = this.books.filter((b) => !RESERVED.includes(b.dependency));
    // Each copy's path: its title in its package's folder (`Logoxide/tdp/The Dorean Principle.epub`)
    const copies = books.flatMap((book) => {
      const names = stubNames(book.files);
      return book.files.map((file) => {
        const extension = file.path.slice(file.path.lastIndexOf(".") + 1);
        const stub = { package: book.dependency, path: file.path };
        return { book, file, path: names.get(file.path) ? stubPath(root, stub, names.get(file.path) ?? null, extension) : `${root}/${book.dependency}/${file.path}`, old: `${root}/${book.dependency}/${file.path}` };
      });
    });
    const wanted = new Set(copies.map((c) => c.path));
    // Known before they're written, so the index takes them as they're created
    const before = this.copies;
    this.copies = wanted;
    for (const { book, file, path, old } of copies) {
      const bytes = await adapter.readBinary(`${book.dir}/${file.path}`);
      let existing = vault.getFileByPath(path);
      // The same file copied under another name before (its path in the package, or an older
      // title): renamed, so links and highlights follow it
      const earlier = [...written.values()].find(
        (c) => c.path !== path && ((c.package === book.dependency && c.file === file.path) || (c.package === undefined && c.path === old)),
      );
      const moving = !existing && earlier ? vault.getFileByPath(earlier.path) : null;
      if (moving && earlier) {
        await this.folder(path.slice(0, path.lastIndexOf("/")));
        await this.rename(moving, path);
        written.delete(earlier.path);
        existing = vault.getFileByPath(path);
      }
      if (existing) {
        if (existing.stat.size !== bytes.byteLength || !same(await vault.readBinary(existing), bytes)) await vault.modifyBinary(existing, bytes);
      } else {
        await this.folder(path.slice(0, path.lastIndexOf("/")));
        await vault.createBinary(path, bytes);
      }
      written.set(path, { path, package: book.dependency, file: file.path });
    }
    // A package listed but not installed here keeps its copies (they may have synced from another device)
    const kept = this.installed.filter((p) => p.problem !== null).map((p) => `${root}/${p.name}/`);
    for (const path of [...written.keys()]) {
      if (wanted.has(path) || kept.some((dir) => path.startsWith(dir))) continue;
      const file = vault.getFileByPath(path);
      if (file) await vault.delete(file);
      written.delete(path);
    }
    if (record) await adapter.write(record, JSON.stringify([...written.values()].sort((a, b) => a.path.localeCompare(b.path))));
    await this.removeEmptyFolders([...new Set(copies.map((c) => `${root}/${c.book.dependency}`))]);
    // Books the index may have passed over before they were known as the vault's
    if ([...wanted].some((path) => !before.has(path))) this.plugin.reindexSoon();
  }

  /** Removes the empty folders inside these (left by stubs and copies that moved); never a folder with anything in it */
  private async removeEmptyFolders(dirs: string[]): Promise<void> {
    const { vault } = this.plugin.app;
    const prune = async (folder: TFolder): Promise<void> => {
      for (const child of [...folder.children]) if (child instanceof TFolder) await prune(child);
      // Only a folder with nothing in it on disk (no hidden files either)
      const listed = folder.children.length === 0 ? await vault.adapter.list(folder.path) : null;
      if (listed && listed.files.length === 0 && listed.folders.length === 0) await vault.adapter.rmdir(folder.path, true);
    };
    for (const dir of dirs) {
      const folder = vault.getFolderByPath(dir);
      if (!folder) continue;
      for (const child of [...folder.children]) if (child instanceof TFolder) await prune(child);
    }
  }

  /** Whether a path is a book package's EPUB copy (searched for references whatever the settings say) */
  isBookCopy(path: string): boolean {
    return this.copies.has(path);
  }

  /**
   * Writes a stub for each package Bible's book (when it isn't there, or names something else),
   * and removes stubs no package has now. Only stubs are removed: annotation files and notes
   * beside them stay
   */
  private async syncStubs(): Promise<void> {
    const { vault } = this.plugin.app;
    const root = this.booksDir();
    // The stubs there now, by what they name (to rename one whose name changed, not make another)
    const library = vault.getFolderByPath(root);
    const existing: TFile[] = [];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder && !(folder === library && RESERVED.includes(child.name))) walk(child);
        else if (child instanceof TFile && child.extension === STUB_EXTENSION) existing.push(child);
      }
    };
    if (library) walk(library);
    const named = new Map<string, TFile>();
    for (const file of existing) {
      const stub = parseStub(await vault.cachedRead(file));
      if (stub) named.set(`${stub.package}\n${stub.path}\n${stub.book ?? ""}`, file);
    }
    const bookInfo = this.plugin.topos?.books() ?? [];
    const wanted = new Set<string>();
    for (const bible of this.bibles) {
      bible.stubs = new Map();
      bible.stubFiles = new Map();
      if (RESERVED.includes(bible.dependency)) {
        this.problems.push(`${bible.dependency}: a package named like the library's own folders gets no book stubs`);
        continue;
      }
      const files = bible.pkg.bookFiles();
      // A file of several books (a whole Bible in OSIS or ThML) gets a stub for each, named by its book
      const shared = new Set(files.filter((f, i) => files.findIndex((o) => o.path === f.path) !== i).map((f) => f.path));
      const keyed = files.map((f) => {
        const info = shared.has(f.path) ? bookInfo.find((b) => b.id === f.bookId) : undefined;
        return { file: f, key: info ? `${f.path}#${info.usfm}` : f.path, book: info?.usfm, title: info ? info.name : (f.title ?? null) };
      });
      const names = stubNames(keyed.map((k) => ({ path: k.key, title: k.title })));
      for (const { file, key, book } of keyed) {
        const stub = { package: bible.dependency, path: file.path, ...(book ? { book } : {}) };
        const path = stubPath(root, stub, names.get(key) ?? null);
        wanted.add(path);
        bible.stubs.set(file.bookId, path);
        if (!bible.stubFiles.has(file.path)) bible.stubFiles.set(file.path, path);
        const text = stubText(stub);
        // Named otherwise before (its file's path, or an older title): renamed, so links follow
        const before = named.get(`${stub.package}\n${stub.path}\n${stub.book ?? ""}`);
        if (before && before.path !== path && !vault.getAbstractFileByPath(path)) {
          await this.folder(path.slice(0, path.lastIndexOf("/")));
          await this.rename(before, path);
        }
        const current = vault.getFileByPath(path);
        if (current) {
          if ((await vault.read(current)) !== text) await vault.modify(current, text);
        } else {
          await this.folder(path.slice(0, path.lastIndexOf("/")));
          await vault.create(path, text);
        }
      }
    }
    // Stubs of packages (or books) the vault no longer has
    const now: TFile[] = [];
    if (library) {
      const again = (folder: TFolder) => {
        for (const child of folder.children) {
          if (child instanceof TFolder && !(folder === library && RESERVED.includes(child.name))) again(child);
          else if (child instanceof TFile && child.extension === STUB_EXTENSION) now.push(child);
        }
      };
      again(library);
    }
    const stale = new Set(staleStubs(now.map((f) => f.path), wanted));
    for (const file of now.filter((f) => stale.has(f.path))) {
      // Only what is a stub (a file named .bible that isn't one stays)
      if (parseStub(await vault.read(file))) await vault.delete(file);
    }
    await this.removeEmptyFolders(this.bibles.map((b) => `${root}/${b.dependency}`));
  }

  /**
   * Moves a stub or copy, updating every link to it (and the annotation file that names it):
   * these are the plugin's moves, so the vault's "update links" setting isn't asked about each
   */
  private async rename(file: TFile, path: string): Promise<void> {
    const vault = this.plugin.app.vault as unknown as { getConfig?(key: string): unknown; setConfig?(key: string, value: unknown): void };
    const before = vault.getConfig?.("alwaysUpdateLinks");
    if (before !== true) vault.setConfig?.("alwaysUpdateLinks", true);
    const { metadataCache, vault: files } = this.plugin.app;
    const to = path.slice(0, path.lastIndexOf("/"));
    // Its annotation files (notes beside it whose properties link to it), found before it moves
    const beside = file.parent && file.parent.path !== to ? file.parent.children : [];
    const notes = beside.filter((note): note is TFile => {
      if (!(note instanceof TFile) || note.extension !== "md") return false;
      const links = metadataCache.getFileCache(note)?.frontmatterLinks ?? [];
      return links.some((l) => metadataCache.getFirstLinkpathDest(l.link.split("#")[0] ?? "", note.path) === file);
    });
    try {
      await this.plugin.app.fileManager.renameFile(file, path);
      for (const note of notes) {
        if (!files.getAbstractFileByPath(`${to}/${note.name}`)) await this.plugin.app.fileManager.renameFile(note, `${to}/${note.name}`);
      }
    } finally {
      if (before !== true) vault.setConfig?.("alwaysUpdateLinks", before ?? false);
    }
  }

  /** Makes a folder in the vault (and its parents) when it isn't there */
  private async folder(path: string): Promise<void> {
    const { vault } = this.plugin.app;
    if (!path || vault.getAbstractFileByPath(path)) return;
    await this.folder(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
    await vault.createFolder(path);
  }

  /**
   * The book a stub names: its file in the library (or a path package's folder), and the Bible it's
   * in. Null when the stub names a package the vault doesn't have (or isn't a stub)
   */
  async stubTarget(stub: TFile): Promise<{ path: string; bible: string; book: string | null } | null> {
    await this.loading;
    const named = parseStub(await this.plugin.app.vault.cachedRead(stub));
    const bible = named && this.bibles.find((b) => b.dependency === named.package);
    return named && bible ? { path: `${bible.dir}/${named.path}`, bible: bible.name, book: named.book ?? null } : null;
  }

  /**
   * A stub's book read by logoxide, for files the reader can't parse itself (OSIS, ThML, and files of
   * several books); a new book each time, which the reader disposes
   */
  async stubBook(stub: TFile, code: string | null): Promise<LogoxideBook | null> {
    await this.loading;
    const named = parseStub(await this.plugin.app.vault.cachedRead(stub));
    const bible = named && this.bibles.find((b) => b.dependency === named.package);
    if (!named || !bible) return null;
    const bookId = code
      ? this.plugin.topos?.books().find((b) => b.usfm === code)?.id
      : bible.pkg.bookFiles().find((f) => f.path === named.path)?.bookId;
    return bookId === undefined ? null : bible.pkg.book(bookId);
  }

  /**
   * A stub's book as this version has it: the version, and its verses by the hash of their words,
   * so links made in it record them and find their verses again after an update
   */
  async edition(stub: TFile, bookId: number): Promise<BookEdition | null> {
    await this.loading;
    const named = parseStub(await this.plugin.app.vault.cachedRead(stub));
    const bible = named && this.bibles.find((b) => b.dependency === named.package);
    if (!bible) return null;
    let hashes = bible.hashes.get(bookId);
    if (!hashes) {
      try {
        hashes = new Map(bible.pkg.verseHashes(bookId).map((v) => [`${v.chapter}:${v.verse}`, v.hash.slice(0, 8)]));
      } catch {
        return null;
      }
      bible.hashes.set(bookId, hashes);
      await this.saveCache(bible.pkg);
    }
    const byHash = new Map([...hashes].map(([at, hash]) => [hash, at]));
    return {
      version: bible.version,
      hashOf: (chapter, verse) => hashes.get(`${chapter}:${verse}`),
      find: (hash) => {
        const at = byHash.get(hash.slice(0, 8));
        const [chapter, verse] = at?.split(":").map(Number) ?? [];
        return chapter && verse ? { chapter, verse } : undefined;
      },
      said: (message) => new Notice(message, 8000),
    };
  }

  /** The names of the package Bibles whose `[media]` may read a book (a file listed for it, or for no one book) */
  recorded(bookId: number): string[] {
    const code = this.plugin.topos?.books().find((b) => b.id === bookId)?.usfm;
    return this.bibles
      .filter((b) => b.recordings.get(bookId) !== null && b.stubs.has(bookId) && b.pkg.media().some((f) => f.book === null || f.book === code))
      .map((b) => b.name);
  }

  /**
   * The recording of a stub's book, from its package's `[media]` (the file listed for the book, or
   * a file whose timings read it), with where it reads each verse; null when it has none
   */
  async recording(stub: string, bookId: number): Promise<Recording | null> {
    await this.loading;
    const bible = this.bibles.find((b) => b.stubs.get(bookId) === stub);
    if (!bible) return null;
    if (bible.recordings.has(bookId)) return bible.recordings.get(bookId) ?? null;
    let found: Recording | null = null;
    const code = this.plugin.topos.books().find((b) => b.id === bookId)?.usfm;
    for (const file of bible.pkg.media()) {
      if (file.book !== null && file.book !== code) continue;
      try {
        const timings = bible.pkg.timings(file).filter((t) => t.bookId === bookId);
        if (timings.length === 0) continue;
        found = { file, bible: bible.name, timings: timings.map((t) => ({ chapter: t.chapter, verse: t.verse, last: t.last, startMs: t.startMs, endMs: t.endMs })) };
        break;
      } catch (error) {
        console.warn(`Logoxide: ${bible.name}'s timings for ${file.path}`, error);
      }
    }
    bible.recordings.set(bookId, found);
    return found;
  }

  /** The stub of a package's book file (its path from the vault's root), if it has one */
  stubOf(path: string): string | null {
    for (const bible of this.bibles) {
      if (!path.startsWith(`${bible.dir}/`)) continue;
      const stub = bible.stubFiles.get(path.slice(bible.dir.length + 1));
      if (stub) return stub;
    }
    return null;
  }

  /** Whether a path is in an installed package (or a path package): the packages' own files, not notes */
  isPackageFile(path: string): boolean {
    const dirs = [`${this.libraryDir()}/packages`, ...this.installed.map((p) => p.dir)];
    return dirs.some((dir) => path === dir || path.startsWith(`${dir}/`));
  }

  /** Whether a package Bible has this name or alias */
  has(name: string): boolean {
    return this.named(name) !== null;
  }

  /** A passage's plain text from the package Bible named (else the default one), parts joined by " … " */
  async text(passage: Passage, name?: string | null): Promise<string | null> {
    await this.loading;
    const bible = this.named(name);
    if (!bible || !bible.pkg.books().includes(passage.bookId)) return null;
    let book = bible.books.get(passage.bookId);
    if (!book) {
      book = bible.pkg.book(passage.bookId);
      bible.books.set(passage.bookId, book);
      for (const [id, old] of [...bible.books].slice(0, -BOOKS_KEPT)) {
        old.dispose();
        bible.books.delete(id);
      }
      await this.saveCache(bible.pkg);
    }
    const parts = book.text(passage, { notes: false, headings: false, classPrefix: "topos-" });
    const text = parts.map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean).join(" … ");
    return text || null;
  }

  private dispose(bible: PackageBible): void {
    for (const book of bible.books.values()) book.dispose();
    bible.pkg.dispose();
  }

  unload(): void {
    for (const bible of this.bibles) this.dispose(bible);
    this.bibles = [];
  }
}

export function message(error: unknown): string {
  const value = (error as { value?: { message?: string } })?.value;
  return value?.message ?? (error instanceof Error ? error.message : String(error));
}

export function join(base: string, path: string): string {
  const parts = base ? base.split("/") : [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

/** Every file under a folder but git's, with paths relative to it (after `prefix`) */
export async function readTree(plugin: ToposPlugin, dir: string, prefix = ""): Promise<PackageFile[]> {
  const adapter = plugin.app.vault.adapter;
  const listed = await adapter.list(dir);
  const files: PackageFile[] = await Promise.all(
    listed.files.map(async (path) => ({ path: prefix + path.slice(dir.length + 1), bytes: new Uint8Array(await adapter.readBinary(path)) })),
  );
  for (const folder of listed.folders) {
    const name = folder.slice(dir.length + 1);
    if (name === ".git") continue;
    files.push(...(await readTree(plugin, folder, `${prefix}${name}/`)));
  }
  return files;
}

export async function mkdirs(plugin: ToposPlugin, dir: string): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  if (!dir || (await adapter.exists(dir))) return;
  await mkdirs(plugin, dir.slice(0, Math.max(0, dir.lastIndexOf("/"))));
  await adapter.mkdir(dir);
}

/** Whether two files' bytes are the same */
function same(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** The bytes as their own ArrayBuffer (Obsidian's writeBinary takes one) */
export function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
