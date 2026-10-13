import { setIcon, type HoverParent } from "obsidian";
import { PackageKind, type Passage } from "logoxide";
import { bookStyle } from "../core/settings.ts";
import { notedVerses, studyGroups, weightLabel, type NotesOf } from "../core/study.ts";
import type ToposPlugin from "../main.ts";
import { linkPassage, renderNote } from "./commentary.ts";
import type { Bible } from "../core/bibles.ts";
import type { CommentaryNotes } from "./packages.ts";
import type { BibleReader } from "./reader.ts";
import { markStrongs, renderEntries, strongsPopups } from "./strongs.ts";
import { wordStrongs } from "../core/strongs.ts";
import type { BibleView } from "./view.ts";

/** The Bible tab's sidebar tabs */
export const COMMENTARIES_TAB = "commentaries";
export const CROSS_REFERENCES_TAB = "cross-references";

export type Place = { chapter: number; verse: number };

/**
 * A tab of a Bible tab's sidebar about a verse. It shows the verse at the top of the text until one
 * is picked (`showVerse`), and moves on when that verse leaves the view
 */
abstract class VerseTab {
  protected readonly panel: HTMLElement;
  protected reader: BibleReader | null = null;
  /** The verse shown */
  protected verse: Place | null = null;
  /** Each render's number: a slower one that finishes after a newer one started is dropped */
  protected rendering = 0;
  protected off: (() => void)[] = [];
  private readonly offPopups: ReturnType<typeof strongsPopups>;

  constructor(
    protected readonly view: BibleView,
    protected readonly plugin: ToposPlugin,
    private readonly id: string,
    icon: string,
    label: string,
  ) {
    this.panel = view.addSidebarTab(id, icon, label, () => void this.shown());
    this.panel.addClass("topos-commentary", "topos-study-tab");
    this.offPopups = strongsPopups(this.panel, this.panel, {
      lookup: (key) => plugin.packages.entries(key, TEXT_OPTIONS),
      enabled: () => plugin.settings.strongsHover,
      click: true,
      container: this.panel.doc.body,
    });
  }

  protected get hoverParent(): HoverParent {
    return this.view as unknown as HoverParent;
  }

  protected get shownNow(): boolean {
    return this.view.sidebarTabShown(this.id);
  }

  /** A new reader (another book, or the same one drawn again) */
  attach(reader: BibleReader): void {
    this.detach();
    const sameBook = this.reader?.bible.bookId === reader.bible.bookId;
    this.reader = reader;
    if (!sameBook) this.verse = null;
    const offRelocated = reader.on("relocated", () => void this.relocated());
    this.off.push(() => offRelocated?.());
    if (this.shownNow) void this.shown();
  }

  detach(): void {
    this.off.forEach((off) => off());
    this.off = [];
  }

  destroy(): void {
    this.detach();
    this.offPopups();
  }

  /** What the tab shows changed (packages installed or removed, a setting): draws it again */
  refresh(): void {
    if (this.shownNow) void this.render();
  }

  /** Opens the tab on a verse */
  showVerse(chapter: number, verse: number): void {
    this.verse = { chapter, verse };
    this.view.showSidebarTab(this.id);
    void this.render();
  }

  /** The tab came into view: on the verse at the top, unless one is shown */
  private async shown(): Promise<void> {
    this.verse ??= this.reader?.verseInView() ?? null;
    await this.render();
  }

  /** The text scrolled: the verse at the top, once the one shown is out of view */
  private async relocated(): Promise<void> {
    const reader = this.reader;
    if (!reader || !this.shownNow) return;
    if (this.verse && reader.verseShown(this.verse.chapter, this.verse.verse)) return;
    const top = reader.verseInView();
    if (!top || (top.chapter === this.verse?.chapter && top.verse === this.verse.verse)) return;
    this.verse = top;
    await this.render();
  }

  /** The book's name, as topos names it */
  protected bookName(reader: BibleReader): string {
    return this.plugin.topos.books().find((b) => b.id === reader.bible.bookId)?.name ?? "";
  }

