import { Notice, TFile, TFolder } from "obsidian";
import { Biblix, PackageKind, type BiblixPackage, type LockedEntry, type PackageFile, type Passage, type ToposBook, type ToposTranslations } from "biblix";
import { RESERVED, STUB_EXTENSION, parseStub, staleStubs, stubPath, stubText } from "../core/stubs.ts";
import type ToposPlugin from "../main.ts";

/** The vault's manifest: at its root, else in the library's folder */
export const MANIFEST = "biblix.toml";
export const LOCK = "biblix.lock";

/** How many parsed books each package keeps */
const BOOKS_KEPT = 3;

/** A Bible from a biblix package */
interface PackageBible {
  id: string;
  /** What the vault's `biblix.toml` calls it (its id, or a fork's own name) */
  dependency: string;
  /** What references name it by (`BSB`) */
  name: string;
  aliases: string[];
  pkg: BiblixPackage;
  /** Books read last */
  books: Map<number, ToposBook>;
  /** The package's folder, from the vault's root */
  dir: string;
  /** Each book's stub (see `core/stubs.ts`), by book id */
  stubs: Map<number, string>;
}

/** A package the vault's lock file names, for the settings */
export interface InstalledPackage {
  id: string;
  /** What the vault's biblix.toml calls it (its id, or a fork's own name) */
  name: string;
  version: string;
  /** The package biblix.toml asks for that brings it in (a collection), when it doesn't ask for this one itself */
  dependencyOf: string | null;
  /** Its folder, from the vault's root */
  dir: string;
  /** From an import (`imports/<id>`) or a path package rather than the library */
  path: boolean;
  /** What it is, once read (else why it couldn't be) */
  info: { name: string; abbreviation: string; license: string | null; kind: PackageKind } | null;
  problem: string | null;
}

/** A book package's EPUBs, copied into the packages folder (EPUB++ opens only vault files) */
interface PackageBook {
  dependency: string;
  /** The package's folder, from the vault's root */
  dir: string;
  /** Its EPUBs, relative to its folder */
  files: string[];
}

/** Where the copies of book packages' EPUBs are recorded (in the plugin's folder), so only those are ever removed */
const COPIES = "biblix-copies.json";

/** A package Bible's book files in the vault, for the reader */
export interface PackageFiles {
  dir: string;
  name: string;
  books: Map<number, string>;
}

/**
 * The Bibles and books a vault's `biblix.toml` asks for (and those its collections bring in), as
 * its `biblix.lock` pins them, read with biblix from the library (`.biblix/` by default: hidden and
 * not synced, so each device installs what the lock pins) or a path package's folder. They show in
 * the packages folder (`Biblix/` by default, with the vault's `biblix.toml`): a stub for each Bible
 * book, which the reader opens, and a copy of each book package's EPUBs, which EPUB++ opens and
 * verse search reads. Bibles give the translations references can name, with their own verse
 * counts. Their parsed cache is kept in the plugin's folder.
 *
 * `bx install` (with `BIBLIX_HOME` set to the library, in the packages folder) installs them too.
 */
export class BiblixBibles {
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
  /** The folder of the vault's biblix.toml ("" for its root), as last read */
  base = "";
  private loading: Promise<void> | null = null;

  constructor(
    private readonly plugin: ToposPlugin,
    /** Called when the packages were read again */
    private readonly changed: () => void,
  ) {}

  /** The library's folder in the vault: installed packages (the setting; `.biblix` by default) */
  libraryDir(): string {
    return this.plugin.settings.biblixLibrary.trim().replace(/^\/+|\/+$/g, "") || ".biblix";
  }

