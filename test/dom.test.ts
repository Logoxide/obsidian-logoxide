// Renders verse search (the sidebar and the search tab) in a DOM (happy-dom), so effects run like they do in Obsidian
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { Window } from "happy-dom";

const cache = new URL("../node_modules/.cache/", import.meta.url).pathname;

async function loadApp() {
  const src = (path: string) => JSON.stringify(new URL(`../src/${path}`, import.meta.url).pathname);
  mkdirSync(cache, { recursive: true });
  const entry = join(cache, "dom-entry.tsx");
  writeFileSync(
    entry,
    `import { act } from "react";
     import { createRoot } from "react-dom/client";
     import { Topos } from "biblix";
     import { PaneApp } from ${src("view/PaneApp.tsx")};
     import { ErrorBoundary } from ${src("view/ErrorBoundary.tsx")};
     import { SearchStore } from ${src("view/store.ts")};
     import { ReferenceIndex } from ${src("core/index.ts")};
     import { DEFAULT_SETTINGS } from ${src("core/settings.ts")};
     import { linkUrl, siteName } from ${src("core/links.ts")};
     export { act };
     export function mount(container, notes, state = {}) {
       const topos = Topos.new();
       const index = new ReferenceIndex(topos);
       for (const [path, text] of Object.entries(notes)) index.update(path, text);
       const plugin = {
         topos, refs: index, indexVersion: 1, indexing: false,
         indexer: { loadDetails: async () => {} },
         settings: DEFAULT_SETTINGS,
         extensions: () => ["md"], bibles: { all: () => [] },
         referenceUrl: (passage) => linkUrl(DEFAULT_SETTINGS.linkTemplate, passage),
         linkSite: () => siteName(DEFAULT_SETTINGS.linkTemplate),
         search: new SearchStore(state),
         subscribeIndex: () => () => {},
         app: {
           workspace: { getActiveFile: () => null, on: () => ({}), offref() {} },
           vault: { getFileByPath: (path) => ({ path }), cachedRead: async (file) => notes[file.path] },
         },
       };
       const host = {
         markdown: () => ({ done: Promise.resolve(), unload() {} }), verses: () => ({ unload() {} }),
         icon() {}, open() {}, openPassage() {}, copy() {}, folders: () => [],
       };
       const look = { preview: "source", verses: false, style: "name", merge: false, references: false };
       const root = createRoot(container);
       act(() => root.render(<ErrorBoundary><PaneApp plugin={plugin} store={plugin.search} host={host} look={look} onOpenTab={() => {}} /></ErrorBoundary>));
       return { plugin, root };
     }`,
  );
  const outfile = join(cache, "dom.mjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["obsidian", "biblix", "react", "react-dom"],
    nodePaths: [new URL("../node_modules", import.meta.url).pathname],
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

test("the sidebar's inputs and context lines work in a DOM", async () => {
  const window = new Window();
  // Recent Chromium returns a promise from scrollIntoView; React must not see it as a cleanup
  window.HTMLElement.prototype.scrollIntoView = function () {
    return Promise.resolve() as never;
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    requestAnimationFrame: (f: () => void) => setTimeout(f, 0),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  const errors: unknown[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const { act, mount } = await loadApp();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const notes = {
      "a.md": "first\nRead Jn 3:16 here\nlast line",
      "b.md": "Rom 8:28",
    };
    const { plugin } = mount(container, notes);
    // The notes' lines are read after the first render
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    const text = () => container.textContent!.replace(/\s+/g, " ");
    assert.match(text(), /Read Jn 3:16 here/);
    assert.match(text(), /2 references ?2 files/);

    // Open the filters and focus the "Names" input (explicit overlap): every book is listed, and arrows move
    const input = [...container.querySelectorAll("input")].find((i) => i.placeholder === "John 3:16-21")!;
    const key = (k: string) =>
      act(() => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as never));
    await act(async () => input.focus());
    assert.equal(container.querySelectorAll(".topos-dropdown li").length, plugin.topos.books().length);
    await key("ArrowDown");
    await key("ArrowDown");
    assert.equal(container.querySelector(".topos-dropdown li.is-active span")!.textContent, "Leviticus");

    // Type a reference and press Enter: it becomes a chip and filters the results
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "jn 3");
      input.dispatchEvent(new window.Event("input", { bubbles: true }) as never);
    });
    assert.match(container.querySelector(".topos-dropdown li")!.textContent!, /Add "John 3"/);
    await key("Enter");
    assert.deepEqual(plugin.search.get().filters.explicitOverlap, ["John 3"]);
    assert.match(text(), /1 reference ?1 file/);

    // The filters' Clear clears them
    const clear = [...container.querySelectorAll("button")].find((b) => b.textContent === "Clear")!;
    await act(async () => (clear as unknown as HTMLElement).click());
    assert.deepEqual(plugin.search.get().filters.explicitOverlap, []);
    assert.match(text(), /2 references ?2 files/);

    // Options typed in the query bar apply on Enter
    const bar = container.querySelector<HTMLInputElement>("input.topos-pane-query")!;
    await act(async () => {
      setter.call(bar, '-o "John 3"');
      bar.dispatchEvent(new window.Event("input", { bubbles: true }) as never);
    });
    await act(async () => bar.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as never));
    assert.deepEqual(plugin.search.get().filters.explicitOverlap, ["John 3"]);
    assert.match(text(), /1 reference ?1 file/);

    // Middle-click removes the chip
    const chip = [...container.querySelectorAll(".topos-chip")].find((c) => c.textContent!.startsWith("John 3"))!;
    await act(async () => chip.dispatchEvent(new window.MouseEvent("auxclick", { button: 1, bubbles: true }) as never));
    assert.deepEqual(plugin.search.get().filters.explicitOverlap, []);

    // Context lines are read from the notes and shown around each result
    await act(async () => plugin.search.set({ context: 1 }));
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    const hit = [...container.querySelectorAll(".topos-pane-card")].find((h) => h.textContent!.includes("John 3:16"))!;
    assert.deepEqual(
      [...hit.querySelectorAll(".topos-pane-source-line.is-context")].map((l) => l.textContent),
      ["1first", "3last line"],
    );

    assert.equal(container.querySelector(".topos-crash"), null);
    assert.deepEqual(errors, []);
  } finally {
    console.error = consoleError;
    await window.happyDOM.close();
  }
});

