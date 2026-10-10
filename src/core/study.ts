/**
 * How the commentary view names what it shows: a note's verses, a cross-reference's weight, and the
 * passage a Bible tab is at. No Obsidian imports: tested with Node.
 */
import { parseVerseLocator } from "./verse-locator.ts";

/** Where a commentary's note is: the verses it covers */
export interface NoteSpan {
  chapter: number;
  verse: number;
  last: number;
  lastChapter: number;
  /** 1 for `20a`, 0 for the whole verse */
  part: number;
}

/** `a` for 1, `b` for 2, … */
function partLetter(part: number): string {
  return part > 0 ? String.fromCharCode(96 + Math.min(part, 26)) : "";
}

/** A note's verses: `3:16`, `3:17-18`, `3:36-4:2`, `3:20a`, or `3` for a chapter's introduction (verse 0) */
export function noteVerses(note: NoteSpan): string {
  const first = `${note.chapter}:${note.verse}${partLetter(note.part)}`;
  if (note.verse === 0 && note.last === 0 && note.lastChapter === note.chapter) return `${note.chapter}`;
  if (note.lastChapter !== note.chapter) return `${first}-${note.lastChapter}:${note.last}`;
  if (note.last !== note.verse) return `${first}-${note.last}`;
  return first;
}

/** A note's label: the commentary's name and the passage, `MHCC · John 3:16-18` */
export function noteLabel(commentary: string, book: string, note: NoteSpan): string {
  return `${commentary} · ${book} ${noteVerses(note)}`;
}

/**
 * The passage a Bible tab shows, as a reference topos reads: its book's name and the first verse
 * of its locator (`v=3:16`, `v=3:16-18&c=2`); a whole chapter (`v=3`) is its first verse. Null
 * without a verse locator
 */
export function locatorReference(book: string, locator: string | null | undefined): string | null {
  if (!locator) return null;
  const parts = parseVerseLocator(locator.split("&")[0] ?? "");
  const first = parts?.[0];
  if (!first) return null;
  return `${book} ${first.chapter}:${Math.max(1, first.verse)}`;
}

/** A cross-reference's weight for showing (`0.8`), or "" without one */
export function weightLabel(weight: number | null | undefined): string {
  if (weight === null || weight === undefined || !Number.isFinite(weight)) return "";
  return String(Math.round(weight * 100) / 100);
}
