import { ItemView, setIcon, type HoverPopover, type WorkspaceLeaf } from "obsidian";
import { PackageKind, type Passage } from "logoxide";
import type { Bible } from "../core/bibles.ts";
import { partsReference } from "../core/mapping.ts";
import { bookStyle } from "../core/settings.ts";
import { passageParts } from "../core/verse-locator.ts";
import { stepVerse, versesFrom, type VersePlace } from "../core/verse-steps.ts";
import type ToposPlugin from "../main.ts";
import { renderNote, type OpenPassage } from "./commentary.ts";
import { PassageSuggest } from "./passage-suggest.ts";
import { pickListButton } from "./pick-list.ts";
import { strongsPopups } from "./strongs.ts";

export const TRANSLATIONS_VIEW = "logoxide-translations";
export const VERSE_COMMENTARIES_VIEW = "logoxide-verse-commentaries";

/** The text options notes are read with */
const TEXT_OPTIONS = { notes: false, headings: false, classPrefix: "topos-" };

/** How many verses a translations tab may show at a time */
const VERSE_COUNTS = [1, 2, 3, 5, 10, 20];

/** What a rows tab shows */
interface RowsState {
  /** Its book (by id) and the verse it starts at */
  book?: number | null;
  at?: string | null;
  follow?: boolean;
  /** A translations tab's Bibles, by folder (a name may be both a folder's and a package's), in order */
  bibles?: string[] | null;
  /** A commentaries tab's commentaries (their dependency names), in order; null: all of them */
  commentaries?: string[] | null;
  /** A translations tab's verses at a time */
  count?: number;
}

/**
 * A tab of rows about a verse: a bar to go to a passage (typed, or a verse before or after) above
 * them, following the Bible tab in front (and the reference under the editor's cursor) while its
 * header's link button is lit (`ToposPlugin.followPassage`). Its links open in a Bible tab beside
 * it (`ToposPlugin.openBeside`).
 */
abstract class RowsView extends ItemView {
  hoverPopover: HoverPopover | null = null;
  book: number | null = null;
  at: VersePlace = { chapter: 1, verse: 1 };
  following = true;
  private followButton: HTMLElement | null = null;
  protected readonly barEl: HTMLElement;
  protected readonly rowsEl: HTMLElement;
  private field: HTMLInputElement | null = null;
  private rendering = 0;

  constructor(
    leaf: WorkspaceLeaf,
    protected readonly plugin: ToposPlugin,
  ) {
    super(leaf);
    // Made here: Obsidian may set the state before `onOpen`
    this.contentEl.addClass("topos-commentary", "topos-rows");
    this.barEl = this.contentEl.createDiv({ cls: "topos-resource-bar topos-rows-bar" });
    this.rowsEl = this.contentEl.createDiv({ cls: "topos-rows-body" });
  }

  /** How many verses it shows (and moves by) */
  protected get count(): number {
    return 1;
  }

  /** Draws the rows for these verses into `el` (a fresh element: shown when this render is still the newest) */
  protected abstract drawRows(el: HTMLElement, verses: Passage[], current: () => boolean): Promise<void>;

  /** After the rows are shown (laid out) */
  protected afterRender(): void {}

  /** More of the bar, after the passage's */
  protected drawBarExtras(_bar: HTMLElement): void {}

  override getState(): Record<string, unknown> {
    return { book: this.book, at: `${this.at.chapter}:${this.at.verse}`, follow: this.following } satisfies RowsState;
  }

