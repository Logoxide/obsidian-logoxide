import { test } from "node:test";
import assert from "node:assert/strict";
import { stepVerse, versesFrom } from "../src/core/verse-steps.ts";

const counts = [3, 2, 4];

test("verses from one on cross chapters' ends and stop at the book's", () => {
  assert.deepEqual(versesFrom(counts, { chapter: 1, verse: 2 }, 3), [
    { chapter: 1, verse: 2 },
    { chapter: 1, verse: 3 },
    { chapter: 2, verse: 1 },
  ]);
  assert.deepEqual(versesFrom(counts, { chapter: 3, verse: 3 }, 5), [
    { chapter: 3, verse: 3 },
    { chapter: 3, verse: 4 },
  ]);
  assert.deepEqual(versesFrom(counts, { chapter: 2, verse: 0 }, 1), [{ chapter: 2, verse: 1 }]);
  assert.deepEqual(versesFrom(null, { chapter: 5, verse: 9 }, 2), [
    { chapter: 5, verse: 9 },
    { chapter: 5, verse: 10 },
  ]);
});

test("stepping verses forward and back", () => {
  assert.deepEqual(stepVerse(counts, { chapter: 1, verse: 3 }, 1), { chapter: 2, verse: 1 });
  assert.deepEqual(stepVerse(counts, { chapter: 2, verse: 1 }, -2), { chapter: 1, verse: 2 });
  assert.deepEqual(stepVerse(counts, { chapter: 1, verse: 1 }, -3), { chapter: 1, verse: 1 });
  assert.deepEqual(stepVerse(counts, { chapter: 3, verse: 3 }, 10), { chapter: 3, verse: 4 });
  assert.deepEqual(stepVerse(null, { chapter: 2, verse: 1 }, -1), { chapter: 2, verse: 1 });
});
