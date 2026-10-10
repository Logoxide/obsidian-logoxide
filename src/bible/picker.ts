import { Keymap, Modal, Notice, Platform, setIcon, type PaneType } from "obsidian";
import { BookStyle, type BookInfo, type Passage } from "logoxide";
import type { Bible } from "../core/bibles.ts";
import { bookMatches, byTestament, parseTypedNumber, parseTypedPlace, TESTAMENT_NAMES, testamentOf, tileLabel, type TestamentName } from "../core/picker.ts";
import type ToposPlugin from "../main.ts";
import { activeBibleView } from "./parallel.ts";

/** The genres that color the book tiles, in order: topos's, one per book */
const GENRES = ["Pentateuch", "History", "Wisdom And Poetry", "Major Prophets", "Minor Prophets", "Gospels And Acts", "Pauline Epistles", "General Epistles"];

type Step = "testament" | "book" | "chapter" | "verse";

export interface PickerOptions {
  /** What the dialog is for, its title: `Go to a passage` */
  action: string;
  /** The Bible whose books are shown as there (others are faded), if any */
  bible: Bible | null;
  /** The book and chapter open now, marked in the grids */
  current?: { bookId: number; chapter: number | null } | null;
  /** The passage chosen, and where to open it (a new tab with Ctrl/Cmd) */
  chosen: (passage: Passage, newLeaf: PaneType | boolean) => void;
}

/**
 * Picks a book, chapter, and verse by tapping: every book at once (or the Old or New Testament's,
 * after choosing it, with the `pickerTestament` setting), then a chapter and a verse from a grid or
 * typed on the number pad (`pickerNumbers`), the verse only with `pickerVerse`. On a keyboard, typing
 * picks too: a book's first letters, a number, Enter, and Backspace to go back
 */
export class PassagePickerModal extends Modal {
  private step: Step;
  private testament: TestamentName | null = null;
  private book: BookInfo | null = null;
  private chapter: number | null = null;
  /** What's been typed on this step (book letters, or digits in a grid) */
  private typed = "";
  private readonly books: BookInfo[];
  private readonly genres = new Map<number, number>();
  private bodyEl!: HTMLElement;
  private crumbsEl!: HTMLElement;
  private backButton!: HTMLElement;

  constructor(
    private readonly plugin: ToposPlugin,
    private readonly options: PickerOptions,
  ) {
    super(plugin.app);
    this.books = plugin.topos.books();
    this.step = plugin.settings.pickerTestament ? "testament" : "book";
    const genres = plugin.topos.genres();
    GENRES.forEach((name, i) => {
      for (const id of genres.find((g) => g.name === name)?.bookIds ?? []) if (!this.genres.has(id)) this.genres.set(id, i);
    });
    // A book topos doesn't place goes with the one before it (Song of Songs, after Ecclesiastes)
    let last = 0;
    for (const book of this.books) last = this.genres.get(book.id) ?? (this.genres.set(book.id, last), last);
  }