  protected passage(reader: BibleReader, reference: string): Passage | null {
    return this.plugin.topos.parse(`${this.bookName(reader)} ${reference}`, bookStyle("name"));
  }

  /** Draws the tab again, from `build`; a newer render meanwhile wins */
  async render(): Promise<void> {
    const n = ++this.rendering;
    const el = createDiv();
    const current = () => n === this.rendering;
    await this.build(el, current);
    if (!current()) return;
    this.offPopups.hide();
    this.panel.replaceChildren(...Array.from(el.childNodes));
  }

  /** What the tab shows, into `el` (`current`: false once a newer render started) */
  protected abstract build(el: HTMLElement, current: () => boolean): Promise<void>;

  /** The verse shown, as a heading */
  protected heading(el: HTMLElement, reader: BibleReader, verse: Place): Passage | null {
    const passage = this.passage(reader, `${verse.chapter}:${verse.verse}`);
    el.createDiv({ cls: "topos-study-head" }).createEl("h4", { cls: "topos-commentary-passage", text: passage?.reference ?? `${verse.chapter}:${verse.verse}` });
    return passage;
  }
}

/**
 * The *Commentaries* tab: the commentaries' notes on a verse, then on its chapter as a whole, each
 * by commentary. Verses commentaries have notes on get a mark in the margin (the `commentaryMarks`
 * setting), drawn over the text, so the text, its selections, and its links are left alone
 */
export class CommentariesTab extends VerseTab {
  /** The book's notes, each commentary's, read once per reader */
  private notes: Promise<CommentaryNotes[]> | null = null;
  /** The marks beside verses, in the reader's scroller */
  private marksEl: HTMLElement | null = null;

  constructor(view: BibleView, plugin: ToposPlugin) {
    super(view, plugin, COMMENTARIES_TAB, "message-square-quote", "Commentaries");
  }

  override attach(reader: BibleReader): void {
    super.attach(reader);
    const resized = new ResizeObserver(() => this.placeMarks());
    resized.observe(reader.content);
    this.off.push(() => resized.disconnect());
    void this.drawMarks();
  }

  override detach(): void {
    super.detach();
    this.marksEl?.remove();
    this.marksEl = null;
    this.notes = null;
  }

  override refresh(): void {
    this.notes = null;
    void this.drawMarks();
    super.refresh();
  }

  /** The notes of every commentary on the open book */
  private bookNotes(): Promise<CommentaryNotes[]> {
    const reader = this.reader;
    if (!reader || !this.plugin.packages.hasKind(PackageKind.Commentary)) return Promise.resolve([]);
    if (!this.notes) {
      const whole = this.plugin.topos.parse(`${this.bookName(reader)} 1-${Math.max(1, reader.lastChapter())}`, bookStyle("name"));
      this.notes = whole ? this.plugin.packages.commentaryNotes(whole, TEXT_OPTIONS) : Promise.resolve([]);
    }
    return this.notes;
  }

  /** The verse's notes, then its chapter's */
  protected async build(el: HTMLElement, current: () => boolean): Promise<void> {
    const reader = this.reader;
    const verse = this.verse;
    if (!reader || !verse) {
      el.createDiv({ cls: "topos-commentary-empty", text: "Scroll to a verse to read the commentaries on it." });
    } else if (!this.plugin.packages.hasKind(PackageKind.Commentary)) {
      el.createDiv({ cls: "topos-commentary-empty", text: "The vault has no commentaries yet: add one under Settings → Logoxide → Add Bibles." });
    } else {
      const notes = await this.bookNotes();
      if (!current() || reader !== this.reader) return;
      const groups = studyGroups(notes, verse.chapter, verse.verse, reader.lastVerse(verse.chapter), this.plugin.settings.stretchNotes);
      const onVerse = this.heading(el, reader, verse);
      const onChapter = this.passage(reader, `${verse.chapter}`);
      this.group(el, `On ${onVerse?.reference ?? "this verse"}`, groups.verse, onVerse, `No commentary has a note on ${onVerse?.reference ?? "this verse"}.`);
      this.group(el, `On ${onChapter?.reference ?? "the chapter"} as a whole`, groups.chapter, onChapter, null);
    }
  }

