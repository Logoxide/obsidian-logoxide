import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStub, staleStubs, stubPath, stubText } from "../src/core/stubs.ts";

test("a book's stub mirrors its package, without a version", () => {
  assert.equal(stubPath("Biblix", { package: "bsb", path: "usx/JHN.usx" }), "Biblix/bsb/usx/JHN.bible");
  assert.equal(stubPath("Biblix", { package: "kjv-bob", path: "usfm/43-JHN.usfm" }), "Biblix/kjv-bob/usfm/43-JHN.bible");
  // A dot in a folder isn't the extension
  assert.equal(stubPath("", { package: "p", path: "v1.0/JHN" }), "p/v1.0/JHN.bible");
});

test("a stub's text names its package and book", () => {
  const stub = { package: "bsb", path: "usx/JHN.usx" };
  assert.deepEqual(parseStub(stubText(stub)), stub);
  assert.equal(parseStub("# My notes"), null);
  assert.equal(parseStub('{"biblix": 1}'), null);
});

test("only stubs no package has are removed", () => {
  const existing = ["Biblix/bsb/usx/JHN.bible", "Biblix/bsb/usx/ROM.bible", "Biblix/bsb/usx/JHN - Annotations.md"];
  assert.deepEqual(staleStubs(existing, new Set(["Biblix/bsb/usx/JHN.bible"])), ["Biblix/bsb/usx/ROM.bible"]);
});
