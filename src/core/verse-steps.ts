/**
 * Moving through a book a few verses at a time, across chapters' ends, by its verse counts (each
 * chapter's number of verses, in order; null when they aren't known: then within the chapter). No
 * Obsidian imports: tested with Node.
 */

/** A verse in a book */
export interface VersePlace {
  chapter: number;
  verse: number;
}

/** The verse after one, or null at the book's end */
function next(counts: readonly number[] | null, at: VersePlace): VersePlace | null {
  const last = counts?.[at.chapter - 1];
  if (!counts) return { chapter: at.chapter, verse: at.verse + 1 };
  if (last !== undefined && at.verse < last) return { chapter: at.chapter, verse: at.verse + 1 };
  return at.chapter < counts.length ? { chapter: at.chapter + 1, verse: 1 } : null;
}

/** The verse before one, or null at the book's start */
function previous(counts: readonly number[] | null, at: VersePlace): VersePlace | null {
  if (at.verse > 1) return { chapter: at.chapter, verse: at.verse - 1 };
  if (at.chapter <= 1) return null;
  const last = counts?.[at.chapter - 2];
  return last ? { chapter: at.chapter - 1, verse: last } : null;
}

/** `n` verses from one on (verse 0, a chapter's start, is its verse 1); fewer at the book's end */
export function versesFrom(counts: readonly number[] | null, at: VersePlace, n: number): VersePlace[] {
  const verses: VersePlace[] = [];
  let place: VersePlace | null = { chapter: at.chapter, verse: Math.max(1, at.verse) };
  while (place && verses.length < Math.max(1, n)) {
    verses.push(place);
    place = next(counts, place);
  }
  return verses;
}

/** The verse `delta` verses from one (before it when negative), stopping at the book's ends */
export function stepVerse(counts: readonly number[] | null, at: VersePlace, delta: number): VersePlace {
  let place: VersePlace = { chapter: at.chapter, verse: Math.max(1, at.verse) };
  for (let i = 0; i < Math.abs(delta); i++) {
    const moved = delta > 0 ? next(counts, place) : previous(counts, place);
    if (!moved) break;
    place = moved;
  }
  return place;
}
