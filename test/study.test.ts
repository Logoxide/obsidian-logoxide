import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStrongs, strongsAt, strongsIn, strongsKeys, wordStrongs } from "../src/core/strongs.ts";
import { coversVerse, locatorReference, notedVerses, noteLabel, noteVerses, onChapter, studyGroups, weightLabel } from "../src/core/study.ts";

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

test("a verse's notes, and its chapter's as a whole, by commentary", () => {
  const span = (chapter: number, verse: number, lastChapter: number, last: number) => ({ chapter, verse, lastChapter, last, part: 0 });
  const intro = span(3, 0, 3, 15);
  const on16 = span(3, 16, 3, 16);
  const on17 = span(3, 17, 3, 18);
  const across = span(2, 20, 4, 3);
  assert.ok(coversVerse(on17, 3, 18) && !coversVerse(on17, 3, 16));
  assert.ok(coversVerse(across, 3, 36) && coversVerse(across, 4, 1) && !coversVerse(across, 4, 4));
  assert.ok(onChapter(intro, 3, 36), "an introduction, however far it reaches");
  assert.ok(onChapter(across, 3, 36), "all of the chapter");
  assert.ok(!onChapter(on16, 3, 36) && !onChapter(span(3, 1, 3, 1), 3, 1), "one verse isn't the chapter");
  const groups = studyGroups(
    [
      { commentary: "TC", title: "A Tiny Commentary", notes: [intro, on16, on17] },
      { commentary: "MH", title: "Matthew Henry", notes: [across, on17] },
    ],
    3,
    16,
    36,
  );
  assert.deepEqual(groups.verse, [{ commentary: "TC", title: "A Tiny Commentary", notes: [on16] }]);
  assert.deepEqual(
    groups.chapter.map((g) => [g.commentary, g.notes]),
    [
      ["TC", [intro]],
      ["MH", [across]],
    ],
  );
  assert.deepEqual([...notedVerses([{ commentary: "TC", title: "", notes: [intro, on16, on17] }])], ["3:16", "3:17"]);
});
