// Loads the built main.js with a stand-in for Obsidian's API (Obsidian itself can't run here)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import { epub as makeEpub } from "./epub.ts";
import { toposCli } from "./topos.ts";

class Events {
  on() {
    return {};
  }
  offref() {}
  trigger() {}
}
class Component {
  load() {}
  unload() {}
  register() {}
  registerEvent() {}
  registerDomEvent() {}
  addChild(child: any) {
    return child;
  }
}
class Plugin extends Component {
  app: any;
  manifest: any;
  commands: any[] = [];
  viewTypes: string[] = [];
  suggests: any[] = [];
  postProcessors: any[] = [];
  constructor(app: any, manifest: any) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  registerExtensions() {}
  registerHoverLinkSource() {}
  async loadData() {
    return null;
  }
  async saveData() {}
  registerView(type: string) {
    this.viewTypes.push(type);
  }
  addRibbonIcon() {}
  settingTab: any;
  addSettingTab(tab: any) {
    this.settingTab = tab;
  }
  registerEditorSuggest(suggest: any) {
    this.suggests.push(suggest);
  }
  registerEditorExtension() {}
  registerMarkdownPostProcessor(p: any) {
    this.postProcessors.push(p);
  }
  registerInterval() {}
  addCommand(command: any) {
    this.commands.push(command);
  }
}
class TFile {
  path: string;
  extension: string;
  stat = { mtime: 1, size: 1 };
  constructor(path: string) {
    this.path = path;
    this.extension = path.split(".").pop()!;
  }
}
/** Records each setting's name, description, and controls, so a test can change them */
class FakeSetting {
  /** Every setting drawn since the last `display()` */
  static all: FakeSetting[] = [];
  name = "";
  desc = "";
  controls: any[] = [];
  settingEl: any;
  infoEl: any;
  nameEl: any;
  descEl: any;
  controlEl: any;
  constructor(containerEl: any) {
    FakeSetting.all.push(this);
    this.settingEl = containerEl.createDiv("setting-item");
    this.infoEl = this.settingEl.createDiv("setting-item-info");
    this.nameEl = this.infoEl.createDiv("setting-item-name");
    this.descEl = this.infoEl.createDiv("setting-item-description");
    this.controlEl = this.settingEl.createDiv("setting-item-control");
  }
  private control(kind: string, build: (c: any) => void) {
    const control: any = { kind, inputEl: document.createElement("input"), buttonEl: document.createElement("button") };
    for (const method of ["setPlaceholder", "setValue", "addOptions", "addOption", "setLimits", "setDynamicTooltip", "setButtonText", "setIcon", "setTooltip", "setCta", "setWarning", "setDisabled"]) {
      control[method] = (value: any) => {
        if (method === "setValue") control.value = value;
        if (method === "setButtonText") control.text = value;
        return control;
      };
    }
    control.getValue = () => control.value;
    control.onChange = (handler: any) => ((control.change = handler), control);
    control.onClick = (handler: any) => ((control.click = handler), control);
    build(control);
    this.controls.push(control);
    return this;
  }
  private static text(value: any) {
    return typeof value === "string" ? value : (value?.textContent ?? "");
  }
  setName(name: any) { this.name = FakeSetting.text(name); return this; }
  setDesc(desc: any) { this.desc = FakeSetting.text(desc); return this; }
  setClass() { return this; }
  setHeading() { return this; }
  addText(build: any) { return this.control("text", build); }
  addTextArea(build: any) { return this.control("text", build); }
  addToggle(build: any) { return this.control("toggle", build); }
  addDropdown(build: any) { return this.control("dropdown", build); }
  addColorPicker(build: any) { return this.control("color", build); }
  addSlider(build: any) { return this.control("slider", build); }
  addButton(build: any) { return this.control("button", build); }
  addExtraButton(build: any) { return this.control("button", build); }
}

