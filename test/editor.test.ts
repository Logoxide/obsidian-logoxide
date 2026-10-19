// Runs the editor's reference decorations in a real CodeMirror view (in happy-dom)
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { Window } from "happy-dom";

const cache = new URL("../node_modules/.cache/", import.meta.url).pathname;
const stub = new URL("./obsidian-stub.ts", import.meta.url).pathname;

async function load() {
  const src = (path: string) => JSON.stringify(new URL(`../src/${path}`, import.meta.url).pathname);
  mkdirSync(cache, { recursive: true });
  const entry = join(cache, "editor-entry.ts");
  writeFileSync(
    entry,
    `export { EditorView } from "@codemirror/view";
     export { referenceDecorations, refreshReferences } from ${src("editor/decorations.ts")};
     export { linkUrl } from ${src("core/links.ts")};
     export { relinkEditor } from ${src("reading.ts")};
     export { DEFAULT_SETTINGS } from ${src("core/settings.ts")};
     export { livePreview, editorLivePreviewField, Platform } from ${JSON.stringify(stub)};`,
  );
  const outfile = join(cache, "editor.mjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["logoxide"],
    alias: { obsidian: stub },
    nodePaths: [new URL("../node_modules", import.meta.url).pathname],
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}

test("editor links follow the settings after a refresh", async () => {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    MutationObserver: window.MutationObserver,
    NodeFilter: window.NodeFilter,
    requestAnimationFrame: (f: () => void) => setTimeout(f, 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  const { EditorView, referenceDecorations, refreshReferences, linkUrl, relinkEditor, DEFAULT_SETTINGS, livePreview } = await load();
  const { Topos } = await import("logoxide");
  const topos = Topos.new();
  const settings = { ...DEFAULT_SETTINGS };
  const plugin = {
    topos,
    settings,
    referenceUrl: (passage: any) => linkUrl(settings.linkTemplate, passage),
    linkSite: () => "the site",
    clickOpens: (event: MouseEvent) => event.button === 1 || event.ctrlKey,
    openUrl: (url: string) => window.open(url, "_blank"),
    tapReference: (_event: MouseEvent, passage: any, _at: unknown, open: (passage: any) => void) => open(passage),
    bibles: { all: () => [] },
    translations: () => undefined,
    embedPassage: async (el: HTMLElement, passage: any, label: string) => {
      el.className = "topos-embed";
      el.textContent = `${label}: ${passage.reference}`;
    },
  };
  const view = new EditorView({
    doc: "Read Jn 3:16 today",
    extensions: referenceDecorations(plugin),
    parent: document.body,
  });
  const links = () =>
    [...view.contentDOM.querySelectorAll(".topos-reference")].map((el: any) => el.getAttribute("data-topos-url"));
  assert.deepEqual(links(), ["https://app.literalword.com/43/3/16"]);

  settings.linkTemplate = "https://lets.bible/bible/{book|lower|kebab}/{chapter}[?v={verse}]";
  // Without a refresh, the editor keeps the link it drew
  assert.deepEqual(links(), ["https://app.literalword.com/43/3/16"]);
  view.dispatch({ effects: refreshReferences.of(null) });
  assert.deepEqual(links(), ["https://lets.bible/bible/john/3?v=16"]);

  assert.equal(view.contentDOM.querySelector(".topos-reference")!.getAttribute("title"), "John 3:16, opens in the site");

  // No links: nothing is highlighted
  settings.linkTemplate = "";
  view.dispatch({ effects: refreshReferences.of(null) });
  assert.deepEqual(links(), []);
  settings.linkTemplate = DEFAULT_SETTINGS.linkTemplate;
  view.dispatch({ effects: refreshReferences.of(null) });
  assert.deepEqual(links(), ["https://app.literalword.com/43/3/16"]);
  settings.linkInEditor = false;
  view.dispatch({ effects: refreshReferences.of(null) });
  assert.deepEqual(links(), []);
  view.destroy();

  // Callouts, tables, and embeds in live preview are rendered blocks, relinked in place; a table
  // cell being edited is an editor of its own and is left alone
  settings.linkInEditor = true;
  const editorEl = document.createElement("div");
  editorEl.innerHTML =
    '<div class="cm-content"><div class="cm-embed-block cm-callout"><div class="callout-content">' +
    '<span class="topos-reference topos-rendered" data-topos-url="https://old.example/43/3/16">Jn 3:16</span> and Rom 8:28</div></div>' +
    '<div class="cm-embed-block cm-table-widget"><div class="cm-editor"><div class="cm-line">Gen 1:1</div></div></div></div>';
  const hrefs = () =>
    [...editorEl.querySelectorAll(".topos-rendered")].map((el: any) => `${el.textContent} ${el.getAttribute("data-topos-url")}`);
  relinkEditor(plugin, editorEl);
  assert.deepEqual(hrefs(), ["Jn 3:16 https://app.literalword.com/43/3/16", "Rom 8:28 https://app.literalword.com/45/8/28"]);
  // Not links: a plain click does nothing, Ctrl-click opens the reference
  const opened: string[] = [];
  (window as any).open = (url: string) => opened.push(url);
  const rom = editorEl.querySelectorAll(".topos-rendered")[1]!;
  rom.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));
  rom.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true, ctrlKey: true }));
  // A middle click (auxclick) opens it too, and its mousedown doesn't paste
  rom.dispatchEvent(new (window as any).MouseEvent("auxclick", { bubbles: true, button: 1 }));
  const down = new (window as any).MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
  rom.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.deepEqual(opened, ["https://app.literalword.com/45/8/28", "https://app.literalword.com/45/8/28"]);
  assert.equal(editorEl.querySelector("a.topos-reference"), null);
  settings.linkTemplate = "";
  relinkEditor(plugin, editorEl);
  assert.deepEqual(hrefs(), []);
  assert.equal(editorEl.querySelector(".callout-content")!.textContent, "Jn 3:16 and Rom 8:28");
  assert.equal(editorEl.querySelector(".cm-line")!.textContent, "Gen 1:1");
});

