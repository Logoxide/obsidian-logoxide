import { requestUrl } from "obsidian";
import { Logoxide, ChangeKind, type LogoxideCatalog, type LogoxideInstaller, type LogoxideProject, type CatalogEntry, type FetchRequest, type InstallStep, type PackageFile, type PackageLocation, type UpdateMode, type Upstream } from "logoxide";
import type ToposPlugin from "../main.ts";
import { LOCK, MANIFEST, buffer, join, message, mkdirs, readTree } from "./packages.ts";

/** How long a downloaded catalog is used before it's downloaded again */
const CATALOG_KEPT_MS = 24 * 60 * 60 * 1000;

/**
 * Adding, installing, and removing logoxide packages, with Obsidian doing the I/O: downloads through
 * `requestUrl` (which works on mobile and isn't held to CORS), files through the vault's adapter.
 * logoxide resolves exactly as `lx install` does, so the vault's `logoxide.lock` works with `lx` too.
 */
export class BibleManager {
  private catalog: LogoxideCatalog | null = null;
  private catalogLoading: Promise<LogoxideCatalog> | null = null;

  constructor(private readonly plugin: ToposPlugin) {}

  private get adapter() {
    return this.plugin.app.vault.adapter;
  }

  /** Where the vault's logoxide.toml is: at its root if it has one there, else in the packages folder */
  private async base(): Promise<string> {
    return (await this.adapter.exists(MANIFEST)) ? "" : this.plugin.packages.booksDir();
  }

  private async project(logoxide: Logoxide): Promise<{ project: LogoxideProject; base: string }> {
    const base = await this.base();
    const at = (name: string) => join(base, name);
    const manifest = (await this.adapter.exists(at(MANIFEST))) ? await this.adapter.read(at(MANIFEST)) : null;
    const lock = (await this.adapter.exists(at(LOCK))) ? await this.adapter.read(at(LOCK)) : null;
    return { project: logoxide.parseProject(manifest, lock), base };
  }

  /** Every catalog the vault searches (its own, then the defaults: eBible.org's, fetch.bible's, CCEL's, CrossWire's), downloaded at most once a day */
  async catalogs(): Promise<LogoxideCatalog> {
    if (this.catalog) return this.catalog;
    this.catalogLoading ??= this.loadCatalogs().finally(() => (this.catalogLoading = null));
    return this.catalogLoading;
  }

  private async loadCatalogs(): Promise<LogoxideCatalog> {
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    let merged: LogoxideCatalog | null = null;
    const failed: string[] = [];
    // The vault's registries first (catalogs; a folder of repositories is only for lx), then its catalogs
    const registries = project.registries().map((r) => r.location);
    for (const location of [...registries, ...project.catalogs()]) {
      try {
        const catalog = logoxide.parseCatalogBytes(location, await this.catalogBytes(location, base));
        if (merged) {
          const next: LogoxideCatalog = merged.merge(catalog);
          merged.dispose();
          catalog.dispose();
          merged = next;
        } else merged = catalog;
      } catch (error) {
        failed.push(`${location}: ${message(error)}`);
      }
    }
    project.dispose();
    if (!merged) throw new Error(failed.join("\n") || "no catalogs");
    if (failed.length > 0) console.warn("Logoxide: catalogs", failed);
    this.catalog = merged;
    return merged;
  }