class EditorSuggest {
  app: any;
  context: any = null;
  constructor(app: any) {
    this.app = app;
  }
  setInstructions() {}
}
/** The vault on disk, for the CLI engine and the index's files */
class FileSystemAdapter {
  base: string;
  constructor(base: string) {
    this.base = base;
  }
  getBasePath() {
    return this.base;
  }
  private full(path: string) {
    return join(this.base, path);
  }
  async exists(path: string) {
    return existsSync(this.full(path));
  }
  async mkdir(path: string) {
    mkdirSync(this.full(path), { recursive: true });
  }
  async list(path: string) {
    const names = readdirSync(this.full(path), { withFileTypes: true });
    const files = names.filter((n) => n.isFile()).map((n) => `${path}/${n.name}`);
    return { files, folders: names.filter((n) => n.isDirectory()).map((n) => `${path}/${n.name}`) };
  }
  async stat(path: string) {
    const stat = statSync(this.full(path));
    return { mtime: stat.mtimeMs, size: stat.size, ctime: stat.ctimeMs, type: "file" };
  }
  async readBinary(path: string) {
    const bytes = readFileSync(this.full(path));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  async writeBinary(path: string, data: ArrayBuffer) {
    writeFileSync(this.full(path), new Uint8Array(data));
  }
  async remove(path: string) {
    rmSync(this.full(path));
  }
}

const obsidian = {
  Platform: { isDesktopApp: true, isPhone: false, isMobile: false },
  Component,
  Events,
  WorkspaceLeaf: class {
    setViewState() {}
  },
  FileView: class {},
  TextFileView: class {},
  Menu: class {},
  Scope: class {},
  MarkdownRenderer: { render: async () => {} },
  Modal: class {},
  FuzzySuggestModal: class {},
  MarkdownRenderChild: class extends Component {},
  parseLinktext: (linktext: string) => {
    const i = linktext.indexOf("#");
    return i === -1 ? { path: linktext, subpath: "" } : { path: linktext.slice(0, i), subpath: linktext.slice(i) };
  },
  debounce: (f: any) => f,
  setIcon() {},
  FileSystemAdapter,
  Plugin,
  TFile,
  EditorSuggest,
  PluginSettingTab: class {
    containerEl: any = { settings: [] as any[], empty() { this.settings = []; } };
    constructor(_app: any, _plugin: any) {}
  },
  Setting: FakeSetting,
  ItemView: class {},
  SuggestModal: class {},
  MarkdownView: class {},
  Notice: class {
    static messages: string[] = [];
    constructor(message: string) {
      obsidian.Notice.messages.push(message);
    }
  },
};

const files: Record<string, string | Uint8Array> = {
  "Books/real.epub": makeEpub(["Read Jn 3:16.", "Then Rev 22:21"]),
  "Sermons/a.md": "Read Jn 3:16 and Rom 8:28.",
  "Sermons/b.md": "Psalm 23 and is 2.5%",
  "Archive/old.md": "Gen 1:1",
  "image.png": "Jn 3:16",
  "Books/b.epub": "(an EPUB; its text comes from the stand-in EPUB++ API)",
};

/** A stand-in for EPUB++'s API: one book of two sections, with made-up CFIs from section offsets */
const epubText = "See John\n\n3 more, and Rom 8:28.";
const epub = {
  provider: null as any,
  opened: [] as string[],
  refreshed: [] as (string[] | undefined)[],
  api: {
    version: 1,
    extractText: async (_file?: TFile) => ({
      sections: [
        { spineIndex: 0, href: "title.xhtml", text: "Title", title: null },
        { spineIndex: 1, href: "ch1.xhtml", text: epubText, title: "Chapter 1" },
      ],
      cfi: (spine: number, start: number, end: number) => `epubcfi(/6/${(spine + 1) * 2}!/4,/1:${start},/1:${end})`,
    }),
    registerAnnotationProvider(provider: any) {
      epub.provider = provider;
      return () => (epub.provider = null);
    },
    refreshAnnotations: (_id: string, paths?: string[]) => void epub.refreshed.push(paths),
    open: async (file: TFile, locator: string) => void epub.opened.push(`${file.path}#${locator}`),
  },
};

/** A minimal Editor over one line of text */
function fakeEditor(text: string, ch = text.length) {
  let value = text;
  return {
    getLine: () => value,
    getCursor: () => ({ line: 0, ch }),
    getSelection: () => "",
    getValue: () => value,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    transaction({ changes }: any) {
      for (const c of [...changes].sort((a: any, b: any) => b.from.ch - a.from.ch)) {
        value = value.slice(0, c.from.ch) + c.text + value.slice(c.to.ch);
      }
    },
    replaceRange(text: string, from: any, to: any) {
      value = value.slice(0, from.ch) + text + value.slice(to.ch);
    },
    setCursor() {},
    get value() {
      return value;
    },
  };
}

test("the built plugin loads, indexes, and runs its commands", async (t) => {
  // file-plus-plus listens on the document (hover previews in the editor)
  const { Window } = await import("happy-dom");
  const dom = new Window();
  Object.assign(globalThis, { window: dom, document: dom.document, activeDocument: dom.document });
  // Its timers would keep the test running
  t.after(() => dom.happyDOM.close());
  // Obsidian's DOM helpers
  const proto = (dom as any).HTMLElement.prototype;
  const nodeProto = (dom as any).Node.prototype;
  const createEl = function (this: any, tag: string, o: any = {}) {
    const el = dom.document.createElement(tag) as any;
    if (typeof o === "string") o = { cls: o };
    if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
    if (o.text) el.textContent = o.text;
    for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, String(v));
    this?.appendChild?.(el);
    return el;
  };
  Object.assign(nodeProto, {
    createEl,
    createDiv(this: any, o?: any) { return createEl.call(this, "div", o); },
    createSpan(this: any, o?: any) { return createEl.call(this, "span", o); },
    empty(this: any) { this.textContent = ""; },
    setText(this: any, text: string) { this.textContent = text; },
  });
  Object.assign(proto, {
    addClass(this: any, ...c: string[]) { this.classList.add(...c); },
    removeClass(this: any, ...c: string[]) { this.classList.remove(...c); },
    toggleClass(this: any, c: string, on: boolean) { this.classList.toggle(c, on); },
    setAttr(this: any, k: string, v: string) { this.setAttribute(k, v); },
  });
  Object.assign(globalThis, { createDiv: (o?: any) => createEl.call(null, "div", o), createEl: (t: string, o?: any) => createEl.call(null, t, o) });
  execFileSync("node", ["esbuild.config.mjs", "production"], { stdio: "ignore" });
  const require = createRequire(import.meta.url);
  const resolve = (Module as any)._resolveFilename;
  (Module as any)._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === "obsidian" ? "obsidian" : resolve.call(this, request, ...rest);
  };
  require.cache.obsidian = { id: "obsidian", filename: "obsidian", loaded: true, exports: obsidian } as any;
  // Obsidian loads main.js as CommonJS; this package is "type": "module", so load a .cjs copy
  // (inside node_modules, so it still resolves the CodeMirror packages Obsidian provides)
  mkdirSync(new URL("../node_modules/.cache/", import.meta.url), { recursive: true });
  const bundle = new URL("../node_modules/.cache/main.cjs", import.meta.url);
  copyFileSync(new URL("../dist/main.js", import.meta.url), bundle);
  const ToposPlugin = require(bundle.pathname).default;

