import { ButtonComponent, Notice, setIcon } from "obsidian";
import { PackageKind, type CatalogEntry } from "logoxide";
import type ToposPlugin from "../main.ts";
import { kindName, language, license, SOURCE_NAMES, sourceKey, sourceName } from "../bible/add.ts";
import { badge, chips, errorText, md, searchField, type Section } from "./kit.ts";

/** How many results show at first, and how many more are drawn each time the list is scrolled to its end */
const PAGE = 25;

type KindFilter = "all" | "bible" | "commentary" | "book" | "other";

const KINDS: [KindFilter, string][] = [
  ["all", "All"],
  ["bible", "Bibles"],
  ["commentary", "Commentaries"],
  ["book", "Books"],
  ["other", "Other"],
];

function kindMatches(kind: PackageKind, filter: KindFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "bible":
      return kind === PackageKind.Bible;
    case "commentary":
      return kind === PackageKind.Commentary;
    case "book":
      return kind === PackageKind.Book || kind === PackageKind.Collection;
    case "other":
      return !([PackageKind.Bible, PackageKind.Commentary, PackageKind.Book, PackageKind.Collection] as PackageKind[]).includes(kind);
  }
}

/** The browser's search, kept while the settings are redrawn (and between visits) */
const state = { query: "", kind: "all" as KindFilter, source: "all", shown: PAGE, hideInstalled: false };

/** Installs running, by entry id, so a redraw still shows them */
const installing = new Set<string>();

/**
 * Searching the catalogs and registries for packages to add: a search field, filters by kind
 * and source, and a card for each result with a button to install it
 */
export class CatalogBrowser {
  private status!: HTMLElement;
  private results!: HTMLElement;
  /** The row at the list's end saying there are more */
  private more: HTMLElement | null = null;
  /** The results the filters allow, and how many of them are drawn */
  private shown: CatalogEntry[] = [];
  private drawn = 0;
  private source!: HTMLSelectElement;
  private input!: HTMLInputElement;
  /** The newest search, so an older one finishing late is dropped */
  private searchId = 0;
  private timer: number | null = null;
  private found: CatalogEntry[] = [];
  private registries: string[] = [];

  constructor(
    private readonly plugin: ToposPlugin,
    private readonly section: Section,
    /** Called after a package is installed, to redraw what lists them */
    private readonly onInstalled: () => void,
  ) {}

  /** Sets the source filter (`registry:<name>`, `ebible`…) and searches again */
  static showSource(source: string): void {
    state.source = source;
    state.shown = PAGE;
  }

  render(): void {
    const { group, search, items } = this.section;
    group.addClass("mod-list", "topos-browser");
    const top = search;
    this.input = searchField(top, "Search by name, abbreviation, or language: “world english”, KJV, español…", state.query, (value) => {
      state.query = value;
      state.shown = PAGE;
      this.searchSoon();
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.search();
    });
    const refresh = top.createDiv({ cls: "clickable-icon topos-browser-refresh", attr: { "aria-label": "Download the catalogs again (they're kept a day)" } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", async () => {
      refresh.addClass("is-spinning");
      await this.plugin.bibleManager.refreshCatalogs();
      await this.search();
      refresh.removeClass("is-spinning");
    });

    const filters = search.createDiv("setting-group-search-control topos-browser-filters");
    chips(filters, KINDS, state.kind, (kind) => {
      state.kind = kind;
      state.shown = PAGE;
      this.draw();
    });
    const right = filters.createDiv("topos-browser-filters-end");
    this.source = right.createEl("select", { cls: "dropdown" });
    this.source.addEventListener("change", () => {
      state.source = this.source.value;
      state.shown = PAGE;
      this.draw();
    });
    const hide = right.createEl("label", { cls: "topos-browser-hide" });
    const checkbox = hide.createEl("input", { attr: { type: "checkbox" } });
    checkbox.checked = state.hideInstalled;
    hide.append("Hide installed");
    checkbox.addEventListener("change", () => {
      state.hideInstalled = checkbox.checked;
      this.draw();
    });

    this.status = search.createDiv("setting-group-search-control topos-browser-status");
    this.results = items;
    items.addClass("topos-scroll", "is-tall");
    items.addEventListener("scroll", () => this.scrolled(), { passive: true });
    void this.plugin.bibleManager
      .registryList()
      .then((list) => {
        this.registries = list.map((r) => r.name);
        this.fillSources();
      })
      .catch(() => {});
    void this.search();
  }

