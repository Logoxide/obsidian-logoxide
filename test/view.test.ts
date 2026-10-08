// Renders the sidebar to HTML with a fake plugin (esbuild compiles the JSX)
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

test("the sidebar renders filtered, grouped results", async () => {
  const src = (path: string) => JSON.stringify(new URL(`../src/${path}`, import.meta.url).pathname);
  const dir = mkdtempSync(join(tmpdir(), "topos-view-"));
  const entry = join(dir, "entry.tsx");
  writeFileSync(
    entry,
    `import { renderToString } from "react-dom/server";
     import { Topos } from "biblix";
     import { PaneApp } from ${src("view/PaneApp.tsx")};
     import { SearchStore } from ${src("view/store.ts")};
     import { ReferenceIndex } from ${src("core/index.ts")};
     import { DEFAULT_SETTINGS } from ${src("core/settings.ts")};
     import { linkUrl, siteName } from ${src("core/links.ts")};
     import { NO_FILTERS } from ${src("core/filters.ts")};

     export function render(filters, groupBy, queries = [], context = 0) {
       const topos = Topos.new();
       const index = new ReferenceIndex(topos);
       index.update("a.md", "Read Jn 3:16 and Rom 8:28");
       index.update("b.md", "Psalm 23, then John 1:1");
       const settings = { ...DEFAULT_SETTINGS, queries };
       const plugin = {
         topos, refs: index, indexVersion: 1, indexing: false, settings,
         indexer: { loadDetails: async () => {} },
         extensions: () => ["md"], bibles: { all: () => [] },
         referenceUrl: (passage) => linkUrl(DEFAULT_SETTINGS.linkTemplate, passage),
         linkSite: () => siteName(DEFAULT_SETTINGS.linkTemplate),
         search: new SearchStore({ filters: { ...NO_FILTERS, ...filters }, groupBy, context }),
         subscribeIndex: () => () => {},
         app: {
           workspace: { getActiveFile: () => null, on: () => ({}), offref() {} },
           vault: { getFileByPath: (path) => ({ path }), cachedRead: async () => "" },
         },
       };
       const host = {
         markdown: () => ({ done: Promise.resolve(), unload() {} }),
         verses: () => ({ unload() {} }),
         icon() {}, open() {}, openPassage() {}, copy() {}, folders: () => [],
       };
       const look = { preview: "source", verses: false, style: "name", merge: false, references: false };
       return renderToString(<PaneApp plugin={plugin} store={plugin.search} host={host} look={look} onOpenTab={() => {}} />);
     }`,
  );
  const out = join(new URL("../node_modules/.cache/", import.meta.url).pathname, "view.mjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["obsidian", "biblix", "react", "react-dom"],
    nodePaths: [new URL("../node_modules", import.meta.url).pathname],
    outfile: out,
    logLevel: "silent",
  });
  const { render } = await import(pathToFileURL(out).href);
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const all = text(render({}, "file"));
  assert.match(all, /4 references 2 files/);
  assert.match(all, /John 3:16/);
  assert.match(all, /Psalm 23/);
  // The sidebar can move its search into a tab
  assert.match(render({}, "file"), /aria-label="Open this search in a tab"/);

  const nt = text(render({ testaments: ["new"] }, "book"));
  assert.match(nt, /3 references 2 files/);
  assert.match(nt, /John 2 John 3:16/);
  assert.doesNotMatch(nt, /Psalm 23/);

  // Contradictory filters say why nothing matches, even with the panel closed
  const conflict = text(render({ testaments: ["old"], genres: ["Pauline Epistles"] }, "file"));
  assert.match(conflict, /0 references/);
  assert.match(conflict, /Pauline Epistles is not in the Old Testament, so nothing can match/);

  // The header counts filters and books; the query bar shows them as CLI options
  const pauline = render({ testaments: ["new"], genres: ["Pauline Epistles"] }, "file");
  assert.match(text(pauline), /Filters 2 13 books/);
  assert.match(pauline, /value="--nt -g &quot;Pauline Epistles&quot;"/);
  assert.match(text(pauline), /1 reference 1 file/);

  // A saved search matching the filters is marked
  const saved = render({ testaments: ["new"] }, "file", [
    { name: "Old", query: "--ot" },
    { name: "New", query: "-t new" },
  ]);
  assert.match(saved, /<li class="is-active"><button class="topos-pane-saved-name" title="-t new"><span>New<\/span>/);
  assert.match(saved, /aria-label="Delete &quot;New&quot;"/);

  // Passage filters narrow the results
  assert.match(text(render({ anyOverlap: ["John 3"] }, "file")), /1 reference 1 file/);
  assert.match(text(render({ inside: ["John 1-3"] }, "file")), /2 references 2 files/);
  assert.match(text(render({ excludeOverlap: ["John 1-3"] }, "file")), /2 references 2 files.*Romans 8:28/);

  // The context control (lines are read after the first render, so the server render has none)
  assert.match(render({}, "file", [], 2), /<option value="2" selected="">±2 lines<\/option>/);

  const bad = text(render({ books: ["Jhon"] }, "file"));
  assert.match(bad, /Unknown book &quot;Jhon&quot;/);
});

