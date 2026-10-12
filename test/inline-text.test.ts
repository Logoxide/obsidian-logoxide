// The text shown after a reference in live preview, from its template
import assert from "node:assert/strict";
import { test } from "node:test";
import { inlineNeeds, inlineText } from "../src/core/inline-text.ts";

const values = { first: "For God so loved the world,", last: "whoever does not believe…", text: "For God so loved the world, … condemned.", reference: "John 3:16-18", bible: "BSB" };

test("a template fills in the passage's text", () => {
  assert.equal(inlineText("{first}", values, 0), "For God so loved the world,");
  assert.equal(inlineText("{reference} ({bible}): {first}", values, 0), "John 3:16-18 (BSB): For God so loved the world,");
  assert.equal(inlineText("{first}", { ...values, first: "¶ For God so loved" }, 0), "For God so loved");
  // Unknown names stay as they are
  assert.equal(inlineText("{first} {nope}", values, 0), "For God so loved the world, {nope}");
});

test("it's cut at a word, and nothing when its text is empty", () => {
  assert.equal(inlineText("{first}", values, 12), "For God so…");
  assert.equal(inlineText("{first}", { ...values, first: "" }, 0), null);
  assert.equal(inlineText("— {first}", { ...values, first: "" }, 0), null);
});

test("only the values a template uses are looked up", () => {
  assert.deepEqual([...inlineNeeds("{first} … {last}")], ["first", "last"]);
});