  /** A heading, then each commentary's notes under its name (folding away) */
  private group(el: HTMLElement, heading: string, commentaries: NotesOf<CommentaryNotes["notes"][number]>[], shown: Passage | null, empty: string | null): void {
    if (commentaries.length === 0 && empty === null) return;
    const section = el.createDiv({ cls: "topos-commentary-section topos-study-group" });
    section.createDiv({ cls: "topos-commentary-heading", text: heading });
    if (commentaries.length === 0) section.createDiv({ cls: "topos-commentary-empty", text: empty ?? "" });
    const book = this.reader ? this.bookName(this.reader) : "";
    for (const { commentary, title, notes } of commentaries) {
      const details = section.createEl("details", { cls: "topos-study-commentary", attr: { open: "" } });
      const summary = details.createEl("summary");
      summary.createSpan({ cls: "topos-commentary-name", text: commentary });
      if (title && title !== commentary) summary.createSpan({ cls: "topos-commentary-meta", text: ` ${title}` });
      for (const note of notes) if (shown) renderNote(this.plugin, details, note, book, shown, this.hoverParent);
    }
  }

  // Marks beside verses

  /** Draws (or takes away) the marks beside verses commentaries have notes on */
  private async drawMarks(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    const verses = this.plugin.settings.commentaryMarks ? notedVerses(await this.bookNotes()) : new Set<string>();
    if (reader !== this.reader) return;
    this.marksEl?.remove();
    this.marksEl = null;
    if (verses.size === 0) return;
    const layer = (this.marksEl = reader.doc.createElement("div"));
    layer.className = "topos-note-marks";
    for (const m of reader.verseMarkers()) {
      if (!verses.has(`${m.chapter}:${m.verse}`)) continue;
      const mark = reader.doc.createElement("div");
      mark.className = "topos-note-mark";
      mark.dataset.chapter = String(m.chapter);
      mark.dataset.verse = String(m.verse);
      mark.setAttribute("aria-label", `Commentaries on ${m.chapter}:${m.verse}`);
      mark.setAttribute("role", "button");
      setIcon(mark, "message-square-quote");
      layer.append(mark);
    }
    // Over the text: a press neither selects nor reaches the reader's own clicks (highlights)
    layer.addEventListener("mousedown", (e) => e.preventDefault());
    layer.addEventListener("click", (e) => {
      const mark = (e.target as Element).closest?.<HTMLElement>(".topos-note-mark");
      if (!mark) return;
      e.stopPropagation();
      this.showVerse(Number(mark.dataset.chapter), Number(mark.dataset.verse));
    });
    reader.scroller.append(layer);
    this.placeMarks();
  }

  /** Puts each mark beside its verse's number, at the text's right edge (before comments in the margin) */
  private placeMarks(): void {
    const reader = this.reader;
    const layer = this.marksEl;
    if (!reader || !layer) return;
    const box = reader.scroller.getBoundingClientRect();
    const content = reader.content.getBoundingClientRect();
    // At the text's edge, in its padding: comments in the margin start 20px after it (file-plus-plus's Margin)
    const textRight = content.right - (parseFloat(reader.content.ownerDocument.defaultView?.getComputedStyle(reader.content).paddingRight ?? "") || 0);
    const size = 18;
    const left = Math.min(textRight - box.left + 1, reader.scroller.clientWidth - size - 2);
    let lastTop = -Infinity;
    let shift = 0;
    for (const mark of Array.from(layer.children) as HTMLElement[]) {
      const at = reader.markerOf(Number(mark.dataset.chapter), Number(mark.dataset.verse))?.getBoundingClientRect();
      if (!at) continue;
      const top = at.top - box.top + reader.scroller.scrollTop - 2;
      // Two verses on a line: side by side
      shift = Math.abs(top - lastTop) < size / 2 ? shift + size : 0;
      lastTop = top;
      mark.style.top = `${top}px`;
      mark.style.left = `${left - shift}px`;
    }
  }
}