  /** A catalog's bytes (a SWORD repository's is a `.tar.gz`): downloaded (kept a day in the plugin's folder), or a file in the vault */
  private async catalogBytes(location: string, base: string): Promise<Uint8Array> {
    if (!/^https?:\/\//.test(location)) return new Uint8Array(await this.adapter.readBinary(join(base, location)));
    const dir = this.plugin.manifest?.dir;
    const saved = dir ? `${dir}/catalogs/${location.replace(/[^A-Za-z0-9.]+/g, "_")}` : null;
    if (saved && (await this.adapter.exists(saved))) {
      const stat = await this.adapter.stat(saved);
      if (stat && Date.now() - stat.mtime < CATALOG_KEPT_MS) return new Uint8Array(await this.adapter.readBinary(saved));
    }
    const bytes = await download(location);
    if (saved) {
      await mkdirs(this.plugin, `${dir}/catalogs`);
      await this.adapter.writeBinary(saved, bytes);
    }
    return new Uint8Array(bytes);
  }

  /** Downloads every catalog again when next searched (new releases show without waiting a day) */
  async refreshCatalogs(): Promise<void> {
    const dir = this.plugin.manifest?.dir;
    if (dir && (await this.adapter.exists(`${dir}/catalogs`))) await this.adapter.rmdir(`${dir}/catalogs`, true);
    this.catalog?.dispose();
    this.catalog = null;
  }

  /** The catalogs searched, in order, and whether each is one of the defaults (eBible.org's, fetch.bible's, CCEL's, CrossWire's) */
  async catalogList(): Promise<{ location: string; isDefault: boolean }[]> {
    await this.plugin.engine();
    const { project } = await this.project(Logoxide.new());
    const list = project.catalogs().map((location) => ({ location, isDefault: project.isDefaultCatalog(location) }));
    project.dispose();
    return list;
  }

  /** Searches a catalog too (a URL, or a path relative to logoxide.toml), after reading it to check it; how many packages it lists */
  async addCatalog(location: string): Promise<number> {
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    const catalog = logoxide.parseCatalogBytes(location, await this.catalogBytes(location, base));
    const count = catalog.count();
    catalog.dispose();
    const added = project.addCatalog(location);
    project.dispose();
    await this.saveManifest(added, base);
    return count;
  }

  /** The vault's registries, by name */
  async registryList(): Promise<{ name: string; location: string }[]> {
    await this.plugin.engine();
    const { project } = await this.project(Logoxide.new());
    const list = project.registries().map((r) => ({ name: r.name, location: r.location }));
    project.dispose();
    return list;
  }

  /** Names a registry (a catalog's URL, or a file in the vault), after reading it to check it; how many packages it lists */
  async addRegistry(name: string, location: string): Promise<number> {
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    const catalog = logoxide.parseCatalogBytes(location, await this.catalogBytes(location, base));
    const count = catalog.count();
    catalog.dispose();
    const added = project.addRegistry(name, location);
    project.dispose();
    await this.saveManifest(added, base);
    return count;
  }

  async removeRegistry(name: string): Promise<void> {
    await this.plugin.engine();
    const { project, base } = await this.project(Logoxide.new());
    const removed = project.removeRegistry(name);
    project.dispose();
    await this.saveManifest(removed, base);
  }

  /** Stops searching a catalog (removing a default one turns the defaults off, keeping the other) */
  async removeCatalog(location: string): Promise<void> {
    await this.plugin.engine();
    const { project, base } = await this.project(Logoxide.new());
    const removed = project.removeCatalog(location);
    project.dispose();
    await this.saveManifest(removed, base);
  }

  private async saveManifest(project: LogoxideProject, base: string): Promise<void> {
    await mkdirs(this.plugin, base);
    await this.adapter.write(join(base, MANIFEST), project.manifestText());
    project.dispose();
    this.catalog?.dispose();
    this.catalog = null;
  }

  /** The catalogs' packages that `query` matches, best first */
  async search(query: string, limit = 50): Promise<CatalogEntry[]> {
    return (await this.catalogs()).search(query, limit);
  }

  /** Answers what an installer asks for: downloads, or files in the vault */
  private async answer(installer: LogoxideInstaller, request: FetchRequest, base: string): Promise<void> {
    // A registry's catalog or a release's archive: from the web, or a file in the vault
    if (request.tag === "Download") {
      if (/^(\/|file:\/\/)/.test(request.url)) throw new Error(`${request.url} is a file outside the vault: use lx for it, or a registry on the web`);
      const bytes = /^https?:\/\//.test(request.url) ? await download(request.url) : await this.adapter.readBinary(join(base, request.url));
      installer.provideDownload(request.url, new Uint8Array(bytes));
      return;
    }
    if (request.tag !== "Files" && !/^https?:\/\//.test(request.repository)) {
      throw new Error(`${request.repository} isn't on the web: use lx for it (lx install, lx update, or lx install --repair to restore it)`);
    }
    if (request.tag === "Refs") {
      installer.provideRefs(request.repository, new Uint8Array(await download(request.url)));
    } else if (request.tag === "Archive") {
      let last: unknown = null;
      for (const url of request.urls) {
        try {
          installer.provideArchive(request.repository, request.commit, new Uint8Array(await download(url)));
          return;
        } catch (error) {
          last = error;
        }
      }
      throw new Error(`${request.repository} at ${request.commit.slice(0, 8)}: ${message(last)}`);
    } else {
      const dir = this.locationDir(request.location, base);
      if (await this.adapter.exists(`${dir}/${MANIFEST}`)) installer.provideFiles(request.location, await readTree(this.plugin, dir));
      else installer.provideMissing(request.location);
    }
  }

  private locationDir(location: PackageLocation, base: string): string {
    return location.tag === "Library" ? `${this.plugin.packages.libraryDir()}/${location.dir}` : join(base, location.dir);
  }

  /** Installs the project's packages, then saves its manifest and lock file and reads the packages again; the lock's text */
  private async install(logoxide: Logoxide, project: LogoxideProject, base: string, installer = logoxide.installer(), update: UpdateMode = { tag: "Nothing" }): Promise<string> {
    let step: InstallStep = installer.install(project, update);
    while (step.tag === "Fetch") {
      await this.answer(installer, step.request, base);
      step = installer.install(project, update);
    }
    const library = this.plugin.packages.libraryDir();
    for (const file of step.files) {
      const path = `${library}/${file.path}`;
      await mkdirs(this.plugin, path.slice(0, path.lastIndexOf("/")));
      await this.adapter.writeBinary(path, buffer(file.bytes));
    }
    await mkdirs(this.plugin, base);
    await this.adapter.write(join(base, MANIFEST), project.manifestText());
    await this.adapter.write(join(base, LOCK), step.lock);
    installer.dispose();
    await this.plugin.packages.load();
    return step.lock;
  }

  /** Adds a git repository's package (its newest release) and installs it; its id */
  async addGit(url: string): Promise<string> {
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    const installer = logoxide.installer();
    let step = installer.inspect(url, null, null, null);
    while (step.tag === "Fetch") {
      await this.answer(installer, step.request, base);
      step = installer.inspect(url, null, null, null);
    }
    const { info } = step.inspected;
    const added = project.addDependency(info.id, { git: url, registry: null, path: null, version: info.version, tag: null, branch: null, rev: null, features: [], defaultFeatures: true, packageId: null, abbreviation: null, aliases: null });
    project.dispose();
    // The same installer: it has the archive already
    await this.install(logoxide, added, base, installer);
    added.dispose();
    return info.abbreviation;
  }

  /** Adds a registry's package (its newest release, as `lx add` would) and installs it; its abbreviation */
  private async addRelease(entry: CatalogEntry, catalog: string): Promise<string> {
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    const newest = entry.releases.at(-1)?.version ?? null;
    const added = project.addDependency(entry.id, { git: null, registry: catalog, path: null, version: newest, tag: null, branch: null, rev: null, features: [], defaultFeatures: true, packageId: null, abbreviation: null, aliases: null });
    project.dispose();
    await this.install(logoxide, added, base);
    added.dispose();
    return entry.abbreviation;
  }

  /** Installs a catalog entry: adds its repository or its registry's newest release, or imports eBible.org's, fetch.bible's, CCEL's, or a SWORD repository's download */
  async addEntry(entry: CatalogEntry): Promise<string> {
    if (entry.source.tag === "Git") return this.addGit(entry.source.url);
    if (entry.source.tag === "Registry") return this.addRelease(entry, entry.source.catalog);
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    const relative = `imports/${entry.id}`;
    const dir = join(base, relative);
    if (await this.adapter.exists(dir)) throw new Error(`${dir} already exists`);
    const files = await importFiles(logoxide, entry);
    for (const file of files) {
      const path = `${dir}/${file.path}`;
      await mkdirs(this.plugin, path.slice(0, path.lastIndexOf("/")));
      await this.adapter.writeBinary(path, buffer(file.bytes));
    }
    const added = project.addDependency(entry.id, { git: null, registry: null, path: relative, version: null, tag: null, branch: null, rev: null, features: [], defaultFeatures: true, packageId: null, abbreviation: null, aliases: null });
    project.dispose();
    await this.install(logoxide, added, base);
    added.dispose();
    return entry.abbreviation;
  }

  /**
   * Puts back the files of installed packages that were edited (downloading them again; files
   * beside them that aren't the package's, like annotations, stay); which were restored
   */
  async restore(): Promise<string[]> {
    await this.plugin.engine();
    const changed = [...this.plugin.packages.changedPackages];
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    await this.install(logoxide, project, base, logoxide.installer(), { tag: "Repair" });
    project.dispose();
    return changed;
  }

  /**
   * Installs what the vault's logoxide.lock pins and this device's library doesn't have (the lock
   * synced from another device), exactly as locked
   */
  async installLocked(): Promise<void> {
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    await this.install(logoxide, project, base);
    project.dispose();
  }

  /** Moves every git package to the newest release its requirement allows (like `lx update`); what changed */
  async update(): Promise<string[]> {
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    const before = new Map(project.packages().map((p) => [p.id, p.version]));
    const lock = await this.install(logoxide, project, base, logoxide.installer(), { tag: "All" });
    const after = logoxide.parseProject(project.manifestText(), lock);
    const changed = after
      .packages()
      .filter((p) => before.get(p.id) !== p.version)
      .map((p) => `${p.id} ${before.get(p.id) ?? "new"} → ${p.version}`);
    after.dispose();
    project.dispose();
    return changed;
  }

  /**
   * Makes each import (`imports/<id>/`) again from its publisher's download, like
   * `lx import --update`, and replaces those that changed (unless only checking), then locks them
   * again; a line for each. eBible.org's and SWORD imports are downloaded only when their catalog
   * lists a newer version; fetch.bible's and CCEL's each time (their texts change without one)
   */
  async updateImports(checkOnly = false): Promise<string[]> {
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    const catalog = await this.catalogs();
    const lines: string[] = [];
    const changed: string[] = [];
    const imports = project.packages().filter((p) => p.dependencyOf === null && p.location.tag === "Path" && p.location.dir.startsWith("imports/"));
    for (const entry of imports) {
      const dir = this.locationDir(entry.location, base);
      try {
        const current = await readTree(this.plugin, dir);
        const pkg = logoxide.openPackage(current, entry.features, []);
        const upstream = pkg.info().upstream;
        pkg.dispose();
        if (!upstream) continue;
        const from = await this.importEntry(logoxide, catalog, upstream, base);
        if (!from) {
          lines.push(`${entry.name}: in none of the catalogs searched`);
          continue;
        }
        if (logoxide.importIsCurrent(from, upstream.version)) {
          lines.push(`${entry.name} ${entry.version}: up to date`);
          continue;
        }
        const update = logoxide.updateImport(current, await importFiles(logoxide, from));
        if (!update) {
          lines.push(`${entry.name} ${entry.version}: up to date`);
          continue;
        }
        const publisher = update.upstreamFrom !== update.upstreamTo ? `, the publisher's ${update.upstreamFrom ?? "?"} → ${update.upstreamTo ?? "?"}` : "";
        lines.push(`${entry.name} ${update.from} → ${update.to}: ${update.description} (${changeName(update.change)} change${publisher})`);
        if (checkOnly) continue;
        for (const path of update.removed) {
          if (await this.adapter.exists(`${dir}/${path}`)) await this.adapter.remove(`${dir}/${path}`);
        }
        for (const file of update.files) {
          const path = `${dir}/${file.path}`;
          await mkdirs(this.plugin, path.slice(0, path.lastIndexOf("/")));
          await this.adapter.writeBinary(path, buffer(file.bytes));
        }
        changed.push(entry.id);
      } catch (error) {
        lines.push(`${entry.name}: ${message(error)}`);
      }
    }
    if (changed.length > 0) {
      await this.install(logoxide, project, base, logoxide.installer(), { tag: "Only", ids: changed });
      await this.plugin.packages.load();
    }
    project.dispose();
    return lines;
  }

  /** The catalog entry an import was made from, by its upstream: in the catalogs searched, else (a SWORD module) its repository's */
  private async importEntry(logoxide: Logoxide, catalog: LogoxideCatalog, upstream: Upstream, base: string): Promise<CatalogEntry | null> {
    const found = catalog.findUpstream(upstream);
    const url = upstream.url ?? "";
    const root = url.split("/packages/")[0];
    if (found || root === url || !root) return found ?? null;
    const location = `${root}/mods.d.tar.gz`;
    const repository = logoxide.parseCatalogBytes(location, await this.catalogBytes(location, base));
    const entry = repository.findUpstream(upstream);
    repository.dispose();
    return entry ?? null;
  }

  /**
   * Turns a package on or off by what logoxide.toml calls it (`enabled = false`): off, it stays installed and locked, so turning it on
   * again needs no download, but it isn't read
   */
  async setEnabled(name: string, enabled: boolean): Promise<void> {
    await this.plugin.engine();
    const { project, base } = await this.project(Logoxide.new());
    const changed = project.setEnabled(name, enabled);
    project.dispose();
    await this.adapter.write(join(base, MANIFEST), changed.manifestText());
    changed.dispose();
    await this.plugin.packages.load();
  }

  /** Removes a package from the vault's manifest, and its files (unless another entry uses them) */
  async remove(id: string): Promise<void> {
    await this.plugin.engine();
    const logoxide = Logoxide.new();
    const { project, base } = await this.project(logoxide);
    const gone = project.packages().filter((p) => p.id === id);
    const removed = project.removeDependency(id);
    project.dispose();
    const lock = await this.install(logoxide, removed, base);
    const after = logoxide.parseProject(removed.manifestText(), lock);
    const kept = new Set(after.packages().map((p) => this.locationDir(p.location, base)));
    after.dispose();
    removed.dispose();
    for (const entry of gone) {
      const dir = this.locationDir(entry.location, base);
      // A path package is only removed when the vault imported it
      const imported = entry.location.tag === "Path" && entry.location.dir.startsWith("imports/");
      if (kept.has(dir) || (entry.location.tag === "Path" && !imported)) continue;
      if (await this.adapter.exists(dir)) await this.adapter.rmdir(dir, true);
    }
    await this.plugin.packages.load();
  }
}

/** Each of fetch.bible's books (a few at a time), with its code as the path */
async function downloadBooks(books: { code: string; url: string }[]): Promise<{ path: string; bytes: Uint8Array }[]> {
  const files: { path: string; bytes: Uint8Array }[] = [];
  const queue = [...books];
  const worker = async () => {
    for (let book = queue.shift(); book; book = queue.shift()) {
      files.push({ path: book.code, bytes: new Uint8Array(await download(book.url)) });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return files;
}

/** A change's kind in words (`minor`) */
function changeName(change: ChangeKind): string {
  return (Object.entries(ChangeKind).find(([, value]) => value === change)?.[0] ?? "").toLowerCase();
}

/** A catalog entry's import: its publisher's download made into a package's files */
async function importFiles(logoxide: Logoxide, entry: CatalogEntry): Promise<PackageFile[]> {
  const source = entry.source;
  if (source.tag === "Ebible") return logoxide.importEbible(entry, new Uint8Array(await download(source.zipUrl)));
  if (source.tag === "Ccel") return logoxide.importCcel(entry, new Uint8Array(await download(source.url)));
  if (source.tag === "Sword") return logoxide.importSword(entry, new Uint8Array(await downloadFirst(source.zipUrls)));
  if (source.tag === "FetchBible") return logoxide.importFetchBible(entry, await downloadBooks(source.books));
  throw new Error(`${entry.id} isn't imported: add it`);
}

/** The bytes of the first of these URLs that answers (a SWORD module's zip, under its name or in lowercase) */
async function downloadFirst(urls: string[]): Promise<ArrayBuffer> {
  let failed: unknown = new Error("nothing to download");
  for (const url of urls) {
    try {
      return await download(url);
    } catch (error) {
      failed = error;
    }
  }
  throw failed;
}

/** A URL's bytes through Obsidian (redirects followed, no CORS) */
export async function download(url: string): Promise<ArrayBuffer> {
  const response = await requestUrl({ url, throw: false });
  if (response.status >= 400) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer;
}
