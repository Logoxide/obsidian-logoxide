import { ItemView, SuggestModal, setIcon, type App, type HoverPopover, type WorkspaceLeaf } from "obsidian";
import { PackageKind, type Note, type Passage } from "logoxide";
import { bookStyle } from "../core/settings.ts";
import { matchingKeys, noteAt } from "../core/study.ts";
import { passageParts } from "../core/verse-locator.ts";
import type { StudyResource } from "./packages.ts";
import type ToposPlugin from "../main.ts";
import { linkNote, renderNote, type OpenPassage } from "./commentary.ts";
import { renderEntries, strongsPopups } from "./strongs.ts";

export const RESOURCE_VIEW = "logoxide-resource";

/** The text options notes and entries are read with */
const TEXT_OPTIONS = { notes: false, headings: false, classPrefix: "topos-" };

/** How many of a dictionary's keys are listed at once */
const KEY_LIMIT = 300;

/** What a resource tab shows: a commentary's book (at a verse) or a dictionary's entry */
export interface ResourceState {
  resource: string | null;
  /** A commentary's book (its id) */
  book?: number | null;
  /** Where it's at in that book: `3:16` */
  at?: string | null;
  /** A dictionary's key */
  key?: string | null;
  /** Whether it follows the Bible tab in front */
  follow?: boolean;
}

/**
 * A commentary or dictionary read in a tab of its own: a commentary one book at a time, every note
 * in order under its chapter's heading (following the Bible tab in front, or the reference under
 * the editor's cursor, while `follow` and `commentaryFollows` are on); a dictionary as its keys,
 * filtered as typed, beside the entry picked. Links open in a Bible tab beside it (`openBeside`).
 */
