import assert from "node:assert/strict";
import { test } from "node:test";
import { Topos } from "logoxide";
import { bookMatches, byTestament, parseTypedNumber, parseTypedPlace, testamentOf, tileLabel } from "../src/core/picker.ts";

const books = Topos.new().books();
const named = (name: string) => books.find((b) => b.name === name)!;

test("the books split into the testaments at Malachi", () => {
  const { old, new: nt } = byTestament(books);
  assert.equal(old.length, 39);
  assert.equal(nt.length, 27);
  assert.equal(old.at(-1)!.name, "Malachi");
  assert.equal(nt[0]!.name, "Matthew");
  assert.equal(testamentOf(named("Revelation").id), "new");
});

test("tiles show short names, and typing picks books by their start", () => {
  assert.equal(tileLabel(named("1 Samuel")), "1Sam");
  assert.ok(bookMatches(named("1 Samuel"), "1 sa"));
  assert.ok(bookMatches(named("1 Samuel"), "1sam"));
  assert.ok(bookMatches(named("Philemon"), "phlm"));
  assert.ok(!bookMatches(named("John"), "1jo"));
  assert.deepEqual(books.filter((b) => bookMatches(b, "jo")).map((b) => b.name), ["Joshua", "Job", "Joel", "Jonah", "John"]);
});

test("a chapter, or a chapter and verse, typed on a number pad", () => {
  const verses = (chapter: number) => (chapter === 3 ? 36 : 20);
  assert.deepEqual(parseTypedPlace("3", 21, verses), { chapter: 3, verse: null });
  for (const typed of ["3:16", "3.16", "3,16", " 3 16 "]) assert.deepEqual(parseTypedPlace(typed, 21, verses), { chapter: 3, verse: 16 });
  assert.equal(parseTypedPlace("22", 21, verses), null);
  assert.equal(parseTypedPlace("0", 21, verses), null);
  assert.equal(parseTypedPlace("3:37", 21, verses), null);
  assert.equal(parseTypedPlace("3a", 21, verses), null);
  assert.equal(parseTypedNumber("16", 36), 16);
  assert.equal(parseTypedNumber("37", 36), null);
  assert.equal(parseTypedNumber("", 36), null);
});
