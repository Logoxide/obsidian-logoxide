import { Notice, TFile } from "obsidian";
import { retargetLinks, type NoteLink } from "../core/retarget.ts";
import { fileName, folderStubText, parseFolderStub, STUB_EXTENSION } from "../core/stubs.ts";
import type ToposPlugin from "../main.ts";

/**
 * Folder Bibles' stubs: a book-named file beside each book of a folder of USX (or USFM) files
 * (`Bibles/BSB/John.bible` beside `JHN.usx`, see `core/stubs.ts`), through which the Bible's books
 * open, with the `folderStubs` setting. Links to a book's file (highlights in its annotation file,
 * links in notes) are moved to its stub, as a rename would move them; turned off, they move back
 * and the stubs are removed. The book files themselves are never changed.
 */
export class FolderStubs {
  /** Each book file's stub, by the file's path */
  private readonly byFile = new Map<string, string>();
  /** Each stub's book file, by the stub's path */
  private readonly byStub = new Map<string, string>();
  /** Each book file's book, by its path (for files whose names don't say), once synced */
  private readonly ids = new Map<string, number>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: number | null = null;

  constructor(private readonly plugin: ToposPlugin) {}

  /** A book file's stub, if it has one */
  stubOf(path: string): string | null {
    return this.byFile.get(path) ?? null;
  }

  /** A stubbed book file's book id, once synced */
  idOf(path: string): number | null {
    return this.byFile.has(path) ? (this.ids.get(path) ?? null) : null;
  }

  /** The book file a stub stands in for, if it's a folder Bible's stub */
  sourceOf(path: string): string | null {
    return this.byStub.get(path) ?? null;
  }

  /** The book file a stub names (read from it when it isn't known yet: a tab restored on startup) */
  async resolve(stub: TFile): Promise<TFile | null> {
    const { vault } = this.plugin.app;
    const known = this.byStub.get(stub.path);
    if (known) return vault.getFileByPath(known);
    const name = parseFolderStub(await vault.cachedRead(stub));
    return name ? vault.getFileByPath(stub.parent && stub.parent.path !== "/" ? `${stub.parent.path}/${name}` : name) : null;
  }

  /** Reads the stubs in the vault, then makes them match the Bibles */
  async start(): Promise<void> {
    await this.readExisting();
    this.plugin.bibles.reset();
    await this.sync();
  }

