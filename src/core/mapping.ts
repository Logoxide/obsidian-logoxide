import { formatPart, type VersePart } from "./verse-locator.ts";

/**
 * References mapped between Bibles numbered differently (`Psalm 51:1` in an English Bible is
 * `51:3` in a Hebrew one). A package Bible's numbering is its `versification` (`English`, `KJV`;
 * `own` names none, as a folder of USX files has none), and the vault's versification map
 * packages lead from one to another. The mapping itself is logoxide's
 * (`LogoxideVersifications.map`, in `bible/packages.ts`); here is what's decided around it.
 */

/** A verse as logoxide's `MappedPassage` lists it */
export interface MappedVerseLike {
  chapter: number;
  /** 0 is a psalm's title */
  verse: number;
}

/** What `LogoxideVersifications.map` says of a passage, as far as labels need it */
export interface MappedLike {
  /** `Psalm 51:3-4` (empty when no verse has a counterpart) */
  text: string;
  /** The verses the other numbering doesn't have, written the same way */
  missingText: string;
}

/**
 * Whether a passage numbered as `from` numbers it must be mapped to be read in `to`: both are
 * named, differently (ignoring case), and neither is a Bible's `own` (a folder Bible's, or a
 * package without `versification`), which maps to nothing
 */
export function numberedApart(from: string | null | undefined, to: string | null | undefined): boolean {
  const own = (v: string | null | undefined) => !v || v.toLowerCase() === "own";
  return !own(from) && !own(to) && from!.toLowerCase() !== to!.toLowerCase();
}

/** A reference for parts of a book, as logoxide reads one: `John 3:16-18; 4:1`, `Psalm 51` */
export function partsReference(book: string, parts: VersePart[]): string {
  return `${book} ${parts.map(formatPart).join("; ")}`;
}

/**
 * The parts a mapped passage's verses make: runs of consecutive verses, in order, joined across a
 * chapter's end when `counts` (the Bible's verses per chapter, in order) say the run reached its
 * last verse. Psalm titles (verse 0) are left out: a locator can't name one, and the reader shows a
 * chapter's title with its first verse
 */
export function versesParts(verses: MappedVerseLike[], counts?: readonly number[] | null): VersePart[] {
  const sorted = verses
    .filter((v) => v.verse > 0)
    .map((v) => ({ chapter: v.chapter, verse: v.verse }))
    .sort((a, b) => a.chapter - b.chapter || a.verse - b.verse)
    .filter((v, i, all) => i === 0 || all[i - 1]!.chapter !== v.chapter || all[i - 1]!.verse !== v.verse);
  const lastOf = (chapter: number): number | null => counts?.[chapter - 1] ?? null;
  const parts: VersePart[] = [];
  for (const v of sorted) {
    const last = parts.at(-1);
    const follows =
      last &&
      ((v.chapter === last.endChapter && v.verse === last.endVerse + 1) ||
        (v.chapter === last.endChapter + 1 && v.verse === 1 && lastOf(last.endChapter) === last.endVerse));
    if (follows) {
      last.endChapter = v.chapter;
      last.endVerse = v.verse;
    } else parts.push({ chapter: v.chapter, verse: v.verse, endChapter: v.chapter, endVerse: v.verse });
  }
  return parts;
}

/**
 * How a Bible numbered differently is labeled, as the language server labels it: `KJV (Psalm
 * 51:3)`, with what the passage has that it doesn't: `KJV (Psalm 51:3) (not in it: Psalm 51:0)`
 */
export function mappedLabel(bible: string, mapped: MappedLike): string {
  const where = mapped.text ? `${bible} (${mapped.text})` : bible;
  return mapped.missingText ? `${where} (not in it: ${mapped.missingText})` : where;
}
