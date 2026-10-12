import { BookStyle, OffsetUnit, ToposQuery, type Passage, type Topos, type ToposTranslations } from "logoxide";

/**
 * References in a note's Markdown, by how they are written:
 *
 * - `link`: `[some text](John 1:1)`, a Markdown link whose target is a reference in any form topos
 *   reads (`Jn 1:1`, OSIS `John.1.1`, USFM `JHN 1:1`; `<John 1:1>` too)
 * - `explicit`: `[John 1:1]`, a reference in brackets
 * - `embed`: `![John 1:1]` (or `![text](John 1:1)`), the passage's text shown in place
 * - `bare`: `John 1:1` in the text, which is found and marked but isn't a link
 *
 * Each can name a translation after the reference (`[John 1:1 KJV]`, `John 1:1 (KJV)`), when
 * translations are given (see `core/translations.ts`)
 */
export type SyntaxKind = "link" | "explicit" | "embed" | "bare";

export interface ReferenceSyntax {
  kind: SyntaxKind;
  passage: Passage;
  /** The whole syntax, brackets included (UTF-16 offsets) */
  start: number;
  end: number;
  /** What is shown as the link: the link's text, or the reference in brackets */
  labelStart: number;
  labelEnd: number;
  /** The translation named after the reference (`KJV`), as the translations list it */
  translation?: string;
}

/** A reference and the translation named after it, if any */
export interface NamedPassage {
  passage: Passage;
  translation: string | null;
}

/** A query that keeps every reference, for searches with translations */
let everything: ToposQuery | null = null;

/** Whether only a closing bracket and spaces follow `end` (`(KJV)`) */
const endsAt = (s: string, end: number) => /^[\s)\]]*$/.test(s.slice(end));