test("in the search tab, Collapse all also collapses groups that appear later", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    requestAnimationFrame: (f: () => void) => setTimeout(f, 0),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const src = (path: string) => JSON.stringify(new URL(`../src/${path}`, import.meta.url).pathname);
  const entry = join(cache, "dom-pane-entry.tsx");
  writeFileSync(
    entry,
    `import { act } from "react";
     import { createRoot } from "react-dom/client";
     import { Topos } from "biblix";
     import { PaneApp } from ${src("view/PaneApp.tsx")};
     import { SearchStore } from ${src("view/store.ts")};
     import { ReferenceIndex } from ${src("core/index.ts")};
     import { DEFAULT_SETTINGS } from ${src("core/settings.ts")};
     export { act };
     export function mount(container, notes) {
       const topos = Topos.new();
       const index = new ReferenceIndex(topos);
       for (const [path, text] of Object.entries(notes)) index.update(path, text);
       const plugin = {
         topos, refs: index, indexVersion: 1, indexing: false, settings: DEFAULT_SETTINGS,
         indexer: { loadDetails: async () => {} },
         extensions: () => ["md"], bibles: { all: () => [] },
         referenceUrl: () => null, linkSite: () => "",
         search: new SearchStore(), subscribeIndex: () => () => {},
         app: {
           workspace: { getActiveFile: () => null, on: () => ({}), offref() {} },
           vault: { getFileByPath: (path) => ({ path }), cachedRead: async (file) => notes[file.path] },
         },
       };
       const host = {
         markdown: () => ({ done: Promise.resolve(), unload() {} }), verses: () => ({ unload() {} }),
         icon() {}, open() {}, openPassage() {}, copy() {}, folders: () => [],
       };
       const look = { preview: "source", verses: false, style: "name", merge: false };
       act(() => createRoot(container).render(<PaneApp plugin={plugin} store={new SearchStore({ context: 0 })} host={host} look={look} />));
     }`,
  );
  const outfile = join(cache, "dom-pane.mjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    external: ["obsidian", "biblix", "react", "react-dom"],
    nodePaths: [new URL("../node_modules", import.meta.url).pathname],
    outfile,
    logLevel: "silent",
  });
  const { act, mount } = await import(pathToFileURL(outfile).href);
  const container = document.createElement("div");
  document.body.appendChild(container);
  // A page is 100 results: a.md and 99 of b.md's 350
  mount(container, { "a.md": "Gen 1:1", "b.md": "John 3:16\n".repeat(350), "c.md": "Rev 22:21" });
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  const group = (name: string) =>
    [...container.querySelectorAll(".topos-pane-group")].find((g) => g.querySelector(".topos-pane-group-name")!.textContent === name);
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent!.startsWith(label)) as unknown as HTMLElement | undefined;

  await act(async () => button("Collapse all")!.click());
  assert.ok(group("a")!.classList.contains("is-collapsed") && group("b")!.classList.contains("is-collapsed"));
  // Pages of more b.md show nothing new, so they load until c.md's group, which starts collapsed
  await act(async () => button("Show more")!.click());
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  assert.equal(group("b")!.querySelector(".topos-pane-count")!.textContent, "350");
  assert.ok(group("c")!.classList.contains("is-collapsed"));
  assert.equal(button("Show more"), undefined);
  // A group opened by hand stays open; Expand all opens the rest
  await act(async () => (group("c")!.querySelector(".topos-pane-group-head") as unknown as HTMLElement).click());
  assert.ok(!group("c")!.classList.contains("is-collapsed") && group("a")!.classList.contains("is-collapsed"));
  await act(async () => button("Expand all")!.click());
  assert.equal(container.querySelectorAll(".topos-pane-group.is-collapsed").length, 0);
});