test("reference links and embeds in live preview hide their syntax unless the cursor is in them", async () => {
  const { EditorView, referenceDecorations, DEFAULT_SETTINGS, livePreview, editorLivePreviewField } = await load();
  const { Topos } = await import("logoxide");
  const { EditorSelection } = await import("@codemirror/state");
  const topos = Topos.new();
  const settings = { ...DEFAULT_SETTINGS };
  const plugin = {
    topos,
    settings,
    referenceUrl: () => null,
    linkSite: () => "the site",
    clickOpens: () => false,
    bibles: { all: () => [{}] },
    translations: () => undefined,
    embedPassage: async (el: HTMLElement, passage: any, label: string) => {
      el.className = "topos-embed";
      el.textContent = `${label} = ${passage.reference}`;
    },
  };
  const doc = "See [the verse](John 3:16) and [Ps 23] and Rom 8:28.\n![John 1:1-5]\nEnd";
  const make = () =>
    new EditorView({ doc, selection: EditorSelection.cursor(doc.length), extensions: [editorLivePreviewField, referenceDecorations(plugin)], parent: document.body });
  const shown = (view: any) => view.contentDOM.textContent;
  const kinds = (view: any) =>
    [...view.contentDOM.querySelectorAll("[data-topos-osis]")].map((el: any) => `${el.dataset.toposKind} ${el.textContent} ${el.dataset.toposOsis}`);

  // Source mode: everything is text, links are marked
  livePreview.on = false;
  let view = make();
  assert.equal(shown(view), "See [the verse](John 3:16) and [Ps 23] and Rom 8:28.![John 1:1-5]End");
  // A link's shown target too, so a Ctrl/Cmd-click on it doesn't open a note `John`
  assert.deepEqual(kinds(view), [
    "link the verse John.3.16",
    "link John 3:16 John.3.16",
    "explicit Ps 23 Ps.23",
    "bare Rom 8:28 Rom.8.28",
    "embed John 1:1-5 John.1.1-John.1.5",
  ]);
  assert.equal(view.contentDOM.querySelector(".topos-link-target")?.textContent, "John 3:16");
  view.destroy();

  // Live preview: link syntax is hidden and the embed shows the passage
  livePreview.on = true;
  view = make();
  assert.equal(shown(view), "See the verse and Ps 23 and Rom 8:28.John 1:1-5 = John 1:1-5End");
  // The cursor in a link shows its syntax again
  view.dispatch({ selection: EditorSelection.cursor(8) });
  assert.match(shown(view), /^See \[the verse\]\(John 3:16\) and Ps 23/);
  view.destroy();
  livePreview.on = false;
});