const TEXT_OPTIONS = { notes: false, headings: false, classPrefix: "topos-" };


/** How many cross-references a package's list shows before *Show all* */
const FIRST_REFERENCES = 25;

/**
 * The *Cross-references* tab: each cross-reference package's lines from a verse, the strongest
 * first, with the text of each in the tab's Bible
 */
export class CrossReferencesTab extends VerseTab {
  constructor(view: BibleView, plugin: ToposPlugin) {
    super(view, plugin, CROSS_REFERENCES_TAB, "git-compare-arrows", "Cross-references");
  }

  protected async build(el: HTMLElement, current: () => boolean): Promise<void> {
    const reader = this.reader;
    const verse = this.verse;
    if (!reader || !verse) {
      el.createDiv({ cls: "topos-commentary-empty", text: "Scroll to a verse to see its cross-references." });
      return;
    }
    if (!this.plugin.packages.hasKind(PackageKind.CrossReferences)) {
      el.createDiv({ cls: "topos-commentary-empty", text: "The vault has no cross-references yet: add a package of them under Settings → Logoxide → Add Bibles." });
      return;
    }
    const passage = this.heading(el, reader, verse);
    if (!passage) return;
    const lists = await this.plugin.packages.crossReferences(passage.osis);
    if (!current() || reader !== this.reader) return;
    if (lists.length === 0) el.createDiv({ cls: "topos-commentary-empty", text: `No cross-references from ${passage.reference}.` });
    for (const { name, title, references } of lists) {
      const details = el.createEl("details", { cls: "topos-study-commentary topos-study-xrefs", attr: { open: "" } });
      const summary = details.createEl("summary");
      summary.createSpan({ cls: "topos-commentary-name", text: name });
      summary.createSpan({ cls: "topos-commentary-meta", text: ` ${title && title !== name ? `${title} · ` : ""}${references.length}` });
      const list = details.createEl("ul", { cls: "topos-study-xref-list" });
      const sorted = byWeight(references);
      // The text in the tab's own Bible (another may have its name)
      const bible = this.view.file ? this.plugin.bibles.ofFile(this.view.file.path) : null;
      const show = (from: number, to: number) => {
        for (const ref of sorted.slice(from, to)) this.reference(list, ref.to, ref.weight, bible);
      };
      show(0, FIRST_REFERENCES);
      if (sorted.length > FIRST_REFERENCES) {
        const more = details.createEl("button", { cls: "topos-study-more", text: `Show all ${sorted.length}` });
        more.addEventListener("click", () => {
          show(FIRST_REFERENCES, sorted.length);
          more.remove();
        });
      }
    }
  }

  /** A cross-reference: a link to it, its weight, and its text (filled in when read) */
  private reference(list: HTMLElement, to: string, weight: number | null, bible: Bible | null): void {
    const target = this.plugin.topos.parse(to, bookStyle(this.plugin.settings.style));
    const li = list.createEl("li");
    const head = li.createDiv({ cls: "topos-study-xref-head" });
    const link = head.createSpan({ cls: "topos-commentary-ref", text: target?.reference ?? to });
    const shown = weightLabel(weight);
    if (shown) head.createSpan({ cls: "topos-commentary-meta", text: ` ${shown}` });
    if (!target) return;
    linkPassage(this.plugin, link, target, this.hoverParent);
    const text = li.createDiv({ cls: "topos-study-xref-text" });
    void this.plugin.bibles.textIn(target, bible, this.reader?.bible.bible || null).then((words) => {
      if (words) text.setText(words);
      else text.remove();
    });
  }
}

/** Cross-references, the strongest first (those without a weight keep their order, after) */
function byWeight<T extends { weight: number | null }>(references: readonly T[]): T[] {
  return references
    .map((ref, i) => ({ ref, i }))
    .sort((a, b) => (b.ref.weight ?? -Infinity) - (a.ref.weight ?? -Infinity) || a.i - b.i)
    .map(({ ref }) => ref);
}

export const LANGUAGE_TAB = "language";

