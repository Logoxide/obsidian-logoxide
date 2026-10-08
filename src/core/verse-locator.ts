import type { Passage, PassageSegment } from "biblix";

/**
 * Places in a Bible book, as link subpaths: `v=3:16`, `v=3:16-18`, `v=3:16-4:2`, a chapter `v=3`,
 * chapters `v=3-4`, and parts joined by `;` (`v=3:16;4:1-5`). Markdown links may encode `:` as
 * `%3A` and `;` as `%3B`, so both forms are read.
 */
export interface VersePart {
  chapter: number;
  /** 0 for a whole chapter */
  verse: number;
  endChapter: number;
  /** {@link END} for the end of `endChapter` */
  endVerse: number;
}

/** The end of a chapter, whatever its length */
export const END = 255;

const PART = /^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/;

export function parseVerseLocator(locator: string): VersePart[] | null {
  // Without the exact words a locator may end with (`v=3:16:~:text=…`, see file-plus-plus's units)
  const m = /^v=(.+)$/.exec(decode(locator.trim().replace(/(:~:|%3A~%3A).*$/i, "")));
  if (!m) return null;
  const parts: VersePart[] = [];
  for (const text of m[1].split(";")) {
    const p = PART.exec(text.trim());
    if (!p) return null;
    const chapter = Number(p[1]);
    const verse = p[2] === undefined ? 0 : Number(p[2]);
    let endChapter = chapter;
    let endVerse = verse === 0 ? END : verse;
    if (p[3] !== undefined) {
      if (p[4] !== undefined) {
        endChapter = Number(p[3]);
        endVerse = Number(p[4]);
      } else if (verse === 0) {
        // `3-4`: chapters
        endChapter = Number(p[3]);
      } else endVerse = Number(p[3]);
    }
    if (chapter < 1 || endChapter < chapter || (endChapter === chapter && endVerse < verse)) return null;
    parts.push({ chapter, verse, endChapter, endVerse });
  }
  return parts.length > 0 ? parts : null;
}

export function formatVerseLocator(parts: VersePart[]): string {
  return `v=${parts.map(formatPart).join(";")}`;
}

function formatPart(p: VersePart): string {
  if (p.verse === 0 && p.endVerse === END) return p.endChapter === p.chapter ? `${p.chapter}` : `${p.chapter}-${p.endChapter}`;
  const start = `${p.chapter}:${p.verse}`;
  if (p.endChapter !== p.chapter) return `${start}-${p.endChapter}:${p.endVerse}`;
  return p.endVerse === p.verse ? start : `${start}-${p.endVerse}`;
}

function decode(s: string): string {
  return s.replace(/%3A/gi, ":").replace(/%3B/gi, ";").replace(/%20/g, " ");
}

/** A passage's place in its book */
export function passageParts(passage: Passage): VersePart[] {
  return passage.segments.map((segment) => {
    switch (segment.tag) {
      case "Verses": {
        const { start, end } = segment;
        return { chapter: start.chapter, verse: start.verse, endChapter: end?.chapter ?? start.chapter, endVerse: end?.verse ?? start.verse };
      }
      case "Chapters":
        return { chapter: segment.start, verse: 0, endChapter: segment.end ?? segment.start, endVerse: END };
    }
  });
}

/** The segments of a passage covering these parts (for building a `Passage`) */
export function partSegments(parts: VersePart[]): PassageSegment[] {
  return parts.map((p): PassageSegment => {
    if (p.verse === 0 && p.endVerse === END) {
      return { tag: "Chapters", start: p.chapter, end: p.endChapter === p.chapter ? null : p.endChapter };
    }
    const start = { chapter: p.chapter, verse: Math.max(1, p.verse) };
    const single = p.endChapter === p.chapter && p.endVerse === start.verse;
    return { tag: "Verses", start, end: single ? null : { chapter: p.endChapter, verse: p.endVerse } };
  });
}
