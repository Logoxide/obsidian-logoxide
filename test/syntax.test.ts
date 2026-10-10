// References in notes by how they're written: links, explicit links, embeds, and bare references
import assert from "node:assert/strict";
import { test } from "node:test";
import { Topos } from "logoxide";
import { findReferences, wholeReference } from "../src/core/syntax.ts";

const topos = Topos.new();
const found = (text: string) =>
  findReferences(topos, text).map((r) => `${r.kind} ${r.passage.reference} ${JSON.stringify(text.slice(r.labelStart, r.labelEnd))}`);

test("link targets and bracketed text must be a whole reference", () => {
  const whole = (s: string) => wholeReference(topos, s)?.reference ?? null;
  assert.equal(whole("John 3:16"), "John 3:16");
  assert.equal(whole("Jn 3:16-18"), "John 3:16-18");
  assert.equal(whole("John.3.16"), "John 3:16");
  assert.equal(whole("JHN 3:16"), "John 3:16");
  assert.equal(whole("<John 3:16>"), "John 3:16");
  assert.equal(whole("Ps 23"), "Psalm 23");
  // Ambiguous in prose, but brackets say it's a reference
  assert.equal(whole("Is 5"), "Isaiah 5");
  assert.equal(whole("see John 3:16"), null);
  assert.equal(whole("John 3:16 is great"), null);
  assert.equal(whole("the love verse"), null);
  assert.equal(whole("John"), null);
  assert.equal(whole("Notes/John"), null);
});

test("each way of writing a reference", () => {
  assert.deepEqual(found("A [the love verse](John 3:16) and [osis](John.3.16) and [u](JHN 3:16)."), [
    'link John 3:16 "the love verse"',
    'link John 3:16 "osis"',
    'link John 3:16 "u"',
  ]);
  assert.deepEqual(found("An explicit [John 1:1] and [Ps 23]."), ['explicit John 1:1 "John 1:1"', 'explicit Psalm 23 "Ps 23"']);
  assert.deepEqual(found("![John 1:1-5]"), ['embed John 1:1-5 "John 1:1-5"']);
  assert.deepEqual(found("![the Word](Jn 1:1)"), ['embed John 1:1 "the Word"']);
  assert.deepEqual(found("Bare Romans 8:28 here, [John 1:1] there"), ['bare Romans 8:28 "Romans 8:28"', 'explicit John 1:1 "John 1:1"']);
});

test("other bracket syntax is left alone", () => {
  // Wikilinks, links to notes, footnotes, checkboxes, reference definitions
  assert.deepEqual(found("[[John 3:16]]"), ['bare John 3:16 "John 3:16"']);
  assert.deepEqual(found("[a note](Notes/John.md)"), []);
  assert.deepEqual(found("[^1] and [x] and [ ]"), []);
  assert.deepEqual(found("[John 1:1]: https://example.com"), ['bare John 1:1 "John 1:1"']);
  // A link to a site whose text is a reference: the text is a bare reference
  assert.deepEqual(found("[John 3:16](https://example.com)"), ['bare John 3:16 "John 3:16"']);
  // Brackets around more than a reference
  assert.deepEqual(found("[see John 3:16]"), ['bare John 3:16 "John 3:16"']);
});
