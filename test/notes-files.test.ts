import assert from "node:assert/strict";
import { test } from "node:test";
import { headingChapter, notesPath, notesText, osisLocator } from "../src/core/notes-files.ts";

test("a book's notes: shared by translations, or one a translation", () => {
  assert.equal(notesPath("Bibles", "shared", "John", "ESV"), "Bibles/John.md");
  assert.equal(notesPath("Bibles/", "translation", "1 John", "ESV"), "Bibles/ESV/1 John.md");
  assert.equal(notesPath("", "shared", "John", null), "John.md");
  assert.equal(notesPath("Notes", "translation", "John", null), "Notes/John.md");
});

test("a new notes file names its book and has a heading a chapter", () => {
  assert.equal(notesText("John", null, 2), "---\nbible-book: John\n---\n\n## John 1\n\n## John 2\n");
  assert.match(notesText("Song of Solomon", "KJV", 1), /^---\nbible-book: Song of Solomon\nbible-translation: KJV\n---/);
  assert.match(notesText("true", null, 0), /bible-book: "true"/);
});

test("a heading's passage is a place in the book", () => {
  assert.equal(osisLocator("John.3"), "v=3");
  assert.equal(osisLocator("John.3.16"), "v=3:16");
  assert.equal(osisLocator("John.3.16-John.3.18"), "v=3:16");
  assert.equal(osisLocator("John"), null);
  assert.equal(headingChapter("John.3.16", "John"), 3);
  assert.equal(headingChapter("1John.3", "John"), null);
});
