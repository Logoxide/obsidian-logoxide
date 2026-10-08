import { TFile, type TAbstractFile } from "obsidian";
import type { Passage } from "topos-bible";
import { codeFromUsx, groupBibles, type Bible } from "../core/bibles.ts";
import type ToposPlugin from "../main.ts";

/** The Bibles in the vault (folders of USX files), kept up to date as files change */
export class BibleLibrary {
  private cached: Bible[] | null = null;

  constructor(private readonly plugin: ToposPlugin) {}

  /** Starts watching the vault for USX files */
  start(): void {
    const { vault } = this.plugin.app;
    const changed = (file: TAbstractFile) => {
      if (file instanceof TFile && file.extension === "usx") this.cached = null;
    };
    this.plugin.registerEvent(vault.on("create", changed));
    this.plugin.registerEvent(vault.on("delete", changed));
    this.plugin.registerEvent(vault.on("rename", (file) => changed(file)));
  }

  all(): Bible[] {
    if (!this.cached) {
      const files = this.plugin.app.vault
        .getFiles()
        .filter((f) => f.extension === "usx")
        .map((f) => ({ path: f.path, basename: f.basename, folder: f.parent?.path ?? "" }));
      const ids = new Map(this.plugin.topos.books().filter((b) => b.usfm).map((b) => [b.usfm, b.id]));
      this.cached = groupBibles(files, ids);
    }
    return this.cached;
  }

  /** The Bible references open in: the chosen one, else the first */
  current(): Bible | null {
    const bibles = this.all();
    return bibles.find((b) => b.folder === this.plugin.settings.bible) ?? bibles[0] ?? null;
  }

  /** The file of a passage's book in a Bible (the current one by default) */
  async bookFile(passage: Passage | number, bible = this.current()): Promise<TFile | null> {
    if (!bible) return null;
    const id = typeof passage === "number" ? passage : passage.bookId;
    if (!bible.books.has(id) && bible.unknown.length > 0) await this.readUnknown(bible);
    const path = bible.books.get(id);
    return path ? this.plugin.app.vault.getFileByPath(path) : null;
  }

  /** The path of a book's file in the current Bible, if known now (else it's looked up for next time) */
  bookPath(bookId: number): string | null {
    const bible = this.current();
    if (!bible) return null;
    const path = bible.books.get(bookId);
    if (!path && bible.unknown.length > 0) void this.readUnknown(bible);
    return path ?? null;
  }

  /** Reads the book code of files whose names don't say which book they are */
  private async readUnknown(bible: Bible): Promise<void> {
    const ids = new Map(this.plugin.topos.books().filter((b) => b.usfm).map((b) => [b.usfm, b.id]));
    const unknown = bible.unknown;
    bible.unknown = [];
    for (const path of unknown) {
      const file = this.plugin.app.vault.getFileByPath(path);
      if (!file) continue;
      const code = codeFromUsx(await this.plugin.app.vault.cachedRead(file));
      const id = code ? ids.get(code) : undefined;
      if (id !== undefined && !bible.books.has(id)) bible.books.set(id, path);
    }
  }
}
