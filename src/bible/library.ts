import { TFile, type TAbstractFile } from "obsidian";
import { LogoxideBook, type Passage } from "logoxide";
import { BOOK_EXTENSIONS, bookFiles, codeFromUsx, groupBibles, type Bible } from "../core/bibles.ts";
import type ToposPlugin from "../main.ts";

/** How many parsed books `text` keeps */
const BOOKS_KEPT = 3;

/**
 * The Bibles in the vault: folders of USX (or USFM) files, and logoxide packages (installed in the
 * library's folder, or path packages), kept up to date as files change
 */
export class BibleLibrary {
  private cached: Bible[] | null = null;
  /** The folder Bibles, by their book files (before stubs stand in for them) */
  private folders: Bible[] | null = null;
  /** The books `text` read last, by path and modification time (suggestions read the same ones again) */
  private readonly books = new Map<string, LogoxideBook>();

  constructor(
    private readonly plugin: ToposPlugin,
    /** Called when book files are added, removed, or renamed */
    private readonly changed: () => void = () => {},
  ) {}

  /** Starts watching the vault for USX files */
  start(): void {
    const { vault } = this.plugin.app;
    const changed = (file: TAbstractFile) => {
      if (!(file instanceof TFile && BOOK_EXTENSIONS.includes(file.extension))) return;
      this.cached = null;
      this.folders = null;
      this.changed();
    };
    this.plugin.registerEvent(vault.on("create", changed));
    this.plugin.registerEvent(vault.on("delete", changed));
    this.plugin.registerEvent(vault.on("rename", (file) => changed(file)));
  }

  /** Reads the Bibles again when next asked (logoxide's packages changed, or stubs were written) */
  reset(): void {
    this.cached = null;
  }

  /** The folders of USX (or USFM) files, each book by its own file, with every file's book read */
  async folderBibles(): Promise<Bible[]> {
    if (!this.folders) {
      const inPackage = (path: string) => this.plugin.packages.isPackageFile(path);
      const files = this.plugin.app.vault
        .getFiles()
        .filter((f) => BOOK_EXTENSIONS.includes(f.extension) && !inPackage(f.path))
        .map((f) => ({ path: f.path, basename: f.basename, folder: f.parent?.path ?? "" }));
      const ids = new Map(this.plugin.topos.books().filter((b) => b.usfm).map((b) => [b.usfm, b.id]));
      this.folders = groupBibles(files, ids);
    }
    for (const bible of this.folders) if (bible.unknown.length > 0) await this.readUnknown(bible);
    return this.folders;
  }

  all(): Bible[] {
    if (!this.cached) {
      // Installed packages are Bibles of their own, named by their abbreviation (their books
      // open through their stubs), so their files aren't folder Bibles
      const packages = this.plugin.packages.files();
      const inPackage = (path: string) => this.plugin.packages.isPackageFile(path);
      const files = this.plugin.app.vault
        .getFiles()
        .filter((f) => BOOK_EXTENSIONS.includes(f.extension) && !inPackage(f.path))
        .map((f) => ({ path: f.path, basename: f.basename, folder: f.parent?.path ?? "" }));
      const ids = new Map(this.plugin.topos.books().filter((b) => b.usfm).map((b) => [b.usfm, b.id]));
      const fromPackages = packages.map((p): Bible => ({ folder: p.dir, name: p.name, books: p.books, unknown: [], package: true }));
      // A folder Bible's books open through their stubs (book-named), when they have them
      const stubs = this.plugin.folderStubs;
      const folders = groupBibles(files, ids).map((bible): Bible => {
        if (![...bible.books.values(), ...bible.unknown].some((path) => stubs.stubOf(path))) return bible;
        // Files whose names don't say their book: known from when their stubs were made
        const files = new Map(bible.books);
        const unknown = bible.unknown.filter((path) => {
          const id = stubs.idOf(path);
          if (id === null || files.has(id)) return true;
          files.set(id, path);
          return false;
        });
        const books = new Map([...files].map(([id, path]) => [id, stubs.stubOf(path) ?? path]));
        return { ...bible, books, files, unknown };
      });
      this.cached = [...folders, ...fromPackages].sort((a, b) => a.name.localeCompare(b.name));
    }
    return this.cached;
  }

  /** The Bible references open in: the chosen one, else the first */
  current(): Bible | null {
    const bibles = this.all();
    return bibles.find((b) => b.folder === this.plugin.settings.bible) ?? bibles[0] ?? null;
  }

  /** A Bible by its name or an alias of it (ignoring case), if the vault has it */
  named(name: string): Bible | null {
    const listed = this.plugin.translations().get(name) ?? name;
    return this.all().find((b) => b.name.toLowerCase() === listed.toLowerCase()) ?? null;
  }

  /**
   * The Bible a reference's text comes from: the one it names, else the current one (also when the
   * vault doesn't have the one it names)
   */
  forText(translation?: string | null): Bible | null {
    return (translation ? this.named(translation) : null) ?? this.current();
  }

  /** The file of a passage's book in a Bible (the current one by default) */
  async bookFile(passage: Passage | number, bible = this.current()): Promise<TFile | null> {
    if (!bible) return null;
    const id = typeof passage === "number" ? passage : passage.bookId;
    if (!bible.books.has(id) && bible.unknown.length > 0) await this.readUnknown(bible);
    const path = bible.books.get(id);
    return path ? this.plugin.app.vault.getFileByPath(path) : null;
  }

  /** The path of a book's file in a Bible (the current one by default), if known now (else it's looked up for next time) */
  bookPath(bookId: number, bible = this.current()): string | null {
    if (!bible) return null;
    const path = bible.books.get(bookId);
    if (!path && bible.unknown.length > 0) void this.readUnknown(bible);
    return path ?? null;
  }

  /**
   * A passage's plain text, from the Bible it names (else the current one; else a logoxide
   * package's), its parts joined by " … "; null without a Bible with the book
   */
  async text(passage: Passage, translation?: string | null): Promise<string | null> {
    // A logoxide package's Bible, when the reference names one the vault has no folder for
    const packages = this.plugin.packages;
    if (translation && !this.named(translation) && packages.has(translation)) return packages.text(passage, translation);
    const opened = await this.bookFile(passage, this.forText(translation));
    if (!opened) return packages.text(passage, translation);
    // A stub's book: the file it stands in for
    const source = this.plugin.folderStubs.sourceOf(opened.path);
    const file = (source && this.plugin.app.vault.getFileByPath(source)) || opened;
    const key = `${file.path}\n${file.stat.mtime}`;
    let book: LogoxideBook | null | undefined = this.books.get(key);
    if (!book) {
      book = LogoxideBook.parse(this.plugin.topos, "usx", await this.plugin.app.vault.cachedRead(file));
      if (!book) return null;
      this.books.set(key, book);
      // A few books: a chapter's verses come from one, and switching books is rare
      for (const old of [...this.books.keys()].slice(0, -BOOKS_KEPT)) this.books.delete(old);
    }
    const parts = book.text(passage, { notes: false, headings: false, classPrefix: "topos-" });
    const text = parts.map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean).join(" … ");
    return text || null;
  }

  /** The Bible a book's file is in */
  ofFile(path: string): Bible | null {
    return this.all().find((b) => [...b.books.values()].includes(path) || [...bookFiles(b).values()].includes(path)) ?? null;
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
