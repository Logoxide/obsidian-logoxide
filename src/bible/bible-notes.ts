import { normalizePath, type TFile } from "obsidian";
import type { BookInfo } from "logoxide";
import type { Bible } from "../core/bibles.ts";
import { BOOK_KEY, headingChapter, notesPath, notesText, osisLocator, TRANSLATION_KEY } from "../core/notes-files.ts";
import { wholeReference } from "../core/syntax.ts";
import type ToposPlugin from "../main.ts";

/** A Bible book's file: which book, in which Bible */
export interface BookOfFile {
  bible: Bible;
  book: BookInfo;
}

/** What a notes file is about: its book, and its translation when it has one */
export interface NotesOf {
  book: BookInfo;
  translation: string | null;
}

/**
 * The vault's notes on Bible books (core/notes-files.ts): where each is (the `notesFolder` and
 * `notesLayout` settings), finding one by its path or else by its frontmatter, and making one. They
 * are the Bible's annotation files: highlights inserted from a book go in its notes, under its chapter
 */
export class BibleNotes {
  constructor(private readonly plugin: ToposPlugin) {}

  private get app() {
    return this.plugin.app;
  }

  /** A book by its id */
  book(bookId: number): BookInfo | null {
    return this.plugin.topos.books().find((b) => b.id === bookId) ?? null;
  }

  /** The book a Bible's file is (a stub, or a folder Bible's USX), and its Bible */
  bookOf(path: string): BookOfFile | null {
    const bible = this.plugin.bibles.ofFile(path);
    if (!bible) return null;
    const files = [...bible.books, ...(bible.files ?? [])];
    const id = files.find(([, p]) => p === path)?.[0];
    const book = id === undefined ? null : this.book(id);
    return book ? { bible, book } : null;
  }

  /** The translation a book's notes are for: its Bible's name with notes a translation, else none */
  private translation(bible: Bible | null): string | null {
    return this.plugin.settings.notesLayout === "translation" ? (bible?.name ?? null) : null;
  }

  /** Where a book's notes go, by the settings */
  path(book: BookInfo, bible: Bible | null): string {
    const { notesFolder, notesLayout } = this.plugin.settings;
    return normalizePath(notesPath(notesFolder, notesLayout, book.name, this.translation(bible)));
  }

  /** What a markdown file's frontmatter says it's the notes of */
  notesOf(file: TFile | null): NotesOf | null {
    if (!file || file.extension !== "md") return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const name = fm?.[BOOK_KEY];
    if (typeof name !== "string" || !name.trim()) return null;
    const passage = wholeReference(this.plugin.topos, `${name.trim()} 1`);
    const book = passage ? this.book(passage.bookId) : null;
    if (!book) return null;
    const translation = fm?.[TRANSLATION_KEY];
    return { book, translation: typeof translation === "string" && translation.trim() ? translation.trim() : null };
  }

  /** A book's notes: at their path, else a file whose frontmatter names the book (and translation, a notes file a translation) */
  find(book: BookInfo, bible: Bible | null): TFile | null {
    const at = this.app.vault.getFileByPath(this.path(book, bible));
    if (at) return at;
    const translation = this.translation(bible);
    for (const file of this.app.vault.getMarkdownFiles()) {
      const of = this.notesOf(file);
      if (of?.book.id === book.id && (of.translation ?? null) === translation) return file;
    }
    return null;
  }

  /** A book's notes, made when it has none yet */
  async open(book: BookInfo, bible: Bible | null): Promise<TFile> {
    const existing = this.find(book, bible);
    if (existing) return existing;
    const path = this.path(book, bible);
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    return this.app.vault.create(path, notesText(book.name, this.translation(bible), book.chapters));
  }

  /** Where a block of a book's notes is, when it's all a reference in that book (`## John 3`): a verse locator */
  locatorOfText(markdown: string, target: TFile | null): string | null {
    const book = target ? this.bookOf(target.path)?.book : null;
    const text = markdown.replace(/^#+\s*/, "").trim();
    if (!book || !text || text.length > 40) return null;
    const passage = wholeReference(this.plugin.topos, text);
    return passage?.bookId === book.id ? osisLocator(passage.osis) : null;
  }

  /** The chapter a heading names, in a book (`## John 3`) */
  headingChapter(heading: string, book: BookInfo): number | null {
    const passage = wholeReference(this.plugin.topos, heading.trim());
    return passage ? headingChapter(passage.osis, book.osis) : null;
  }
}
