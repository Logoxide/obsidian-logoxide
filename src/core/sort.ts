import type { Passage } from "biblix";
import type { Hit } from "./search.ts";

export type SortOrder = "file" | "bible";

/** Where a passage starts in the Bible, for sorting: [book, chapter, verse] */
export function bibleOrder(passage: Passage): [number, number, number] {
  const first = passage.segments[0];
  if (!first) return [passage.bookId, 0, 0];
  return first.tag === "Verses"
    ? [passage.bookId, first.start.chapter, first.start.verse]
    : [passage.bookId, first.start, 0];
}

function compareTuples(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function sortHits(hits: Hit[], order: SortOrder): Hit[] {
  const byFile = (a: Hit, b: Hit) => a.path.localeCompare(b.path) || a.start - b.start;
  return [...hits].sort(
    order === "file"
      ? byFile
      : (a, b) => compareTuples(bibleOrder(a.passage), bibleOrder(b.passage)) || byFile(a, b),
  );
}

export interface Group {
  key: string;
  hits: Hit[];
}

/** Groups sorted hits by file, or by book (named with `bookName`) */
export function groupHits(
  hits: Hit[],
  by: "file" | "book",
  bookName: (id: number) => string,
): Group[] {
  const groups = new Map<string, Hit[]>();
  for (const hit of hits) {
    const key = by === "file" ? hit.path : bookName(hit.passage.bookId);
    const group = groups.get(key);
    if (group) group.push(hit);
    else groups.set(key, [hit]);
  }
  return [...groups].map(([key, hits]) => ({ key, hits }));
}

/** References near each other in a file, shown as one result */
export interface HitRun {
  hits: Hit[];
  /** The first and last of their lines (1-based) */
  firstLine: number;
  lastLine: number;
}

/**
 * Joins hits that follow each other in the list, in the same file, whose lines are close enough
 * that their `context` lines would touch or overlap (with no context, on the same line): each
 * run's context is then counted from its first and last line. An EPUB's references only join on
 * the same line (they show their own text, not the book's lines)
 */
export function mergeNearby(hits: Hit[], context: number): HitRun[] {
  const runs: HitRun[] = [];
  const reach = context === 0 ? 0 : 2 * context + 1;
  for (const hit of hits) {
    const run = runs.at(-1);
    const near =
      run &&
      run.hits[0]!.path === hit.path &&
      (hit.epub
        ? run.hits.every((h) => h.line === hit.line)
        : hit.line >= run.firstLine - reach && hit.line <= run.lastLine + reach);
    if (run && near) {
      run.hits.push(hit);
      run.firstLine = Math.min(run.firstLine, hit.line);
      run.lastLine = Math.max(run.lastLine, hit.line);
    } else {
      runs.push({ hits: [hit], firstLine: hit.line, lastLine: hit.line });
    }
  }
  return runs;
}
