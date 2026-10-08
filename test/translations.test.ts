// References that name a translation (`John 3:16 KJV`): the names, the syntax, completion, and links
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BookStyle, Topos } from "topos-bible";
import { completionsBefore } from "../src/core/completions.ts";
import { linkUrl } from "../src/core/links.ts";
import { findReferences, wholeNamedReference } from "../src/core/syntax.ts";
import { buildTranslations, parseAliases } from "../src/core/translations.ts";
import { toposDir } from "./topos.ts";

const topos = Topos.new();

test("translations: Bibles' names, then the settings' names and aliases", () => {
  const aliases = parseAliases("kjv: AV, King James\nESV\n\n  NET : NET2 ");
  assert.deepEqual([...aliases], [["kjv", ["AV", "King James"]], ["ESV", []], ["NET", ["NET2"]]]);
  // A Bible's name keeps its case; settings name it ignoring case
  const translations = buildTranslations(["BSB", "KJV"], aliases);
  assert.deepEqual(translations.names(), ["BSB", "KJV", "ESV", "NET"]);
  assert.equal(translations.get("king james"), "KJV");
  assert.equal(translations.get("net2"), "NET");
  assert.equal(translations.get("NIV"), null);
  translations.dispose();
});

test("a Bible's own verse counts check references that name it", () => {
  const threeJohn = 64;
  const translations = buildTranslations(["ESV"], new Map(), [{ translation: "ESV", bookId: threeJohn, counts: [15] }]);
  const whole = (s: string) => {
    const named = wholeNamedReference(topos, s, translations);
    return named ? `${named.passage.reference}${named.translation ? ` [${named.translation}]` : ""}` : null;
  };
  // The default counts (the KJV's) end 3 John at verse 14
  assert.equal(whole("3 John 1:15 esv"), "3 John 1:15 [ESV]");
  assert.equal(whole("3 John 1:15"), null);
  translations.dispose();
});

test("links, explicit links, embeds, and bare references name translations", () => {
  const translations = buildTranslations(["BSB", "KJV", "LXX"], parseAliases("KJV: AV"));
  const found = (text: string) =>
    findReferences(topos, text, translations).map(
      (r) => `${r.kind} ${r.passage.reference}${r.translation ? ` [${r.translation}]` : ""} ${JSON.stringify(text.slice(r.start, r.end))}`,
    );
  assert.deepEqual(found("An explicit [John 1:1 KJV] and [Ps 23 (av)]."), [
    'explicit John 1:1 [KJV] "[John 1:1 KJV]"',
    'explicit Psalm 23 [KJV] "[Ps 23 (av)]"',
  ]);
  assert.deepEqual(found("![John 1:1-5, BSB]"), ['embed John 1:1-5 [BSB] "![John 1:1-5, BSB]"']);
  assert.deepEqual(found("[the Word](Jn 1:1 KJV)"), ['link John 1:1 [KJV] "[the Word](Jn 1:1 KJV)"']);
  assert.deepEqual(found("[John.3.16 KJV]"), ['explicit John 3:16 [KJV] "[John.3.16 KJV]"']);
  // A bare reference covers its translation, and the bracket around it
  assert.deepEqual(found("See John 3:16 (KJV) and Ps 22, LXX; Rom 8:28 NIV."), [
    'bare John 3:16 [KJV] "John 3:16 (KJV)"',
    'bare Psalm 22 [LXX] "Ps 22, LXX"',
    'bare Romans 8:28 "Rom 8:28"',
  ]);
  // Not a translation: nothing else may be in brackets
  assert.deepEqual(found("[John 3:16 says KJV]"), ['bare John 3:16 "John 3:16"']);
  // Without translations, nothing is one
  assert.deepEqual(
    findReferences(topos, "[John 1:1 KJV]").map((r) => r.kind),
    ["bare"],
  );
  translations.dispose();
});

test("completion offers translations after a reference (topos's translations.txt)", () => {
  const lines = readFileSync(join(toposDir, "crates/topos-lib/tests/cases/translations.txt"), "utf8").split("\n");
  const names = lines.find((l) => l.startsWith("translations: "))!.slice("translations: ".length).split(", ");
  const aliases = new Map(names.map((n) => n.split("=")).map(([name, ...rest]) => [name!, rest]));
  const translations = buildTranslations([], aliases);
  const failures: string[] = [];
  for (const line of lines.filter((l) => l.startsWith("complete: "))) {
    const [input, expectedText] = line.slice("complete: ".length).split(" =>");
    const expected = expectedText!.split(" | ").map((e) => e.trim()).filter(Boolean);
    const labels = completionsBefore(topos, input!, BookStyle.Name, 0, "always", { needsNumber: true, translations }).map((c) => c.label);
    const ok = expected.length === 0 ? labels.length === 0 : expected.every((e, i) => labels[i] === e);
    if (!ok) failures.push(`${JSON.stringify(input)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(labels.slice(0, 4))}`);
  }
  assert.deepEqual(failures, []);
  translations.dispose();
});

test("{translation} in link templates", () => {
  const passage = topos.parse("John 3:16", BookStyle.Name)!;
  const template = "https://www.biblegateway.com/passage/?search={reference}[&version={translation}]";
  assert.equal(linkUrl(template, passage, undefined, "ESV"), "https://www.biblegateway.com/passage/?search=John%203%3A16&version=ESV");
  assert.equal(linkUrl(template, passage), "https://www.biblegateway.com/passage/?search=John%203%3A16");
});