  override async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]): Promise<void> {
    const s = (state ?? {}) as RowsState;
    this.readState(s);
    await super.setState(state, result);
    await this.render();
  }

  protected readState(s: RowsState): void {
    if (s.book) this.book = s.book;
    const at = /^(\d+):(\d+)$/.exec(s.at ?? "");
    if (at) this.at = { chapter: Number(at[1]), verse: Number(at[2]) };
    this.following = s.follow ?? true;
  }

  protected override async onOpen(): Promise<void> {
    this.followButton = this.addAction("link", "Follow the Bible tab", () => {
      this.following = !this.following;
      this.updateFollow();
      this.app.workspace.requestSaveLayout();
    });
    this.updateFollow();
    if (this.book === null) await this.render();
  }

  private updateFollow(): void {
    this.followButton?.toggleClass("is-active", this.following);
    this.followButton?.setAttribute("aria-label", this.following ? "Following the Bible tab: click to stop" : "Follow the Bible tab");
  }

  protected bookName(): string {
    return this.plugin.topos.books().find((b) => b.id === this.book)?.name ?? "";
  }

  /** The verse counts it steps by: the current Bible's */
  private counts(): number[] | null {
    return this.book ? this.plugin.chapterVerses(this.plugin.bibles.current(), this.book) : null;
  }

  /** Goes to a passage's first verse */
  async show(passage: Passage): Promise<void> {
    const first = passageParts(passage)[0];
    const at = { chapter: first?.chapter ?? 1, verse: Math.max(1, first?.verse ?? 1) };
    if (this.book === passage.bookId && this.at.chapter === at.chapter && this.at.verse === at.verse) return;
    this.book = passage.bookId;
    this.at = at;
    this.app.workspace.requestSaveLayout();
    await this.render();
  }

  /** A passage shown elsewhere (the Bible tab in front, the editor's cursor): followed while `following` */
  follow(passage: Passage): void {
    if (this.following) void this.show(passage);
  }

  /** Moves by verses (by `count` at a time) */
  private async step(delta: number): Promise<void> {
    this.at = stepVerse(this.counts(), this.at, delta);
    this.app.workspace.requestSaveLayout();
    await this.render();
  }

  /** The verses it shows, as passages */
  private verses(): Passage[] {
    const book = this.bookName();
    if (!book) return [];
    return versesFrom(this.counts(), this.at, this.count).flatMap((v) => this.plugin.topos.parse(`${book} ${v.chapter}:${v.verse}`, bookStyle("name")) ?? []);
  }

  /** The verses' reference: `John 3:16`, `John 3:16-18` */
  protected reference(verses: Passage[]): string {
    const first = verses[0];
    const last = verses[verses.length - 1];
    if (!first || !last || first === last) return first?.reference ?? "";
    const a = passageParts(first)[0]!;
    const b = passageParts(last)[0]!;
    return `${this.bookName()} ${a.chapter}:${a.verse}-${b.chapter === a.chapter ? "" : `${b.chapter}:`}${b.verse}`;
  }

  /** Opens a passage in a Bible tab beside this one */
  protected readonly openLink: OpenPassage = (passage, newLeaf) => void this.plugin.openBeside(passage, this.leaf, newLeaf);

  async render(): Promise<void> {
    const n = ++this.rendering;
    if (this.book === null) {
      const passage = this.plugin.currentPassage() ?? this.plugin.topos.parse("John 1:1", bookStyle("name"));
      const first = passage && passageParts(passage)[0];
      if (passage && first) {
        this.book = passage.bookId;
        this.at = { chapter: first.chapter, verse: Math.max(1, first.verse) };
      }
    }
    const verses = this.verses();
    const el = createDiv();
    await this.drawRows(el, verses, () => n === this.rendering);
    if (n !== this.rendering) return;
    this.drawBar(verses);
    this.rowsEl.replaceChildren(...Array.from(el.childNodes));
    this.afterRender();
    (this.leaf as WorkspaceLeaf & { tabHeaderInnerTitleEl?: HTMLElement }).tabHeaderInnerTitleEl?.setText(this.getDisplayText());
    (this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText());
  }

  /** The bar: back, the passage (typed to go there), forward, and the view's own (made once; the passage shown again each time) */
  private drawBar(verses: Passage[]): void {
    if (this.field) {
      if (this.field.doc.activeElement !== this.field) this.field.value = this.reference(verses);
      return;
    }
    const bar = this.barEl;
    const button = (icon: string, label: string, run: () => void) => {
      const b = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", run);
    };
    button("chevron-left", this.count > 1 ? `The ${this.count} verses before` : "The verse before", () => void this.step(-this.count));
    const field = (this.field = bar.createEl("input", { cls: "topos-rows-passage", attr: { type: "text", "aria-label": "Passage", spellcheck: "false", autocomplete: "off", enterkeyhint: "go" } }));
    field.value = this.reference(verses);
    const suggest = new PassageSuggest(this.plugin, field, (passage) => {
      field.removeClass("is-invalid");
      void this.show(passage);
    });
    field.addEventListener("input", () => field.removeClass("is-invalid"));
    field.addEventListener("keydown", (e) => {
      // With suggestions showing, Enter picks one
      if (e.key !== "Enter" || suggest.shown || e.defaultPrevented) return;
      const passage = this.plugin.topos.parse(field.value, bookStyle(this.plugin.settings.style));
      field.toggleClass("is-invalid", !passage);
      if (passage) {
        field.blur();
        void this.show(passage);
      }
    });
    field.addEventListener("focus", () => field.select());
    button("chevron-right", this.count > 1 ? `The next ${this.count} verses` : "The next verse", () => void this.step(this.count));
    this.drawBarExtras(bar);
  }
}