  private searchSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.search(), 200);
  }

  private async search(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const id = ++this.searchId;
    this.setStatus("loading", "Searching the catalogs… (the first search downloads them)");
    try {
      const found = await this.plugin.bibleManager.search(state.query.trim(), 0);
      if (id !== this.searchId) return;
      this.found = found;
      this.draw();
    } catch (error) {
      if (id !== this.searchId) return;
      this.found = [];
      this.results.empty();
      this.setStatus("error", `The catalogs couldn't be read: ${errorText(error)}`);
      new ButtonComponent(this.status).setButtonText("Try again").onClick(() => void this.search());
    }
  }

  private setStatus(kind: "loading" | "error" | "count", text: string): void {
    this.status.empty();
    this.status.className = `setting-group-search-control topos-browser-status is-${kind}`;
    if (kind === "loading") this.status.createSpan("topos-spinner");
    this.status.createSpan({ text });
  }

  /** The source filter's options, with how many of the current results each has */
  private fillSources(): void {
    const counts = new Map<string, number>();
    for (const entry of this.found) {
      if (!kindMatches(entry.kind, state.kind)) continue;
      const key = sourceKey(entry);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const keys = [...this.registries.map((name) => `registry:${name}`), ...Object.keys(SOURCE_NAMES)];
    for (const key of counts.keys()) if (!keys.includes(key)) keys.push(key);
    if (state.source !== "all" && !keys.includes(state.source)) keys.push(state.source);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    this.source.empty();
    const option = (value: string, text: string) => this.source.createEl("option", { text, attr: { value } });
    option("all", `All sources (${total})`);
    for (const key of keys) {
      const name = key.startsWith("registry:") ? `${key.slice("registry:".length)} (registry)` : (SOURCE_NAMES[key] ?? key);
      option(key, `${name} (${counts.get(key) ?? 0})`);
    }
    this.source.value = state.source;
  }

  private isInstalled(entry: CatalogEntry): boolean {
    return this.plugin.packages.installed.some((p) => p.id === entry.id);
  }

  /** Draws the results the filters allow, up to `state.shown`, from the top of the list */
  private draw(): void {
    this.fillSources();
    this.shown = this.found.filter(
      (entry) =>
        kindMatches(entry.kind, state.kind) &&
        (state.source === "all" || sourceKey(entry) === state.source) &&
        !(state.hideInstalled && this.isInstalled(entry)),
    );
    const shown = this.shown;
    const query = state.query.trim();
    this.setStatus(
      "count",
      shown.length === 0
        ? query
          ? `Nothing matches “${query}”${state.kind !== "all" || state.source !== "all" ? " with these filters" : ""}`
          : "Nothing to show with these filters"
        : `${shown.length.toLocaleString()} ${shown.length === 1 ? "package" : "packages"}${query ? ` matching “${query}”` : ""}`,
    );
    this.results.empty();
    this.results.scrollTop = 0;
    this.drawn = 0;
    this.more = null;
    if (shown.length === 0) {
      const empty = this.results.createDiv("setting-item mod-empty-state topos-list-empty");
      empty.setText(state.kind !== "all" || state.source !== "all" || state.hideInstalled ? "Nothing here: try another kind or source." : "Nothing matches: try a language, an abbreviation, or fewer words.");
      return;
    }
    this.drawMore(state.shown);
  }

  /** Adds rows to the list, up to `count` in all, with a row at its end while there are more */
  private drawMore(count: number): void {
    this.more?.remove();
    this.more = null;
    for (const entry of this.shown.slice(this.drawn, count)) this.card(entry);
    this.drawn = Math.min(count, this.shown.length);
    state.shown = Math.max(state.shown, this.drawn);
    if (this.drawn >= this.shown.length) return;
    this.more = this.results.createDiv({
      cls: "setting-item mod-empty-state topos-list-empty topos-browser-more",
      text: `Showing ${this.drawn} of ${this.shown.length.toLocaleString()}: scroll for more`,
    });
    this.more.addEventListener("click", () => this.drawMore(this.drawn + PAGE));
  }

  /** Draws the next page once the list is scrolled near its end */
  private scrolled(): void {
    const list = this.results;
    if (this.more && list.scrollTop + list.clientHeight > list.scrollHeight - 240) this.drawMore(this.drawn + PAGE);
  }

  private card(entry: CatalogEntry): void {
    const card = this.results.createDiv("setting-item topos-entry");
    const main = card.createDiv("setting-item-info topos-entry-main");
    const title = main.createDiv("setting-item-name topos-entry-title");
    title.createSpan({ cls: "topos-entry-name", text: entry.name });
    if (entry.abbreviation) badge(title, entry.abbreviation, "is-code");
    if (entry.kind !== PackageKind.Bible) badge(title, kindName(entry.kind), "is-kind");
    if (entry.rightToLeft) badge(title, "right to left");
    const meta = main.createDiv("setting-item-description topos-entry-meta");
    const lang = language(entry);
    for (const [icon, text] of [
      ["languages", lang],
      ["scale", license(entry, 48)],
      ["globe", sourceName(entry)],
    ] as const) {
      if (!text) continue;
      const part = meta.createSpan("topos-entry-meta-part");
      setIcon(part.createSpan("topos-meta-icon"), icon);
      part.createSpan({ text });
    }
    // Details, shown when the card is opened
    const details = main.createDiv("topos-entry-details");
    if (entry.description) details.createEl("p", { text: entry.description });
    const facts = details.createEl("dl");
    const fact = (name: string, value: string | null | undefined, code = false) => {
      if (!value) return;
      facts.createEl("dt", { text: name });
      const dd = facts.createEl("dd");
      if (code) dd.createEl("code", { text: value });
      else dd.setText(value);
    };
    fact("Id", entry.id, true);
    fact("Version", entry.version ?? entry.releases.at(-1)?.version);
    if (entry.aliases.length > 0) fact("Also called", entry.aliases.join(", "));
    fact("Copyright", entry.copyright?.trim());
    fact("License", entry.license, true);
    if (entry.source.tag === "Git") fact("Repository", entry.source.url, true);
    if (entry.source.tag === "External") fact("Import", entry.source._import, true);
    main.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("a, button, code")) return;
      card.toggleClass("is-open", !card.hasClass("is-open"));
    });

    const actions = card.createDiv("setting-item-control topos-entry-actions");
    const button = new ButtonComponent(actions);
    const show = (how: "add" | "installing" | "installed") => {
      button.buttonEl.empty();
      button.buttonEl.className = "topos-entry-add";
      if (how === "installing") {
        button.buttonEl.createSpan("topos-spinner");
        button.buttonEl.createSpan({ text: "Installing…" });
        button.setDisabled(true);
      } else if (how === "installed") {
        setIcon(button.buttonEl.createSpan("topos-entry-add-icon"), "check");
        button.buttonEl.createSpan({ text: "Installed" });
        button.setDisabled(true);
        card.addClass("is-installed");
      } else {
        setIcon(button.buttonEl.createSpan("topos-entry-add-icon"), "plus");
        button.buttonEl.createSpan({ text: "Add" });
        button.setDisabled(false);
      }
    };
    show(installing.has(entry.id) ? "installing" : this.isInstalled(entry) ? "installed" : "add");
    button.onClick(async () => {
      if (installing.has(entry.id) || this.isInstalled(entry)) return;
      installing.add(entry.id);
      show("installing");
      try {
        const name = await this.plugin.bibleManager.addEntry(entry);
        new Notice(`Installed ${name}`);
      } catch (error) {
        new Notice(`Couldn't install ${entry.name}: ${errorText(error)}`, 10000);
      }
      installing.delete(entry.id);
      show(this.isInstalled(entry) ? "installed" : "add");
      this.onInstalled();
    });
  }
}

/** Adding a package from its git repository's URL, as a row of a section's card */
export function gitForm(items: HTMLElement, plugin: ToposPlugin, onInstalled: () => void): void {
  const row = items.createDiv("setting-item topos-add-row");
  const info = row.createDiv("setting-item-info");
  info.createDiv({ cls: "setting-item-name", text: "Repository URL" });
  info.createDiv("setting-item-description").append(md("A logoxide package's git repository: its newest release is installed, and pinned in `logoxide.lock`."));
  const form = info.createDiv("topos-inline-form");
  const input = form.createEl("input", { attr: { type: "url", placeholder: "https://github.com/owner/package", spellcheck: "false" } });
  const button = form.createEl("button", { cls: "mod-cta", text: "Add" });
  const add = async () => {
    const url = input.value.trim();
    if (!url) return input.focus();
    button.disabled = true;
    button.setText("Installing…");
    try {
      const name = await plugin.bibleManager.addGit(url);
      new Notice(`Installed ${name}`);
      input.value = "";
      onInstalled();
    } catch (error) {
      new Notice(`Couldn't install ${url}: ${errorText(error)}`, 10000);
    }
    button.disabled = false;
    button.setText("Add");
  };
  button.addEventListener("click", () => void add());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void add();
  });
}
