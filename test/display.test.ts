import assert from "node:assert/strict";
import { test } from "node:test";
import { displayCss, notesShown, type DisplaySettings } from "../src/core/display.ts";

const DEFAULTS: DisplaySettings = { footnotes: "none", crossRefs: "none", verseNumbers: "faded", bibleRedLetters: false };

test("display settings become CSS in the readers' layer", () => {
  // Notes hidden by default (they aren't rendered then either), verse numbers faded
  const css = displayCss(DEFAULTS);
  assert.match(css, /^@layer document \{/);
  assert.match(css, /\.topos-note:not\(\.topos-crossref\) \{ display: none; \}/);
  assert.match(css, /\.topos-note\.topos-crossref \{ display: none; \}/);
  assert.match(css, /\.topos-verse::before \{ color: currentColor; opacity: 0\.6; \}/);
  assert.doesNotMatch(css, /topos-woj/);
  assert.equal(notesShown(DEFAULTS), false);
  // Only cross references, in a color
  const refs = { ...DEFAULTS, crossRefs: "#3366ff" };
  assert.match(displayCss(refs), /\.topos-note\.topos-crossref::before \{ color: #3366ff; opacity: 1; \}/);
  assert.match(displayCss(refs), /:not\(\.topos-crossref\) \{ display: none/);
  assert.equal(notesShown(refs), true);
  // Footnotes in the accent color
  assert.match(displayCss({ ...DEFAULTS, footnotes: "accent" }), /\.topos-note:not\(\.topos-crossref\)::before \{ color: var\(--text-accent\); opacity: 1; \}/);
  // Verse numbers: a color, the accent color, hidden; what isn't a color is the text's
  assert.match(displayCss({ ...DEFAULTS, verseNumbers: "#7c3aed" }), /\.topos-verse::before \{ color: #7c3aed; opacity: 1; \}/);
  assert.match(displayCss({ ...DEFAULTS, verseNumbers: "accent" }), /\.topos-verse::before \{ color: var\(--text-accent\); opacity: 1; \}/);
  assert.match(displayCss({ ...DEFAULTS, verseNumbers: "red; } body { x: y" }), /color: currentColor;/);
  assert.match(displayCss({ ...DEFAULTS, verseNumbers: "none" }), /\.topos-verse::before \{ content: none; \}/);
  // Red letters: the stylesheet's own color, else the theme's red
  assert.match(displayCss({ ...DEFAULTS, bibleRedLetters: true }), /\.topos-woj \{ color: var\(--tpb-woj-color, var\(--color-red/);
});
