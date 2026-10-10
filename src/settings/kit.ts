import { Setting, setIcon } from "obsidian";
import { describeError } from "../core/errors.ts";

/**
 * Text with `code` in backticks (files, syntax, commands) and *names* of buttons and commands in
 * asterisks, for a setting's description
 */
export function md(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const part of text.split(/(`[^`]+`|\*[^*\s][^*]*\*)/)) {
    const tag = part.length > 2 && part.startsWith("`") && part.endsWith("`") ? "code" : part.length > 2 && part.startsWith("*") && part.endsWith("*") ? "em" : null;
    if (tag) {
      const el = document.createElement(tag);
      el.textContent = part.slice(1, -1);
      fragment.append(el);
    } else if (part) fragment.append(part);
  }
  return fragment;
}

/** Fills an element with `md` text */
export function setMd(el: HTMLElement, text: string): void {
  el.empty();
  el.append(md(text));
}

/** A tab of the settings */
export interface TabSpec<Id extends string> {
  id: Id;
  name: string;
  icon: string;
}

/** A row of tabs over a panel each: every panel is drawn, and only the selected one shows */
export class Tabs<Id extends string> {
  readonly panels = new Map<Id, HTMLElement>();
  private readonly buttons = new Map<Id, HTMLElement>();

  constructor(
    container: HTMLElement,
    specs: TabSpec<Id>[],
    private selected: Id,
    private readonly onSelect: (id: Id) => void,
  ) {
    const bar = container.createDiv({ cls: "topos-tabs", attr: { role: "tablist" } });
    const body = container.createDiv("topos-tab-panels");
    for (const spec of specs) {
      const button = bar.createEl("button", { cls: "topos-tab", attr: { role: "tab", type: "button", "aria-label": spec.name } });
      setIcon(button.createSpan("topos-tab-icon"), spec.icon);
      button.createSpan({ cls: "topos-tab-name", text: spec.name });
      button.addEventListener("click", () => this.select(spec.id));
      this.buttons.set(spec.id, button);
      this.panels.set(spec.id, body.createDiv({ cls: "topos-tab-panel", attr: { role: "tabpanel" } }));
    }
    if (!this.panels.has(selected)) this.selected = specs[0].id;
    this.show();
  }

  get current(): Id {
    return this.selected;
  }

  select(id: Id): void {
    if (!this.panels.has(id)) return;
    this.selected = id;
    this.show();
    this.onSelect(id);
    this.buttons.get(id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  private show(): void {
    for (const [id, panel] of this.panels) {
      const on = id === this.selected;
      panel.toggleClass("is-active", on);
      this.buttons.get(id)?.toggleClass("is-active", on);
      this.buttons.get(id)?.setAttr("aria-selected", String(on));
    }
  }
}

/** A short paragraph at the top of a tab, saying what's in it */
export function lead(el: HTMLElement, text: string): void {
  el.createEl("p", { cls: "topos-tab-lead" }).append(md(text));
}

/** A search field like Obsidian's own (with a button to clear it) */
export function searchField(
  container: HTMLElement,
  placeholder: string,
  value: string,
  onInput: (value: string) => void,
): HTMLInputElement {
  const box = container.createDiv("search-input-container topos-search-field");
  const input = box.createEl("input", { attr: { type: "search", placeholder, spellcheck: "false", enterkeyhint: "search" } });
  input.value = value;
  const clear = box.createDiv({ cls: "search-input-clear-button", attr: { "aria-label": "Clear" } });
  const sync = () => clear.toggleClass("is-hidden", input.value === "");
  input.addEventListener("input", () => {
    sync();
    onInput(input.value);
  });
  clear.addEventListener("click", () => {
    input.value = "";
    sync();
    onInput("");
    input.focus();
  });
  sync();
  return input;
}

/** What each list's filter field holds, kept while the settings are redrawn */
const filters = new Map<string, string>();

/** Whether every word of `query` is in `text` (ignoring case and accents) */
export function matches(text: string, query: string): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const haystack = fold(text);
  return fold(query)
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/**
 * A group of settings under a heading, the way Obsidian's own tabs draw them (1.11 and later): the
 * heading, a search row (empty unless a list fills it), and the settings in one card
 */
export interface Section {
  group: HTMLElement;
  heading: Setting | null;
  /** Where a list puts its search field */
  search: HTMLElement;
  /** The card: add settings here */
  items: HTMLElement;
}

export function section(container: HTMLElement, name?: string, desc?: string, cls = ""): Section {
  const group = container.createDiv(`setting-group ${cls}`.trim());
  let heading: Setting | null = null;
  if (name) {
    heading = new Setting(group).setName(name).setHeading();
    if (desc) heading.setDesc(md(desc));
  }
  const search = group.createDiv("setting-group-search");
  const items = group.createDiv("setting-items");
  return { group, heading, search, items };
}

export interface ListOptions<T> {
  /** Keeps the filter's text across redraws */
  key: string;
  placeholder: string;
  /** What the filter searches in an item */
  text: (item: T) => string;
  /** Draws an item as a row of the section's card, and returns it */
  render: (item: T, items: HTMLElement) => HTMLElement;
  /** Shown when there are no items */
  empty: string;
  /** How many items there must be for the filter field to show */
  filterFrom?: number;
  /** The items' noun, for the count (`package`, `catalog`) */
  noun?: [string, string];
}

/** A section's card as a list, with a filter field at its top once it's long: rows are hidden as you type, not drawn again */
export function filteredList<T>(section: Section, items: T[], options: ListOptions<T>): void {
  section.group.addClass("mod-list", "topos-list");
  section.items.addClass("topos-scroll");
  if (items.length === 0) {
    section.items.createDiv("setting-item mod-empty-state topos-list-empty").append(md(options.empty));
    return;
  }
  const rows = items.map((item) => ({ el: options.render(item, section.items), text: options.text(item) }));
  if (items.length < (options.filterFrom ?? 5)) return;
  const count = createDiv("topos-list-count");
  const none = section.items.createDiv({ cls: "setting-item mod-empty-state topos-list-empty", text: "Nothing matches" });
  const [one, many] = options.noun ?? ["item", "items"];
  const apply = (query: string) => {
    filters.set(options.key, query);
    let shown = 0;
    for (const row of rows) {
      const on = !query.trim() || matches(row.text, query);
      row.el.toggleClass("topos-hidden", !on);
      if (on) shown++;
    }
    none.toggleClass("topos-hidden", shown > 0);
    count.setText(shown === rows.length ? `${rows.length} ${rows.length === 1 ? one : many}` : `${shown} of ${rows.length}`);
  };
  searchField(section.search, options.placeholder, filters.get(options.key) ?? "", apply);
  section.search.append(count);
  apply(filters.get(options.key) ?? "");
}

/** Small labels beside a name: a package's version, kind, or source */
export function badge(el: HTMLElement, text: string, cls = ""): HTMLElement {
  return el.createSpan({ cls: `topos-badge ${cls}`.trim(), text });
}

/** A row of buttons of which one is picked (like a segmented control) */
export function chips<V extends string>(
  container: HTMLElement,
  options: [V, string][],
  value: V,
  onChange: (value: V) => void,
): void {
  const row = container.createDiv({ cls: "setting-group-filters topos-chips", attr: { role: "radiogroup" } });
  const buttons: HTMLElement[] = [];
  for (const [id, name] of options) {
    const button = row.createEl("button", { cls: "setting-group-filter topos-chip", text: name, attr: { type: "button", role: "radio" } });
    const pick = () => {
      for (const b of buttons) {
        b.toggleClass("is-active", b === button);
        b.setAttr("aria-checked", String(b === button));
      }
    };
    button.addEventListener("click", () => {
      pick();
      onChange(id);
    });
    buttons.push(button);
    if (id === value) pick();
  }
}

/** An error's message */
export function errorText(error: unknown): string {
  return describeError(error);
}