/**
 * Translations in rows: each Bible's text of the same verses (`count` at a time, 1 by default), a
 * row a Bible, in the order picked. The verses are numbered as the current Bible numbers them; a
 * Bible numbered differently has them as it numbers them (the vault's versification maps,
 * `ToposPlugin.placeIn`), labeled with its own numbers
 */
export class TranslationsView extends RowsView {
  /** The Bibles shown, by folder, in order (null: the current one and the ones embeds compare with) */
  bibles: string[] | null = null;
  private verseCount = 1;

  getViewType(): string {
    return TRANSLATIONS_VIEW;
  }

  getDisplayText(): string {
    const book = this.bookName();
    return book ? `Translations · ${book} ${this.at.chapter}:${this.at.verse}` : "Translations";
  }

  getIcon(): string {
    return "rows-3";
  }

  protected override get count(): number {
    return this.verseCount;
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), bibles: this.bibles, count: this.verseCount } satisfies RowsState;
  }

  protected override readState(s: RowsState): void {
    super.readState(s);
    this.bibles = s.bibles ?? null;
    this.verseCount = s.count ?? 1;
  }

  /** The Bibles shown */
  private shown(): Bible[] {
    const library = this.plugin.bibles;
    if (this.bibles) return this.bibles.flatMap((folder) => library.all().find((b) => b.folder === folder) ?? []);
    const chosen = [library.current(), ...this.plugin.compareBibles()].filter((b, i, all): b is Bible => !!b && all.findIndex((o) => o?.folder === b.folder) === i);
    // With none to compare with, a few of the vault's
    return chosen.length > 1 ? chosen : [...chosen, ...library.all().filter((b) => !chosen.includes(b))].slice(0, 4);
  }

  /** Shows these Bibles (by folder, in order; null: the default ones) */
  private setBibles(folders: string[] | null): void {
    this.bibles = folders;
    this.app.workspace.requestSaveLayout();
    void this.render();
  }

  protected override drawBarExtras(bar: HTMLElement): void {
    const count = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Verses at a time" } });
    for (const n of VERSE_COUNTS) count.createEl("option", { value: String(n), text: n === 1 ? "1 verse" : `${n} verses` });
    count.value = String(this.verseCount);
    count.addEventListener("change", () => {
      this.verseCount = Number(count.value);
      this.app.workspace.requestSaveLayout();
      void this.render();
    });
    pickListButton(bar, "Bibles", () => {
      const all = this.plugin.bibles.all();
      return {
        items: all.map((b) => ({ id: b.folder, label: b.name, detail: all.filter((o) => o.name === b.name).length > 1 ? b.folder : undefined })),
        picked: this.shown().map((b) => b.folder),
        placeholder: "Search Bibles…",
        onChange: (picked) => this.setBibles(picked),
        actions: this.bibles ? [{ label: "Reset to the default Bibles", run: () => this.setBibles(null) }] : [],
      };
    });
  }

  protected async drawRows(el: HTMLElement, verses: Passage[], current: () => boolean): Promise<void> {
    const bibles = this.shown();
    if (verses.length === 0 || bibles.length === 0) {
      el.createDiv({ cls: "topos-commentary-empty", text: bibles.length === 0 ? "The vault has no Bibles yet, or none is picked: pick some under Bibles." : "Go to a passage." });
      return;
    }
    // Numbered as the current Bible numbers them (else the first row's), whatever the rows' order
    const from = (this.plugin.bibles.current() ?? bibles[0]!).name;
    const book = this.bookName();
    for (const bible of bibles) {
      const row = el.createDiv({ cls: "topos-rows-row" });
      const label = row.createDiv({ cls: "topos-rows-label" });
      const name = label.createSpan({ cls: "topos-commentary-link", text: bible.name, attr: { "aria-label": `Open in ${bible.name}` } });
      const text = row.createDiv({ cls: "topos-rows-text" });
      const whole = this.plugin.topos.parse(this.reference(verses), bookStyle("name"));
      name.addEventListener("click", (e) => {
        if (!whole) return;
        // Where it is in that Bible, as it numbers it
        const parts = this.plugin.placeIn(whole, bible, from).parts;
        const there = parts.length > 0 ? this.plugin.topos.parse(partsReference(book, parts), bookStyle("name")) : null;
        void this.plugin.openBeside(there ?? whole, this.leaf, e.ctrlKey || e.metaKey ? "tab" : false, bible.name);
      });
      const labels: string[] = [];
      for (const verse of verses) {
        const placed = this.plugin.placeIn(verse, bible, from);
        if (placed.mapped?.text) labels.push(placed.mapped.text);
        if (placed.parts.length === 0) {
          text.createSpan({ cls: "topos-rows-missing", text: `${passageParts(verse)[0]?.verse ?? ""} — ` });
          continue;
        }
        for (const part of placed.parts) {
          const passage = this.plugin.topos.parse(partsReference(book, [part]), bookStyle("name"));
          const words = passage ? await this.plugin.bibles.textIn(passage, bible, bible.name) : null;
          if (!current()) return;
          // A chapter's start after the first one's verses names it: `4:1`
          const first = part.chapter !== this.at.chapter && part.verse === 1 ? `${part.chapter}:1` : String(part.verse);
          const number = part.endVerse !== part.verse || part.endChapter !== part.chapter ? `${first}-${part.endVerse}` : first;
          if (verses.length > 1 || placed.mapped) text.createEl("sup", { cls: "topos-rows-number", text: number });
          text.createSpan({ text: words ? `${words} ` : "— ", cls: words ? "" : "topos-rows-missing" });
        }
      }
      const mapped = labels.filter(Boolean);
      if (!text.querySelector("span:not(.topos-rows-missing)")) text.replaceChildren(createSpan({ cls: "topos-rows-missing", text: `Not in ${bible.name}.` }));
      if (mapped.length > 0) label.createDiv({ cls: "topos-commentary-meta", text: mapped.join(", ") });
    }
  }
}

