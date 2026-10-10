import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStrongs, strongsAt, strongsIn, strongsKeys, wordStrongs } from "../src/core/strongs.ts";
import { locatorReference, noteLabel, noteVerses, weightLabel } from "../src/core/study.ts";

test("Strong's numbers are found in text, in normal form", () => {
  assert.deepEqual(strongsIn("loved (G25, G0026) and H430a; not XG25 or G25xy or H"), [
    { start: 7, end: 10, key: "G25" },
    { start: 12, end: 17, key: "G26" },
    { start: 23, end: 28, key: "H430a" },
  ]);
  // In Greek or Hebrew prose too, but not inside a word
  assert.deepEqual(strongsIn("ἀγαπάω G25"), [{ start: 7, end: 10, key: "G25" }]);
  assert.deepEqual(strongsIn("G25ἀ"), []);
  assert.deepEqual(strongsIn("g25"), [], "lower case is too common in prose");
});

test("the Strong's number under the cursor", () => {
  const line = "see G25 and H430";
  assert.equal(strongsAt(line, 4)?.key, "G25");
  assert.equal(strongsAt(line, 7)?.key, "G25", "just after it");
  assert.equal(strongsAt(line, 9), null);
  assert.equal(strongsAt(line, 14)?.key, "H430");
});

test("Strong's keys are normalized and sent to Greek or Hebrew dictionaries", () => {
  assert.equal(normalizeStrongs("G0025"), "G25");
  assert.equal(normalizeStrongs(" g25 "), "G25");
  assert.equal(normalizeStrongs("H0430a"), "H430a");
  assert.equal(normalizeStrongs("G0"), "G0");
  assert.equal(normalizeStrongs("Aaron"), null);
  assert.equal(strongsKeys("G25"), "strongs-greek");
  assert.equal(strongsKeys("h430"), "strongs-hebrew");
  assert.equal(strongsKeys("love"), null);
  assert.deepEqual(wordStrongs("H7225 H0853"), ["H7225", "H853"]);
  assert.deepEqual(wordStrongs("strong:G2424 x"), []);
  assert.deepEqual(wordStrongs(undefined), []);
});

test("a commentary's note is labeled with its verses", () => {
  const span = (chapter: number, verse: number, lastChapter: number, last: number, part = 0) => ({ chapter, verse, lastChapter, last, part });
  assert.equal(noteVerses(span(3, 16, 3, 16)), "3:16");
  assert.equal(noteVerses(span(3, 17, 3, 18)), "3:17-18");
  assert.equal(noteVerses(span(3, 36, 4, 2)), "3:36-4:2");
  assert.equal(noteVerses(span(3, 20, 3, 20, 1)), "3:20a");
  assert.equal(noteVerses(span(3, 0, 3, 0)), "3");
  assert.equal(noteLabel("MHCC", "John", span(3, 16, 3, 18)), "MHCC · John 3:16-18");
});

test("a Bible tab's position is a passage", () => {
  assert.equal(locatorReference("John", "v=3:16"), "John 3:16");
  assert.equal(locatorReference("John", "v=3:16-18&c=2"), "John 3:16");
  assert.equal(locatorReference("John", "v=3"), "John 3:1");
  assert.equal(locatorReference("John", ""), null);
  assert.equal(locatorReference("John", "cfi=/4"), null);
});

test("cross-references' weights", () => {
  assert.equal(weightLabel(0.8), "0.8");
  assert.equal(weightLabel(1), "1");
  assert.equal(weightLabel(0.333333), "0.33");
  assert.equal(weightLabel(null), "");
  assert.equal(weightLabel(undefined), "");
});