export class ResourceView extends ItemView {
  hoverPopover: HoverPopover | null = null;
  resource: StudyResource | null = null;
  private resourceName: string | null = null;
  book: number | null = null;
  key: string | null = null;
  following = true;
  private followButton: HTMLElement | null = null;
  /** The book's passage, all of it */
  private whole: Passage | null = null;
  /** Where to go once drawn */
  private pending: { chapter: number; verse: number } | null = null;
  private notes: Note[] = [];
  private noteEls: HTMLElement[] = [];
  private readonly barEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private rendering = 0;
  private offPopups: ReturnType<typeof strongsPopups> | null = null;
  private observer: IntersectionObserver | null = null;
  /** The dictionary's keys and what's typed in its filter */
  private keys: string[] = [];
  /** A commentary's books (their ids) */
  private books: number[] = [];
  private query = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ToposPlugin,
  ) {
    super(leaf);
    this.navigation = true;
    // Made here: Obsidian may set the state before `onOpen`
    this.contentEl.addClass("topos-commentary", "topos-resource");
    this.barEl = this.contentEl.createDiv({ cls: "topos-resource-bar" });
    this.bodyEl = this.contentEl.createDiv({ cls: "topos-resource-body" });
  }

  getViewType(): string {
    return RESOURCE_VIEW;
  }

  getDisplayText(): string {
    if (!this.resource) return "Commentary";
    if (this.resource.kind !== PackageKind.Commentary) return this.key ? `${this.resource.name} · ${this.key}` : this.resource.name;
    return this.book ? `${this.resource.name} · ${this.bookName(this.book)}` : this.resource.name;
  }

  getIcon(): string {
    return this.resource?.kind === PackageKind.Lexicon ? "book-a" : "message-square-quote";
  }

  get isCommentary(): boolean {
    return this.resource?.kind === PackageKind.Commentary;
  }

  override getState(): Record<string, unknown> {
    const at = this.place();
    return { resource: this.resource?.dependency ?? this.resourceName, book: this.book, at: at && `${at.chapter}:${at.verse}`, key: this.key, follow: this.following } satisfies ResourceState;
  }

  override async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]): Promise<void> {
    const s = (state ?? {}) as ResourceState;
    this.resourceName = s.resource ?? null;
    this.book = s.book ?? null;
    this.key = s.key ?? null;
    this.following = s.follow ?? true;
    const at = /^(\d+):(\d+)$/.exec(s.at ?? "");
    this.pending = at ? { chapter: Number(at[1]), verse: Number(at[2]) } : null;
    await super.setState(state, result);
    await this.load();
  }

  protected override async onOpen(): Promise<void> {
    this.offPopups = strongsPopups(this.bodyEl, this.bodyEl, {
      lookup: (key) => this.plugin.packages.entries(key, TEXT_OPTIONS),
      enabled: () => this.plugin.settings.strongsHover,
      click: true,
      container: this.contentEl.doc.body,
    });
    this.bodyEl.addEventListener("scroll", () => this.app.workspace.requestSaveLayout(), { passive: true });
    this.followButton = this.addAction("link", "Follow the Bible tab", () => this.setFollowing(!this.following));
    this.updateFollow();
  }

  protected override async onClose(): Promise<void> {
    this.offPopups?.();
    this.offPopups = null;
    this.observer?.disconnect();
  }

  private bookName(id: number): string {
    return this.plugin.topos.books().find((b) => b.id === id)?.name ?? "";
  }

  /** Shows the title again in the tab and the view's header (private API: Obsidian has none to say it changed) */
  private updateTitle(): void {
    const text = this.getDisplayText();
    (this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(text);
    (this.leaf as WorkspaceLeaf & { tabHeaderInnerTitleEl?: HTMLElement }).tabHeaderInnerTitleEl?.setText(text);
  }

  private setFollowing(following: boolean): void {
    this.following = following;
    this.updateFollow();
    this.app.workspace.requestSaveLayout();
  }

  /** The header's follow button: a commentary's only, lit while it follows */
  private updateFollow(): void {
    const button = this.followButton;
    if (!button) return;
    button.toggleClass("is-active", this.following);
    button.toggle(this.isCommentary);
    button.setAttribute("aria-label", this.following ? "Following the Bible tab: click to stop" : "Follow the Bible tab");
  }

  /** Reads the resource named in the state and draws it (again, when the vault's packages were read again) */
  async load(): Promise<void> {
    const resources = await this.plugin.packages.resources();
    this.resource = resources.find((r) => r.dependency === this.resourceName) ?? resources[0] ?? null;
    if (this.resource && !this.isCommentary) this.keys = await this.plugin.packages.keysOf(this.resource.dependency);
    if (this.isCommentary) {
      const books = await this.plugin.packages.resourceBooks(this.resource!.dependency);
      this.books = books;
      if (this.book === null || !books.includes(this.book)) this.book = books[0] ?? null;
    }
    this.updateFollow();
    this.updateTitle();
    await this.render(resources);
  }

  /** Shows another resource (the same passage, or the same key, where it has them) */
  async setResource(dependency: string): Promise<void> {
    const at = this.place();
    this.resourceName = dependency;
    if (at) this.pending = at;
    this.app.workspace.requestSaveLayout();
    await this.load();
  }

  /** Shows a passage in a commentary: its book, scrolled to the note on it */
  async showPassage(passage: Passage): Promise<void> {
    if (!this.isCommentary || !this.resource) return;
    const books = await this.plugin.packages.resourceBooks(this.resource.dependency);
    if (!books.includes(passage.bookId)) return;
    const first = passageParts(passage)[0];
    const at = { chapter: first?.chapter ?? 1, verse: first?.verse ?? 0 };
    if (this.book === passage.bookId && this.noteEls.length > 0) return this.scrollTo(at);
    this.book = passage.bookId;
    this.pending = at;
    this.app.workspace.requestSaveLayout();
    await this.load();
  }

  /** A passage shown elsewhere (the Bible tab in front, the editor's cursor): followed while `following` */
  follow(passage: Passage): void {
    if (this.following && this.isCommentary) void this.showPassage(passage);
  }

  /** Shows a dictionary's entry */
  async showKey(key: string): Promise<void> {
    if (!this.resource || this.isCommentary) return;
    this.key = key;
    this.app.workspace.requestSaveLayout();
    this.updateTitle();
    await this.render();
  }

  /** The chapter and verse at the top of a commentary's view */
  private place(): { chapter: number; verse: number } | null {
    if (!this.isCommentary || this.noteEls.length === 0) return this.pending;
    const top = this.bodyEl.getBoundingClientRect().top;
    const i = this.noteEls.findIndex((el) => el.getBoundingClientRect().bottom > top + 4);
    const note = this.notes[i < 0 ? this.notes.length - 1 : i];
    return note ? { chapter: note.chapter, verse: note.verse } : null;
  }

  /** Scrolls to the note on a verse and marks it a moment */
  private scrollTo(at: { chapter: number; verse: number }): void {
    const i = noteAt(this.notes, at.chapter, at.verse);
    const el = i >= 0 ? this.noteEls[i] : this.bodyEl.querySelector<HTMLElement>(`[data-chapter="${at.chapter}"]`);
    if (!el) return;
    this.bodyEl.scrollTop += el.getBoundingClientRect().top - this.bodyEl.getBoundingClientRect().top - 8;
    if (i < 0) return;
    for (const old of Array.from(this.bodyEl.querySelectorAll(".is-current"))) old.removeClass("is-current");
    el.addClass("is-current");
  }

  /** Opens a passage in a Bible tab beside this one (rather than in its place) */
  private readonly openLink: OpenPassage = (passage, newLeaf) => void this.plugin.openBeside(passage, this.leaf, newLeaf);

  // Drawing

  private async render(resources?: StudyResource[]): Promise<void> {
    const n = ++this.rendering;
    resources ??= await this.plugin.packages.resources();
    const body = createDiv();
    let read: { notes: Note[]; whole: Passage | null } = { notes: [], whole: null };
    if (!this.resource) {
      body.createDiv({ cls: "topos-commentary-empty", text: "The vault has no commentaries or dictionaries yet: add one under Settings → Logoxide → Add Bibles." });
    } else if (this.isCommentary) {
      read = await this.drawCommentary(body);
    } else {
      await this.drawDictionary(body);
    }
    if (n !== this.rendering) return;
    this.notes = read.notes;
    this.whole = read.whole;
    this.drawBar(resources);
    this.offPopups?.hide();
    this.observer?.disconnect();
    const scroll = this.isCommentary ? 0 : this.bodyEl.scrollTop;
    this.bodyEl.replaceChildren(...Array.from(body.childNodes));
    this.bodyEl.toggleClass("topos-resource-dictionary", !!this.resource && !this.isCommentary);
    if (this.isCommentary) {
      this.noteEls = Array.from(this.bodyEl.querySelectorAll<HTMLElement>(".topos-commentary-note"));
      this.linkLazily();
      this.bodyEl.scrollTop = scroll;
      if (this.pending) this.scrollTo(this.pending);
      this.pending = null;
    } else {
      this.noteEls = [];
    }
  }

  /** The bar above: which resource, and a commentary's book and chapter */
  private drawBar(resources: StudyResource[]): void {
    const bar = this.barEl;
    bar.empty();
    if (resources.length === 0) return;
    const pick = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Commentary or dictionary" } });
    for (const [kind, label] of [
      [PackageKind.Commentary, "Commentaries"],
      [PackageKind.Lexicon, "Dictionaries"],
    ] as const) {
      const of = resources.filter((r) => r.kind === kind);
      if (of.length === 0) continue;
      const group = pick.createEl("optgroup", { attr: { label } });
      for (const r of of) group.createEl("option", { value: r.dependency, text: r.title && r.title !== r.name ? `${r.name} · ${r.title}` : r.name });
    }
    pick.value = this.resource?.dependency ?? "";
    pick.addEventListener("change", () => void this.setResource(pick.value));
    if (!this.isCommentary || !this.resource) return;
    const books = this.books;
    const book = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Book" } });
    for (const id of books) book.createEl("option", { value: String(id), text: this.bookName(id) });
    book.value = String(this.book ?? "");
    book.addEventListener("change", () => {
      this.book = Number(book.value);
      this.pending = null;
      this.app.workspace.requestSaveLayout();
      void this.load();
    });
    const chapters = [...new Set(this.notes.map((n) => n.chapter))];
    if (chapters.length < 2) return;
    const chapter = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Chapter" } });
    chapter.createEl("option", { value: "", text: "Chapter…" });
    for (const c of chapters) chapter.createEl("option", { value: String(c), text: c === 0 ? "Introduction" : String(c) });
    chapter.addEventListener("change", () => {
      this.bodyEl.querySelector(`[data-chapter="${chapter.value}"]`)?.scrollIntoView({ block: "start" });
      chapter.value = "";
    });
  }

  /** Every note on the book, under its chapter's heading; returns them and the book's passage */
  private async drawCommentary(el: HTMLElement): Promise<{ notes: Note[]; whole: Passage | null }> {
    const resource = this.resource!;
    const info = this.plugin.topos.books().find((b) => b.id === this.book);
    const whole = info ? this.plugin.topos.parse(`${info.name} 1-${Math.max(1, info.chapters)}`, bookStyle("name")) : null;
    const notes = whole ? await this.plugin.packages.notesIn(resource.dependency, whole, TEXT_OPTIONS) : [];
    if (!info || !whole || notes.length === 0) {
      el.createDiv({ cls: "topos-commentary-empty", text: `${resource.name} has no notes on ${info?.name ?? "this book"}.` });
      return { notes, whole };
    }
    el.createEl("h1", { cls: "topos-resource-title", text: `${resource.title || resource.name}: ${info.name}` });
    let chapter = -1;
    let section = el;
    for (const note of notes) {
      if (note.chapter !== chapter) {
        chapter = note.chapter;
        section = el.createDiv({ cls: "topos-resource-chapter", attr: { "data-chapter": String(chapter) } });
        section.createEl("h2", { text: chapter === 0 ? "Introduction" : `${info.name} ${chapter}` });
      }
      renderNote(this.plugin, section, note, info.name, whole, this, { open: this.openLink, link: false });
    }
    return { notes, whole };
  }

  /** Links each note's references and Strong's numbers as it nears the view (a whole book's notes are many) */
  private linkLazily(): void {
    const whole = this.whole;
    this.observer = new IntersectionObserver(
      (seen) => {
        for (const entry of seen) {
          if (!entry.isIntersecting) continue;
          this.observer?.unobserve(entry.target);
          const body = entry.target.querySelector<HTMLElement>(".topos-commentary-body");
          if (body) linkNote(this.plugin, body, whole, this, this.openLink);
        }
      },
      { root: this.bodyEl, rootMargin: "600px 0px" },
    );
    for (const el of this.noteEls) this.observer.observe(el);
  }

  /** A dictionary's keys, filtered, beside the entry picked */
  private async drawDictionary(el: HTMLElement): Promise<void> {
    const resource = this.resource!;
    const side = el.createDiv({ cls: "topos-resource-keys" });
    const filter = side.createEl("input", { cls: "topos-resource-filter", attr: { type: "search", placeholder: `Search ${resource.name}…`, spellcheck: "false" } });
    filter.value = this.query;
    const list = side.createDiv({ cls: "topos-resource-key-list" });
    const drawKeys = () => {
      list.empty();
      const { keys, more } = matchingKeys(this.keys, this.query, KEY_LIMIT);
      for (const key of keys) {
        const item = list.createDiv({ cls: "topos-resource-key", text: key });
        item.toggleClass("is-active", key === this.key);
        item.addEventListener("click", () => void this.showKey(key));
      }
      if (keys.length === 0) list.createDiv({ cls: "topos-commentary-empty", text: "Nothing matches." });
      if (more > 0) list.createDiv({ cls: "topos-commentary-meta", text: `${more} more: type to narrow them` });
    };
    filter.addEventListener("input", () => {
      this.query = filter.value;
      drawKeys();
    });
    filter.addEventListener("keydown", (e) => {
      const first = matchingKeys(this.keys, this.query, 1).keys[0];
      if (e.key === "Enter" && first) void this.showKey(first);
    });
    drawKeys();
    const entryEl = el.createDiv({ cls: "topos-resource-entry" });
    if (!this.key) {
      entryEl.createDiv({ cls: "topos-commentary-empty", text: `${this.keys.length} entries: pick one.` });
      return;
    }
    const found = await this.plugin.packages.entryIn(resource.dependency, this.key, TEXT_OPTIONS);
    renderEntries(entryEl, this.key, found ? [found] : []);
    for (const text of Array.from(entryEl.querySelectorAll<HTMLElement>(".topos-strongs-body"))) linkNote(this.plugin, text, null, this, this.openLink);
    // A double click on a Strong's number in the entry shows its entry here, when this dictionary has it
    entryEl.addEventListener("dblclick", (e) => {
      const key = (e.target as HTMLElement).closest<HTMLElement>("[data-strong]")?.dataset.strong;
      if (key && this.keys.includes(key)) void this.showKey(key);
    });
  }
}

