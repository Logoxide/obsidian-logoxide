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

/** A chapter and verse as one number, for comparing places */
const placeKey = (chapter: number, verse: number) => chapter * 1000 + verse;

/** Whether a note covers a verse (verse 0: the chapter's introduction, before verse 1) */
export function coversVerse(note: NoteSpan, chapter: number, verse: number): boolean {
  const at = placeKey(chapter, verse);
  return placeKey(note.chapter, note.verse) <= at && at <= placeKey(note.lastChapter, note.last);
}

/**
 * Whether a note is on a chapter as a whole: its introduction (verse 0, however far it reaches),
 * or a note covering all of it (`lastVerse`: the chapter's last verse)
 */
export function onChapter(note: NoteSpan, chapter: number, lastVerse: number): boolean {
  if (note.chapter === chapter && note.verse === 0) return true;
  return lastVerse > 1 && coversVerse(note, chapter, 1) && coversVerse(note, chapter, lastVerse);
}

/** A commentary's notes */
export interface NotesOf<N extends NoteSpan> {
  commentary: string;
  title: string;
  notes: N[];
}

/** What commentaries say about a verse: notes on it, and notes on its chapter as a whole, each by commentary (those with none left out) */
export interface StudyGroups<N extends NoteSpan> {
  verse: NotesOf<N>[];
  chapter: NotesOf<N>[];
}

/**
 * A note stretched over the verses after it, up to the commentary's next note in the chapter (else
 * the chapter's end, `lastVerse`), so a verse it skips shows the note before it: the `stretchNotes`
 * setting. An introduction, or a note running into the next chapter, stays as it is
 */
export function stretched<N extends NoteSpan>(note: N, notes: readonly N[], lastVerse: number): NoteSpan {
  if (note.verse === 0 || note.lastChapter !== note.chapter) return note;
  let last = Math.max(note.last, lastVerse);
  for (const n of notes) if (n.chapter === note.chapter && n.verse > note.last && n.verse <= last) last = n.verse - 1;
  return { ...note, last };
}

/**
 * Each commentary's notes on a verse, and on its chapter as a whole (`lastVerse`: the chapter's
 * last verse); with `stretch`, a note also covers the verses after it up to the next (`stretched`)
 */
export function studyGroups<N extends NoteSpan>(commentaries: NotesOf<N>[], chapter: number, verse: number, lastVerse: number, stretch = false): StudyGroups<N> {
  const groups: StudyGroups<N> = { verse: [], chapter: [] };
  for (const { commentary, title, notes } of commentaries) {
    const whole = notes.filter((n) => onChapter(n, chapter, lastVerse));
    const reach = (n: N) => (stretch && n.chapter === chapter ? stretched(n, notes, lastVerse) : n);
    const on = verse > 0 ? notes.filter((n) => !whole.includes(n) && coversVerse(reach(n), chapter, verse)) : [];
    if (on.length > 0) groups.verse.push({ commentary, title, notes: on });
    if (whole.length > 0) groups.chapter.push({ commentary, title, notes: whole });
  }
  return groups;
}

/** The verses where commentaries' notes start (`3:16`), for marking them in the text; introductions aren't */
export function notedVerses(commentaries: NotesOf<NoteSpan>[]): Set<string> {
  const verses = new Set<string>();
  for (const { notes } of commentaries) for (const n of notes) if (n.verse > 0) verses.add(`${n.chapter}:${n.verse}`);
  return verses;
}
