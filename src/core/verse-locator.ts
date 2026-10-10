import type { Passage, PassageSegment } from "logoxide";

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

/**
 * What a link to a package's Bible was made with: the package's version, and the hash of its
 * first verse's words (8 hex digits of logoxide's verse hash). `v=3:16&ver=1.0.2&vh=9f86d081`: when
 * the installed version has other words at 3:16, the link finds them where they are now
 */
export interface Edition {
  version: string;
  hash: string | null;
}

const EDITION = /&ver=([^&:%]+)(?:&vh=([0-9a-f]+))?/i;

/** A locator without its edition, and the edition */
export function splitEdition(locator: string): { locator: string; edition: Edition | null } {
  const m = EDITION.exec(locator);
  if (!m) return { locator, edition: null };
  return { locator: locator.replace(m[0], ""), edition: { version: m[1]!, hash: m[2]?.toLowerCase() ?? null } };
}

/** A locator with an edition, before its exact words (`v=3:16&ver=1.0.2&vh=…:~:text=…`) */
export function withEdition(locator: string, edition: Edition): string {
  const params = `&ver=${edition.version}${edition.hash ? `&vh=${edition.hash}` : ""}`;
  const at = locator.search(/(:~:|%3A~%3A)/i);
  return at === -1 ? locator + params : locator.slice(0, at) + params + locator.slice(at);
}

const CONTEXT = /&c=(\d+)/i;

/**
 * A locator without the context it asks for, and that context: how many verses around its passage
 * an embed or hover preview shows (`v=3:16&c=2`: 3:14-18, 3:16 standing out); null when it doesn't say
 */
export function splitContext(locator: string): { locator: string; context: number | null } {
  const m = CONTEXT.exec(locator);
  if (!m) return { locator, context: null };
  return { locator: locator.replace(m[0], ""), context: Number(m[1]) };
}

/** A locator asking for context around its passage, before its exact words (`v=3:16&c=2:~:text=…`) */
export function withContext(locator: string, context: number | null): string {
  if (context === null) return locator;
  const at = locator.search(/(:~:|%3A~%3A)/i);
  return at === -1 ? `${locator}&c=${context}` : `${locator.slice(0, at)}&c=${context}${locator.slice(at)}`;
}

/**
 * Parts with `context` verses before and after each (whole chapters as they are), by each chapter's
 * verse count (`counts.get(3)`: chapter 3's), crossing into the chapters around them: `shown` is
 * what to render (overlapping parts joined), `context` the verses added, to set apart
 */
export function withContextVerses(parts: VersePart[], context: number, counts: ReadonlyMap<number, number>): { shown: VersePart[]; context: VersePart[] } {
  if (context <= 0 || parts.some((p) => p.verse === 0)) return { shown: parts, context: [] };
  // Every verse of the book in order, and where each is in that order
  const verses: [number, number][] = [];
  for (const chapter of [...counts.keys()].sort((a, b) => a - b)) for (let v = 1; v <= counts.get(chapter)!; v++) verses.push([chapter, v]);
  const index = new Map(verses.map(([c, v], i) => [c * 1000 + v, i]));
  const at = (c: number, v: number, last: boolean) => {
    const exact = index.get(c * 1000 + v);
    if (exact !== undefined) return exact;
    // Past the chapter's end (`END`, or a count this Bible doesn't have): its last verse
    const inChapter = verses.flatMap(([vc], i) => (vc === c ? [i] : []));
    return inChapter.length === 0 ? -1 : last ? inChapter.at(-1)! : inChapter[0]!;
  };
  const own = new Set<number>();
  const all = new Set<number>();
  for (const p of parts) {
    const start = at(p.chapter, p.verse, false);
    const end = at(p.endChapter, p.endVerse, true);
    if (start === -1 || end === -1) return { shown: parts, context: [] };
    for (let i = start; i <= end; i++) own.add(i);
    for (let i = Math.max(0, start - context); i <= Math.min(verses.length - 1, end + context); i++) all.add(i);
  }
  const runs = (set: Set<number>): VersePart[] => {
    const sorted = [...set].sort((a, b) => a - b);
    const out: VersePart[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const first = sorted[i]!;
      while (i + 1 < sorted.length && sorted[i + 1] === sorted[i]! + 1) i++;
      const [chapter, verse] = verses[first]!;
      const [endChapter, endVerse] = verses[sorted[i]!]!;
      out.push({ chapter, verse, endChapter, endVerse });
    }
    return out;
  };
  return { shown: runs(all), context: runs(new Set([...all].filter((i) => !own.has(i)))) };
}

export function parseVerseLocator(locator: string): VersePart[] | null {
  // Without the exact words a locator may end with (`v=3:16:~:text=…`, see file-plus-plus's
  // units), and without the edition it was made with or the context it asks for
  const m = /^v=(.+)$/.exec(decode(splitContext(splitEdition(locator.trim()).locator).locator.replace(/(:~:|%3A~%3A).*$/i, "")));
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

/** One part: `3`, `3-4`, `3:16`, `3:16-18`, `3:16-4:2` */
export function formatPart(p: VersePart): string {
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
