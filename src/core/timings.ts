import { END, type VersePart } from "./verse-locator.ts";

/**
 * Where each verse is in a recording, as a package's WebVTT timings give them (logoxide's
 * `VerseTiming`: a cue per verse, `JHN 3:16`, or per bridge, `JHN 3:17-18`), in the recording's order
 */
export interface Timing {
  chapter: number;
  verse: number;
  /** The bridge's last verse (`verse` when it isn't one) */
  last: number;
  startMs: number;
  endMs: number;
}

const key = (chapter: number, verse: number) => chapter * 1000 + verse;

/** The timing being read at a time (the last starting at or before it); -1 before the first */
export function timingAt(timings: readonly Timing[], ms: number): number {
  let lo = 0;
  let hi = timings.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid]!.startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The timing reading a verse (the bridge it's in); a verse the recording skips, or a whole chapter
 * (verse 0), plays from the next verse it reads in that chapter. -1 when it reads none of them
 */
export function timingOf(timings: readonly Timing[], chapter: number, verse: number): number {
  const exact = timings.findIndex((t) => t.chapter === chapter && t.verse <= verse && verse <= t.last);
  if (exact !== -1) return exact;
  let next = -1;
  for (let i = 0; i < timings.length; i++) {
    const t = timings[i]!;
    if (t.chapter === chapter && t.verse > verse && (next === -1 || t.verse < timings[next]!.verse)) next = i;
  }
  return next;
}

/**
 * Where a passage is in the recording: from its first verse's start to its last verse's end (the
 * parts' verses that the recording reads; across parts, from the first part's start to the last
 * part's end). Null when the recording reads none of its verses
 */
export function clipOf(timings: readonly Timing[], parts: readonly VersePart[]): { startMs: number; endMs: number } | null {
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const part of parts) {
    const from = key(part.chapter, part.verse);
    const to = key(part.endChapter, part.endVerse === END ? 999 : part.endVerse);
    for (const t of timings) {
      if (key(t.chapter, t.last) < from || key(t.chapter, t.verse) > to) continue;
      startMs = Math.min(startMs, t.startMs);
      endMs = Math.max(endMs, t.endMs);
    }
  }
  return startMs === Infinity ? null : { startMs, endMs };
}

/** A download's size, as people read it: `840 KB`, `12.3 MB`, `1.2 GB` */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
