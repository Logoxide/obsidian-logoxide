/**
 * Strong's numbers (`G25`, `H430`, `G0025`, `H0430a`) in text and in Bible markup, and which of a
 * vault's dictionaries answers one: those keyed by `strongs-greek` for a `G`, `strongs-hebrew` for
 * an `H` (a dictionary's `[package] keys`). The dictionaries find a key in any form; this only
 * finds and names them. No Obsidian imports: tested with Node.
 */

/** A Strong's number written in text: `G` or `H`, digits, and an optional letter (`H430a`), not inside a word */
const STRONGS = /(?<![\p{L}\p{N}_])([GH])0*(\d{1,5})([a-z]?)(?![\p{L}\p{N}_])/gu;

export type StrongsKeys = "strongs-greek" | "strongs-hebrew";

/** A Strong's number found in text: where it is (UTF-16 offsets) and its key in normal form */
export interface StrongsMatch {
  start: number;
  end: number;
  key: string;
}

/** Every Strong's number in a text, in order */
export function strongsIn(text: string): StrongsMatch[] {
  const found: StrongsMatch[] = [];
  for (const m of text.matchAll(STRONGS)) {
    found.push({ start: m.index, end: m.index + m[0].length, key: `${m[1]}${m[2]}${m[3]}` });
  }
  return found;
}

/** The Strong's number at (or just before) a column of a line, if any */
export function strongsAt(line: string, ch: number): StrongsMatch | null {
  return strongsIn(line).find((m) => ch >= m.start && ch <= m.end) ?? null;
}

/**
 * A key in normal form (`G0025`, `g25` → `G25`; `H0430a` → `H430a`), or null when it isn't a
 * Strong's number
 */
export function normalizeStrongs(key: string): string | null {
  const m = /^\s*([GgHh])0*(\d{1,5})([a-z]?)\s*$/.exec(key);
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${m[2]}${m[3]}`;
}

/** Which dictionaries a Strong's number is in: Greek for `G`, Hebrew for `H` */
export function strongsKeys(key: string): StrongsKeys | null {
  const normal = normalizeStrongs(key);
  if (!normal) return null;
  return normal.startsWith("G") ? "strongs-greek" : "strongs-hebrew";
}

/**
 * The Strong's numbers of a word in Bible text, from its `data-strong` (logoxide-markup writes
 * them space-separated: `H7225 H853`), in normal form
 */
export function wordStrongs(attribute: string | null | undefined): string[] {
  return (attribute ?? "")
    .split(/\s+/)
    .map((k) => normalizeStrongs(k))
    .filter((k): k is string => k !== null);
}
