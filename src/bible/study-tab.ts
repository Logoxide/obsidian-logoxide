import { setIcon, type HoverParent } from "obsidian";
import { PackageKind, type Passage } from "logoxide";
import { bookStyle } from "../core/settings.ts";
import { notedVerses, studyGroups, type NotesOf } from "../core/study.ts";
import type ToposPlugin from "../main.ts";
import { renderNote } from "./commentary.ts";
import type { CommentaryNotes } from "./packages.ts";
import type { BibleReader } from "./reader.ts";
import { strongsPopups } from "./strongs.ts";
import type { BibleView } from "./view.ts";

/** The Bible tab's sidebar tab of commentaries */
export const COMMENTARIES_TAB = "commentaries";

type Place = { chapter: number; verse: number };

/**
 * The *Commentaries* tab of a Bible tab's sidebar: the commentaries' notes on a verse, then on its
 * chapter as a whole, each by commentary. It shows the verse at the top of the text until one is
 * picked (a mark beside a verse, `showVerse`), and moves on when that verse leaves the view. Verses
 * commentaries have notes on get a mark in the margin (the `commentaryMarks` setting), drawn over
 * the text, so the text, its selections, and its links are left alone
 */
export class CommentariesTab {
  private readonly panel: HTMLElement;
  private reader: BibleReader | null = null;
  /** The book's notes, each commentary's, read once per reader */
  private notes: Promise<CommentaryNotes[]> | null = null;
  /** The verse shown */
  private verse: Place | null = null;
  /** Each render's number: a slower one that finishes after a newer one started is dropped */
  private rendering = 0;
  /** The marks beside verses, in the reader's scroller */
  private marksEl: HTMLElement | null = null;
  private off: (() => void)[] = [];
  private readonly offPopups: ReturnType<typeof strongsPopups>;

  constructor(
    private readonly view: BibleView,
    private readonly plugin: ToposPlugin,
  ) {
    this.panel = view.addSidebarTab(COMMENTARIES_TAB, "message-square-quote", "Commentaries", () => void this.shown());
    this.panel.addClass("topos-commentary", "topos-study-tab");
    this.offPopups = strongsPopups(this.panel, this.panel, {
      lookup: (key) => plugin.packages.entries(key, TEXT_OPTIONS),
      enabled: () => plugin.settings.strongsHover,
      click: true,
      container: this.panel.doc.body,
    });
  }

  private get hoverParent(): HoverParent {
    return this.view as unknown as HoverParent;
  }

  private get shownNow(): boolean {
    return this.view.sidebarTabShown(COMMENTARIES_TAB);
  }

  /** A new reader (another book, or the same one drawn again) */
  attach(reader: BibleReader): void {
    this.detach();
    const sameBook = this.reader?.bible.bookId === reader.bible.bookId;
    this.reader = reader;
    if (!sameBook) this.verse = null;
    const offRelocated = reader.on("relocated", () => void this.relocated());
    const resized = new ResizeObserver(() => this.placeMarks());
    resized.observe(reader.content);
    this.off.push(() => offRelocated?.(), () => resized.disconnect());
    void this.drawMarks();
    if (this.shownNow) void this.shown();
  }

  detach(): void {
    this.off.forEach((off) => off());
    this.off = [];
    this.marksEl?.remove();
    this.marksEl = null;
    this.notes = null;
  }

  destroy(): void {
    this.detach();
    this.offPopups();
  }

  /** The commentaries changed (installed, removed, or a setting): read and draw everything again */
  refresh(): void {
    this.notes = null;
    void this.drawMarks();
    if (this.shownNow) void this.render();
  }

  /** Opens the tab on a verse */
  showVerse(chapter: number, verse: number): void {
    this.verse = { chapter, verse };
    this.view.showSidebarTab(COMMENTARIES_TAB);
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
  private bookName(reader: BibleReader): string {
    return this.plugin.topos.books().find((b) => b.id === reader.bible.bookId)?.name ?? "";
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

  private passage(reader: BibleReader, reference: string): Passage | null {
    return this.plugin.topos.parse(`${this.bookName(reader)} ${reference}`, bookStyle("name"));
  }

  /** Draws the tab again: the verse's notes, then its chapter's */
  async render(): Promise<void> {
    const n = ++this.rendering;
    const reader = this.reader;
    const verse = this.verse;
    const el = createDiv();
    if (!reader || !verse) {
      el.createDiv({ cls: "topos-commentary-empty", text: "Scroll to a verse to read the commentaries on it." });
    } else if (!this.plugin.packages.hasKind(PackageKind.Commentary)) {
      el.createDiv({ cls: "topos-commentary-empty", text: "The vault has no commentaries yet: add one under Settings → Logoxide → Add Bibles." });
    } else {
      const notes = await this.bookNotes();
      if (n !== this.rendering || reader !== this.reader) return;
      const groups = studyGroups(notes, verse.chapter, verse.verse, reader.lastVerse(verse.chapter));
      const onVerse = this.passage(reader, `${verse.chapter}:${verse.verse}`);
      const onChapter = this.passage(reader, `${verse.chapter}`);
      const head = el.createDiv({ cls: "topos-study-head" });
      head.createEl("h4", { cls: "topos-commentary-passage", text: onVerse?.reference ?? `${verse.chapter}:${verse.verse}` });
      this.group(el, `On ${onVerse?.reference ?? "this verse"}`, groups.verse, onVerse, `No commentary has a note on ${onVerse?.reference ?? "this verse"}.`);
      this.group(el, `On ${onChapter?.reference ?? "the chapter"} as a whole`, groups.chapter, onChapter, null);
    }
    if (n !== this.rendering) return;
    this.offPopups.hide();
    this.panel.replaceChildren(...Array.from(el.childNodes));
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

  /** Puts each mark beside its verse's number, at the text's right edge */
  private placeMarks(): void {
    const reader = this.reader;
    const layer = this.marksEl;
    if (!reader || !layer) return;
    const box = reader.scroller.getBoundingClientRect();
    const text = reader.content.getBoundingClientRect();
    const size = 18;
    const left = Math.min(text.right - box.left + 2, reader.scroller.clientWidth - size - 2);
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

