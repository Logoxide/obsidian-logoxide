import assert from "node:assert/strict";
import { test } from "node:test";
import { Logoxide } from "logoxide";
import { mappedLabel, numberedApart, partsReference, versesParts } from "../src/core/mapping.ts";
import { END, formatVerseLocator, parseVerseLocator } from "../src/core/verse-locator.ts";

test("only Bibles numbered differently, neither by its own numbering, are mapped", () => {
  assert.equal(numberedApart("English", "Original"), true);
  assert.equal(numberedApart("KJV", "kjv"), false);
  assert.equal(numberedApart("own", "KJV"), false);
  assert.equal(numberedApart("KJV", "Own"), false);
  assert.equal(numberedApart(null, "KJV"), false);
  assert.equal(numberedApart("", "KJV"), false);
});

test("parts become a reference logoxide reads, and mapped verses become parts again", () => {
  const parts = parseVerseLocator("v=3:16-18;4:1;5")!;
  assert.equal(partsReference("John", parts), "John 3:16-18; 4:1; 5");
  const verses = [
    { chapter: 4, verse: 1 },
    { chapter: 3, verse: 18 },
    { chapter: 3, verse: 17 },
    { chapter: 3, verse: 17 },
    { chapter: 3, verse: 36 },
    { chapter: 51, verse: 0 },
  ];
  // Runs in order, each verse once, titles left out; 3:36 and 4:1 join only when 3:36 is the chapter's end
  assert.equal(formatVerseLocator(versesParts(verses)), "v=3:17-18;3:36;4:1");
  const counts = [51, 25, 36, 54];
  assert.equal(formatVerseLocator(versesParts(verses, counts)), "v=3:17-18;3:36-4:1");
  assert.deepEqual(versesParts([{ chapter: 51, verse: 0 }]), []);
  assert.deepEqual(versesParts([{ chapter: 2, verse: 3 }]), [{ chapter: 2, verse: 3, endChapter: 2, endVerse: 3 }]);
  assert.notEqual(END, 0);
});

test("a mapped Bible is labeled as the language server labels it", () => {
  assert.equal(mappedLabel("KJV", { text: "Psalm 51:3", missingText: "" }), "KJV (Psalm 51:3)");
  assert.equal(mappedLabel("KJV", { text: "Psalm 51:3", missingText: "Psalm 51:0" }), "KJV (Psalm 51:3) (not in it: Psalm 51:0)");
  assert.equal(mappedLabel("KJV", { text: "", missingText: "Psalm 151" }), "KJV (not in it: Psalm 151)");
});

test("logoxide maps a reference through a .vrs map, both ways, and refuses a missing route", () => {
  const maps = Logoxide.new().versifications().withVrs("A", "B", "JHN 3:16 = JHN 3:17\nJHN 3:17 = JHN 3:18\n");
  assert.deepEqual(maps.names().sort(), ["A", "B"]);
  const mapped = maps.map(partsReference("John", parseVerseLocator("v=3:16-17;4:1")!), "A", "B", null);
  assert.equal(mapped.text, "John 3:17-18; 4:1");
  assert.equal(formatVerseLocator(versesParts(mapped.verses)), "v=3:17-18;4:1");
  assert.equal(maps.map("John 3:18", "b", "a", null).text, "John 3:17");
  // A verse B has that A hasn't: said, not shown
  const back = maps.map("John 3:16", "B", "A", null);
  assert.equal(back.text, "");
  assert.equal(back.missingText, "John 3:16");
  assert.throws(() => maps.map("John 3:16", "A", "C", null), (e: unknown) => (e as { value: { tag: string } }).value.tag === "Invalid");
});