/** A word of a verse that carries Strong's numbers, and its text */
interface TaggedWord {
  el: HTMLElement;
  text: string;
  keys: string[];
}

/**
 * The *Language tools* tab: each word of a verse whose markup names its Strong's numbers, with the
 * vault's dictionary entries for them (read when a word is opened). `showWord` opens it on a word
 */
export class LanguageTab extends VerseTab {
  /** A word to open and scroll to (in its verse) */
  private word: HTMLElement | null = null;

  constructor(view: BibleView, plugin: ToposPlugin) {
    super(view, plugin, LANGUAGE_TAB, "languages", "Language tools");
  }

  /** Opens the tab on a word's verse, the word open */
  showWord(word: HTMLElement): void {
    const verse = this.reader?.verseOf(word);
    if (!verse) return;
    this.word = word;
    this.showVerse(verse.chapter, verse.verse);
  }

  /** The words of a verse that carry Strong's numbers, in order */
  private words(reader: BibleReader, verse: Place): TaggedWord[] {
    const range = reader.versesRange({ chapter: verse.chapter, verse: verse.verse, endChapter: verse.chapter, endVerse: verse.verse });
    if (!range) return [];
    const words: TaggedWord[] = [];
    for (const el of Array.from(reader.content.querySelectorAll<HTMLElement>("[data-strong]"))) {
      if (!range.intersectsNode(el) || el.closest(".topos-note")) continue;
      const keys = wordStrongs(el.dataset.strong);
      const text = (el.textContent ?? "").trim();
      if (keys.length > 0 && text) words.push({ el, text, keys });
    }
    return words;
  }

  protected async build(el: HTMLElement): Promise<void> {
    const reader = this.reader;
    const verse = this.verse;
    if (!reader || !verse) {
      el.createDiv({ cls: "topos-commentary-empty", text: "Scroll to a verse to look up its words." });
      return;
    }
    const passage = this.heading(el, reader, verse);
    const words = this.words(reader, verse);
    if (words.length === 0) {
      el.createDiv({ cls: "topos-commentary-empty", text: `This Bible's text of ${passage?.reference ?? "this verse"} names no Strong's numbers. A Bible tagged with them (the KJV with Strong's, for one) gives each word's entry.` });
      return;
    }
    if (!this.plugin.packages.hasStrongs()) {
      el.createDiv({ cls: "topos-commentary-empty", text: "The vault has no Strong's dictionaries yet: add one under Settings → Logoxide → Add Bibles." });
    }
    const list = el.createDiv({ cls: "topos-study-words" });
    // The word asked for (`showWord`), while its verse is the one shown
    const wanted = this.word;
    let opened: HTMLElement | null = null;
    for (const word of words) {
      const details = list.createEl("details", { cls: "topos-study-word" });
      const summary = details.createEl("summary");
      summary.createSpan({ cls: "topos-study-word-text", text: word.text });
      summary.createSpan({ cls: "topos-commentary-meta", text: ` ${word.keys.join(" ")}` });
      const body = details.createDiv({ cls: "topos-study-word-entries" });
      let read = false;
      details.addEventListener("toggle", () => {
        if (!details.open || read) return;
        read = true;
        body.setText("…");
        void Promise.all(word.keys.map(async (key) => ({ key, entries: await this.plugin.packages.entries(key, TEXT_OPTIONS) }))).then((found) => {
          body.empty();
          for (const { key, entries } of found) renderEntries(body.createDiv(), key, entries);
          for (const text of Array.from(body.querySelectorAll<HTMLElement>(".topos-strongs-body"))) markStrongs(text);
        });
      });
      // Its word in the text, on hover
      summary.addEventListener("mouseenter", () => word.el.classList.add("topos-word-shown"));
      summary.addEventListener("mouseleave", () => word.el.classList.remove("topos-word-shown"));
      if (word.el === wanted) {
        details.open = true;
        opened = details;
      }
    }
    if (opened) {
      const target = opened;
      window.setTimeout(() => target.scrollIntoView({ block: "nearest" }), 0);
    }
  }
}