test("with embedAlone, a reference alone on its line shows its text unless the cursor is near it", async () => {
  const { EditorView, referenceDecorations, refreshReferences, relinkEditor, DEFAULT_SETTINGS, livePreview, editorLivePreviewField } = await load();
  const { Topos } = await import("logoxide");
  const { EditorSelection } = await import("@codemirror/state");
  const settings = { ...DEFAULT_SETTINGS, embedAlone: "both" };
  const plugin = {
    topos: Topos.new(),
    settings,
    referenceUrl: () => null,
    linkSite: () => "the site",
    clickOpens: () => false,
    bibles: { all: () => [{}] },
    translations: () => undefined,
    embedPassage: async (el: HTMLElement, passage: any) => {
      el.className += " topos-embed";
      el.textContent = `<${passage.reference}>`;
    },
  };
  const doc = "Start\n\n  Jn 3:16 \nRead Rom 8:28 too\n\nPs 23:1\n\nEnd";
  livePreview.on = true;
  const view = new EditorView({ doc, selection: EditorSelection.cursor(0), extensions: [editorLivePreviewField, referenceDecorations(plugin)], parent: document.body });
  const shown = () => view.contentDOM.textContent;
  const cursorOn = (line: number) => {
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(line).from), effects: refreshReferences.of(null) });
    return shown();
  };
  // A line of its own is enough, and only the cursor on that line shows the reference
  assert.equal(cursorOn(1), "Start<John 3:16>Read Rom 8:28 too<Psalm 23:1>End");
  assert.equal(cursorOn(2), "Start<John 3:16>Read Rom 8:28 too<Psalm 23:1>End");
  assert.equal(cursorOn(3), "Start  Jn 3:16 Read Rom 8:28 too<Psalm 23:1>End");
  // A blank line above and below: John 3:16 has text below it; the cursor a line away shows Psalm 23
  settings.embedAloneBlankLines = 1;
  assert.equal(cursorOn(1), "Start  Jn 3:16 Read Rom 8:28 too<Psalm 23:1>End");
  assert.equal(cursorOn(4), "Start  Jn 3:16 Read Rom 8:28 too<Psalm 23:1>End");
  assert.equal(cursorOn(5), "Start  Jn 3:16 Read Rom 8:28 tooPs 23:1End");
  assert.equal(cursorOn(7), "Start  Jn 3:16 Read Rom 8:28 tooPs 23:1End");
  assert.equal(cursorOn(8), "Start  Jn 3:16 Read Rom 8:28 too<Psalm 23:1>End");
  settings.embedAloneCursorLines = 2;
  assert.equal(cursorOn(4), "Start  Jn 3:16 Read Rom 8:28 tooPs 23:1End");
  settings.embedAloneCursorLines = 0;
  assert.equal(cursorOn(5), "Start  Jn 3:16 Read Rom 8:28 too<Psalm 23:1>End");
  view.destroy();
  livePreview.on = false;

  // Rendered Markdown: a line of a paragraph (between line breaks), not a reference in a sentence
  settings.embedAloneBlankLines = 0;
  const editorEl = document.createElement("div");
  editorEl.innerHTML =
    '<div class="cm-content"><div class="cm-embed-block"><p>Intro<br>\nJn 3:16<br>\nSee Rom 8:28</p><p>Ps 23:1</p></div></div>';
  relinkEditor(plugin, editorEl);
  const text = () => [...editorEl.querySelectorAll("p")].map((p: any) => p.textContent);
  assert.deepEqual(text(), ["Intro\n<John 3:16>\nSee Rom 8:28", "<Psalm 23:1>"]);
  // With blank lines, only a paragraph of its own
  settings.embedAloneBlankLines = 1;
  relinkEditor(plugin, editorEl);
  assert.deepEqual(text(), ["Intro\nJn 3:16\nSee Rom 8:28", "<Psalm 23:1>"]);
  settings.embedAlone = "reading";
  relinkEditor(plugin, editorEl);
  assert.deepEqual(text(), ["Intro\nJn 3:16\nSee Rom 8:28", "Ps 23:1"]);
  // A callout's title is a title, even one that's only a reference (`> > [!bible] Ezra 1:7-11`),
  // while a line of its own in the callout is embedded
  settings.embedAlone = "editor";
  settings.embedAloneBlankLines = 0;
  const calloutEl = document.createElement("div");
  calloutEl.innerHTML =
    '<div class="cm-content"><div class="cm-embed-block"><div class="callout"><div class="callout-title"><div class="callout-title-inner">Ezra 1:7-11</div></div><div class="callout-content"><div class="callout"><div class="callout-title"><div class="callout-title-inner">Ezra 1:7-11</div></div><div class="callout-content"><p>Ps 23:1</p></div></div></div></div></div></div>';
  relinkEditor(plugin, calloutEl);
  const titles = [...calloutEl.querySelectorAll(".callout-title-inner")];
  assert.deepEqual(titles.map((t: any) => t.textContent), ["Ezra 1:7-11", "Ezra 1:7-11"]);
  assert.ok(titles.every((t: any) => t.querySelector(".topos-reference") && !t.querySelector(".topos-embed")));
  assert.equal(calloutEl.querySelector(".callout-content p")!.textContent, "<Psalm 23:1>");
  // Each device chooses for itself: this one only in the reading view, so not in the editor
  Object.assign(plugin, { deviceId: "phone" });
  settings.embedAloneDevices = { phone: "reading", computer: "editor" };
  relinkEditor(plugin, calloutEl);
  assert.equal(calloutEl.querySelector(".callout-content p")!.textContent, "Ps 23:1");
});

