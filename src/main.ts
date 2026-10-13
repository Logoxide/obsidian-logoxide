import {
  Component,
  Editor,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  parseLinktext,
  Platform,
  TFile,
  type HoverParent,
  type OpenViewState,
  Menu,
  type PaneType,
  type TAbstractFile,
  type Workspace,
  type WorkspaceLeaf,
} from "obsidian";
import { around, hoverLink } from "file-plus-plus/obsidian";
import { DocumentView, FilePlusPlusPlugin, type DocumentEmbed, type EmbedContext } from "file-plus-plus/obsidian";
import type { FppSettings } from "file-plus-plus/obsidian";
import { OffsetUnit, ToposOptions, type BookTextOptions, type MappedPassage, type Passage, type Topos, type ToposTranslations } from "logoxide";
import type { EditorView } from "@codemirror/view";
import { DEFAULT_FORMAT, written } from "./core/format.ts";
import { migrateQuery, parseQuery, type SavedQuery } from "./core/query.ts";
import { NO_FILTERS } from "./core/filters.ts";
import { BIBLE_URL, linkUrl, OLD_SITE_TEMPLATES, siteName, templateFromTranslation, type LinkBook } from "./core/links.ts";
import { applyReplacements, normalizeReferences, referenceAt } from "./core/references.ts";
import { ReferenceIndex } from "./core/index.ts";
import { searchText, type Hit } from "./core/search.ts";
import { hoverParent, interceptLinkClicks, referenceDecorations, refreshReferences } from "./editor/decorations.ts";
import { ReferenceSuggest, suggestFirst } from "./editor/suggest.ts";
import { engineWasm, loadTopos } from "./engine.ts";
import { BackgroundSearcher } from "./indexers/background.ts";
import { defaultCliPath } from "./indexers/cli.ts";
import { VaultIndexer } from "./indexers/vault.ts";
import { indexBook, type BookRequest, type BookResult, type IndexRequest } from "./indexers/worker.ts";
import { EpubSupport } from "./epub/support.ts";
import { DocumentSupport } from "./documents/support.ts";
import workerSource from "topos-worker-source";
import { bookFiles, type Bible } from "./core/bibles.ts";
import { openPassagePicker, pickPassage } from "./bible/picker.ts";
import { FolderStubs } from "./bible/folder-stubs.ts";
import { GoToReferenceModal, InsertReferenceModal, SavedQueryModal } from "./modals.ts";
import { linkReferences, relinkEditor } from "./reading.ts";
import { bookStyle, DEFAULT_SETTINGS, openSettings, ToposSettingsPanel, type ToposSettings } from "./settings.ts";
import { BibleEmbed } from "./bible/embed.ts";
import { BibleMedia } from "./bible/media.ts";
import { BibleView } from "./bible/view.ts";
import { createBibleFormat } from "./bible/format.ts";
import { STUB_EXTENSION } from "./core/stubs.ts";
import { BibleLibrary } from "./bible/library.ts";
import { VerseCounts } from "./bible/counts.ts";
import { LogoxideBibles } from "./bible/packages.ts";
import { BibleManager } from "./bible/manage.ts";
import { BibleStyles } from "./bible/styles.ts";
import { addParallelCommands } from "./bible/parallel.ts";
import { buildTranslations, parseAliases } from "./core/translations.ts";
import type { BibleBook, BibleReader } from "./bible/reader.ts";
import type { NoteLinks } from "./bible/notes.ts";
import { notesShown } from "./core/display.ts";
import { formatVerseLocator, passageParts, splitBible, type VersePart } from "./core/verse-locator.ts";
import { mappedLabel, versesParts } from "./core/mapping.ts";
import { partAt, passageStops, wholeReference } from "./core/syntax.ts";
import { inlineNeeds, inlineText, inlineTextVars } from "./core/inline-text.ts";
import { COMMENTARY_VIEW, CommentaryView } from "./bible/commentary.ts";
import type { StrongsPopupOptions } from "./bible/strongs.ts";
import { strongsHover } from "./editor/strongs.ts";
import { strongsAt } from "./core/strongs.ts";
import { locatorReference } from "./core/study.ts";

/** The page preview source of references in notes (Settings → Page preview) */
export const HOVER_SOURCE = "logoxide-references";
import { SEARCH_VIEW, SearchView } from "./view/SearchView.tsx";
import { newTabLeaf, SEARCH_PANE_VIEW, SearchPane } from "./view/SearchPane.tsx";
import { scopeOf, SearchStore, type SearchState } from "./view/store.ts";

/** The plugin's settings and file-plus-plus's (the Bible tab, previews, highlights) */
export type PluginSettings = FppSettings & ToposSettings;

/**
 * Where a passage is in a Bible: its parts there, and the mapping that put them there when the
 * Bible is numbered differently from the one the passage was written for (no parts with one:
 * it has none of the passage)
 */
export interface Placement {
  parts: VersePart[];
  mapped: MappedPassage | null;
}

/**
 * A copy format for an embed of the selection, highlighted, that names its Bible rather than its
 * file: `![John 3:16 BSB](#:~:text=so%20loved&color=yellow)`
 */
const EMBED_FORMAT = { id: "embed", name: "Embed", template: "![{{reference}} {{bible}}](#{{highlight}}&color={{color}})" };

/** An embed's highlight (`:~:text=so%20loved&color=yellow`), and how a new one is written in the note */
export interface EmbedHighlight {
  fragment?: string;
  /** Writes the embed again with another highlight, or none (null) */
  onHighlight?: (fragment: string | null) => void;
}

export default class ToposPlugin extends FilePlusPlusPlugin<BibleBook, BibleReader> {
  readonly format = createBibleFormat(this);
  declare settings: PluginSettings;
  topos!: Topos;
  /** Bibles in the vault (folders of USX files) */
  bibles = new BibleLibrary(this, () => {
    this.bibleTextChanged();
    this.resetTranslations();
    void this.verseCounts.update();
    this.folderStubs.soon();
  });
  /** Folder Bibles' books, named by their titles (`John.bible` beside `JHN.usx`) */
  folderStubs = new FolderStubs(this);
  /** Each Bible book's verse counts, for references that name its translation */
  verseCounts = new VerseCounts(this, () => this.resetTranslations(true));
  /** Bibles from logoxide packages: the ones the vault's `logoxide.toml` asks for */
  packages = new LogoxideBibles(this, () => {
    this.bibleTextChanged();
    this.bibles.reset();
    this.resetTranslations(true);
    this.refreshCommentaries();
  });
  /** Adds, installs, and removes logoxide packages */
  bibleManager = new BibleManager(this);
  /** Package Bibles' recordings, downloaded when first played */
  media = new BibleMedia(this);
  /** The vault's CSS for Bible text (the `bibleCss` setting) */
  bibleStyles = new BibleStyles(this);
  private translationsCache: ToposTranslations | null = null;
  private toposReady: Promise<Topos> | null = null;
  refs!: ReferenceIndex;
  search = new SearchStore();
  /** References in EPUBs, through the EPUB++ plugin */
  epubs = new EpubSupport(this);
  /** References in other file-plus-plus documents (transcripts, the Bible tab) */
  otherDocuments = new DocumentSupport(this);
  /** Bumped whenever the index changes, so the sidebar re-renders */
  indexVersion = 0;
  indexing = false;
  private readonly indexListeners = new Set<() => void>();
  /** The background indexer; null if workers are unavailable (then searches run on this thread) */
  private worker: BackgroundSearcher | null | undefined;
  /** Keeps the index on disk and up to date */
  indexer = new VaultIndexer(this);
  /** Names this device's index packs */
  device = "";

  /**
   * The translations references can name (`John 3:16 KJV`): the vault's Bibles and the settings'
   * names and aliases, with each Bible's verse counts
   */
  translations(): ToposTranslations {
    this.translationsCache ??= this.packages.addTo(
      buildTranslations(
        this.bibles.all().map((b) => b.name),
        parseAliases(this.settings.bibleAliases),
        this.verseCounts.all(),
      ),
    );
    return this.translationsCache;
  }

  /** Builds the translations again when next asked (and with `redraw`, redraws references) */
  resetTranslations(redraw = false): void {
    this.translationsCache?.dispose();
    this.translationsCache = null;
    if (redraw) this.refreshLinks();
  }