/**
 * Commentaries in rows: each of the vault's commentaries' notes on one verse (on it, or on a
 * passage around it: the `stretchNotes` setting stretches notes over the verses after them), a row
 * a commentary; those with none say so
 */
export class VerseCommentariesView extends RowsView {
  private offPopups: ReturnType<typeof strongsPopups> | null = null;
  /** The commentaries shown (their dependency names), in order; null: all of them */
  commentaries: string[] | null = null;

  override getState(): Record<string, unknown> {
    return { ...super.getState(), commentaries: this.commentaries } satisfies RowsState;
  }

  protected override readState(s: RowsState): void {
    super.readState(s);
    this.commentaries = s.commentaries ?? null;
  }

  protected override drawBarExtras(bar: HTMLElement): void {
    pickListButton(bar, "Commentaries", () => {
      const resources = this.plugin.packages.commentaries();
      return {
        items: resources.map((r) => ({ id: r.dependency, label: r.name, detail: r.title !== r.name ? r.title : undefined })),
        picked: this.commentaries ?? resources.map((r) => r.dependency),
        placeholder: "Search commentaries…",
        onChange: (picked) => {
          // All of them in their own order: every one, also those added later
          const all = resources.map((r) => r.dependency);
          this.commentaries = picked.join("\n") === all.join("\n") ? null : picked;
          this.app.workspace.requestSaveLayout();
          void this.render();
        },
      };
    });
  }