  /** Syncs soon (book files are added a whole Bible at a time) */
  soon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, 1000);
  }

  /** Makes the stubs match the folder Bibles (once at a time), or removes them when the setting is off */
  async sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (this.plugin.settings.folderStubs ? this.write() : this.removeAll()).finally(() => (this.running = null));
    try {
      await this.running;
    } catch (error) {
      new Notice(`Logoxide couldn't name the Bibles' books: ${error instanceof Error ? error.message : String(error)}`, 10000);
    }
    if (this.again) {
      this.again = false;
      await this.sync();
    }
  }

  /** The folder Bibles' stubs in the vault now (outside the packages folder, whose stubs are packages'), by path, with the file each names */
  private async existing(): Promise<Map<TFile, string>> {
    const { vault } = this.plugin.app;
    const packages = this.plugin.packages.booksDir();
    const found = new Map<TFile, string>();
    for (const file of vault.getFiles()) {
      if (file.extension !== STUB_EXTENSION || file.path.startsWith(`${packages}/`)) continue;
      const name = parseFolderStub(await vault.cachedRead(file));
      if (name) found.set(file, file.parent && file.parent.path !== "/" ? `${file.parent.path}/${name}` : name);
    }
    return found;
  }

  private async readExisting(): Promise<void> {
    this.byFile.clear();
    this.byStub.clear();
    if (!this.plugin.settings.folderStubs) return;
    for (const [stub, target] of await this.existing()) {
      if (!this.plugin.app.vault.getFileByPath(target)) continue;
      this.byFile.set(target, stub.path);
      this.byStub.set(stub.path, target);
    }
  }

  /** A stub for each folder Bible's book (named by the book), links moved to it; stubs of books no longer there removed */
  private async write(): Promise<void> {
    const { vault } = this.plugin.app;
    await this.resolved();
    const names = new Map(this.plugin.topos.books().map((b) => [b.id, fileName(b.name)]));
    const wanted = new Map<string, string>();
    this.ids.clear();
    for (const bible of await this.plugin.bibles.folderBibles()) {
      for (const [id, path] of bible.books) {
        this.ids.set(path, id);
        const name = names.get(id);
        if (name) wanted.set(bible.folder ? `${bible.folder}/${name}.${STUB_EXTENSION}` : `${name}.${STUB_EXTENSION}`, path);
      }
    }
    const existing = await this.existing();
    const problems: string[] = [];
    let created = 0;
    for (const [stubPath, target] of wanted) {
      const there = vault.getFileByPath(stubPath);
      if (there) {
        if (existing.get(there) === target) continue;
        // A file of the user's own with the book's name, or a stub naming another file: left as it is
        problems.push(stubPath);
        wanted.delete(stubPath);
        continue;
      }
      await vault.create(stubPath, folderStubText(target.slice(target.lastIndexOf("/") + 1)));
      created++;
    }
    // Stubs of book files no longer there (or named otherwise now): their links go back, then they go
    let removed = 0;
    for (const [stub, target] of existing) {
      if (wanted.get(stub.path) === target) continue;
      const file = vault.getFileByPath(target);
      if (file) await this.moveLinks(stub, file);
      await vault.delete(stub);
      removed++;
    }
    this.byFile.clear();
    this.byStub.clear();
    for (const [stubPath, target] of wanted) {
      this.byFile.set(target, stubPath);
      this.byStub.set(stubPath, target);
    }
    // Links to the book files (highlights, links in notes) now go to their stubs
    let moved = 0;
    for (const [stubPath, target] of wanted) {
      const [stub, file] = [vault.getFileByPath(stubPath), vault.getFileByPath(target)];
      if (stub && file) moved += await this.moveLinks(file, stub);
    }
    if (created || removed) this.changed();
    if (moved) new Notice(`Moved ${moved} link${moved === 1 ? "" : "s"} to the Bibles' books from their files`);
    if (problems.length) new Notice(`Logoxide left these as they are, since they aren't its book files: ${problems.join(", ")}`, 10000);
  }

  /** Every folder Bible's stub removed, its links moved back to the book's file */
  private async removeAll(): Promise<void> {
    const { vault } = this.plugin.app;
    await this.resolved();
    let removed = 0;
    let moved = 0;
    for (const [stub, target] of await this.existing()) {
      const file = vault.getFileByPath(target);
      if (file) moved += await this.moveLinks(stub, file);
      await vault.delete(stub);
      removed++;
    }
    this.byFile.clear();
    this.byStub.clear();
    if (removed) this.changed();
    if (moved) new Notice(`Moved ${moved} link${moved === 1 ? "" : "s"} back to the Bibles' book files`);
  }

  /** The Bibles changed: read them again, and redraw what shows them */
  private changed(): void {
    this.plugin.bibles.reset();
    this.plugin.resetTranslations(true);
    this.plugin.applyBookFileHiding();
  }

  /** Waits for Obsidian to have read every note's links */
  private async resolved(): Promise<void> {
    const cache = this.plugin.app.metadataCache as typeof this.plugin.app.metadataCache & { resolved?: boolean };
    if (cache.resolved !== false) return;
    await new Promise<void>((done) => {
      const ref = cache.on("resolved", () => {
        cache.offref(ref);
        done();
      });
    });
  }

  /** Points every link to `from` at `to` instead (in notes' text and properties); how many it changed */
  private async moveLinks(from: TFile, to: TFile): Promise<number> {
    const { metadataCache, vault } = this.plugin.app;
    let moved = 0;
    for (const [notePath, targets] of Object.entries(metadataCache.resolvedLinks)) {
      if (!targets[from.path]) continue;
      const note = vault.getFileByPath(notePath);
      const cache = note && metadataCache.getFileCache(note);
      if (!note || !cache) continue;
      const toFrom = (link: string) => metadataCache.getFirstLinkpathDest(link.split("#")[0] ?? "", notePath) === from;
      const links: NoteLink[] = [
        ...[...(cache.links ?? []), ...(cache.embeds ?? [])]
          .filter((l) => toFrom(l.link))
          .map((l) => ({ start: l.position.start.offset, end: l.position.end.offset, original: l.original, link: l.link })),
        ...(cache.frontmatterLinks ?? []).filter((l) => toFrom(l.link)).map((l) => ({ start: null, end: null, original: l.original, link: l.link })),
      ];
      if (links.length === 0) continue;
      const linktext = metadataCache.fileToLinktext(to, notePath, false);
      await vault.process(note, (text) => {
        const result = retargetLinks(text, links, linktext);
        moved += result.changed;
        return result.text;
      });
    }
    return moved;
  }
}