test("a reference's text at its line's end goes while it's edited; on a phone, only once it's typed in", async () => {
  const { EditorView, referenceDecorations, DEFAULT_SETTINGS, livePreview, editorLivePreviewField, Platform } = await load();
  const { Topos } = await import("logoxide");
  const { EditorSelection } = await import("@codemirror/state");
  const settings = { ...DEFAULT_SETTINGS, inlineText: true, inlineTextWrap: true, linkInEditor: false };
  const plugin = {
    topos: Topos.new(),
    settings,
    inlineGeneration: 0,
    referenceUrl: () => null,
    linkSite: () => "the site",
    clickOpens: () => false,
    bibles: { all: () => [{}] },
    translations: () => undefined,
    inlineVerseTextNow: (passage: any) => `[${passage.reference}]`,
    inlineVerseText: async (passage: any) => `[${passage.reference}]`,
  };
  livePreview.on = true;
  const shown = (view: any) => view.contentDOM.textContent;
  const at = "Start\n\nRead Heb 1:1".indexOf("Heb");
  for (const mobile of [false, true]) {
    Platform.isMobile = mobile;
    const view = new EditorView({ doc: "Start\n\nRead Heb 1:1", selection: EditorSelection.cursor(0), extensions: [editorLivePreviewField, referenceDecorations(plugin)], parent: document.body });
    assert.equal(shown(view), "StartRead Heb 1:1[Hebrews 1:1]");
    // A tap in it, then a double tap's selection of it
    view.dispatch({ selection: EditorSelection.cursor(at + 2) });
    assert.equal(shown(view), mobile ? "StartRead Heb 1:1[Hebrews 1:1]" : "StartRead Heb 1:1", mobile ? "phone, tapped" : "desktop, clicked");
    view.dispatch({ selection: EditorSelection.range(at, at + 7) });
    assert.equal(shown(view), mobile ? "StartRead Heb 1:1[Hebrews 1:1]" : "StartRead Heb 1:1");
    // Typing in it
    view.dispatch({ changes: { from: at + 7, insert: "-2" }, selection: EditorSelection.cursor(at + 9) });
    assert.equal(shown(view), "StartRead Heb 1:1-2");
    // Away from it
    view.dispatch({ selection: EditorSelection.cursor(0) });
    assert.equal(shown(view), "StartRead Heb 1:1-2[Hebrews 1:1-2]");
    view.destroy();
  }
  Platform.isMobile = false;
  livePreview.on = false;
});