/** Picks a commentary or dictionary to open in a tab */
export class ResourceModal extends SuggestModal<StudyResource> {
  constructor(
    app: App,
    private readonly resources: StudyResource[],
    private readonly chosen: (resource: StudyResource) => void,
  ) {
    super(app);
    this.setPlaceholder("Open which commentary or dictionary?");
  }

  getSuggestions(query: string): StudyResource[] {
    const q = query.toLowerCase();
    return this.resources.filter((r) => r.name.toLowerCase().includes(q) || r.title.toLowerCase().includes(q));
  }

  renderSuggestion(resource: StudyResource, el: HTMLElement): void {
    el.addClass("topos-suggestion");
    setIcon(el.createSpan({ cls: "topos-suggestion-icon" }), resource.kind === PackageKind.Lexicon ? "book-a" : "message-square-quote");
    const main = el.createDiv({ cls: "topos-suggestion-main" });
    main.createDiv({ cls: "topos-suggestion-label", text: resource.name });
    if (resource.title !== resource.name) main.createDiv({ cls: "topos-suggestion-text", text: resource.title });
    el.createSpan({ cls: "topos-suggestion-kind", text: resource.kind === PackageKind.Lexicon ? "Dictionary" : "Commentary" });
  }

  onChooseSuggestion(resource: StudyResource): void {
    this.chosen(resource);
  }
}