  // The vault on disk too, for the CLI engine
  const vaultPath = mkdtempSync(join(tmpdir(), "topos-plugin-vault-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(vaultPath, path)), { recursive: true });
    writeFileSync(join(vaultPath, path), text);
  }
  // An open note, which records being redrawn
  const redrawn: string[] = [];
  const openNote = {
    view: Object.assign(new obsidian.MarkdownView(), {
      editor: { cm: { dispatch: () => redrawn.push("editor") } },
      previewMode: { rerender: () => redrawn.push("reading view") },
      contentEl: { querySelectorAll: () => (redrawn.push("rendered blocks"), []) },
    }),
  };
  const app = {
    workspace: Object.assign(new Events(), {
      onLayoutReady: (callback: () => void) => callback(),
      updateOptions() {},
      getActiveFile: () => null,
      getLeavesOfType: (type: string) => (type === "markdown" ? [openNote] : []),
      iterateAllLeaves() {},
      getActiveViewOfType: () => null,
      openLinkText: async () => {},
    }),
    metadataCache: Object.assign(new Events(), {
      resolvedLinks: {},
      getFirstLinkpathDest: () => null,
      getFileCache: () => null,
    }),
    vault: Object.assign(new Events(), {
      getFiles: () => Object.keys(files).map((path) => new TFile(path)),
      getMarkdownFiles: () => Object.keys(files).filter((path) => path.endsWith(".md")).map((path) => new TFile(path)),
      cachedRead: async (file: TFile) => files[file.path] as string,
      readBinary: async (file: TFile) => {
        const data = files[file.path];
        const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      getAbstractFileByPath: (path: string) => (path in files ? new TFile(path) : null),
      getFileByPath: (path: string) => (path in files ? new TFile(path) : null),
      adapter: new FileSystemAdapter(vaultPath),
    }),
    plugins: { plugins: { "epub-plus-plus": { api: epub.api } } },
    storage: new Map<string, unknown>(),
    loadLocalStorage(key: string) {
      return this.storage.get(key) ?? null;
    },
    saveLocalStorage(key: string, value: unknown) {
      this.storage.set(key, value);
    },
  };
  const manifest = { id: "logoxide", name: "Logoxide", dir: ".obsidian/plugins/logoxide", version: "0.4.0" };
  mkdirSync(join(vaultPath, manifest.dir), { recursive: true });
  // The JSON cache from before the index is removed, and so are packs in another format
  writeFileSync(join(vaultPath, manifest.dir, "epub-index.json"), "{}");
  mkdirSync(join(vaultPath, manifest.dir, "index/packs"), { recursive: true });
  const oldPack = join(vaultPath, manifest.dir, "index/packs/old-03.bin");
  writeFileSync(oldPack, Buffer.concat([Buffer.from("TOPOSPAK"), Buffer.from([1, 0, 0, 0])]));
  const idle = async (p: any) => {
    await new Promise((r) => setTimeout(r, 5));
    while (p.indexing) await new Promise((r) => setTimeout(r, 5));
  };
  const plugin = new ToposPlugin(app, manifest);
  await plugin.onload();
  await idle(plugin);
  assert.equal(existsSync(join(vaultPath, manifest.dir, "epub-index.json")), false);
  assert.equal(existsSync(oldPack), false);

  // The Bible tab (and the plain text of USX files, from file-plus-plus), and the sidebar
  assert.deepEqual(plugin.viewTypes, ["logoxide", "logoxide-source", "logoxide-search", "logoxide-search-pane"]);
  assert.deepEqual(
    plugin.refs.all().map((h: any) => `${h.path} ${h.passage.reference}`),
    ["Archive/old.md Genesis 1:1", "Sermons/a.md John 3:16", "Sermons/a.md Romans 8:28", "Sermons/b.md Psalm 23"],
  );
  const ids = plugin.commands.map((c: any) => c.id);
  for (const id of ["open-search", "open-search-tab", "open-search-new-tab", "insert-reference", "go-to-reference", "open-literal-word", "normalize-references"]) {
    assert.ok(ids.includes(id), id);
  }

  // On mobile (the stand-in's Platform isn't desktop), a tap opens references outside the editor;
  // in it, only with the setting on, and only when the tap would focus the editor
  const tap = { button: 0, ctrlKey: false, metaKey: false } as MouseEvent;
  assert.equal(plugin.clickOpens(tap, false), true);
  assert.equal(plugin.clickOpens(tap, true, false), false);
  plugin.settings.tapOpensInEditor = true;
  assert.equal(plugin.clickOpens(tap, true, false), true);
  assert.equal(plugin.clickOpens(tap, true, true), false);
  plugin.settings.tapOpensInEditor = false;

  // The index is saved, and a restart searches nothing again
  await plugin.indexer.save();
  const packs = readdirSync(join(vaultPath, manifest.dir, "index/packs"));
  assert.ok(packs.length > 0 && packs.every((name) => name.startsWith(`${plugin.device}-`)), packs.join());
  // Notes' packs are named for their kind: an app that searches no EPUBs never reads EPUBs' packs
  assert.ok(packs.every((name) => name.startsWith(`${plugin.device}-text-`)), packs.join());
  const searched: string[] = [];
  const counting = (p: any) => {
    const indexFiles = p.indexFiles.bind(p);
    p.indexFiles = async (batch: any[]) => (searched.push(...batch.map((f) => f.path)), indexFiles(batch));
    return p;
  };
  const restarted = counting(new ToposPlugin(app, manifest));
  await restarted.onload();
  await idle(restarted);
  assert.equal(restarted.device, plugin.device);
  assert.deepEqual(searched, []);
  assert.deepEqual(restarted.refs.all().map((h: any) => h.passage.reference), plugin.refs.all().map((h: any) => h.passage.reference));
  restarted.onunload();

  // Another device (its files have other times after syncing) confirms the notes by their text
  const phoneApp = Object.create(app, { storage: { value: new Map() } });
  const realFiles = app.vault.getFiles;
  app.vault.getFiles = () => realFiles().map((f: any) => Object.assign(f, { stat: { mtime: 99, size: f.stat.size } }));
  const phone = counting(new ToposPlugin(phoneApp, manifest));
  await phone.onload();
  await idle(phone);
  assert.notEqual(phone.device, plugin.device);
  assert.deepEqual(searched, []);
  assert.equal(phone.refs.all().length, 4);
  // An edit there is searched, and saved in the phone's own packs
  files["Sermons/b.md"] = "Psalm 23 and Psalm 24";
  app.vault.getFiles = () => realFiles().map((f: any) => (f.path === "Sermons/b.md" ? Object.assign(f, { stat: { mtime: 100, size: 21 } }) : f));
  await phone.indexer.update(app.vault.getFileByPath("Sermons/b.md"));
  assert.equal(phone.refs.get("Sermons/b.md").length, 2);
  await phone.indexer.save();
  assert.ok(readdirSync(join(vaultPath, manifest.dir, "index/packs")).some((name) => name.startsWith(`${phone.device}-`)));
  phone.onunload();
  files["Sermons/b.md"] = "Psalm 23 and is 2.5%";
  app.vault.getFiles = realFiles;
  // The other instances replaced this one's EPUB++ annotation provider
  plugin.epubs.api = null;
  plugin.epubs.start();

  // Excluding a folder reindexes without it
  plugin.settings.excludeFolders = "Archive";
  await plugin.reindex();
  assert.equal(plugin.refs.all().length, 3);
  const builtin = plugin.refs.all();

  // The CLI engine finds the same hits (still honoring the plugin's own exclusions)
  const cli = toposCli;
  if (existsSync(cli)) {
    plugin.settings.engine = "cli";
    plugin.settings.cliPath = cli;
    plugin.settings.cliCache = false;
    await plugin.reindex(true);
    assert.deepEqual(plugin.refs.all(), builtin);

    // A missing CLI falls back to the built-in engine with a notice
    plugin.settings.cliPath = join(vaultPath, "no-such-topos");
    await plugin.reindex(true);
    assert.deepEqual(plugin.refs.all(), builtin);
    assert.match(obsidian.Notice.messages.at(-1)!, /Using the built-in engine/);
    plugin.settings.engine = "builtin";
  }

  // The sidebar's order and grouping are saved
  const saved: any[] = [];
  plugin.saveData = async (data: any) => void saved.push(structuredClone(data));
  plugin.search.set({ sort: "bible", groupBy: "book" });
  assert.equal(saved.at(-1).sort, "bible");
  assert.equal(saved.at(-1).groupBy, "book");

  // Saved searches: saving replaces by name, and applying one sets the sidebar's filters
  await plugin.saveQuery({ name: "Paul", query: '--nt -g "Pauline Epistles"' });
  await plugin.saveQuery({ name: "Sermons", query: "Sermons -b John" });
  await plugin.saveQuery({ name: "Paul", query: "-g pauline" });
  assert.deepEqual(saved.at(-1).queries, [
    { name: "Paul", query: "-g pauline" },
    { name: "Sermons", query: "Sermons -b John" },
  ]);
  assert.deepEqual(plugin.applyQuery(plugin.settings.queries[1]), []);
  assert.equal(plugin.search.get().scope, "paths");
  assert.deepEqual(plugin.search.get().paths, ["Sermons"]);
  assert.deepEqual(plugin.search.get().filters.books, ["John"]);
  assert.deepEqual(plugin.applyQuery({ name: "x", query: "--bogus" }), ["Unknown option --bogus"]);
  await plugin.deleteQuery("Paul");
  assert.deepEqual(saved.at(-1).queries.map((q: any) => q.name), ["Sermons"]);
  assert.ok(plugin.commands.some((c: any) => c.id === "open-saved-search"));

  // The settings page: the format fields, with a preview that follows them
  plugin.saveData = async () => {};
  // topos's settings, which file-plus-plus's settings tab shows first
  const tab = {
    containerEl: document.createElement("div"),
    display() {
      FakeSetting.all = [];
      this.containerEl = document.createElement("div");
      plugin.displaySettings(this.containerEl, () => this.display());
    },
  };
  tab.display();
  // Its tabs
  assert.deepEqual(
    [...tab.containerEl.querySelectorAll(".topos-tab")].map((el: any) => el.textContent),
    ["Bibles", "Display", "Library", "Add Bibles", "References", "Search", "Reader", "Highlights"],
  );
  // Settings still shown (a part of a tab is drawn again when what it shows changes)
  const setting = (name: string): any => FakeSetting.all.find((s: any) => s.name === name && tab.containerEl.contains(s.settingEl));
  // Display: each mark is one choice; notes render when either kind shows
  assert.equal(plugin.settings.crossRefs, "none");
  setting("Cross references").controls[0].change("accent");
  assert.equal(plugin.settings.crossRefs, "accent");
  assert.equal(plugin.bookTextOptions().notes, true);
  setting("Cross references").controls[0].change("none");
  assert.equal(plugin.bookTextOptions().notes, false);
  setting("Verse numbers").controls[0].change("none");
  assert.equal(plugin.settings.verseNumbers, "none");
  setting("Verse numbers").controls[0].change("faded");
  assert.equal(setting("Format preview").desc, "John 3:16,17,18; 4:1-5:3   Jude 1:5");
  setting("Join adjacent verses").controls[0].change(true);
  setting("Chapter in single-chapter books").controls[0].change(false);
  setting("Range").controls[0].change("–");
  assert.equal(setting("Format preview").desc, "John 3:16–18; 4:1–5:3   Jude 5");
  // An empty separator field goes back to the default
  setting("Range").controls[0].change("");
  assert.equal(plugin.settings.format.range, "-");
  // Normalizing uses the format
  const note = fakeEditor("See jn 3:16,17,18");
  plugin.commands.find((c: any) => c.id === "normalize-references").editorCallback(note);
  assert.equal(note.value, "See John 3:16-18");
  setting("Writing references").controls[0].click();
  assert.equal(plugin.settings.format.joinAdjacent, false);

  // Links: a site, a template of your own, or none
  assert.equal(setting("Open references in").controls[0].value, "literalword");
  // Earlier changes save in the background; let them finish before counting redraws
  await new Promise((resolve) => setTimeout(resolve, 0));
  redrawn.length = 0;
  setting("Open references in").controls[0].change("biblehub");
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Open notes are redrawn, so their links go to the new site
  assert.deepEqual(redrawn, ["editor", "rendered blocks", "reading view"]);
  assert.equal(
    setting("Link template").desc,
    "Preview: https://biblehub.com/john/3-16.htm   https://biblehub.com/psalms/23.htm",
  );
  const john = plugin.topos.parse("Jn 3:16", 0);
  setting("Link template").controls[0].change("https://x.app/{book.usfm}/{chapters}");
  assert.equal(setting("Link template").desc, "Can't be used: unknown placeholder {chapters}");
  assert.equal(plugin.referenceUrl(john), null);
  setting("Link template").controls[0].change("https://x.app/{book.usfm}/{chapter}");
  assert.equal(plugin.referenceUrl(john), "https://x.app/JHN/3");
  assert.equal(plugin.linkSite(), "x.app");
  assert.equal(setting("Open references in").controls[0].value, "custom");
  setting("Open references in").controls[0].change("none");
  assert.equal(plugin.settings.linkTemplate, "");
  assert.equal(setting("Link template"), undefined);
  assert.equal(plugin.referenceUrl(john), null);

  // A Literal Word translation from before link templates becomes a template
  plugin.loadData = async () => ({ translation: "esv" });
  await plugin.loadSettings();
  assert.equal(plugin.settings.linkTemplate, "https://app.literalword.com/esv/{book.id}/{chapter}[/{verse}]");
  assert.equal("translation" in plugin.settings, false);

  // An earlier joinAdjacent setting moves into the format
  plugin.loadData = async () => ({ joinAdjacent: true });
  await plugin.loadSettings();
  assert.equal(plugin.settings.format.joinAdjacent, true);
  assert.equal(plugin.settings.format.range, "-");
  assert.equal("joinAdjacent" in plugin.settings, false);

  // Saved searches from before 0.4.0 are migrated once (-o used to mean any overlap)
  const loadData = plugin.loadData;
  plugin.loadData = async () => ({ queries: [{ name: "Old", query: '-o "John 3" --outside "John 3:16"' }] });
  await plugin.loadSettings();
  assert.equal(plugin.settings.queries[0].query, '--any-overlap "John 3" --exclude-overlap "John 3:16"');
  assert.equal(saved.at(-1).queryFormat, 2);
  plugin.loadData = async () => ({ queries: [{ name: "New", query: '-o "John 3"' }], queryFormat: 2 });
  await plugin.loadSettings();
  assert.equal(plugin.settings.queries[0].query, '-o "John 3"');
  plugin.loadData = loadData;
  await plugin.loadSettings();

  // Commands that need a reference under the cursor are only available on one
  const copy = plugin.commands.find((c: any) => c.id === "copy-osis");
  assert.equal(copy.editorCheckCallback(true, fakeEditor("See Jn 3:16 here", 6)), true);
  assert.equal(copy.editorCheckCallback(true, fakeEditor("Nothing here", 3)), false);

  // Normalizing rewrites references in the chosen style
  const editor = fakeEditor("See jn 3:16 and 1 cor 13:4");
  plugin.commands.find((c: any) => c.id === "normalize-references").editorCallback(editor);
  assert.equal(editor.value, "See John 3:16 and 1 Corinthians 13:4");

  // Editor autocomplete
  const suggest = plugin.suggests[0];
  const typing = fakeEditor("Read John 3:");
  const trigger = suggest.onTrigger({ line: 0, ch: 12 }, typing);
  assert.deepEqual(trigger.start, { line: 0, ch: 5 });
  suggest.context = { editor: typing, start: trigger.start, end: trigger.end, query: trigger.query };
  const suggestions = suggest.getSuggestions(suggest.context);
  assert.equal(suggestions[0].label, "John 3:1");
  suggest.selectSuggestion(suggestions[15]);
  assert.equal(typing.value, "Read John 3:16");
  assert.equal(suggest.onTrigger({ line: 0, ch: 9 }, fakeEditor("The quick")), null);

  // EPUBs: off by default; on, their references come from EPUB++'s text and go back as annotations
  assert.ok(epub.provider, "registered as an annotation provider");
  assert.equal(plugin.refs.get("Books/b.epub").length, 0);
  plugin.settings.searchEpubs = true;
  const extracted: string[] = [];
  const extractText = epub.api.extractText;
  epub.api.extractText = async (file?: TFile) => (extracted.push(file!.path), extractText());
  await plugin.epubs.toggled();
  epub.api.extractText = extractText;
  // A real book is searched by the engine (as the CLI would), and only the one it can't read
  // goes through EPUB++
  assert.deepEqual(extracted, ["Books/b.epub"]);
  assert.deepEqual(
    plugin.refs.get("Books/real.epub").map((h: any) => [h.passage.reference, h.epub.chapter, h.epub.cfi]),
    [
      ["John 3:16", "Chapter 1", "epubcfi(/6/2!/4/2,/1:5,/1:12)"],
      ["Revelation 22:21", "Chapter 2", "epubcfi(/6/4!/4/2,/1:5,/1:14)"],
    ],
  );
  const [hit, ...rest] = plugin.refs.get("Books/b.epub");
  // "See John" / "3 more" are separate paragraphs, so only Romans 8:28 is a reference
  assert.equal(rest.length, 0);
  assert.equal(hit.passage.reference, "Romans 8:28");
  const at = epubText.indexOf("Rom");
  assert.deepEqual(hit.epub, { spineIndex: 1, cfi: `epubcfi(/6/4!/4,/1:${at},/1:${at + "Rom 8:28".length})`, chapter: "Chapter 1" });
  assert.equal(hit.start, "Title".length + 2 + at);
  assert.ok(epub.refreshed.some((paths) => paths?.[0] === "Books/b.epub"));
  const annotations = await epub.provider.annotations(new TFile("Books/b.epub"));
  assert.deepEqual(
    annotations.map((a: any) => [a.label, a.locator]),
    [["Romans 8:28", hit.epub.cfi]],
  );
  assert.match(epub.provider.style("red"), /dashed/);
  // Results open in the book
  await plugin.openHit(hit);
  assert.deepEqual(epub.opened, [`Books/b.epub#${hit.epub.cfi}`]);
  // A reindex keeps them (from the index); turning the setting off removes them
  epub.api.extractText = async () => {
    throw new Error("searched again");
  };
  await plugin.reindex();
  assert.equal(plugin.refs.get("Books/b.epub").length, 1);
  epub.api.extractText = extractText;

  // A book open as topos starts (a tab restored at launch) asked for its references before the
  // index was read; once it is, open books are redrawn, though the book isn't searched again
  await plugin.indexer.save();
  const relaunched = new ToposPlugin(app, manifest);
  const loadSettings = relaunched.loadSettings.bind(relaunched);
  relaunched.loadSettings = async () => {
    await loadSettings();
    relaunched.settings.searchEpubs = true;
  };
  let searchedBooks = 0;
  relaunched.indexBook = async () => (searchedBooks++, { error: "not searched" });
  epub.refreshed.length = 0;
  await relaunched.onload();
  await idle(relaunched);
  assert.equal(searchedBooks, 0);
  assert.equal(relaunched.refs.get("Books/real.epub").length, 2);
  assert.ok(epub.refreshed.includes(undefined), "every open book is asked again");
  relaunched.onunload();
  plugin.epubs.api = null;
  plugin.epubs.start();
  plugin.settings.searchEpubs = false;
  await plugin.epubs.toggled();
  assert.equal(plugin.refs.get("Books/b.epub").length, 0);
  assert.deepEqual(await epub.provider.annotations(new TFile("Books/b.epub")), []);
  plugin.onunload();
  assert.equal(epub.provider, null);
});
