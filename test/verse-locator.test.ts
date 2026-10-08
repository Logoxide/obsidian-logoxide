import assert from "node:assert/strict";
import { test } from "node:test";
import { BookStyle, Topos } from "topos-bible";
import { END, formatVerseLocator, parseVerseLocator, partSegments, passageParts } from "../src/core/verse-locator.ts";

test("verse locators round-trip", () => {
  for (const s of ["v=3:16", "v=3:16-18", "v=3:16-4:2", "v=3", "v=3-4", "v=3:16;4:1-5;5"]) {
    assert.equal(formatVerseLocator(parseVerseLocator(s)!), s);
  }
  // Markdown links may encode them
  assert.equal(formatVerseLocator(parseVerseLocator("v=3%3A16%3B4")!), "v=3:16;4");
  assert.deepEqual(parseVerseLocator("v=3"), [{ chapter: 3, verse: 0, endChapter: 3, endVerse: END }]);
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