/** `[label](target)` and `![label](target)`; the target may be in `<>` */
const LINK = /(!?)\[([^\[\]\n]*)\]\((<[^<>\n]+>|[^()\n]+)\)/g;
/** `[reference]` and `![reference]`, not part of `[[wikilinks]]`, links, or reference definitions */
const BRACKETS = /(!?)\[([^\[\]\n]+)\](?![(\[:])/g;
/** OSIS (`John.3.16`, `1Cor.13`) and USFM (`JHN 3:16`, `1CO 13`) references */
const OSIS = /^[1-4]?[A-Za-z]+\.\d+(?:\.\d+)?(?:-(?:[1-4]?[A-Za-z]+\.)?\d+(?:\.\d+)*)?$/;
const USFM = /^[1-4A-Z][A-Z0-9]{2} \d+(?::\d+)?/;
/** A book name followed by a number: `Ps 23`, `1 Cor. 13:4`, `Song of Songs 2` */
const WRITTEN = /^(?:[1-4I]{1,3}\s*)?\p{L}[\p{L}.' ]*\s*\d/u;

/**
 * The passage a link target or bracketed text names, when all of it is a reference: `John 3:16`,
 * `Jn 3:16-18`, `John.3.16`, `JHN 3:16`, `Ps 23` (abbreviations that need a verse in prose are fine
 * here, since the brackets say it's a reference), but not `see John 3:16` or `the love verse`
 */
export function wholeReference(topos: Topos, text: string): Passage | null {
  return wholeNamedReference(topos, text)?.passage ?? null;
}

/** {@link wholeReference}, which may name one of `translations` after it: `John 3:16 KJV` */
export function wholeNamedReference(topos: Topos, text: string, translations?: ToposTranslations): NamedPassage | null {
  const s = text.trim().replace(/^<(.*)>$/, "$1").trim();
  if (translations && s && s.length <= 120) {
    everything ??= ToposQuery.create();
    const matches = topos.searchWithTranslations(s, OffsetUnit.Utf16, everything, translations);
    const [m] = matches;
    if (matches.length === 1 && m && m.reference.start === 0) {
      if (m.translation && endsAt(s, m.translation.end)) return { passage: m.reference.passage, translation: m.translation.name };
      if (!m.translation && m.reference.end === s.length) return { passage: m.reference.passage, translation: null };
      return null;
    }
    if (matches.length > 0) return null;
    // OSIS or USFM, then a translation: `John.3.16 KJV`
    const parsed = topos.parseWithTranslation(s, OffsetUnit.Utf16, translations, BookStyle.Name);
    if (parsed?.translation && endsAt(s, parsed.translation.end)) {
      const before = s.slice(0, parsed.translation.start).replace(/[\s,;:(\[—–-]+$/, "");
      const passage = wholePassage(topos, before);
      return passage ? { passage, translation: parsed.translation.name } : null;
    }
  }
  const passage = wholePassage(topos, s);
  return passage ? { passage, translation: null } : null;
}

function wholePassage(topos: Topos, s: string): Passage | null {
  if (!s || s.length > 120) return null;
  const matches = topos.search(s, OffsetUnit.Utf16);
  if (matches.length === 1 && matches[0].start === 0 && matches[0].end === s.length) return matches[0].passage;
  // Something else is in it, like `see John 3:16`
  if (matches.length > 0) return null;
  if (!OSIS.test(s) && !USFM.test(s) && !WRITTEN.test(s)) return null;
  if (!/\d$/.test(s) && !OSIS.test(s)) return null;
  return topos.parse(s, BookStyle.Name) ?? null;
}

/**
 * Every reference in `text`, links, explicit links, and embeds first where they overlap bare ones;
 * with `translations`, each with the translation named after it (a bare reference's range then
 * covers the name: `John 3:16 (KJV)`)
 */
export function findReferences(topos: Topos, text: string, translations?: ToposTranslations): ReferenceSyntax[] {
  const found: ReferenceSyntax[] = [];
  const taken: [number, number][] = [];
  const free = (start: number, end: number) => taken.every(([s, e]) => end <= s || start >= e);
  const add = (item: ReferenceSyntax) => {
    found.push(item);
    taken.push([item.start, item.end]);
  };

  for (const m of text.matchAll(LINK)) {
    const start = m.index;
    if (text[start - 1] === "[" || text[start + m[1].length + 1] === "[") continue;
    const named = wholeNamedReference(topos, m[3], translations);
    if (!named) continue;
    const labelStart = start + m[1].length + 1;
    const kind = m[1] ? "embed" : "link";
    add({ kind, ...withTranslation(named), start, end: start + m[0].length, labelStart, labelEnd: labelStart + m[2].length });
  }
  for (const m of text.matchAll(BRACKETS)) {
    const start = m.index;
    const end = start + m[0].length;
    if (text[start - 1] === "[" || text[end] === "]" || !free(start, end)) continue;
    // Footnotes and task checkboxes
    if (m[2].startsWith("^") || /^[ xX]$/.test(m[2])) continue;
    const named = wholeNamedReference(topos, m[2], translations);
    if (!named) continue;
    const labelStart = start + m[1].length + 1;
    add({ kind: m[1] ? "embed" : "explicit", ...withTranslation(named), start, end, labelStart, labelEnd: labelStart + m[2].length });
  }
  if (translations) {
    everything ??= ToposQuery.create();
    for (const m of topos.searchWithTranslations(text, OffsetUnit.Utf16, everything, translations)) {
      const t = m.translation;
      // Through the name, and the bracket that closes it: `John 3:16 (KJV)`
      let end = t ? t.end : m.reference.end;
      if (t && /[)\]]/.test(text[end] ?? "") && /[(\[]\s*$/.test(text.slice(m.reference.end, t.start))) end++;
      if (!free(m.reference.start, end)) continue;
      const translation = t ? { translation: t.name } : {};
      found.push({ kind: "bare", passage: m.reference.passage, start: m.reference.start, end, labelStart: m.reference.start, labelEnd: end, ...translation });
    }
    return found.sort((a, b) => a.start - b.start);
  }
  for (const m of topos.search(text, OffsetUnit.Utf16)) {
    if (!free(m.start, m.end)) continue;
    found.push({ kind: "bare", passage: m.passage, start: m.start, end: m.end, labelStart: m.start, labelEnd: m.end });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** A named passage's fields for a {@link ReferenceSyntax} */
function withTranslation(named: NamedPassage): { passage: Passage; translation?: string } {
  return named.translation ? { passage: named.passage, translation: named.translation } : { passage: named.passage };
}

/**
 * Whether the `count` lines above `first` and below `last` (1-based) are blank, or past the start
 * or end of the text: `line(n)` is line `n`'s text, or undefined past the text
 */
export function blankAround(line: (n: number) => string | undefined, first: number, last: number, count: number): boolean {
  for (let i = 1; i <= count; i++) {
    if (line(first - i)?.trim() || line(last + i)?.trim()) return false;
  }
  return true;
}

/**
 * The part of a reference written at `offset` in `text` (UTF-16): `4:5-7` in `John 3:16; 4:5-7`
 * is John 4:5-7, and its `7` John 4:7; null where that's all of it (a reference of one part, away
 * from its range's end), or between parts (topos's `parts`, which is slower than searching, so
 * `text` should be the reference itself)
 */
export function partAt(topos: Topos, text: string, offset: number): Passage | null {
  const parts = topos.parts(text, OffsetUnit.Utf16);
  const part = parts.find((p) => p.start <= offset && offset < p.end);
  if (!part) return null;
  if (part.lastStart !== null && offset >= part.lastStart) return part.last;
  return parts.length > 1 ? part.passage : null;
}

/**
 * Where each part of a passage starts and ends, in order and each once: `John 3:16-18; 4:5, 1-2`
 * is John 3:16, 3:18, 4:5, 4:1, and 4:2
 */
export function passageStops(topos: Topos, passage: Passage): Passage[] {
  const stops = new Map<string, Passage>();
  for (const part of topos.parts(passage.reference, OffsetUnit.Utf16)) {
    for (const p of [part.first, part.last]) if (!stops.has(p.osis)) stops.set(p.osis, p);
  }
  return [...stops.values()];
}
