/** The book, chapter, and verse picker's choices, without Obsidian (see `bible/picker.ts`) */

/** A book as topos lists it (`Topos.books()`) */
export interface PickerBook {
  id: number;
  name: string;
  osis: string;
  chapters: number;
}

/** The Old Testament's last book (Malachi): topos numbers the 66 books in order */
export const LAST_OLD_TESTAMENT = 39;

export type TestamentName = "old" | "new";

export const TESTAMENT_NAMES: Record<TestamentName, string> = { old: "Old Testament", new: "New Testament" };

export function testamentOf(bookId: number): TestamentName {
  return bookId <= LAST_OLD_TESTAMENT ? "old" : "new";
}

/** The books of each testament, in order (books outside the 66 go with the New) */
export function byTestament<B extends { id: number }>(books: readonly B[]): Record<TestamentName, B[]> {
  return {
    old: books.filter((b) => testamentOf(b.id) === "old"),
    new: books.filter((b) => testamentOf(b.id) === "new"),
  };
}

/** A book's label on a small tile: its OSIS name (`1Sam`, `Phlm`), short and still readable */
export function tileLabel(book: PickerBook): string {
  return book.osis || book.name;
}

/** Whether typed letters pick out a book: the start of its name or OSIS name, ignoring case and spaces (`1sa`, `song`) */
export function bookMatches(book: PickerBook, typed: string): boolean {
  const q = typed.toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  return [book.name, book.osis].some((n) => n.toLowerCase().replace(/\s+/g, "").startsWith(q));
}

/** A chapter and maybe a verse, typed on a number pad */
export interface TypedPlace {
  chapter: number;
  verse: number | null;
}

/**
 * Reads a typed chapter (`3`), or chapter and verse (`3:16`, `3.16`, `3,16` from a phone's decimal
 * pad, `3 16`). `chapters` is how many the book has; `verses(chapter)` how many verses a chapter
 * has. Null when it isn't a place in the book
 */
export function parseTypedPlace(text: string, chapters: number, verses: (chapter: number) => number): TypedPlace | null {
  const match = /^\s*(\d+)\s*(?:[:.,\s]\s*(\d+))?\s*$/.exec(text);
  if (!match) return null;
  const chapter = Number(match[1]);
  if (chapter < 1 || chapter > chapters) return null;
  if (match[2] === undefined) return { chapter, verse: null };
  const verse = Number(match[2]);
  return verse >= 1 && verse <= verses(chapter) ? { chapter, verse } : null;
}

/** Reads a typed number from 1 to `max`; null otherwise */
export function parseTypedNumber(text: string, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= max ? n : null;
}