test("the search tab shows file types with their counts, filters, and results", async () => {
  const src = (path: string) => JSON.stringify(new URL(`../src/${path}`, import.meta.url).pathname);
  const dir = mkdtempSync(join(tmpdir(), "topos-pane-"));
  const entry = join(dir, "entry.tsx");
  writeFileSync(
    entry,
    `import { renderToString } from "react-dom/server";
     import { Topos } from "biblix";
     import { PaneApp } from ${src("view/PaneApp.tsx")};
     import { SearchStore } from ${src("view/store.ts")};
     import { ReferenceIndex } from ${src("core/index.ts")};
     import { DEFAULT_SETTINGS } from ${src("core/settings.ts")};
     import { linkUrl, siteName } from ${src("core/links.ts")};
     import { NO_FILTERS } from ${src("core/filters.ts")};

     export function render(state, look) {
       const topos = Topos.new();
       const index = new ReferenceIndex(topos);
       index.update("Notes/a.md", "Read Jn 3:16 and Rom 8:28");
       index.update("b.txt", "Psalm 23, then John 1:1");
       index.update("Media/Talk.srt", "John 3:17");
       const settings = { ...DEFAULT_SETTINGS, extensions: "md, txt, srt" };
       const plugin = {
         topos, refs: index, indexVersion: 1, indexing: false, settings,
         indexer: { loadDetails: async () => {} },
         extensions: () => settings.extensions.split(",").map((e) => e.trim()),
         bibles: { all: () => [] },
         referenceUrl: (passage) => linkUrl(DEFAULT_SETTINGS.linkTemplate, passage),
         linkSite: () => siteName(DEFAULT_SETTINGS.linkTemplate),
         search: new SearchStore(),
         subscribeIndex: () => () => {},
         app: {
           workspace: { getActiveFile: () => null, on: () => ({}), offref() {} },
           vault: { getFileByPath: (path) => ({ path }), cachedRead: async () => "" },
         },
       };
       const host = {
         markdown: () => ({ done: Promise.resolve(), unload() {} }),
         verses: () => ({ unload() {} }),
         icon() {}, open() {}, openPassage() {}, copy() {},
         folders: () => ["Media", "Notes"],
       };
       const store = new SearchStore({ ...state, filters: { ...NO_FILTERS, ...state.filters } });
       return renderToString(<PaneApp plugin={plugin} store={store} host={host} look={look} />);
     }`,
  );
  const out = join(new URL("../node_modules/.cache/", import.meta.url).pathname, "pane.mjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["obsidian", "biblix", "react", "react-dom"],
    nodePaths: [new URL("../node_modules", import.meta.url).pathname],
    outfile: out,
    logLevel: "silent",
  });
  const { render } = await import(pathToFileURL(out).href);
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  // Every file type the settings search, with how many references each has
  const all = text(render({}));
  assert.match(all, /All 5 md 2 txt 2 srt 1/);
  assert.match(all, /5 references 3 files/);
  // References on the same line are one result, counted; which they are is listed when asked
  assert.match(all, /Notes\/ a 2 2 matches Line 1/);
  const listed = text(render({}, { preview: "rendered", verses: false, style: "name", merge: true, references: true }));
  assert.match(listed, /John 3:16 Romans 8:28 2 matches Line 1/);
  const apart = text(render({}, { preview: "rendered", verses: false, style: "name", merge: false }));
  assert.match(apart, /John 3:16 Line 1 .*Romans 8:28 Line 1/);
  assert.doesNotMatch(apart, /matches/);

  // Limited to some types, the others are off, and the filters still apply
  const some = render({ extensions: ["txt", "srt"], filters: { testaments: ["new"] } });
  assert.match(text(some), /2 references 2 files/);
  assert.match(some, /class="topos-pane-type is-off"[^>]*>.*?md/);
  assert.doesNotMatch(text(some), /Romans 8:28/);
  // The query bar shows the filters as the CLI's options
  assert.match(some, /value="--nt"/);

  // Grouped by book, each result names its file; the source preview numbers its lines (read from
  // the note once shown)
  const books = render({ groupBy: "book", filters: { books: ["John"] } }, { preview: "source", verses: false, style: "abbreviation", merge: false });
  assert.match(text(books), /John 3 .*Jn 3:16 Notes\/a.md Line 1/);
  assert.match(books, /<span class="topos-pane-line-number">1<\/span>/);

  // Nothing matches: says so, with a way back
  assert.match(text(render({ filters: { books: ["Obadiah"] } })), /No references match\. Search everything/);
});