  /** The engine, once its WebAssembly is loaded (file-plus-plus may open a Bible before `onLoaded`) */
  engine(): Promise<Topos> {
    this.toposReady ??= loadTopos().then((topos) => (this.topos = topos));
    return this.toposReady;
  }

  protected override defaultSettings(): PluginSettings {
    // Links into a Bible are labeled with the reference (file-plus-plus's default: "book, chapter")
    return { ...super.defaultSettings(), aliasTemplate: "{{reference}}", ...structuredClone(DEFAULT_SETTINGS) };
  }

  /** The Bible tab, with a player for books that have a recording */
  override createView(leaf: WorkspaceLeaf): DocumentView<BibleBook, BibleReader> {
    return new BibleView(leaf, this);
  }

  override createEmbed(ctx: EmbedContext, file: TFile, subpath: string): DocumentEmbed<BibleBook, BibleReader> {
    return new BibleEmbed(this, ctx, file, subpath);
  }

  override displaySettings(el: HTMLElement, refresh: () => void): void {
    new ToposSettingsPanel(this, el, refresh).render();
  }

  /** data.json changed on disk (synced from another device) */
  override async onExternalSettingsChange(): Promise<void> {
    await super.onExternalSettingsChange();
    this.refreshLinks();
    void this.bibleStyles.load();
  }

  /** file-plus-plus's settings and topos's, with topos's from older versions updated */
  override async loadSettings(): Promise<void> {
    await super.loadSettings();
    await this.migrateToposSettings();
  }

