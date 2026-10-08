import { Biblix, PackageKind, type BiblixPackage, type LockedEntry, type PackageFile, type Passage, type ToposBook, type ToposTranslations } from "biblix";
import type ToposPlugin from "../main.ts";

/** The vault's manifest: at its root, else in the library's folder */
export const MANIFEST = "biblix.toml";
export const LOCK = "biblix.lock";

/** How many parsed books each package keeps */
const BOOKS_KEPT = 3;

/** A Bible from a biblix package */
interface PackageBible {
  id: string;
  /** What references name it by (`BSB`) */
  name: string;
  aliases: string[];
  pkg: BiblixPackage;
  /** Books read last */
  books: Map<number, ToposBook>;
  /** The package's folder, from the vault's root */
  dir: string;
}

/** A package the vault's lock file names, for the settings */
export interface InstalledPackage {
  id: string;
  version: string;
  /** Its folder, from the vault's root */
  dir: string;
  /** From an import (`imports/<id>`) or a path package rather than the library */
  path: boolean;
  /** What it is, once read (else why it couldn't be) */
  info: { name: string; abbreviation: string; license: string | null; kind: PackageKind } | null;
  problem: string | null;
}

/** A package Bible's book files in the vault, for the reader */
export interface PackageFiles {
  dir: string;
  name: string;
  books: Map<number, string>;
}

/**
 * The Bibles a vault's `biblix.toml` asks for, as its `biblix.lock` pins them, read from the library
 * (a folder in the vault, `Biblix/` by default) or a path package's folder with biblix. They're
 * Bibles like the vault's USX folders (their books are vault files the reader opens), and give the
 * translations references can name, with their own verse counts. Their parsed cache is kept in the
 * plugin's folder.
 *
 * Installing from the settings comes later; `bx install` (with `BIBLIX_HOME` set to the library)
 * puts packages there.
 */
export class BiblixBibles {
  private bibles: PackageBible[] = [];
  private defaultName: string | null = null;
  /** What couldn't be read, to show */
  problems: string[] = [];
  /** Every package the lock file names, as last read */
  installed: InstalledPackage[] = [];
  /** The folder of the vault's biblix.toml ("" for its root), as last read */
  base = "";
  private loading: Promise<void> | null = null;

  constructor(
    private readonly plugin: ToposPlugin,
    /** Called when the packages were read again */
    private readonly changed: () => void,
  ) {}

  /** The library's folder in the vault (the setting; `Biblix` by default) */
  libraryDir(): string {
    return this.plugin.settings.biblixLibrary.trim().replace(/^\/+|\/+$/g, "") || "Biblix";
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
    const base = (await adapter.exists(MANIFEST)) ? "" : this.libraryDir();
    const at = (name: string) => (base ? `${base}/${name}` : name);
    const problems: string[] = [];
    const bibles: PackageBible[] = [];
    const installed: InstalledPackage[] = [];
    let defaultName: string | null = null;
    if (await adapter.exists(at(MANIFEST))) {
      await this.plugin.engine();
      const biblix = Biblix.new();
      try {
        const lock = (await adapter.exists(at(LOCK))) ? await adapter.read(at(LOCK)) : null;
        const project = biblix.parseProject(await adapter.read(at(MANIFEST)), lock);
        for (const name of project.unlocked()) problems.push(`${name}: not installed yet (run bx install)`);
        for (const entry of project.packages()) {
          const dir = this.dirOf(entry, base);
          const listed: InstalledPackage = { id: entry.id, version: entry.version, dir, path: entry.location.tag === "Path", info: null, problem: null };
          installed.push(listed);
          try {
            const opened = await this.open(biblix, entry, base, problems);
            listed.info = opened.info;
            if (opened.bible) bibles.push(opened.bible);
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
    this.defaultName = defaultName;
    this.problems = problems;
    this.installed = installed;
    this.base = base;
    if (problems.length > 0) console.warn("Topos Bible: biblix packages", problems);
    this.changed();
  }

  /** A locked package's folder, from the vault's root */
  dirOf(entry: LockedEntry, base = this.base): string {
    return entry.location.tag === "Library" ? `${this.libraryDir()}/${entry.location.dir}` : join(base, entry.location.dir);
  }

  /** A locked package: what it is, and its Bible if it's one */
  private async open(biblix: Biblix, entry: LockedEntry, base: string, problems: string[]): Promise<{ info: InstalledPackage["info"]; bible: PackageBible | null }> {
    const adapter = this.plugin.app.vault.adapter;
    const dir = this.dirOf(entry, base);
    if (!(await adapter.exists(`${dir}/${MANIFEST}`))) throw new Error(`not installed in ${dir} (run bx install)`);
    const files = await readTree(this.plugin, dir);
    const cacheDir = this.cacheDir();
    // The cache is per package (`<id>/<version>-<checksum>/`)
    const cache = cacheDir && (await adapter.exists(`${cacheDir}/${entry.id}`)) ? await readTree(this.plugin, `${cacheDir}/${entry.id}`, `${entry.id}/`) : [];
    const pkg = biblix.openPackage(files, entry.features, cache);
    if (entry.checksum && pkg.checksum() !== entry.checksum) {
      problems.push(`${entry.id} ${entry.version}: its files changed since biblix.lock was written`);
    }
    await this.saveCache(pkg);
    const info = pkg.info();
    const summary = { name: info.name, abbreviation: info.abbreviation, license: info.license ?? info.licenseFile ?? null, kind: info.kind };
    if (info.kind !== PackageKind.Bible) {
      pkg.dispose();
      return { info: summary, bible: null };
    }
    return { info: summary, bible: { id: info.id, name: info.abbreviation, aliases: info.aliases, pkg, books: new Map(), dir } };
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

  /** Each package Bible's book files (in the vault, so the reader opens them) */
  files(): PackageFiles[] {
    return this.bibles.map((bible) => ({
      dir: bible.dir,
      name: bible.name,
      books: new Map(bible.pkg.bookFiles().map((f) => [f.bookId, `${bible.dir}/${f.path}`])),
    }));
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

/** The bytes as their own ArrayBuffer (Obsidian's writeBinary takes one) */
export function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
