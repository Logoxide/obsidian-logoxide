// References in notes by how they're written: links, explicit links, embeds, and bare references
import assert from "node:assert/strict";
import { test } from "node:test";
import { BookStyle, Topos } from "logoxide";
import { findReferences, partAt, passageStops, wholeReference, withHighlight } from "../src/core/syntax.ts";

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

test("a click on a part of a reference opens that part", () => {
  const at = (text: string, offset: number) => partAt(topos, text, offset)?.reference ?? null;
  assert.equal(at("John 3:16; 4:5-7", 2), "John 3:16");
  assert.equal(at("John 3:16; 4:5-7", 11), "John 4:5-7");
  assert.equal(at("Rom 8:28, 31, 38-39", 10), "Romans 8:31");
  // A range's end opens its last verse, in a reference of one part too
  assert.equal(at("John 3:16; 4:5-7", 15), "John 4:7");
  assert.equal(at("John 3:16-18", 10), "John 3:18");
  assert.equal(at("John 3-4", 7), "John 4");
  // Between parts: the verse before it
  assert.equal(at("John 3:16; 4:5-7", 9), "John 3:16");
  assert.equal(at("John 3:16; 4:5-7", 10), "John 3:16");
  assert.equal(at("Rom 8:28, 31, 38-39", 8), "Romans 8:28");
  assert.equal(at("John 3:16-18, 20", 12), "John 3:18");
  assert.equal(at("John 3:16; 4:5-7", 14), "John 4:5-7");
  // The rest of a reference of one part, and past the last part: all of it
  assert.equal(at("John 3:16-18", 2), null);
  assert.equal(at("John 3:16-18", 9), null);
  assert.equal(at("John 3:16", 2), null);
  assert.equal(at("John 3:16; 4:5 KJV", 16), null);
});

test("a passage's stops are where each part starts and ends, each once", () => {
  const stops = (reference: string) => passageStops(topos, topos.parse(reference, BookStyle.Name)!).map((p) => p.reference);
  assert.deepEqual(stops("John 3:16-18; 4:5, 1-2"), ["John 3:16", "John 3:18", "John 4:5", "John 4:1", "John 4:2"]);
  assert.deepEqual(stops("John 3:16; 3:16-18"), ["John 3:16", "John 3:18"]);
  assert.deepEqual(stops("John 3-4"), ["John 3", "John 4"]);
  assert.deepEqual(stops("John 3:16"), ["John 3:16"]);
});

test("an embed carries a highlight after #, and is written again with another", () => {
  const embeds = (text: string) => findReferences(topos, text).map((r) => `${r.kind} ${r.passage.reference} ${r.fragment ?? "-"} ${JSON.stringify(text.slice(r.labelStart, r.labelEnd))}`);
  assert.deepEqual(embeds("![John 3:16](#:~:text=so%20loved&color=yellow)"), ['embed John 3:16 :~:text=so%20loved&color=yellow "John 3:16"']);
  assert.deepEqual(embeds("![the verse](John 3:16#:~:text=so)"), ['embed John 3:16 :~:text=so "the verse"']);
  // Not an embed's highlight: a heading, and a link
  assert.deepEqual(embeds("![John 3:16](#heading)"), ["bare John 3:16 - \"John 3:16\""]);
  assert.deepEqual(embeds("[John 3:16](#:~:text=so)"), ["bare John 3:16 - \"John 3:16\""]);

  const again = (text: string, fragment: string | null) => withHighlight(text, findReferences(topos, text)[0]!, fragment);
  const f = ":~:text=so%20loved&color=yellow";
  assert.equal(again("![John 3:16]", f), `![John 3:16](#${f})`);
  assert.equal(again(`![John 3:16](#:~:text=x&color=red)`, f), `![John 3:16](#${f})`);
  assert.equal(again(`![John 3:16](#:~:text=x&color=red)`, null), "![John 3:16]");
  assert.equal(again("![the verse](John 3:16)", f), `![the verse](John 3:16#${f})`);
  assert.equal(again(`![the verse](John 3:16#${f})`, null), "![the verse](John 3:16)");
  assert.equal(again("John 3:16", f), `![John 3:16](#${f})`);
});