  onOpen(): void {
    this.modalEl.addClass("topos-picker");
    this.titleEl.empty();
    const header = this.titleEl.createDiv("topos-picker-header");
    this.backButton = header.createEl("button", { cls: "clickable-icon topos-picker-back", attr: { "aria-label": "Back" } });
    setIcon(this.backButton, "chevron-left");
    this.backButton.addEventListener("click", () => this.back());
    this.crumbsEl = header.createDiv("topos-picker-crumbs");
    if (this.options.bible) header.createSpan({ cls: "topos-picker-bible", text: this.options.bible.name });
    this.bodyEl = this.contentEl.createDiv("topos-picker-body");
    this.modalEl.addEventListener("keydown", (e) => this.onKey(e));
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private get numbers(): "grid" | "keypad" {
    return this.plugin.settings.pickerNumbers;
  }

  /** How many verses a chapter of the chosen book has (topos's counts: the KJV's) */
  private verses(chapter: number): number {
    const passage = this.book ? this.plugin.topos.parse(`${this.book.name} ${chapter}`, BookStyle.Name) : null;
    return passage ? this.plugin.topos.verses(passage).length : 0;
  }

  private go(step: Step): void {
    this.step = step;
    this.typed = "";
    this.render();
  }

  private back(): void {
    const steps: Step[] = ["testament", "book", "chapter", "verse"];
    let i = steps.indexOf(this.step) - 1;
    // A one-chapter book has no chapter step, and without the testament step the books come first
    if (steps[i] === "chapter" && this.book?.chapters === 1) i--;
    if (steps[i] === "testament" && !this.plugin.settings.pickerTestament) i--;
    if (i < 0) return;
    this.go(steps[i]!);
  }

  private canGoBack(): boolean {
    return this.step !== (this.plugin.settings.pickerTestament ? "testament" : "book");
  }

  private render(): void {
    this.renderCrumbs();
    this.backButton.toggleClass("topos-hidden", !this.canGoBack());
    this.bodyEl.empty();
    this.bodyEl.dataset.step = this.step;
    if (this.step === "testament") this.renderTestaments();
    else if (this.step === "book") this.renderBooks();
    else if (this.step === "chapter") this.renderNumbers(this.book!.chapters, "Chapter");
    else this.renderNumbers(this.verses(this.chapter!), "Verse");
  }

  /** `Go to · New Testament › John › 3`, each part going back to it */
  private renderCrumbs(): void {
    const el = this.crumbsEl;
    el.empty();
    const crumb = (text: string, step: Step | null) => {
      if (el.childElementCount > 0) el.createSpan({ cls: "topos-picker-sep", text: "›" });
      const span = el.createSpan({ cls: "topos-picker-crumb", text });
      if (step && step !== this.step) {
        span.addClass("is-link");
        span.addEventListener("click", () => this.go(step));
      }
    };
    if (this.step === "testament" || (this.step === "book" && !this.testament)) crumb(this.options.action, null);
    if (this.testament) crumb(TESTAMENT_NAMES[this.testament], "book");
    if (this.book && this.step !== "book") crumb(this.book.name, this.book.chapters > 1 ? "chapter" : null);
    if (this.chapter !== null && this.step === "verse" && this.book!.chapters > 1) crumb(`Chapter ${this.chapter}`, null);
    if (this.typed && this.step === "book") el.createSpan({ cls: "topos-picker-typed", text: this.typed });
  }

  private renderTestaments(): void {
    const grid = this.bodyEl.createDiv("topos-picker-testaments");
    const groups = byTestament(this.books);
    for (const name of ["old", "new"] as const) {
      const books = groups[name];
      if (books.length === 0) continue;
      const button = grid.createEl("button", { cls: "topos-picker-testament" });
      if (this.options.current && testamentOf(this.options.current.bookId) === name) button.addClass("is-current");
      button.createDiv({ cls: "topos-picker-testament-name", text: TESTAMENT_NAMES[name] });
      button.createDiv({ cls: "topos-picker-testament-books", text: `${books[0]!.name} – ${books[books.length - 1]!.name} · ${books.length} books` });
      button.addEventListener("click", () => {
        this.testament = name;
        this.go("book");
      });
    }
    this.focusBody();
  }

  private renderBooks(): void {
    const groups = byTestament(this.books);
    const shown = this.testament ? [this.testament] : (["old", "new"] as const).filter((t) => groups[t].length > 0);
    const roomy = this.testament !== null;
    for (const testament of shown) {
      const section = this.bodyEl.createDiv("topos-picker-group");
      if (!roomy) section.createDiv({ cls: "topos-picker-group-name", text: TESTAMENT_NAMES[testament] });
      const grid = section.createDiv({ cls: `topos-picker-grid topos-picker-books ${roomy ? "is-roomy" : "is-compact"}` });
      for (const book of groups[testament]) {
        const tile = grid.createEl("button", {
          cls: "topos-picker-tile",
          text: roomy ? book.name : tileLabel(book),
          attr: { "aria-label": book.name, "data-genre": String(this.genres.get(book.id) ?? 0), "data-id": String(book.id) },
        });
        if (!this.has(book)) {
          tile.addClass("is-missing");
          tile.setAttr("aria-label", `${book.name} (not in ${this.options.bible?.name ?? "this Bible"})`);
        }
        if (book.id === this.options.current?.bookId) tile.addClass("is-current");
        tile.addEventListener("click", (e) => this.pickBook(book, e));
      }
    }
    this.markTyped();
    this.focusBody();
  }

  /** Whether the Bible has the book (any book, without a Bible, or while some files' books aren't known yet) */
  private has(book: BookInfo): boolean {
    const bible = this.options.bible;
    return !bible || bible.books.has(book.id) || bible.unknown.length > 0;
  }

  private pickBook(book: BookInfo, e?: MouseEvent | KeyboardEvent): void {
    this.book = book;
    this.chapter = null;
    if (book.chapters > 1) return this.go("chapter");
    this.chapter = 1;
    if (this.plugin.settings.pickerVerse) this.go("verse");
    else this.finish(null, e);
  }

  /** A grid of 1 to `count`, or a field for the number pad */
  private renderNumbers(count: number, what: "Chapter" | "Verse"): void {
    const current = this.options.current;
    const here = what === "Chapter" && current && current.bookId === this.book?.id ? current.chapter : null;
    const pick = (n: number, e?: MouseEvent | KeyboardEvent) => {
      if (what === "Verse") return this.finish(n, e);
      this.chapter = n;
      if (this.plugin.settings.pickerVerse) this.go("verse");
      else this.finish(null, e);
    };
    if (this.numbers === "keypad") return this.renderKeypad(count, what, pick);
    const grid = this.bodyEl.createDiv("topos-picker-grid topos-picker-numbers");
    for (let n = 1; n <= count; n++) {
      const tile = grid.createEl("button", { cls: "topos-picker-tile", text: String(n), attr: { "data-n": String(n) } });
      if (n === here) tile.addClass("is-current");
      tile.addEventListener("click", (e) => pick(n, e));
    }
    if (what === "Verse") {
      const whole = this.bodyEl.createEl("button", { cls: "topos-picker-whole", text: `Start of chapter ${this.chapter}` });
      whole.addEventListener("click", (e) => this.finish(null, e));
    }
    this.markTyped();
    this.focusBody();
  }

  /**
   * A field that brings up the number pad on a phone, for a chapter (or a chapter and verse at once,
   * `3:16` or `3.16`), or a verse
   */
  private renderKeypad(count: number, what: "Chapter" | "Verse", pick: (n: number, e?: KeyboardEvent | MouseEvent) => void): void {
    const both = what === "Chapter" && this.plugin.settings.pickerVerse;
    const form = this.bodyEl.createEl("form", { cls: "topos-picker-keypad" });
    const label = form.createEl("label", { cls: "topos-picker-keypad-label", text: `${what} (1–${count})` });
    const row = form.createDiv("topos-picker-keypad-row");
    const input = row.createEl("input", {
      type: "text",
      cls: "topos-picker-keypad-input",
      attr: {
        // A decimal pad has a point, for `3.16`
        inputmode: both ? "decimal" : "numeric",
        enterkeyhint: "go",
        autocomplete: "off",
        placeholder: both ? "3 or 3:16" : "1",
        "aria-label": label.textContent ?? what,
      },
    });
    row.createEl("button", { cls: "mod-cta", text: "Go", attr: { type: "submit" } });
    const error = form.createDiv("topos-picker-keypad-error");
    if (both) form.createDiv({ cls: "topos-picker-keypad-hint", text: "A chapter, or a chapter and verse." });
    let submitting: KeyboardEvent | MouseEvent | undefined;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitting = e;
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value;
      if (what === "Chapter") {
        const place = parseTypedPlace(text, count, (c) => this.verses(c));
        if (!place) return void (error.textContent = this.problem(text, count));
        if (place.verse === null) return pick(place.chapter, submitting);
        this.chapter = place.chapter;
        return this.finish(place.verse, submitting);
      }
      const n = parseTypedNumber(text, count);
      if (n === null) error.textContent = this.problem(text, count);
      else pick(n, submitting);
    });
    input.addEventListener("input", () => (error.textContent = ""));
    // Focused right away, in the tap that got here, so a phone opens its keyboard
    input.focus();
  }

  private problem(text: string, count: number): string {
    if (!text.trim()) return "Type a number.";
    const book = this.book!.name;
    if (this.step === "verse") return `${book} ${this.chapter} has ${count} verses.`;
    const verse = /\d\s*[:.,\s]\s*\d/.test(text) && parseTypedPlace(text, count, () => Infinity);
    if (verse) return `${book} ${verse.chapter} has ${this.verses(verse.chapter)} verses.`;
    return count === 1 ? `${book} has one chapter.` : `${book} has ${count} chapters.`;
  }

  /** Keyboard focus on the dialog's grid, so typing picks (not on a phone, whose keyboard would open) */
  private focusBody(): void {
    if (Platform.isMobile) return;
    this.bodyEl.tabIndex = -1;
    this.bodyEl.focus();
  }

  /** Typing in a grid: a book's first letters, or a number; Enter picks the first marked, Backspace erases or goes back */
  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.step === "testament") {
      const pick = { o: "old", n: "new" }[e.key.toLowerCase()] as TestamentName | undefined;
      if (!pick) return;
      e.preventDefault();
      this.testament = pick;
      this.go("book");
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (this.typed) this.setTyped(this.typed.slice(0, -1));
      else this.back();
      return;
    }
    if (e.key === "Enter") {
      const first = this.bodyEl.querySelector<HTMLElement>(".topos-picker-tile.is-match");
      if (!this.typed || !first) return;
      e.preventDefault();
      first.dispatchEvent(new MouseEvent("click", { ctrlKey: e.ctrlKey, metaKey: e.metaKey }));
      return;
    }
    const books = this.step === "book";
    if (e.key.length !== 1 || (books ? !/[\p{L}\p{N} ]/u.test(e.key) : !/\d/.test(e.key))) return;
    e.preventDefault();
    this.setTyped(this.typed + e.key);
  }

  private setTyped(typed: string): void {
    this.typed = typed;
    this.markTyped();
    if (this.step === "book") this.renderCrumbs();
  }

  /** Marks the tiles what's typed picks out, fading the rest; one book left is picked */
  private markTyped(): void {
    const tiles = [...this.bodyEl.querySelectorAll<HTMLElement>(".topos-picker-tile")];
    const typed = this.typed;
    this.bodyEl.toggleClass("is-typing", typed !== "");
    const matches: HTMLElement[] = [];
    for (const tile of tiles) {
      const match = typed !== "" && (this.step === "book" ? bookMatches(this.books.find((b) => String(b.id) === tile.dataset.id)!, typed) : tile.dataset.n === typed);
      tile.toggleClass("is-match", match);
      if (match) matches.push(tile);
    }
    if (this.step === "book" && matches.length === 1 && typed.length >= 2) matches[0]!.click();
    else matches[0]?.scrollIntoView({ block: "nearest" });
  }

  /** Opens (or inserts) the chosen book and chapter, at a verse or the chapter's start */
  private finish(verse: number | null, e?: MouseEvent | KeyboardEvent): void {
    const book = this.book!;
    const chapter = this.chapter ?? 1;
    const text = verse !== null ? `${book.name} ${chapter}:${verse}` : `${book.name} ${chapter}`;
    const passage = this.plugin.topos.parse(text, BookStyle.Name);
    if (!passage) {
      new Notice(`Couldn't read ${text}.`);
      return;
    }
    this.close();
    this.options.chosen(passage, e ? Keymap.isModEvent(e) : false);
  }
}

