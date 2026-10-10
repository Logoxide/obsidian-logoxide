import assert from "node:assert/strict";
import { test } from "node:test";
import { displayCss, type DisplaySettings } from "../src/core/display.ts";

const DEFAULTS: DisplaySettings = { bibleNotes: false, bibleCrossRefs: false, bibleVerseNumbers: true, bibleRedLetters: false, verseNumberColor: "" };

test("display settings become CSS in the readers' layer", () => {
  // Notes hidden by default (they aren't rendered then either)
  const css = displayCss(DEFAULTS);
  assert.match(css, /^@layer document \{/);
  assert.match(css, /\.topos-note:not\(\.topos-crossref\) \{ display: none; \}/);
  assert.match(css, /\.topos-note\.topos-crossref \{ display: none; \}/);
  assert.doesNotMatch(css, /topos-verse|topos-woj/);
  // Only cross references
  const refs = displayCss({ ...DEFAULTS, bibleCrossRefs: true });
  assert.doesNotMatch(refs, /topos-crossref \{ display: none/);
  assert.match(refs, /:not\(\.topos-crossref\) \{ display: none/);
  // Everything shown, nothing to say
  assert.equal(displayCss({ ...DEFAULTS, bibleNotes: true, bibleCrossRefs: true }), "");
  // Verse numbers: a color, or hidden (then the color doesn't matter)
  assert.match(displayCss({ ...DEFAULTS, verseNumberColor: "#7c3aed" }), /\.topos-verse::before \{ color: #7c3aed; opacity: 1; \}/);
  assert.match(displayCss({ ...DEFAULTS, verseNumberColor: "red; } body { x: y" }), /color: currentColor;/);
  assert.match(displayCss({ ...DEFAULTS, verseNumberColor: "accent" }), /\.topos-verse::before \{ color: var\(--text-accent\); opacity: 1; \}/);
  const hidden = displayCss({ ...DEFAULTS, bibleVerseNumbers: false, verseNumberColor: "#7c3aed" });
  assert.match(hidden, /\.topos-verse::before \{ content: none; \}/);
  assert.doesNotMatch(hidden, /#7c3aed/);
  // Red letters: the stylesheet's own color, else the theme's red
  assert.match(displayCss({ ...DEFAULTS, bibleRedLetters: true }), /\.topos-woj \{ color: var\(--tpb-woj-color, var\(--color-red/);
});
