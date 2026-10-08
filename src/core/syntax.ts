import { BookStyle, OffsetUnit, type Passage, type Topos } from "topos-bible";

/**
 * References in a note's Markdown, by how they are written:
 *
 * - `link`: `[some text](John 1:1)`, a Markdown link whose target is a reference in any form topos
 *   reads (`Jn 1:1`, OSIS `John.1.1`, USFM `JHN 1:1`; `<John 1:1>` too)
 * - `explicit`: `[John 1:1]`, a reference in brackets
 * - `embed`: `![John 1:1]` (or `![text](John 1:1)`), the passage's text shown in place
 * - `bare`: `John 1:1` in the text, which is found and marked but isn't a link
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
}

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
  const s = text.trim().replace(/^<(.*)>$/, "$1").trim();
  if (!s || s.length > 120) return null;
  const matches = topos.search(s, OffsetUnit.Utf16);
  if (matches.length === 1 && matches[0].start === 0 && matches[0].end === s.length) return matches[0].passage;
  // Something else is in it, like `see John 3:16`
  if (matches.length > 0) return null;
  if (!OSIS.test(s) && !USFM.test(s) && !WRITTEN.test(s)) return null;
  if (!/\d$/.test(s) && !OSIS.test(s)) return null;
  return topos.parse(s, BookStyle.Name) ?? null;
}

/** Every reference in `text`, links, explicit links, and embeds first where they overlap bare ones */
export function findReferences(topos: Topos, text: string): ReferenceSyntax[] {
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
    const passage = wholeReference(topos, m[3]);
    if (!passage) continue;
    const labelStart = start + m[1].length + 1;
    add({ kind: m[1] ? "embed" : "link", passage, start, end: start + m[0].length, labelStart, labelEnd: labelStart + m[2].length });
  }
  for (const m of text.matchAll(BRACKETS)) {
    const start = m.index;
    const end = start + m[0].length;
    if (text[start - 1] === "[" || text[end] === "]" || !free(start, end)) continue;
    // Footnotes and task checkboxes
    if (m[2].startsWith("^") || /^[ xX]$/.test(m[2])) continue;
    const passage = wholeReference(topos, m[2]);
    if (!passage) continue;
    const labelStart = start + m[1].length + 1;
    add({ kind: m[1] ? "embed" : "explicit", passage, start, end, labelStart, labelEnd: labelStart + m[2].length });
  }
  for (const m of topos.search(text, OffsetUnit.Utf16)) {
    if (!free(m.start, m.end)) continue;
    found.push({ kind: "bare", passage: m.passage, start: m.start, end: m.end, labelStart: m.start, labelEnd: m.end });
  }
  return found.sort((a, b) => a.start - b.start);
}