/** The Bible to pick in, and where the reader is: the Bible tab in front, else the Bible references open in */
function pickerContext(plugin: ToposPlugin): Pick<PickerOptions, "bible" | "current"> {
  const view = activeBibleView(plugin);
  const bible = (view?.file ? plugin.bibles.ofFile(view.file.path) : null) ?? plugin.bibles.current();
  const bookId = view?.reader?.bible.bookId;
  return { bible, current: bookId ? { bookId, chapter: view?.reader?.verseInView()?.chapter ?? null } : null };
}

/** Opens a passage in a Bible's tab: the one picked in, else the link site when that Bible lacks the book */
async function openIn(plugin: ToposPlugin, bible: Bible | null, passage: Passage, newLeaf: PaneType | boolean): Promise<void> {
  const file = bible ? await plugin.bibles.bookFile(passage, bible) : null;
  if (file) await plugin.openDocument(file, plugin.passageLocator(passage), newLeaf);
  else plugin.openReference(passage);
}

/** Picks a book, chapter, and verse, and opens it in the Bible */
export function openPassagePicker(plugin: ToposPlugin): void {
  const context = pickerContext(plugin);
  new PassagePickerModal(plugin, { action: "Go to a passage", ...context, chosen: (passage, newLeaf) => void openIn(plugin, context.bible, passage, newLeaf) }).open();
}

/** Picks a book, chapter, and verse, and hands back the passage (inserting it, say) */
export function pickPassage(plugin: ToposPlugin, action: string, chosen: (passage: Passage) => void): void {
  new PassagePickerModal(plugin, { action, ...pickerContext(plugin), chosen: (passage) => chosen(passage) }).open();
}
