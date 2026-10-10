import assert from "node:assert/strict";
import { test } from "node:test";
import { fileName, parseStub, staleStubs, stubNames, stubPath, stubText } from "../src/core/stubs.ts";

test("a book's stub is named by its title, without a version", () => {
  assert.equal(stubPath("Logoxide", { package: "bsb", path: "usx/JHN.usx" }, "John"), "Logoxide/bsb/John.bible");
  assert.equal(stubPath("Logoxide", { package: "tdp", path: "epub/tdp.epub" }, "The Dorean Principle", "epub"), "Logoxide/tdp/The Dorean Principle.epub");
  // Without a title: the book's path
  assert.equal(stubPath("Logoxide", { package: "bsb", path: "usx/JHN.usx" }), "Logoxide/bsb/usx/JHN.bible");
  assert.equal(stubPath("Logoxide", { package: "kjv-bob", path: "usfm/43-JHN.usfm" }), "Logoxide/kjv-bob/usfm/43-JHN.bible");
  // A dot in a folder isn't the extension
  assert.equal(stubPath("", { package: "p", path: "v1.0/JHN" }), "p/v1.0/JHN.bible");
});

test("a stub's text names its package and book", () => {
  const stub = { package: "bsb", path: "usx/JHN.usx" };
  assert.deepEqual(parseStub(stubText(stub)), stub);
  assert.equal(parseStub("# My notes"), null);
  assert.equal(parseStub('{"logoxide": 1}'), null);
  // One book of a file that holds several (a whole Bible in ThML)
  const john = { package: "kjv", path: "thml/kjv.xml", book: "JHN" };
  assert.equal(stubText(john), '{"logoxide":"kjv","path":"thml/kjv.xml","book":"JHN"}\n');
  assert.deepEqual(parseStub(stubText(john)), john);
});

test("only stubs no package has are removed", () => {
  const existing = ["Logoxide/bsb/usx/JHN.bible", "Logoxide/bsb/usx/ROM.bible", "Logoxide/bsb/usx/JHN - Annotations.md"];
  assert.deepEqual(staleStubs(existing, new Set(["Logoxide/bsb/usx/JHN.bible"])), ["Logoxide/bsb/usx/ROM.bible"]);
});

test("titles become file names, unique in their package", () => {
  assert.equal(fileName("1 & 2: Kings? / [Notes]"), "1 & 2- Kings- - -Notes-");
  assert.equal(fileName("  Song of   Solomon. "), "Song of Solomon");
  const names = stubNames([
    { path: "usx/JHN.usx", title: "John" },
    { path: "usx/1JN.usx", title: "John" },
    { path: "usx/ROM.usx", title: "Romans" },
    { path: "usx/XXA.usx", title: null },
  ]);
  assert.deepEqual([...names.values()], ["John (JHN)", "John (1JN)", "Romans", null]);
});