  /** The packages folder: biblix.toml, imports, stubs, and EPUB copies (the setting; `Biblix` by default) */
  booksDir(): string {
    return this.plugin.settings.biblixBooks.trim().replace(/^\/+|\/+$/g, "") || "Biblix";
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
    return dir ? `${dir}/biblix-cache` : null;
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
      console.warn("Topos Bible: moving the installed packages into the library", error);
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
      const biblix = Biblix.new();
      try {
        lock = (await adapter.exists(at(LOCK))) ? await adapter.read(at(LOCK)) : null;
        const project = biblix.parseProject(await adapter.read(at(MANIFEST)), lock);
        for (const name of project.unlocked()) problems.push(`${name}: not installed yet (run bx install)`);
        // What each package biblix.toml asks for is, so a collection's packages count as the vault's
        const kinds = new Map<string, PackageKind>();
        for (const entry of project.packages()) {
          const dir = this.dirOf(entry, base);
          const listed: InstalledPackage = { id: entry.id, name: entry.name, version: entry.version, dependencyOf: entry.dependencyOf, dir, path: entry.location.tag === "Path", info: null, problem: null };
          installed.push(listed);
          // Another package's own dependencies (a commentary's Bible) are its, not the vault's
          const ours = entry.dependencyOf === null || kinds.get(entry.dependencyOf) === PackageKind.Collection;
          try {
            if (!(await adapter.exists(`${dir}/${MANIFEST}`))) {
              missing = true;
              throw new Error(`not installed in ${dir} yet`);
            }
            const opened = await this.open(biblix, entry, base, problems, changed);
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
      new Notice(`Topos Bible: the files of ${changed.join(", ")} were edited in the library. Run "Restore edited Bible packages" to put them back (notes beside them stay).`, 15000);
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
    if (problems.length > 0) console.warn("Topos Bible: biblix packages", problems);
    this.changed();
    // A device the lock was synced to installs what it pins (once for each lock file)
    if (missing && lock !== null && lock !== this.installedFrom) {
      this.installedFrom = lock;
      void this.plugin.bibleManager.installLocked().catch((error: unknown) => {
        new Notice(`Topos Bible: couldn't install the vault's Bible packages: ${message(error)}`, 10000);
      });
    }
  }

  /** A locked package's folder, from the vault's root */
  dirOf(entry: LockedEntry, base = this.base): string {
    return entry.location.tag === "Library" ? `${this.libraryDir()}/${entry.location.dir}` : join(base, entry.location.dir);
  }

  /** A locked package: what it is, and its Bible or its books */
  private async open(
    biblix: Biblix,
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
    const pkg = biblix.openPackage(files, entry.features, cache);
    if (entry.checksum && pkg.checksum() !== entry.checksum) {
      problems.push(`${entry.id} ${entry.version}: its files changed since biblix.lock was written (Restore puts them back)`);
      changed.push(entry.name);
    }
    await this.saveCache(pkg);
    const info = pkg.info();
    const summary = { name: info.name, abbreviation: info.abbreviation, license: info.license ?? info.licenseFile ?? null, kind: info.kind };
    if (info.kind !== PackageKind.Bible) {
      const files = pkg.epubFiles();
      pkg.dispose();
      return { info: summary, bible: null, book: files.length > 0 ? { dependency: entry.name, dir, files } : null };
    }
    // The vault's own names for it, when its biblix.toml gives them (a fork's)
    const name = entry.abbreviation ?? info.abbreviation;
    const aliases = entry.aliases ?? info.aliases;
    return { info: summary, bible: { id: info.id, dependency: entry.name, name, aliases, pkg, books: new Map(), dir, stubs: new Map() }, book: null };
  }

  /** Writes what a package's cache wrote into the plugin's folder */
  private async saveCache(pkg: BiblixPackage): Promise<void> {
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
   * Each package Bible's books, as their stubs (`Biblix/bsb/usx/JHN.bible`): the reader, hover, and
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
   * Copies each book package's EPUBs into the packages folder (`Biblix/<package>/epub/book.epub`),
   * where EPUB++ opens them and verse search reads them; a copy that differs from the package (an
   * update, or an edit) is written again, so links and highlights keep their path. Copies of books
   * the vault no longer has are removed: only files this wrote, never others
   */
  private async syncCopies(): Promise<void> {
    const { vault } = this.plugin.app;
    const adapter = vault.adapter;
    const root = this.booksDir();
    const record = this.plugin.manifest?.dir ? `${this.plugin.manifest.dir}/${COPIES}` : null;
    const written = new Set<string>(record && (await adapter.exists(record)) ? (JSON.parse(await adapter.read(record)) as string[]) : []);
    const books = this.books.filter((b) => !RESERVED.includes(b.dependency));
    const wanted = new Set(books.flatMap((b) => b.files.map((f) => `${root}/${b.dependency}/${f}`)));
    // Known before they're written, so the index takes them as they're created
    const before = this.copies;
    this.copies = wanted;
    for (const book of books) {
      for (const file of book.files) {
        const path = `${root}/${book.dependency}/${file}`;
        const bytes = await adapter.readBinary(`${book.dir}/${file}`);
        const existing = vault.getFileByPath(path);
        if (existing) {
          if (existing.stat.size !== bytes.byteLength || !same(await vault.readBinary(existing), bytes)) await vault.modifyBinary(existing, bytes);
        } else {
          await this.folder(path.slice(0, path.lastIndexOf("/")));
          await vault.createBinary(path, bytes);
        }
        written.add(path);
      }
    }
    // A package listed but not installed here keeps its copies (they may have synced from another device)
    const kept = this.installed.filter((p) => p.problem !== null).map((p) => `${root}/${p.name}/`);
    for (const path of [...written]) {
      if (wanted.has(path) || kept.some((dir) => path.startsWith(dir))) continue;
      const file = vault.getFileByPath(path);
      if (file) await vault.delete(file);
      written.delete(path);
    }
    if (record) await adapter.write(record, JSON.stringify([...written].sort()));
    // Books the index may have passed over before they were known as the vault's
    if ([...wanted].some((path) => !before.has(path))) this.plugin.reindexSoon();
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
    const wanted = new Set<string>();
    for (const bible of this.bibles) {
      bible.stubs = new Map();
      if (RESERVED.includes(bible.dependency)) {
        this.problems.push(`${bible.dependency}: a package named like the library's own folders gets no book stubs`);
        continue;
      }
      for (const file of bible.pkg.bookFiles()) {
        const stub = { package: bible.dependency, path: file.path };
        const path = stubPath(root, stub);
        wanted.add(path);
        bible.stubs.set(file.bookId, path);
        const text = stubText(stub);
        const existing = vault.getFileByPath(path);
        if (existing) {
          if ((await vault.read(existing)) !== text) await vault.modify(existing, text);
        } else {
          await this.folder(path.slice(0, path.lastIndexOf("/")));
          await vault.create(path, text);
        }
      }
    }
    // Stubs of packages (or books) the vault no longer has
    const library = vault.getFolderByPath(root);
    const existing: TFile[] = [];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder && !(folder === library && RESERVED.includes(child.name))) walk(child);
        else if (child instanceof TFile && child.extension === STUB_EXTENSION) existing.push(child);
      }
    };
    if (library) walk(library);
    const stale = new Set(staleStubs(existing.map((f) => f.path), wanted));
    for (const file of existing.filter((f) => stale.has(f.path))) {
      // Only what is a stub (a file named .bible that isn't one stays)
      if (parseStub(await vault.read(file))) await vault.delete(file);
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
  async stubTarget(stub: TFile): Promise<{ path: string; bible: string } | null> {
    await this.loading;
    const named = parseStub(await this.plugin.app.vault.cachedRead(stub));
    const bible = named && this.bibles.find((b) => b.dependency === named.package);
    return named && bible ? { path: `${bible.dir}/${named.path}`, bible: bible.name } : null;
  }

  /** The stub of a package's book file (its path from the vault's root), if it has one */
  stubOf(path: string): string | null {
    for (const bible of this.bibles) {
      if (!path.startsWith(`${bible.dir}/`)) continue;
      const stub = stubPath(this.booksDir(), { package: bible.dependency, path: path.slice(bible.dir.length + 1) });
      if ([...bible.stubs.values()].includes(stub)) return stub;
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
