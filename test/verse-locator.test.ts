import assert from "node:assert/strict";
import { test } from "node:test";
import { BookStyle, Topos } from "logoxide";
import { END, formatVerseLocator, parseVerseLocator, partSegments, passageParts, splitBible, splitContext, splitEdition, withBible, withContext, withContextVerses, withEdition } from "../src/core/verse-locator.ts";

test("verse locators round-trip", () => {
  for (const s of ["v=3:16", "v=3:16-18", "v=3:16-4:2", "v=3", "v=3-4", "v=3:16;4:1-5;5"]) {
    assert.equal(formatVerseLocator(parseVerseLocator(s)!), s);
  }
  // Markdown links may encode them
  assert.equal(formatVerseLocator(parseVerseLocator("v=3%3A16%3B4")!), "v=3:16;4");
  assert.deepEqual(parseVerseLocator("v=3"), [{ chapter: 3, verse: 0, endChapter: 3, endVerse: END }]);
  // The exact words (file-plus-plus's units) don't change the verses
  assert.deepEqual(parseVerseLocator("v=3:16:~:text=so%20loved"), parseVerseLocator("v=3:16"));
  assert.deepEqual(parseVerseLocator("v=3%3A16%3A~%3Atext=so"), parseVerseLocator("v=3:16"));
  for (const bad of ["v=", "v=0", "v=3:16-2", "v=4-3", "t=3", "v=a"]) assert.equal(parseVerseLocator(bad), null, bad);
});

test("passages and locators", () => {
  const topos = Topos.new();
  const locator = (r: string) => formatVerseLocator(passageParts(topos.parse(r, BookStyle.Name)!));
  assert.equal(locator("John 3:16"), "v=3:16");
  assert.equal(locator("John 3:16-18; 4"), "v=3:16-18;4");
  assert.equal(locator("John 3:16-4:2"), "v=3:16-4:2");
  assert.equal(locator("John 3-4"), "v=3-4");
  // Back to segments that topos formats like the original
  const passage = topos.parse("John 3:16-18; 4", BookStyle.Name)!;
  assert.deepEqual(partSegments(passageParts(passage)), passage.segments);
});

test("a link to a package's Bible keeps the edition it was made with", () => {
  const made = withEdition("v=3:16", { version: "1.0.2", hash: "9f86d081" });
  assert.equal(made, "v=3:16&ver=1.0.2&vh=9f86d081");
  // Before the exact words
  assert.equal(withEdition("v=3:16:~:text=so%20loved", { version: "2.0.0", hash: null }), "v=3:16&ver=2.0.0:~:text=so%20loved");
  assert.deepEqual(splitEdition("v=3:16&ver=1.0.2&vh=9F86D081:~:text=x"), { locator: "v=3:16:~:text=x", edition: { version: "1.0.2", hash: "9f86d081" } });
  assert.deepEqual(splitEdition("v=3:16"), { locator: "v=3:16", edition: null });
  // The verses read the same with or without it
  assert.deepEqual(parseVerseLocator("v=3:16-18&ver=1.0.2&vh=9f86d081:~:text=so"), parseVerseLocator("v=3:16-18"));
});

test("a link copied from a Bible names it", () => {
  assert.equal(withBible("v=3:16&ver=1.0.2:~:text=so", "BSB"), "v=3:16&ver=1.0.2&bible=BSB:~:text=so");
  assert.equal(withBible("v=3:16", "World English"), "v=3:16&bible=World%20English");
  assert.equal(withBible("v=3:16", null), "v=3:16");
  assert.deepEqual(splitBible("v=3:16&bible=World%20English:~:text=x"), { locator: "v=3:16:~:text=x", bible: "World English" });
  assert.deepEqual(splitBible("v=3:16"), { locator: "v=3:16", bible: null });
  assert.deepEqual(parseVerseLocator("v=3:16-18&bible=BSB&c=2"), parseVerseLocator("v=3:16-18"));
});

test("a locator's context: verses around its passage, across chapters", () => {
  assert.deepEqual(splitContext("v=3:16&c=2"), { locator: "v=3:16", context: 2 });
  assert.deepEqual(splitContext("v=3:16"), { locator: "v=3:16", context: null });
  assert.equal(withContext("v=3:16:~:text=so", 2), "v=3:16&c=2:~:text=so");
  // The verses themselves ignore it, and the edition too
  assert.deepEqual(parseVerseLocator("v=3:16&ver=1.0.2&vh=9f86d081&c=2"), parseVerseLocator("v=3:16"));
  const counts = new Map([[2, 25], [3, 36], [4, 54]]);
  const v = (chapter: number, verse: number, endChapter: number, endVerse: number) => ({ chapter, verse, endChapter, endVerse });
  assert.deepEqual(withContextVerses([v(3, 16, 3, 16)], 2, counts), { shown: [v(3, 14, 3, 18)], context: [v(3, 14, 3, 15), v(3, 17, 3, 18)] });
  // Into the chapter before, and stopping at the book's last verse
  assert.deepEqual(withContextVerses([v(3, 1, 3, 2)], 2, counts).shown, [v(2, 24, 3, 4)]);
  assert.deepEqual(withContextVerses([v(4, 53, 4, 54)], 3, counts).shown, [v(4, 50, 4, 54)]);
  // Parts whose context overlaps are shown as one
  assert.deepEqual(withContextVerses([v(3, 16, 3, 16), v(3, 19, 3, 19)], 1, counts), { shown: [v(3, 15, 3, 20)], context: [v(3, 15, 3, 15), v(3, 17, 3, 18), v(3, 20, 3, 20)] });
  // Whole chapters, and no context, are as they were
  assert.deepEqual(withContextVerses([v(3, 0, 3, END)], 2, counts).context, []);
  assert.deepEqual(withContextVerses([v(3, 16, 3, 16)], 0, counts).shown, [v(3, 16, 3, 16)]);
});
