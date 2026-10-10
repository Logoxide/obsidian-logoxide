import assert from "node:assert/strict";
import { test } from "node:test";
import { BookStyle, Topos } from "logoxide";
import { END, formatVerseLocator, parseVerseLocator, partSegments, passageParts, splitEdition, withEdition } from "../src/core/verse-locator.ts";

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
