import assert from "node:assert/strict";
import { test } from "node:test";
import { clipOf, formatSize, timingAt, timingOf, type Timing } from "../src/core/timings.ts";
import { END, parseVerseLocator } from "../src/core/verse-locator.ts";

// John 1:1-3, then 3:16 and the bridge 3:17-18 (an introduction before 1:1 has no cue)
const TIMINGS: Timing[] = [
  { chapter: 1, verse: 1, last: 1, startMs: 1500, endMs: 5000 },
  { chapter: 1, verse: 2, last: 2, startMs: 5000, endMs: 8000 },
  { chapter: 1, verse: 3, last: 3, startMs: 8000, endMs: 12000 },
  { chapter: 3, verse: 16, last: 16, startMs: 60000, endMs: 66000 },
  { chapter: 3, verse: 17, last: 18, startMs: 66000, endMs: 75000 },
];

test("the verse being read at a time", () => {
  assert.equal(timingAt(TIMINGS, 0), -1);
  assert.equal(timingAt(TIMINGS, 1500), 0);
  assert.equal(timingAt(TIMINGS, 4999), 0);
  assert.equal(timingAt(TIMINGS, 5000), 1);
  // Between 1:3 and 3:16 (chapter 2 isn't read): still 1:3
  assert.equal(timingAt(TIMINGS, 30000), 2);
  assert.equal(timingAt(TIMINGS, 90000), 4);
  assert.equal(timingAt([], 1000), -1);
});

test("where a verse is read", () => {
  assert.equal(timingOf(TIMINGS, 1, 2), 1);
  // In a bridge
  assert.equal(timingOf(TIMINGS, 3, 18), 4);
  // A whole chapter, and a verse it skips: the next verse it reads in that chapter
  assert.equal(timingOf(TIMINGS, 3, 0), 3);
  assert.equal(timingOf(TIMINGS, 3, 10), 3);
  // Nothing read there
  assert.equal(timingOf(TIMINGS, 2, 1), -1);
  assert.equal(timingOf(TIMINGS, 3, 19), -1);
});

test("where a passage is read", () => {
  const clip = (locator: string) => clipOf(TIMINGS, parseVerseLocator(locator)!);
  assert.deepEqual(clip("v=1:2"), { startMs: 5000, endMs: 8000 });
  assert.deepEqual(clip("v=1:2-3"), { startMs: 5000, endMs: 12000 });
  // Part of a bridge plays the bridge
  assert.deepEqual(clip("v=3:17"), { startMs: 66000, endMs: 75000 });
  // A whole chapter, and chapters with unread verses between
  assert.deepEqual(clip("v=3"), { startMs: 60000, endMs: 75000 });
  assert.deepEqual(clip("v=1:3-3:16"), { startMs: 8000, endMs: 66000 });
  // Parts: from the first's start to the last's end
  assert.deepEqual(clip("v=1:1;3:16"), { startMs: 1500, endMs: 66000 });
  assert.equal(clip("v=2"), null);
  assert.deepEqual(clipOf(TIMINGS, [{ chapter: 1, verse: 3, endChapter: 1, endVerse: END }]), { startMs: 8000, endMs: 12000 });
});

test("sizes", () => {
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(301_156), "301 KB");
  assert.equal(formatSize(12_345_678), "12.3 MB");
  assert.equal(formatSize(1_200_000_000), "1.2 GB");
});