  protected override async onLoaded(): Promise<void> {
    await this.engine();
    await this.bibleStyles.load();
    this.device = this.indexDevice();
    this.refs = new ReferenceIndex(this.topos, this.device, this.manifest?.version ?? "");
    const { sort, groupBy, context } = this.settings;
    this.search.set({ sort, groupBy, context });
    // Remember the sidebar's order, grouping, and context lines
    this.search.subscribe(() => {
      const { sort, groupBy, context } = this.search.get();
      const settings = this.settings;
      if (sort === settings.sort && groupBy === settings.groupBy && context === settings.context) return;
      Object.assign(settings, { sort, groupBy, context });
      void this.saveData(settings);
    });

    this.registerView(SEARCH_VIEW, (leaf) => new SearchView(leaf, this));
    this.registerObsidianProtocolHandler("logoxide", (params) => void this.openBibleUrl(params));
    this.registerView(SEARCH_PANE_VIEW, (leaf) => new SearchPane(leaf, this));
    this.registerView(COMMENTARY_VIEW, (leaf) => new CommentaryView(leaf, this));
    this.registerHoverLinkSource(HOVER_SOURCE, { display: "Logoxide: Bible references in notes", defaultMod: false });
    this.patchReferenceLinks();
    this.addRibbonIcon("book-open", "Verse search", () => void this.activateSearch());
    this.addRibbonIcon("book-marked", "Read the Bible", () => openPassagePicker(this));
    // Before other plugins' suggestions: now, and once they've all loaded (each adds its own last)
    const suggest = new ReferenceSuggest(this);
    this.registerEditorSuggest(suggest);
    suggestFirst(this.app, suggest);
    this.app.workspace.onLayoutReady(() => suggestFirst(this.app, suggest));
    this.registerEditorExtension(referenceDecorations(this));
    this.registerEditorExtension(strongsHover(this));
    // The commentary view follows the Bible tab in front
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.followLeaf(leaf)));
    this.registerMarkdownPostProcessor(linkReferences(this));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => this.editorMenu(menu, editor)));
    // The reference color is a CSS variable on each window's body (pop-out windows too)
    this.applyColor();
    this.registerEvent(
      this.app.workspace.on("window-open", (_win, win) => {
        this.applyColor([win.document]);
        interceptLinkClicks(this, win.document);
      }),
    );
    this.registerEvent(this.app.workspace.on("window-close", (_win, win) => this.bibleStyles.forget(win.document)));
    interceptLinkClicks(this, document);
    this.addCommands();

    this.app.workspace.onLayoutReady(() => {
      this.bibles.start();
      void this.verseCounts.start();
      void this.folderStubs.start();
      this.applyBookFileHiding();
      void this.packages.load();
      this.applyLogoxideHiding();
      // The vault's logoxide.toml and logoxide.lock, at its root or in the packages folder
      const logoxideFiles = (file: TAbstractFile) => {
        const library = this.packages.booksDir();
        const names = ["logoxide.toml", "logoxide.lock"];
        if (names.some((n) => file.path === n || file.path === `${library}/${n}`)) void this.packages.load();
      };
      this.registerEvent(this.app.vault.on("modify", logoxideFiles));
      this.registerEvent(this.app.vault.on("create", logoxideFiles));
      this.registerEvent(this.app.vault.on("delete", logoxideFiles));
      for (const event of ["modify", "create", "delete"] as const) {
        this.registerEvent(this.app.vault.on(event as "modify", (file) => this.bibleStyles.changed(file)));
      }
      this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.bibleStyles.changed(file, oldPath)));
      void this.indexer.start();
      this.epubs.start();
      this.otherDocuments.start();
      const vault = this.app.vault;
      this.registerEvent(vault.on("modify", (file) => file instanceof TFile && void this.indexer.update(file)));
      this.registerEvent(vault.on("create", (file) => file instanceof TFile && void this.indexer.update(file)));
      this.registerEvent(vault.on("delete", (file) => this.indexer.remove(file.path)));
      this.registerEvent(vault.on("rename", (file, oldPath) => file instanceof TFile && this.indexer.rename(file, oldPath)));
      // Other devices' packs sync in while Obsidian is in the background
      if (typeof document !== "undefined") {
        this.registerDomEvent(document, "visibilitychange", () => {
          if (document.visibilityState === "visible") void this.indexer.refreshFromSync();
        });
        this.registerInterval(window.setInterval(() => void this.indexer.refreshFromSync(), 5 * 60 * 1000));
      }
    });
  }

  override onunload(): void {
    super.onunload();
    for (const doc of this.windowDocuments()) doc.body.style.removeProperty("--topos-reference-color");
    this.hidingStyle?.remove();
    this.bookFileStyle?.remove();
    this.indexer.stop();
    this.epubs.stop();
    this.otherDocuments.stop();
    clearTimeout(this.notifyTimer);
    this.worker?.terminate();
    this.translationsCache?.dispose();
    this.packages.unload();
    this.topos?.dispose();
  }

  private hidingStyle: HTMLStyleElement | null = null;

  /**
   * Hides the packages folder (`Logoxide/`) when the setting says: from the file explorer (a style
   * rule) and from Obsidian's search, quick switcher, and graph (an entry in its excluded files,
   * which this takes out again when it's turned off or the folder changes). Verse search still
   * reads its books
   */
  applyLogoxideHiding(): void {
    const dir = this.packages.booksDir();
    const hide = this.settings.hideLogoxideBooks;
    this.hidingStyle?.remove();
    this.hidingStyle = null;
    if (hide) {
      this.hidingStyle = document.head.createEl("style", { attr: { id: "topos-hide-logoxide" } });
      this.hidingStyle.textContent = `.nav-folder:has(> .nav-folder-title[data-path="${CSS.escape(dir)}"]) { display: none; }`;
    }
    const vault = this.app.vault as unknown as { getConfig?(key: string): unknown; setConfig?(key: string, value: unknown): void };
    if (!vault.getConfig || !vault.setConfig) return;
    const filters = Array.isArray(vault.getConfig("userIgnoreFilters")) ? (vault.getConfig("userIgnoreFilters") as string[]) : [];
    const entry = hide ? `${dir}/` : undefined;
    const old = this.settings.hiddenFilter;
    let next = old && old !== entry ? filters.filter((f) => f !== old) : filters;
    if (entry && !next.includes(entry)) next = [...next, entry];
    if (next.length !== filters.length || next.some((f, i) => f !== filters[i])) vault.setConfig("userIgnoreFilters", next);
    if (old !== entry) {
      this.settings.hiddenFilter = entry;
      void this.saveData(this.settings);
    }
  }

  private bookFileStyle: HTMLStyleElement | null = null;

  /**
   * Hides the book files (USX, USFM) of folder Bibles whose books have stubs, in the file explorer
   * (a style rule per folder), with the `hideBookFiles` setting: the stubs show the books
   */
  applyBookFileHiding(): void {
    this.bookFileStyle?.remove();
    this.bookFileStyle = null;
    if (!this.settings.folderStubs || !this.settings.hideBookFiles) return;
    const folders = this.bibles
      .all()
      .filter((b) => b.files)
      .map((b) => b.folder);
    if (folders.length === 0) return;
    const file = (folder: string) => {
      const inFolder = folder ? `[data-path^="${CSS.escape(`${folder}/`)}"]` : "";
      return `.nav-file:has(> .nav-file-title${inFolder}:is([data-path$=".usx" i], [data-path$=".usfm" i]))`;
    };
    this.bookFileStyle = document.head.createEl("style", { attr: { id: "topos-hide-book-files" } });
    this.bookFileStyle.textContent = `${folders.map(file).join(",\n")} { display: none; }`;
  }

  /** Settings saved by older versions, before file-plus-plus's are merged in */
  private savedData: (Partial<ToposSettings> & { joinAdjacent?: boolean; translation?: string }) | null = null;

  protected override migrateSettings(data: Record<string, unknown>): void {
    this.savedData = data as Partial<ToposSettings>;
  }

  private async migrateToposSettings(): Promise<void> {
    const saved = this.savedData ?? {};
    // Saved before Bible links had their own default label
    // A copy format for an embed of a selection, with its highlight (`![John 3:16 BSB](#:~:text=…&color=yellow)`)
    if (!this.settings.embedCopyFormat) {
      if (!this.settings.copyFormats.some((f) => f.id === EMBED_FORMAT.id)) this.settings.copyFormats.push({ ...EMBED_FORMAT });
      // In the selection menu now (file-plus-plus adds new formats to it as it loads, before this)
      const entry = `format:${EMBED_FORMAT.id}`;
      if (!this.settings.selectionMenu.some((e) => e.id === entry)) this.settings.selectionMenu.push({ id: entry, show: true });
      this.settings.embedCopyFormat = true;
    }
    if (!this.settings.bibleAliasDefault) {
      if (this.settings.aliasTemplate === "{{book}}, {{chapter}}") this.settings.aliasTemplate = "{{reference}}";
      this.settings.bibleAliasDefault = true;
    }
    // Format fields added later get their defaults; an earlier joinAdjacent setting carries over
    this.settings.format = {
      ...DEFAULT_FORMAT,
      ...(typeof saved.joinAdjacent === "boolean" ? { joinAdjacent: saved.joinAdjacent } : {}),
      ...saved.format,
    };
    delete (this.settings as { joinAdjacent?: boolean }).joinAdjacent;
    // Before link templates, references opened in Literal Word in a chosen translation
    if (saved.linkTemplate === undefined && typeof saved.translation === "string") {
      this.settings.linkTemplate = templateFromTranslation(saved.translation);
    }
    delete (this.settings as { translation?: string }).translation;
    // The built-in sites' templates from before they used the translation a reference names
    this.settings.linkTemplate = OLD_SITE_TEMPLATES[this.settings.linkTemplate] ?? this.settings.linkTemplate;
    // Before the library was hidden, one folder held the packages and the vault's logoxide.toml: it's
    // the packages folder now, and its installed packages move to the hidden library on load
    if (typeof saved.logoxideLibrary === "string" && saved.logoxideBooks === undefined) {
      this.settings.logoxideBooks = saved.logoxideLibrary || DEFAULT_SETTINGS.logoxideBooks;
      this.settings.logoxideLibrary = DEFAULT_SETTINGS.logoxideLibrary;
      await this.saveData(this.settings);
    }
    // Verse numbers, footnotes, and cross references were each shown or not (notes in one setting
    // at first), and verse numbers had a color: each is one look now. Notes were drawn in the accent color
    const old = saved as { bibleNotes?: boolean; bibleCrossRefs?: boolean; bibleVerseNumbers?: boolean; verseNumberColor?: string };
    if (saved.verseNumbers === undefined && (old.bibleVerseNumbers !== undefined || old.verseNumberColor)) {
      this.settings.verseNumbers = old.bibleVerseNumbers === false ? "none" : old.verseNumberColor || "faded";
    }
    if (saved.footnotes === undefined && old.bibleNotes) this.settings.footnotes = "accent";
    if (saved.crossRefs === undefined && (old.bibleCrossRefs ?? old.bibleNotes)) this.settings.crossRefs = "accent";
    // Red letters were on or off (off by default): the words of Jesus have a look now, red by default
    for (const key of ["bibleNotes", "bibleCrossRefs", "bibleVerseNumbers", "verseNumberColor", "bibleRedLetters"]) delete (this.settings as unknown as Record<string, unknown>)[key];
    // Context was shown when it had an amount (0: none): it's an amount to show now, shown by default or not
    // Embedding references alone on their line was on or off everywhere: it's where, for each device
    const embedAlone = this.settings.embedAlone as unknown;
    if (typeof embedAlone === "boolean") this.settings.embedAlone = embedAlone ? "both" : "off";
    if (!["off", "editor", "reading", "both"].includes(this.settings.embedAlone)) this.settings.embedAlone = DEFAULT_SETTINGS.embedAlone;
    this.settings.embedAloneDevices ??= {};
    if (!(this.settings.previewContext >= 1)) this.settings.previewContext = DEFAULT_SETTINGS.previewContext;
    this.settings.queries = (this.settings.queries ?? []).filter((q) => q && typeof q.name === "string");
    // Saved searches from before 0.4.0 used -o for any overlap
    if ((this.settings.queryFormat ?? 1) < 2) {
      this.settings.queries = this.settings.queries.map((q) => ({ ...q, query: migrateQuery(q.query) }));
      this.settings.queryFormat = 2;
      if (this.settings.queries.length > 0) await this.saveData(this.settings);
    }
  }

  // Bible text

  /** Where a passage is in its book's file: `v=3:16-18` */
  passageLocator(passage: Passage): string {
    return formatVerseLocator(passageParts(passage));
  }

  /**
   * Opens a reference link (`[John 1:1]`, `[text](John 1:1)`): in the Bible tab (the Bible it names,
   * `[John 1:1 KJV]`, else the current one), or with the link template when that's the setting or
   * the vault has no such Bible with the book
   */
  async openPassage(passage: Passage, newLeaf?: PaneType | boolean, translation?: string | null): Promise<void> {
    if (this.settings.referenceLinks !== "bible" || !(await this.openInBible(passage, newLeaf, translation))) this.openReference(passage, translation);
  }

  /** Opens a passage in the Bible tab (the Bible it names, else the current one); false when the vault has no such Bible with the book */
  async openInBible(passage: Passage, newLeaf?: PaneType | boolean, translation?: string | null): Promise<boolean> {
    const bible = translation ? this.bibles.named(translation) : this.bibles.current();
    const file = bible ? await this.bibles.bookFile(passage, bible) : null;
    if (file) await this.openDocument(file, this.passageLocator(passage), newLeaf, { eState: { link: true } });
    return !!file;
  }

  /** Opens a reference's link: in the browser, or the vault's Bible for the *Your Bible* site's links (`obsidian://logoxide?ref=…`) */
  openUrl(url: string, newLeaf?: PaneType | boolean): void {
    if (url.startsWith(`${BIBLE_URL}?`)) void this.openBibleUrl(Object.fromEntries(new URL(url).searchParams), newLeaf);
    else window.open(url, "_blank");
  }

  /** `obsidian://logoxide?ref=John%203:16[&translation=KJV]`, from a reference's link or from outside Obsidian */
  private async openBibleUrl(params: Record<string, string>, newLeaf?: PaneType | boolean): Promise<void> {
    const passage = params.ref ? wholeReference(this.topos, params.ref) : null;
    if (!passage) return void new Notice(params.ref ? `${params.ref} isn't a Bible reference.` : "The link names no passage.");
    const translation = params.translation || null;
    if (!(await this.openInBible(passage, newLeaf, translation)))
      new Notice(`No Bible in the vault has ${passage.reference}${translation ? ` in ${translation}` : ""}.`);
  }

  /**
   * The Bibles whose packages list a recording of a passage's book: the one it names (else the
   * current one) first
   */
  recordedBibles(passage: Passage, translation?: string | null): NonNullable<ReturnType<BibleLibrary["named"]>>[] {
    const recorded = new Set(this.packages.recorded(passage.bookId).map((n) => n.toLowerCase()));
    const first = this.bibles.forText(translation);
    return this.bibles
      .all()
      .filter((b) => b.package && recorded.has(b.name.toLowerCase()))
      .sort((a, b) => Number(b === first) - Number(a === first));
  }

  /**
   * A book's verse counts in a Bible, one per chapter in order: a folder Bible's as read in the
   * background (`VerseCounts`), a package's from logoxide; null when they aren't known
   */
  chapterVerses(bible: Bible | null, bookId: number): number[] | null {
    if (!bible) return null;
    if (bible.package) return this.packages.chapterVerses(bible.name, bookId);
    const path = bookFiles(bible).get(bookId);
    return path ? this.verseCounts.of(path, bookId) : null;
  }

  /**
   * Where a passage, numbered as the Bible it names (else the current one) numbers it, is in
   * `bible`: its parts there, and the mapping when the two are numbered differently and the
   * vault's versification maps lead from one to the other (`Psalm 51:1` in an English Bible is
   * `51:3` in a Hebrew one). No parts with a mapping: `bible` has none of it
   */
  placeIn(passage: Passage, bible: Bible, translation?: string | null): Placement {
    return this.placePartsIn(passage.bookId, passageParts(passage), this.bibles.forText(translation), bible);
  }

  /**
   * Where parts of a book, numbered as `from` numbers them, are in `to`: as written in the same
   * Bible, a folder Bible (which has no numbering of its own, even named as a package is), or
   * when neither numbering maps to the other's
   */
  placePartsIn(bookId: number, parts: VersePart[], from: Bible | null, to: Bible): Placement {
    if (!from || from.folder === to.folder || !from.package || !to.package) return { parts, mapped: null };
    const mapped = this.packages.mapped(bookId, parts, from.name, to.name);
    if (!mapped) return { parts, mapped: null };
    const verses = mapped.verses.filter((v) => v.book === bookId);
    return { parts: versesParts(verses, this.chapterVerses(to, bookId)), mapped };
  }

  /** Plays a passage from a Bible's recording (the first of `recordedBibles` that has it), in its book's tab */
  async playPassage(passage: Passage, translation?: string | null): Promise<void> {
    for (const bible of this.recordedBibles(passage, translation)) {
      const { parts } = this.placeIn(passage, bible, translation);
      if (parts.length === 0) continue;
      const file = await this.bibles.bookFile(passage, bible);
      if (!file || !(await this.packages.recording(file.path, passage.bookId))) continue;
      await this.openDocument(file, formatVerseLocator(parts), false);
      const view = this.views().find((v): v is BibleView => v instanceof BibleView && v.file?.path === file.path && v.leaf === this.app.workspace.getMostRecentLeaf());
      if (view && (await view.whenRecording())) await view.playPassage(parts);
      return;
    }
    new Notice(`No Bible here has a recording of ${passage.reference}.`);
  }

  /** A link to a passage in a Bible (`Bibles/BSB/JHN.usx#v=3:16`): the one named, else the current one, if it has the book */
  passageLink(passage: Passage, translation?: string | null): string | null {
    const path = this.bibles.bookPath(passage.bookId, this.bibles.forText(translation));
    return path ? `${path}#${this.passageLocator(passage)}` : null;
  }

  /**
   * Shows a passage's text in a hover preview (Obsidian's page preview, with the Bible's embed), from
   * the Bible it names or the current one; none if the pointer left the reference while finding it,
   * and it hides as the pointer heads away (`hoverLink`)
   */
  async previewPassage(
    event: MouseEvent,
    targetEl: HTMLElement,
    passage: Passage,
    hoverParent: HoverParent,
    translation?: string | null,
    over?: (x: number, y: number) => boolean,
  ): Promise<void> {
    const file = await this.bibles.bookFile(passage, this.bibles.forText(translation));
    if (!file) return;
    hoverLink(this.app, {
      event,
      source: HOVER_SOURCE,
      hoverParent,
      targetEl,
      linktext: `${file.path}#${this.passageLocator(passage)}`,
      sourcePath: "",
      over,
    });
  }

  /** Topos with a book as context (`3:16` is in it), for references in the book's notes, by book name */
  private readonly bookTopos = new Map<string, Topos>();

  /**
   * References in a Bible book's notes (the popups of its footnote and cross reference marks):
   * found with the book as context, opened in the same Bible, previewed on hover
   */
  noteLinks = (book: BibleBook): NoteLinks | null => {
    if (!this.topos || !book.name) return null;
    let topos = this.bookTopos.get(book.name);
    if (!topos) {
      try {
        topos = ToposOptions.create().contextBook(book.name).build();
      } catch {
        return null;
      }
      this.bookTopos.set(book.name, topos);
    }
    const found = topos;
    return {
      find: (text) => found.search(text, OffsetUnit.Utf16),
      open: (passage, event) => void this.openPassage(passage, event.button === 1 || event.ctrlKey || event.metaKey ? "tab" : false, book.bible),
      preview: (passage, el, event) => {
        // Obsidian previews only an element in the page (it doesn't look in shadow roots): the
        // reader's host is the target, and the pointer is on the reference while it's over its rectangles
        const host = (el.getRootNode() as ShadowRoot).host as HTMLElement | undefined;
        if (!host) return;
        const over = (x: number, y: number) =>
          el.isConnected && Array.from(el.getClientRects()).some((r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2);
        void this.previewPassage(event, host, passage, hoverParent(this, host), book.bible, over);
      },
    };
  };

  /**
   * Shows a passage's text in an element (`![John 1:1]`), from the Bible it names (or the current
   * one), then each Bible to compare with (the setting); each embed is a child of `owner`, so it is
   * unloaded with it. Without a Bible with the book, says so
   */
  async embedPassage(
    containerEl: HTMLElement,
    passage: Passage,
    label: string,
    owner: Component,
    translation?: string | null,
    highlight: EmbedHighlight = {},
  ): Promise<void> {
    containerEl.addClass("topos-embed");
    const bibles = [this.bibles.forText(translation), ...this.compareBibles()].filter((b, i, all): b is Bible => !!b && all.findIndex((o) => o?.folder === b.folder) === i);
    // Each Bible's file and where the passage is in it (a compare Bible numbered differently: its own numbers)
    const shown: { file: TFile | null; bible: Bible; placed: Placement }[] = [];
    for (const bible of bibles) {
      const placed = this.placeIn(passage, bible, translation);
      const file = placed.parts.length > 0 ? await this.bibles.bookFile(passage, bible) : null;
      if (file || placed.mapped) shown.push({ file, bible, placed });
    }
    if (!shown.some((s) => s.file)) {
      containerEl.setText(`${label}: ${this.bibles.all().length === 0 ? "add a Bible (a folder of USX files) to show its text" : "not in this Bible"}`);
      containerEl.addClass("topos-embed-missing");
      return;
    }
    for (const [index, { file, bible, placed }] of shown.entries()) {
      const el = shown.length > 1 ? containerEl.createDiv({ cls: "topos-embed-part" }) : containerEl;
      if (!file) {
        // Mapped to nothing: the other numbering has none of it
        el.setText(`${passage.reference} · ${mappedLabel(bible.name, placed.mapped!)}`);
        el.addClass("topos-embed-missing");
        continue;
      }
      // The highlight is in the first Bible's words, which the others don't have
      const marked = index === 0 && highlight.fragment ? highlight.fragment : "";
      const embed = this.createEmbed({ app: this.app, containerEl: el }, file, formatVerseLocator(placed.parts) + marked) as BibleEmbed;
      embed.label = passage.reference;
      if (index === 0 && highlight.onHighlight) embed.onHighlight = highlight.onHighlight;
      if (placed.mapped) embed.bibleLabel = mappedLabel(bible.name, placed.mapped);
      owner.addChild(embed);
      await embed.loadFile();
    }
  }

  /** The Bibles embeds show after the one a reference names (the setting, by name or alias) */
  compareBibles(): NonNullable<ReturnType<BibleLibrary["named"]>>[] {
    return this.settings.compareBibles
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .flatMap((name) => this.bibles.named(name) ?? []);
  }

  /**
   * Clicking a link whose target is a reference and no note (`[osis](John.3.16)` is an unresolved
   * internal link to Obsidian) opens the passage instead of creating a note. A link to a Bible's
   * book that isn't there any more, but names its Bible (`[[Bibles/ESV/John.bible#v=3:16&bible=ESV]]`),
   * opens the book in that Bible
   */
  private patchReferenceLinks(): void {
    const plugin = this;
    this.register(
      around(this.app.workspace, {
        openLinkText(old) {
          return async function (this: Workspace, linktext: string, sourcePath: string, newLeaf?: PaneType | boolean, state?: OpenViewState) {
            const { path, subpath } = parseLinktext(linktext);
            if (path && !plugin.app.metadataCache.getFirstLinkpathDest(path, sourcePath)) {
              const file = await plugin.namedBibleBook(path, subpath);
              if (file) return plugin.openDocument(file, subpath.replace(/^#/, ""), newLeaf, { ...state, eState: { ...(state?.eState as object | undefined), link: true } });
              const passage = wholeReference(plugin.topos, decodeURI(path));
              if (passage) return plugin.openPassage(passage, newLeaf);
            }
            return old.call(this, linktext, sourcePath, newLeaf, state);
          };
        },
      }),
    );
  }

  /**
   * The book a link names by its file's name (`Bibles/ESV/John.bible`, `JHN.usx`), in the Bible its
   * locator names (`v=3:16&bible=ESV`), if the vault has it
   */
  private async namedBibleBook(path: string, subpath: string): Promise<TFile | null> {
    const { bible: name } = splitBible(subpath.replace(/^#/, ""));
    const bible = name ? this.bibles.named(name) : null;
    if (!bible) return null;
    const base = decodeURI(path).split("/").pop()!.replace(/\.(bible|usx|usfm|sfm)$/i, "");
    const bookId = this.topos.findBook(base);
    return bookId ? this.bibles.bookFile(bookId, bible) : null;
  }

  // Saved searches

  /** Saves a search under a name, replacing one with the same name */
  async saveQuery(query: SavedQuery): Promise<void> {
    const name = query.name.trim();
    if (!name) return;
    const others = this.settings.queries.filter((q) => q.name !== name);
    const index = this.settings.queries.findIndex((q) => q.name === name);
    others.splice(index === -1 ? others.length : index, 0, { name, query: query.query });
    this.settings.queries = others;
    await this.saveData(this.settings);
    this.search.set({}); // re-render the sidebar's list
  }

  async deleteQuery(name: string): Promise<void> {
    this.settings.queries = this.settings.queries.filter((q) => q.name !== name);
    await this.saveData(this.settings);
    this.search.set({});
  }

  /** Shows a saved search in the sidebar; returns the query's mistakes, if any */
  applyQuery(query: SavedQuery): string[] {
    const parsed = parseQuery(query.query);
    this.search.set({ filters: parsed.filters, ...scopeOf(parsed) });
    return parsed.errors;
  }

  async openQuery(query: SavedQuery): Promise<void> {
    const errors = this.applyQuery(query);
    if (errors.length > 0) new Notice(`Saved search "${query.name}": ${errors.join("; ")}`);
    await this.activateSearch();
  }

  /** Saves a change to topos's own settings and redraws references for it */
  async saveToposSettings(): Promise<void> {
    await this.saveSettings();
    // The translations' names and aliases may have changed
    this.resetTranslations();
    this.refreshLinks();
  }

  /** How passages are written in the Bible tab, previews, and embeds */
  bookTextOptions(): BookTextOptions {
    // Both kinds of notes are rendered when either shows; the display settings' CSS hides the other
    return { notes: notesShown(this.settings), headings: this.settings.bibleHeadings, classPrefix: "topos-" };
  }

  /** Renders open Bible tabs again, after a setting changed what's rendered (headings, notes) */
  rerenderBibles(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(this.viewType)) {
      if (leaf.view instanceof DocumentView) void leaf.view.reload();
    }
  }

  /**
   * Redraws references everywhere they are shown, after a setting changes how they look or
   * where they link: open editors, reading views, and the sidebar
   */
  /** A reference's text as shown after it in live preview, by the `inlineText` settings (null: none) */
  inlineVerseText(passage: Passage, translation?: string | null): Promise<string | null> {
    const { inlineTextTemplate: template, inlineTextLength: max } = this.settings;
    const key = this.inlineKey(passage, translation);
    let text = this.inlineTexts.get(key);
    if (!text) {
      text = (async () => {
        const needs = inlineNeeds(template);
        const parts = needs.has("first") || needs.has("last") ? this.topos.parts(passage.reference, OffsetUnit.Utf16) : [];
        const of = async (name: "first" | "last" | "text", p: Passage | undefined) => (needs.has(name) && p ? ((await this.bibles.text(p, translation)) ?? "") : "");
        const values = {
          first: await of("first", parts[0]?.first ?? passage),
          last: await of("last", parts.at(-1)?.last ?? passage),
          text: await of("text", passage),
          reference: passage.reference,
          bible: this.bibles.forText(translation)?.name ?? "",
        };
        return inlineText(template, values, max);
      })()
        .catch(() => null)
        .then((value) => (this.inlineKnown.set(key, value), value));
      this.inlineTexts.set(key, text);
    }
    return text;
  }

  /** That text, if it's known already (so it's drawn at once, without a moment empty) */
  inlineVerseTextNow(passage: Passage, translation?: string | null): string | null | undefined {
    return this.inlineKnown.get(this.inlineKey(passage, translation));
  }

  /** What that text depends on: the passage, the translation, and the settings for it */
  private inlineKey(passage: Passage, translation?: string | null): string {
    return [passage.osis, translation ?? "", this.settings.inlineTextTemplate, this.settings.inlineTextLength].join("\n");
  }

  /** Each reference's text after it in live preview (by `inlineKey`), until the Bibles change */
  private readonly inlineTexts = new Map<string, Promise<string | null>>();
  private readonly inlineKnown = new Map<string, string | null>();
  /** Counts the Bibles' changes, so the editors' widgets of that text are drawn again */
  inlineGeneration = 0;

  /** The Bibles changed: their text after references is looked up again */
  private bibleTextChanged(): void {
    this.inlineTexts.clear();
    this.inlineKnown.clear();
    this.inlineGeneration++;
  }

  refreshLinks(): void {
    this.applyColor();
    this.app.workspace.updateOptions();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      // Editors keep their decorations until the text or viewport changes, so ask for new ones
      const editor = (leaf.view.editor as { cm?: EditorView } | undefined)?.cm;
      editor?.dispatch({ effects: refreshReferences.of(null) });
      // Callouts, tables, and embedded notes in live preview are rendered once, like reading view
      relinkEditor(this, leaf.view.contentEl);
      // Reading view keeps the HTML it rendered (and linked) until told to render again
      leaf.view.previewMode?.rerender(true);
    }
    this.epubs.refresh();
    this.otherDocuments.refresh();
    this.search.set({});
  }

  // Index

  subscribeIndex = (listener: () => void): (() => void) => {
    this.indexListeners.add(listener);
    return () => this.indexListeners.delete(listener);
  };

  notifyIndex(): void {
    clearTimeout(this.notifyTimer);
    this.notifyTimer = undefined;
    this.lastNotify = performance.now();
    this.indexVersion++;
    for (const listener of this.indexListeners) listener();
  }

  private notifyTimer: ReturnType<typeof setTimeout> | undefined;
  private lastNotify = 0;

  /** Notifies at most twice a second, since the sidebar re-sorts every hit (for indexing in batches) */
  notifyIndexSoon(): void {
    if (this.notifyTimer !== undefined) return;
    const wait = Math.max(0, 500 - (performance.now() - this.lastNotify));
    this.notifyTimer = setTimeout(() => this.notifyIndex(), wait);
  }

  /** The file extensions to search, from the settings */
  extensions(): string[] {
    return this.settings.extensions
      .split(",")
      .map((e) => e.trim().replace(/^\./, ""))
      .filter(Boolean);
  }

  /** Whether a path is in one of the folders left out of search */
  isExcluded(path: string): boolean {
    return this.settings.excludeFolders
      .split("\n")
      .map((f) => f.trim().replace(/\/+$/, ""))
      .filter(Boolean)
      .some((folder) => path === folder || path.startsWith(`${folder}/`));
  }

  isSearchable(file: TAbstractFile): file is TFile {
    if (!(file instanceof TFile)) return false;
    // Installed packages hold Bibles and their license files, not notes (the notes beside book
    // stubs in the library's folder are searched)
    if (this.packages.isPackageFile(file.path)) return false;
    return this.extensions().includes(file.extension) && !this.isExcluded(file.path);
  }

  /** The background indexer, started on first use */
  private background(): BackgroundSearcher | null {
    if (this.worker === undefined) {
      try {
        this.worker = new BackgroundSearcher(workerSource, engineWasm);
      } catch (error) {
        console.warn("topos: no Web Worker, indexing on the main thread", error);
        this.worker = null;
      }
    }
    return this.worker;
  }

  /** Searches files into index entries in the background, or on this thread if the worker fails */
  async indexFiles(files: IndexRequest[]): Promise<{ path: string; bytes: Uint8Array }[]> {
    const worker = this.background();
    if (worker) {
      try {
        return await worker.index(files);
      } catch (error) {
        if (this.worker !== worker) return []; // stopped
        console.warn("topos: the background indexer failed, indexing on the main thread", error);
        worker.terminate();
        this.worker = null;
      }
    }
    const entries = [];
    const written = Date.now();
    for (const file of files) {
      const bytes = this.topos.indexEntry(file.path, file.size, file.mtime, file.text, written, OffsetUnit.Utf16);
      entries.push({ path: file.path, bytes });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return entries;
  }

  /** Searches an EPUB into its index entry in the background, or on this thread if the worker fails */
  async indexBook(book: BookRequest): Promise<BookResult> {
    const worker = this.background();
    if (worker) {
      try {
        return await worker.indexBook(book);
      } catch (error) {
        if (this.worker !== worker) return { error: "stopped" };
        console.warn("topos: the background indexer failed, indexing on the main thread", error);
        worker.terminate();
        this.worker = null;
      }
    }
    return indexBook(this.topos, book);
  }

  /** A random name for this device's index packs, kept in this device's storage for the vault */
  private indexDevice(): string {
    const key = "logoxide-device";
    const app = this.app as { loadLocalStorage?: (key: string) => unknown; saveLocalStorage?: (key: string, value: unknown) => void };
    const saved = app.loadLocalStorage?.(key);
    if (typeof saved === "string" && /^[a-z0-9]+$/.test(saved)) return saved;
    const id = Math.random().toString(36).slice(2, 10) || "device";
    app.saveLocalStorage?.(key, id);
    return id;
  }

  /** Searches files in the background, or on this thread if the worker fails */
  async searchFiles(files: { path: string; text: string }[]): Promise<{ path: string; hits: Hit[] }[]> {
    const worker = this.background();
    if (worker) {
      try {
        return await worker.search(files);
      } catch (error) {
        if (this.worker !== worker) return []; // stopped
        console.warn("topos: the background indexer failed, indexing on the main thread", error);
        worker.terminate();
        this.worker = null;
      }
    }
    const results = [];
    for (const file of files) {
      results.push({ path: file.path, hits: searchText(this.topos, file.path, file.text) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return results;
  }

  /**
   * Brings the index up to date with the vault (after settings change what's searched); with
   * `force`, searches every file again
   */
  async reindex(force = false): Promise<void> {
    this.indexer.resetCli();
    await this.indexer.reconcile(force);
  }

  private reindexTimer: ReturnType<typeof setTimeout> | undefined;

  /** Reindexes once typing in a setting pauses */
  reindexSoon(): void {
    clearTimeout(this.reindexTimer);
    this.reindexTimer = setTimeout(() => void this.reindex(), 1000);
  }

  /** The vault's folder when searching with the topos CLI (the CLI engine, on desktop), else null */
  cliVault(): string | null {
    const adapter = this.app.vault.adapter;
    if (this.settings.engine !== "cli" || !Platform.isDesktopApp || !(adapter instanceof FileSystemAdapter)) return null;
    return adapter.getBasePath();
  }

  /** The topos command to run */
  cliPath(): string {
    return this.settings.cliPath || defaultCliPath();
  }

  /** Checks that the topos command runs, for the settings tab */
  async testCli(): Promise<string> {
    const { execFile } = require("node:child_process") as typeof import("node:child_process");
    const path = this.cliPath();
    return new Promise((resolve) => {
      execFile(path, ["--version"], { timeout: 10_000 }, (error, stdout) => {
        if (error) resolve(`Could not run ${path}: ${error.message}`);
        else resolve(`Found ${stdout.trim() || path}`);
      });
    });
  }

  // Navigation

  /** Makes each import again from its publisher's download, replacing those that changed; says what changed */
  async updateImports(): Promise<void> {
    const notice = new Notice("Updating imported Bibles…", 0);
    try {
      const lines = await this.bibleManager.updateImports();
      notice.hide();
      const changed = lines.filter((line) => line.includes("→"));
      new Notice(changed.length > 0 ? changed.join("\n") : "Every imported Bible is up to date", 10000);
    } catch (error) {
      notice.hide();
      new Notice(`Couldn't update imports: ${error instanceof Error ? error.message : String(error)}`, 10000);
    }
  }

  /** Puts back the files of Bible packages edited in the library (through logoxide's installer) */
  async restorePackages(): Promise<void> {
    const notice = new Notice("Restoring Bible packages…", 0);
    try {
      const restored = await this.bibleManager.restore();
      notice.hide();
      new Notice(restored.length > 0 ? `Restored ${restored.join(", ")}` : "No Bible package was edited");
    } catch (error) {
      notice.hide();
      new Notice(`Couldn't restore: ${error instanceof Error ? error.message : String(error)}`, 10000);
    }
  }

  /**
   * A book stub's plain text is its package's book (read only: the package's files aren't edited),
   * and from that, back to the stub
   */
  override async toggleSource(leaf: WorkspaceLeaf, mode: "read" | "edit" = "read"): Promise<void> {
    const state = leaf.getViewState();
    const path = (state.state as { file?: string } | undefined)?.file;
    if (path && state.type === this.viewType && path.endsWith(`.${STUB_EXTENSION}`)) {
      const stub = this.app.vault.getFileByPath(path);
      // A folder Bible's book: its file, which can be edited
      const source = stub && (await this.folderStubs.resolve(stub));
      if (source) {
        await leaf.setViewState({ type: this.sourceViewType, state: { file: source.path, mode }, active: true });
        return;
      }
      const target = stub && (await this.packages.stubTarget(stub));
      if (target) {
        await leaf.setViewState({ type: this.sourceViewType, state: { file: target.path, mode: "read" }, active: true });
        return;
      }
    }
    const stub = path && state.type === this.sourceViewType ? (this.packages.stubOf(path) ?? this.folderStubs.stubOf(path)) : null;
    if (stub) {
      await leaf.setViewState({ type: this.viewType, state: { file: stub }, active: true });
      return;
    }
    return super.toggleSource(leaf, mode);
  }

  async activateSearch(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SEARCH_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: SEARCH_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /**
   * Opens verse search in a new tab, starting from a search (the sidebar's, by default), or shows
   * the search tab already open
   */
  async openSearchPane(search: Partial<SearchState> | null = this.search.get(), newTab = false): Promise<void> {
    const { workspace } = this.app;
    const existing = newTab ? undefined : workspace.getLeavesOfType(SEARCH_PANE_VIEW)[0];
    if (existing) {
      if (search && existing.view instanceof SearchPane) existing.view.store.set(search);
      await workspace.revealLeaf(existing);
      workspace.setActiveLeaf(existing, { focus: true });
      return;
    }
    const leaf = newTabLeaf(workspace);
    await leaf.setViewState({ type: SEARCH_PANE_VIEW, active: true, state: search ? { search } : {} });
    await workspace.revealLeaf(leaf);
  }

  /** Opens the note (in `leaf`, else the current tab) and selects the reference */
  async openHit(hit: Hit, inLeaf?: WorkspaceLeaf): Promise<void> {
    if (hit.epub && (await this.epubs.open(hit))) return;
    const file = this.app.vault.getFileByPath(hit.path);
    if (!file) return;
    const leaf = inLeaf ?? this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { active: true });
    if (leaf.view instanceof MarkdownView) {
      const editor = leaf.view.editor;
      const from = editor.offsetToPos(hit.start);
      const to = editor.offsetToPos(hit.end);
      editor.setSelection(from, to);
      editor.scrollIntoView({ from, to }, true);
      editor.focus();
    }
  }

  /**
   * Whether a click on a reference opens it: a middle click always; on desktop, a Ctrl/Cmd-click
   * (or any click, if the setting allows it); on mobile, which has no Ctrl, a tap outside the
   * editor, or, if that setting is on, a tap in an editor that wasn't focused (the tap that would
   * place the cursor and open the keyboard; once it's open, taps move the cursor). Right clicks
   * never do (they open menus)
   */
  clickOpens(event: MouseEvent, inEditor: boolean, editorFocused = false): boolean {
    if (event.button === 1) return true;
    if (event.button !== 0) return false;
    if (!Platform.isDesktop) return !inEditor || (this.settings.tapOpensInEditor && !editorFocused);
    return !this.settings.clickNeedsModifier || event.ctrlKey || event.metaKey;
  }

  /** The main window's document and each pop-out window's */
  private windowDocuments(): Set<Document> {
    const docs = new Set<Document>();
    const main = (this.app.workspace as { containerEl?: HTMLElement }).containerEl?.ownerDocument;
    if (main) docs.add(main);
    this.app.workspace.iterateAllLeaves?.((leaf) => {
      const doc = leaf.view?.containerEl?.ownerDocument;
      if (doc) docs.add(doc);
    });
    return docs;
  }

  /** Sets the references' color in these windows (all of them by default) */
  applyColor(docs: Iterable<Document> = this.windowDocuments()): void {
    const inline = inlineTextVars(this.settings.inlineTextColor, this.settings.inlineTextStyle, this.settings.inlineTextPadding);
    for (const doc of docs) {
      if (this.settings.referenceColor) doc.body.style.setProperty("--topos-reference-color", this.settings.referenceColor);
      else doc.body.style.removeProperty("--topos-reference-color");
      // The look of a reference's text after it in live preview
      for (const [name, value] of Object.entries(inline)) doc.body.style.setProperty(name, value);
    }
  }

  /** Each book's names, for links */
  private linkBooks: Map<number, LinkBook> | null = null;

  /**
   * The link for a passage, from the link template (with `{translation}`, the translation it names);
   * null when links are off or it has none
   */
  referenceUrl(passage: Passage, translation?: string | null): string | null {
    this.linkBooks ??= new Map(this.topos.books().map((book) => [book.id, book]));
    return linkUrl(this.settings.linkTemplate, passage, this.linkBooks.get(passage.bookId), translation ?? undefined);
  }

  /** Where references open, for menus and tooltips: `BibleHub` */
  linkSite(): string {
    return siteName(this.settings.linkTemplate);
  }

  /**
   * Opens what a click or tap on a reference opens, by the `referenceTap` setting: all of it; the
   * part under the pointer (`at`: the reference's text and where in it the pointer is, when known),
   * a range's last verse on its end; or a menu of where each part starts and ends
   */
  tapReference(event: MouseEvent, passage: Passage, at: { text: string; offset: number } | null, open: (passage: Passage) => void): void {
    const mode = this.settings.referenceTap;
    if (mode === "part" && at) {
      open(partAt(this.topos, at.text, at.offset) ?? passage);
      return;
    }
    const stops = mode === "menu" ? passageStops(this.topos, passage) : [];
    if (stops.length < 2) {
      open(passage);
      return;
    }
    const menu = new Menu();
    for (const stop of stops) menu.addItem((item) => item.setTitle(stop.reference).setIcon("book-open").onClick(() => open(stop)));
    menu.showAtMouseEvent(event);
  }

  openReference(passage: Passage, translation?: string | null): void {
    const url = this.referenceUrl(passage, translation);
    if (url) this.openUrl(url);
    else if (!this.settings.linkTemplate.trim()) new Notice("Links are turned off in the Topos settings.");
    else new Notice(`${this.linkSite()} has no link for ${passage.reference}.`);
  }

  // Commentaries and Strong's numbers

  /** Strong's entries over Bible words that carry their numbers (the reader's popups) */
  readonly strongsPopup: StrongsPopupOptions = {
    lookup: (key) => this.packages.entries(key, { notes: false, headings: false, classPrefix: "topos-" }),
    enabled: () => this.settings.strongsHover && this.packages.hasStrongs(),
  };

  /** The commentary views open */
  private commentaryViews(): CommentaryView[] {
    return this.app.workspace.getLeavesOfType(COMMENTARY_VIEW).flatMap((leaf) => (leaf.view instanceof CommentaryView ? [leaf.view] : []));
  }

  /** Shows the open commentary views again (a setting changed what they show) */
  refreshCommentaries(): void {
    for (const view of this.commentaryViews()) void view.render();
    for (const view of this.views()) {
      if (!(view instanceof BibleView)) continue;
      view.commentaries?.refresh();
      view.crossReferences?.refresh();
      view.language?.refresh();
    }
  }

  /** Opens the commentary view in the right sidebar (or shows it), on a passage when given */
  async openCommentary(passage?: Passage | null, entry?: string): Promise<CommentaryView | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(COMMENTARY_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: COMMENTARY_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
    const view = leaf.view instanceof CommentaryView ? leaf.view : null;
    if (view && entry) await view.showEntry(entry);
    if (view && passage) await view.show(passage);
    return view;
  }

  /** Shows a passage in the open commentary views, while they follow */
  followPassage(passage: Passage | null): void {
    if (!passage || !this.settings.commentaryFollows) return;
    for (const view of this.commentaryViews()) void view.show(passage);
  }

  /** A Bible tab's passage, from its book and a verse locator (its position, `v=3:16`) */
  private readerPassage(book: string, locator: string | null | undefined): Passage | null {
    const reference = locatorReference(book, locator);
    return reference ? this.topos.parse(reference, bookStyle("name")) : null;
  }

  /** A Bible tab scrolled: the commentary follows its verse */
  followReader(reader: BibleReader, locator: string): void {
    if (this.commentaryViews().length === 0) return;
    this.followPassage(this.readerPassage(reader.bible.name, locator));
  }

  /** A Bible tab came to the front: the commentary follows where it is */
  private followLeaf(leaf: WorkspaceLeaf | null): void {
    if (!leaf || this.commentaryViews().length === 0) return;
    const view = this.views().find((v) => v.leaf === leaf);
    const book = view?.reader?.bible.name;
    if (!view?.file || !book) return;
    this.followPassage(this.readerPassage(book, this.settings.positions[view.file.path] ?? "v=1"));
  }

  private followTimer = 0;

  /** The editor's cursor moved: the commentary follows the reference under it (a moment later) */
  followCursor(view: EditorView): void {
    // Only the editor in front (not one changed in the background)
    const active = (this.app.workspace.activeEditor?.editor as { cm?: EditorView } | undefined)?.cm;
    if (!this.settings.commentaryFollows || active !== view || this.commentaryViews().length === 0) return;
    window.clearTimeout(this.followTimer);
    this.followTimer = window.setTimeout(() => {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      this.followPassage(referenceAt(this.topos, line.text, head - line.from)?.passage ?? null);
    }, 250);
  }

  /** The reference under the cursor */
  referenceAtCursor(editor: Editor): Passage | null {
    const cursor = editor.getCursor();
    return referenceAt(this.topos, editor.getLine(cursor.line), cursor.ch)?.passage ?? null;
  }

  /** Opens the sidebar showing references that share a verse with this passage */
  async findInVault(passage: Passage): Promise<void> {
    this.search.set({ filters: { ...NO_FILTERS, anyOverlap: [passage.osis] }, scope: "vault" });
    await this.activateSearch();
  }

  // Commands and menus

  private addCommands(): void {
    this.addCommand({
      id: "add-bibles",
      name: "Add a Bible, commentary, or book",
      callback: () => openSettings(this, "add"),
    });
    this.addCommand({
      id: "restore-logoxide-packages",
      name: "Restore edited Bible packages",
      callback: () => void this.restorePackages(),
    });
    this.addCommand({
      id: "update-logoxide-imports",
      name: "Update imported Bibles from their publishers",
      callback: () => void this.updateImports(),
    });
    this.addCommand({
      id: "reload-logoxide-packages",
      name: "Read logoxide packages again",
      callback: () =>
        void this.packages.load().then(() => {
          const { problems } = this.packages;
          const names = this.packages.names();
          new Notice(problems.length > 0 ? problems.join("\n") : names.length > 0 ? `Bibles from logoxide: ${names.join(", ")}` : "No logoxide packages (logoxide.toml)");
        }),
    });
    this.addCommand({
      id: "toggle-commentary-marks",
      name: "Toggle commentary marks",
      callback: () => {
        this.settings.commentaryMarks = !this.settings.commentaryMarks;
        void this.saveData(this.settings);
        this.refreshCommentaries();
      },
    });
    this.addCommand({
      id: "show-commentaries-tab",
      name: "Show the commentaries in the Bible's sidebar",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BibleView);
        const verse = view?.reader?.verseInView();
        if (!view?.commentaries || !verse) return false;
        if (!checking) view.commentaries.showVerse(verse.chapter, verse.verse);
        return true;
      },
    });
    this.addCommand({
      id: "show-cross-references-tab",
      name: "Show the cross-references in the Bible's sidebar",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(BibleView);
        const verse = view?.reader?.verseInView();
        if (!view?.crossReferences || !verse) return false;
        if (!checking) view.crossReferences.showVerse(verse.chapter, verse.verse);
        return true;
      },
    });
    this.addCommand({
      id: "open-commentary",
      name: "Open commentary",
      callback: () => {
        const editor = this.app.workspace.activeEditor?.editor;
        let passage = editor ? this.referenceAtCursor(editor) : null;
        if (!passage) {
          const view = this.views().find((v) => v.leaf === this.app.workspace.getMostRecentLeaf());
          const book = view?.reader?.bible.name;
          if (view?.file && book) passage = this.readerPassage(book, this.settings.positions[view.file.path] ?? "v=1");
        }
        void this.openCommentary(passage);
      },
    });
    this.addCommand({
      id: "look-up-strongs",
      name: "Look up the Strong's number under the cursor",
      editorCheckCallback: (checking, editor) => {
        const cursor = editor.getCursor();
        const found = strongsAt(editor.getLine(cursor.line), cursor.ch);
        if (!found) return false;
        if (!checking) void this.openCommentary(null, found.key);
        return true;
      },
    });
    this.addCommand({
      id: "open-search",
      name: "Open verse search",
      callback: () => void this.activateSearch(),
    });
    this.addCommand({
      id: "open-search-tab",
      name: "Open verse search in a tab",
      callback: () => void this.openSearchPane(null),
    });
    this.addCommand({
      id: "open-search-new-tab",
      name: "Open verse search in a new tab",
      callback: () => void this.openSearchPane(null, true),
    });
    this.addCommand({
      id: "search-current-note",
      name: "Search references in the current note",
      callback: () => {
        this.search.set({ scope: "file" });
        void this.activateSearch();
      },
    });
    this.addCommand({
      id: "open-saved-search",
      name: "Open a saved search",
      callback: () => {
        if (this.settings.queries.length === 0) new Notice("No saved searches yet: save one from the verse search sidebar.");
        else new SavedQueryModal(this.app, this).open();
      },
    });
    this.addCommand({
      id: "go-to-reference",
      name: "Go to a reference in the vault",
      callback: () => new GoToReferenceModal(this.app, this).open(),
    });
    this.addCommand({
      id: "go-to-passage",
      // Picks a book, chapter, and verse (the id is from before it had this name)
      name: "Read the Bible",
      callback: () => openPassagePicker(this),
    });
    this.addCommand({
      id: "insert-picked-reference",
      name: "Insert a reference by picking its book, chapter, and verse",
      editorCallback: (editor) =>
        pickPassage(this, "Insert a reference", (passage) => {
          const style = bookStyle(this.settings.style);
          editor.replaceSelection(written(this.topos, passage, style, this.settings.format));
        }),
    });
    this.addCommand({
      id: "insert-reference",
      name: "Insert a verse reference",
      editorCallback: (editor) => new InsertReferenceModal(this.app, this, editor).open(),
    });
    this.addCommand({
      id: "find-overlapping",
      name: "Find references to the verses under the cursor",
      editorCheckCallback: (checking, editor) => {
        const passage = this.referenceAtCursor(editor);
        if (!passage) return false;
        if (!checking) void this.findInVault(passage);
        return true;
      },
    });
    this.addCommand({
      id: "open-literal-word",
      name: "Open the reference under the cursor in the browser",
      editorCheckCallback: (checking, editor) => {
        const passage = this.referenceAtCursor(editor);
        if (!passage) return false;
        if (!checking) this.openReference(passage);
        return true;
      },
    });
    this.addCommand({
      id: "copy-osis",
      name: "Copy the reference under the cursor as OSIS",
      editorCheckCallback: (checking, editor) => {
        const passage = this.referenceAtCursor(editor);
        if (!passage) return false;
        if (!checking) void this.copyText(passage.osis);
        return true;
      },
    });
    addParallelCommands(this);
    this.addCommand({
      id: "play-recording",
      name: "Play or pause this book's recording",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        const view = this.views().find((v): v is BibleView => v instanceof BibleView && v.leaf === leaf);
        if (!view?.recording) return false;
        if (!checking) void view.listen();
        return true;
      },
    });
    this.addCommand({
      id: "play-reference",
      name: "Play the reference under the cursor",
      editorCheckCallback: (checking, editor) => {
        const passage = this.referenceAtCursor(editor);
        if (!passage || this.recordedBibles(passage).length === 0) return false;
        if (!checking) void this.playPassage(passage);
        return true;
      },
    });
    this.addCommand({
      id: "normalize-references",
      name: "Normalize references in the selection or note",
      editorCallback: (editor) => this.normalize(editor),
    });
  }

  private editorMenu(menu: Menu, editor: Editor): void {
    const cursor = editor.getCursor();
    const strongs = strongsAt(editor.getLine(cursor.line), cursor.ch);
    if (strongs && this.packages.hasStrongs()) {
      menu.addItem((item) =>
        item
          .setTitle(`Look up ${strongs.key}`)
          .setIcon("book-a")
          .onClick(() => void this.openCommentary(null, strongs.key)),
      );
    }
    const passage = this.referenceAtCursor(editor);
    if (!passage) return;
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(`Commentary on ${passage.reference}`)
        .setIcon("message-square-quote")
        .onClick(() => void this.openCommentary(passage)),
    );
    const recorded = this.recordedBibles(passage)[0];
    if (recorded) {
      menu.addItem((item) =>
        item
          .setTitle(`Play ${passage.reference} (${recorded.name})`)
          .setIcon("play")
          .onClick(() => void this.playPassage(passage)),
      );
    }
    menu.addItem((item) =>
      item
        .setTitle(`Open ${passage.reference} in ${this.linkSite()}`)
        .setIcon("external-link")
        .onClick(() => this.openReference(passage)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Find references to these verses")
        .setIcon("search")
        .onClick(() => void this.findInVault(passage)),
    );
    menu.addItem((item) =>
      item
        .setTitle(`Copy as OSIS (${passage.osis})`)
        .setIcon("copy")
        .onClick(() => void this.copyText(passage.osis)),
    );
  }

  async copyText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    new Notice(`Copied ${text}`);
  }

  /** Rewrites references in the chosen style, in the selection or else the whole note */
  private normalize(editor: Editor): void {
    const style = bookStyle(this.settings.style);
    const selection = editor.getSelection();
    if (selection) {
      const replacements = normalizeReferences(this.topos, selection, style, this.settings.format);
      editor.replaceSelection(applyReplacements(selection, replacements));
      new Notice(`Normalized ${replacements.length} reference${replacements.length === 1 ? "" : "s"}`);
      return;
    }
    const replacements = normalizeReferences(this.topos, editor.getValue(), style, this.settings.format);
    editor.transaction({
      changes: replacements.map((r) => ({
        from: editor.offsetToPos(r.start),
        to: editor.offsetToPos(r.end),
        text: r.text,
      })),
    });
    new Notice(`Normalized ${replacements.length} reference${replacements.length === 1 ? "" : "s"}`);
  }
}