  getViewType(): string {
    return VERSE_COMMENTARIES_VIEW;
  }

  getDisplayText(): string {
    const book = this.bookName();
    return book ? `Commentaries · ${book} ${this.at.chapter}:${this.at.verse}` : "Commentaries";
  }

  getIcon(): string {
    return "message-square-quote";
  }

  protected override async onOpen(): Promise<void> {
    this.offPopups = strongsPopups(this.rowsEl, this.rowsEl, {
      lookup: (key) => this.plugin.packages.entries(key, TEXT_OPTIONS),
      enabled: () => this.plugin.settings.strongsHover,
      click: true,
      container: this.contentEl.doc.body,
    });
    await super.onOpen();
  }

  protected override async onClose(): Promise<void> {
    this.offPopups?.();
    this.offPopups = null;
  }

  /** Long rows fold to a few lines, so the commentaries after them are in view too */
  protected override afterRender(): void {
    for (const text of Array.from(this.rowsEl.querySelectorAll<HTMLElement>(".topos-rows-foldable"))) {
      // Folded: 18em high (styles.css)
      if (!text.isShown() || text.scrollHeight <= parseFloat(getComputedStyle(text).fontSize) * 18 * 1.2) continue;
      text.addClass("is-folded");
      const more = text.parentElement!.createEl("button", { cls: "topos-rows-more", text: "Show all" });
      more.addEventListener("click", () => {
        text.toggleClass("is-folded", !text.hasClass("is-folded"));
        more.setText(text.hasClass("is-folded") ? "Show all" : "Show less");
      });
    }
  }

  protected async drawRows(el: HTMLElement, verses: Passage[], current: () => boolean): Promise<void> {
    const verse = verses[0];
    const all = (await this.plugin.packages.resources()).filter((r) => r.kind === PackageKind.Commentary);
    const resources = this.commentaries ? this.commentaries.flatMap((d) => all.find((r) => r.dependency === d) ?? []) : all;
    if (resources.length === 0 && all.length > 0) {
      el.createDiv({ cls: "topos-commentary-empty", text: "No commentary is picked: pick some under Commentaries." });
      return;
    }
    if (!verse || resources.length === 0) {
      el.createDiv({ cls: "topos-commentary-empty", text: resources.length === 0 ? "The vault has no commentaries yet: add one under Settings → Logoxide → Add Bibles." : "Go to a passage." });
      return;
    }
    const found = await this.plugin.packages.commentaryNotes(verse, TEXT_OPTIONS);
    if (!current()) return;
    this.offPopups?.hide();
    const book = this.bookName();
    for (const resource of resources) {
      const notes = found.find((f) => f.commentary === resource.name)?.notes ?? [];
      const row = el.createDiv({ cls: "topos-rows-row" });
      const label = row.createDiv({ cls: "topos-rows-label" });
      const name = label.createSpan({ cls: "topos-commentary-link", text: resource.name, attr: { "aria-label": `Read ${resource.title || resource.name} in a tab` } });
      name.addEventListener("click", () => void this.plugin.openResource(resource.dependency, { passage: verse }));
      if (resource.title !== resource.name) label.createDiv({ cls: "topos-commentary-meta", text: resource.title });
      const text = row.createDiv({ cls: "topos-rows-text topos-rows-foldable" });
      if (notes.length === 0) text.createDiv({ cls: "topos-rows-missing", text: `Nothing on ${verse.reference}.` });
      for (const note of notes) renderNote(this.plugin, text, note, book, verse, this, { open: this.openLink });
    }
  }
}
