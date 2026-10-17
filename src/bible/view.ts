import { Menu, Notice, setIcon } from "obsidian";
import { DocumentView, MediaPlayer, PlaybackFollower } from "file-plus-plus/obsidian";
import { PREFIX, type SelectionInfo, type TocItem } from "file-plus-plus/core";
import { clipOf, timingAt, timingOf, type Timing } from "../core/timings.ts";
import { parseVerseLocator, type VersePart } from "../core/verse-locator.ts";
import { STUB_EXTENSION } from "../core/stubs.ts";
import { bookStyle } from "../core/settings.ts";
import type ToposPlugin from "../main.ts";
import { openPassagePicker } from "./picker.ts";
import type { Recording } from "./packages.ts";
import type { BibleBook, BibleReader } from "./reader.ts";
import { TRANSLATIONS_VIEW, VERSE_COMMENTARIES_VIEW } from "./rows.ts";
import { CommentariesTab, CrossReferencesTab, LanguageTab } from "./study-tab.ts";

/**
 * Marks the verse a player is reading in a reader, as it plays: the timing at the player's time, its
 * verses' text highlighted; `shown` hears of each new verse (its timing, or null for none)
 */
export function followVerses(reader: BibleReader, player: MediaPlayer, timings: readonly Timing[], shown: (timing: Timing | null, range: Range | null) => void): () => void {
  let current = -2;
  const sync = () => {
    const index = player.paused && player.time === 0 ? -1 : timingAt(timings, player.time * 1000);
    if (index === current) return;
    current = index;
    const t = timings[index];
    const range = t ? reader.versesRange({ chapter: t.chapter, verse: t.verse, endChapter: t.chapter, endVerse: t.last }) : null;
    reader.setPlayingRange(range);
    shown(t ?? null, range);
  };
  const offs = [player.on("timeupdate", sync), player.on("seeked", sync), player.on("emptied", sync)];
  sync();
  return () => {
    offs.forEach((off) => off());
    reader.setPlayingRange(null);
  };
}

/**
 * The Bible tab: file-plus-plus's view, and for a package's book with a recording (its `[media]`
 * and WebVTT timings), a player above the text that follows along: the verse being read is
 * highlighted and kept in view, a verse number (while it plays, or with Ctrl/Cmd) plays from that
 * verse, and following a link or the contents moves the playback there
 */
export class BibleView extends DocumentView<BibleBook, BibleReader> {
  player: MediaPlayer | null = null;
  /** The open book's recording, once looked for */
  recording: Recording | null = null;
  private listenEl!: HTMLElement;
  private listenButton!: HTMLElement;
  private nowEl: HTMLElement | null = null;
  private followButton: HTMLElement | null = null;
  private follower: PlaybackFollower | null = null;
  private offReader: (() => void)[] = [];
  private offFollow: (() => void) | null = null;
  /** The verse being read */
  private reading: Timing | null = null;
  /** The sidebar's *Commentaries* tab, and the marks beside verses */
  commentaries: CommentariesTab | null = null;
  /** The sidebar's *Cross-references* tab */
  crossReferences: CrossReferencesTab | null = null;
  /** The sidebar's *Language tools* tab */
  language: LanguageTab | null = null;

  private get topos(): ToposPlugin {
    return this.plugin as unknown as ToposPlugin;
  }

  protected override buildExtraUi(): void {
    this.listenEl = this.contentEl.createDiv("topos-listen");
    this.contentEl.insertBefore(this.listenEl, this.mainEl);
    const search = this.toolbarEl.querySelector('[aria-label="Search"]');
    const goTo = this.toolbarButton(this.toolbarEl, "book-marked", "Go to a book, chapter, and verse", () => openPassagePicker(this.topos));
    // After the contents button
    this.toolbarEl.insertBefore(goTo, this.toolbarEl.querySelector(`.${PREFIX}-toolbar-center`));
    this.listenButton = this.toolbarButton(this.toolbarEl, "headphones", "Listen", () => void this.listen());
    if (search) this.toolbarEl.insertBefore(this.listenButton, search);
    this.listenButton.hide();
    this.commentaries = new CommentariesTab(this, this.topos);
    this.crossReferences = new CrossReferencesTab(this, this.topos);
    this.language = new LanguageTab(this, this.topos);
    this.register(() => {
      this.commentaries?.destroy();
      this.crossReferences?.destroy();
      this.language?.destroy();
    });
  }

  protected override onReaderReady(reader: BibleReader): void {
    const follower = (this.follower = new PlaybackFollower(reader));
    // A verse number opens the verse's menu (with Ctrl/Cmd, when the book has a recording: plays
    // from it); a tap on a verse's text too, unless it's on a highlight, a link, or a note
    let touchedAt = 0;
    let menuWasOpen = false;
    let tapTimer = 0;
    const onTouchStart = () => {
      touchedAt = Date.now();
      menuWasOpen = !!this.contentEl.doc.querySelector(".menu");
      // A second tap: file-plus-plus's double tap (the paragraph), not this tap's menu
      window.clearTimeout(tapTimer);
    };
    const onClick = (e: MouseEvent) => {
      const el = e.composedPath()[0];
      if (!(el instanceof Element)) return;
      if (el.classList.contains("topos-verse")) {
        const verse = reader.verseOfMarker(el);
        if (!verse) return;
        e.preventDefault();
        e.stopPropagation();
        if (this.recording && (e.ctrlKey || e.metaKey)) void this.playFrom(verse.chapter, verse.verse);
        else this.openVerseMenu(verse.chapter, verse.verse);
        return;
      }
      const touch = Date.now() - touchedAt < 800;
      if (!touch || menuWasOpen || !reader.content.contains(el) || el.closest(TAP_IGNORES)) return;
      const range = reader.getSelectionRange();
      if ((range && !range.collapsed) || reader.highlightsAt(e.clientX, e.clientY).length > 0 || reader.layerHitsAt(e.clientX, e.clientY).length > 0) return;
      const verse = reader.verseAtPoint(e.clientX, e.clientY, el);
      if (!verse) return;
      window.clearTimeout(tapTimer);
      tapTimer = window.setTimeout(() => {
        const now = reader.getSelectionRange();
        if (reader === this.reader && !(now && !now.collapsed)) this.openVerseMenu(verse.chapter, verse.verse);
      }, 330);
    };
    // A triple click selects the verse, a fourth the paragraph (the browser's triple click: the
    // paragraph). Counted here: Chromium on Linux starts again at 1 after a triple click
    let clicks = { count: 0, at: 0, x: 0, y: 0 };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || Date.now() - touchedAt < 800) return;
      const now = Date.now();
      const again = e.detail > 1 || (now - clicks.at < 600 && Math.hypot(e.clientX - clicks.x, e.clientY - clicks.y) < 8);
      clicks = { count: again ? Math.max(clicks.count + 1, e.detail) : 1, at: now, x: e.clientX, y: e.clientY };
      if (clicks.count < 3) return;
      const el = e.composedPath()[0];
      if (!(el instanceof Element) || !reader.content.contains(el) || el.closest(TAP_IGNORES)) return;
      let range: Range | null = null;
      if (clicks.count === 3) {
        const verse = reader.verseAtPoint(e.clientX, e.clientY, el);
        range = verse && reader.versesRange({ chapter: verse.chapter, verse: verse.verse, endChapter: verse.chapter, endVerse: verse.verse });
      } else {
        const block = el.closest(PARAGRAPHS);
        if (block && reader.content.contains(block)) {
          range = block.ownerDocument.createRange();
          range.selectNodeContents(block);
        }
      }
      if (!range) return;
      e.preventDefault();
      const selection = this.contentEl.doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    reader.scroller.addEventListener("mousedown", onMouseDown, true);
    reader.scroller.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    reader.scroller.addEventListener("click", onClick, true);
    // The commentary view follows the verse at the top
    const offRelocated = reader.on("relocated", (loc) => {
      if (this.leaf === this.app.workspace.getMostRecentLeaf()) this.topos.followReader(reader, loc.locator);
    });
    this.offReader.push(
      () => offRelocated?.(),
      () => reader.scroller.removeEventListener("click", onClick, true),
      () => reader.scroller.removeEventListener("mousedown", onMouseDown, true),
      () => reader.scroller.removeEventListener("touchstart", onTouchStart, true),
      () => window.clearTimeout(tapTimer),
      () => follower.destroy(),
    );
    // Re-rendered (edited, or the settings changed): the player keeps playing, now marking this reader
    if (this.player && this.recording) this.bindPlayer(this.player, this.recording);
    void this.findRecording(reader);
    this.commentaries?.attach(reader);
    this.crossReferences?.attach(reader);
    this.language?.attach(reader);
  }

  /** Looks for the book's recording (a package's book, through its stub), and offers to listen when it has one */
  private async findRecording(reader: BibleReader): Promise<void> {
    const file = this.file;
    const found = file?.extension === STUB_EXTENSION ? await this.topos.packages.recording(file.path, reader.bible.bookId) : null;
    if (reader !== this.reader) return;
    if (found?.file.sha256 !== this.recording?.file.sha256) this.closePlayer();
    this.recording = found;
    this.listenButton.toggle(found !== null);
    this.checked = true;
    for (const waiter of this.waiting.splice(0)) waiter(found);
  }

  /** Whether the open book's recording has been looked for, and who waits for it */
  private checked = false;
  private waiting: ((recording: Recording | null) => void)[] = [];

  /** The open book's recording, once its book is open and it's been looked for (null after 15 s: it didn't open) */
  whenRecording(): Promise<Recording | null> {
    if (this.checked) return Promise.resolve(this.recording);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 15000);
      this.waiting.push((recording) => {
        window.clearTimeout(timer);
        resolve(recording);
      });
    });
  }

  /** The toolbar's button: pauses or resumes, and opens the player at the verse in view */
  async listen(): Promise<void> {
    if (this.player) return this.player.toggle();
    const at = this.reader?.verseInView();
    const first = this.recording?.timings[0];
    if (at && this.recording && timingOf(this.recording.timings, at.chapter, at.verse) !== -1) await this.playFrom(at.chapter, at.verse);
    else if (first) await this.playFrom(first.chapter, first.verse);
  }

  /** Plays from a verse (a whole chapter, verse 0: its first verse read), downloading the recording first if it must */
  async playFrom(chapter: number, verse: number): Promise<void> {
    const recording = this.recording;
    if (!recording || !this.reader) return;
    const index = timingOf(recording.timings, chapter, verse);
    if (index === -1) {
      new Notice(`${recording.bible}'s recording doesn't read ${this.reader.bible.name} ${verse ? `${chapter}:${verse}` : chapter}.`);
      return;
    }
    const player = await this.openPlayer();
    this.follower?.resume();
    player?.seek(recording.timings[index]!.startMs / 1000, true);
  }

  /** Plays verses, then stops */
  async playPassage(parts: VersePart[]): Promise<void> {
    const recording = this.recording;
    if (!recording || !this.reader) return;
    const clip = clipOf(recording.timings, parts);
    if (!clip) {
      new Notice(`${recording.bible}'s recording doesn't read these verses.`);
      return;
    }
    const player = await this.openPlayer();
    this.follower?.resume();
    player?.playClip(clip.startMs / 1000, clip.endMs / 1000);
  }

  /** The player, made (and the recording downloaded) when it isn't open yet; null when it couldn't be */
  private async openPlayer(): Promise<MediaPlayer | null> {
    if (this.player) return this.player;
    const recording = this.recording;
    const book = this.reader?.bible;
    if (!recording || !book) return null;
    const src = await this.topos.media.source(recording, `${book.name} (${recording.bible})`);
    if (!src || this.recording !== recording || this.player) return this.player;
    const settings = this.topos.settings;
    this.listenEl.empty();
    const header = this.listenEl.createDiv("topos-listen-header");
    const icon = header.createSpan("topos-listen-icon");
    setIcon(icon, "headphones");
    // The verse being read: shows it (and follows again)
    this.nowEl = header.createEl("button", { cls: "topos-listen-now", attr: { type: "button", "aria-label": "Show the verse being read" } });
    this.nowEl.setText(`${book.name} · ${recording.bible}`);
    this.nowEl.addEventListener("click", () => this.showReading());
    const button = (icon: string, label: string, onClick: () => void) => {
      const el = header.createEl("button", { cls: "clickable-icon topos-listen-button", attr: { type: "button", "aria-label": label } });
      setIcon(el, icon);
      el.addEventListener("click", (e) => {
        e.preventDefault();
        onClick();
      });
      return el;
    };
    this.followButton = button("locate", "Follow along", () => this.setFollow(!settings.followPlayback));
    this.followButton.toggleClass("is-active", settings.followPlayback);
    button("x", "Close the player", () => this.closePlayer());
    const last = recording.timings[recording.timings.length - 1];
    const player = (this.player = new MediaPlayer(this.listenEl, src, {
      fallbackDuration: last ? last.endMs / 1000 : 0,
      rate: settings.playbackRate,
      onRate: (rate) => {
        settings.playbackRate = rate;
        void this.topos.saveData(settings);
      },
    }));
    this.listenButton.addClass("is-active");
    this.bindPlayer(player, recording);
    return player;
  }

  /** Marks the verse being read in the reader, and keeps it in view while following */
  private bindPlayer(player: MediaPlayer, recording: Recording): void {
    const reader = this.reader;
    if (!reader) return;
    this.offFollow?.();
    this.offFollow = followVerses(reader, player, recording.timings, (timing, range) => {
      this.reading = timing;
      if (this.nowEl) this.nowEl.setText(`${reader.bible.name}${timing ? ` ${timing.chapter}:${timing.verse === timing.last ? timing.verse : `${timing.verse}-${timing.last}`}` : ""} · ${recording.bible}`);
      if (range && !player.paused && this.topos.settings.followPlayback) this.follower?.show(range);
    });
  }

  /** Scrolls to the verse being read, and follows it again */
  private showReading(): void {
    const t = this.reading;
    const range = t && this.reader?.versesRange({ chapter: t.chapter, verse: t.verse, endChapter: t.chapter, endVerse: t.last });
    this.follower?.resume();
    if (range) this.reader?.scrollToRange(range, { position: "center" });
  }

  private setFollow(on: boolean): void {
    const settings = this.topos.settings;
    settings.followPlayback = on;
    void this.topos.saveData(settings);
    for (const view of this.topos.views()) if (view instanceof BibleView) view.followButton?.toggleClass("is-active", on);
    if (on) this.showReading();
  }

  closePlayer(): void {
    this.offFollow?.();
    this.offFollow = null;
    this.player?.destroy();
    this.player = null;
    this.nowEl = null;
    this.followButton = null;
    this.reading = null;
    this.listenEl?.empty();
    this.listenButton?.removeClass("is-active");
  }

  /** Following a link while it plays moves the playback there */
  protected override onNavigate(locator: string): void {
    this.moveTo(locator);
  }

  override goToToc(item: TocItem): void {
    super.goToToc(item);
    if (item.href) this.moveTo(item.href);
  }

  private moveTo(locator: string): void {
    const part = parseVerseLocator(locator)?.[0];
    if (!part || !this.player || this.player.paused || !this.recording) return;
    const index = timingOf(this.recording.timings, part.chapter, part.verse);
    if (index !== -1) this.player.seek(this.recording.timings[index]!.startMs / 1000, true);
  }

  /**
   * A verse's menu (a tap on it, its number): the verse selected, to copy or annotate, its
   * cross-references, commentaries, and words, and playing it
   */
  openVerseMenu(chapter: number, verse: number, at?: { x: number; y: number }): void {
    const reader = this.reader;
    const range = reader?.versesRange({ chapter, verse, endChapter: chapter, endVerse: verse });
    if (!reader || !range) return;
    reader.setPendingSelection(range);
    let selecting = false;
    const menu = new Menu();
    const name = `${reader.bible.name} ${chapter}:${verse}`;
    menu.addItem((item) => item.setTitle(name).setIcon("book-open").setSection("title").setIsLabel?.(true));
    menu.addItem((item) =>
      item
        .setTitle("Copy / Annotate…")
        .setIcon("highlighter")
        .setSection("selection")
        // After this menu is gone (it takes the selection's paint away as it goes)
        .onClick(() => {
          selecting = true;
          window.setTimeout(() => this.openSelectionMenu(range), 0);
        }),
    );
    this.addStudyItems(menu, chapter, verse, null);
    if (this.recording) {
      menu.addItem((item) =>
        item
          .setTitle(`Play from ${chapter}:${verse}`)
          .setIcon("play")
          .setSection("view")
          .onClick(() => void this.playFrom(chapter, verse)),
      );
    }
    menu.onHide(() =>
      window.setTimeout(() => {
        if (!selecting) reader.setPendingSelection(null);
      }, 0),
    );
    const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
    menu.showAtPosition(at ?? { x: r.left + 12, y: r.bottom + 6 });
  }

  /** Cross-references, Commentaries, and Language tools (a word's, when one is given) for a verse */
  private addStudyItems(menu: Menu, chapter: number, verse: number, word: HTMLElement | null): void {
    menu.addItem((item) =>
      item
        .setTitle("Cross-references")
        .setIcon("git-compare-arrows")
        .setSection("action")
        .onClick(() => this.crossReferences?.showVerse(chapter, verse)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Commentaries")
        .setIcon("message-square-quote")
        .setSection("action")
        .onClick(() => this.commentaries?.showVerse(chapter, verse)),
    );
    menu.addItem((item) =>
      item
        .setTitle(word ? `Language tools: ${word.textContent?.trim() ?? ""}` : "Language tools")
        .setIcon("languages")
        .setSection("action")
        .onClick(() => (word ? this.language?.showWord(word) : this.language?.showVerse(chapter, verse))),
    );
    const passage = this.reader && this.topos.topos.parse(`${this.reader.bible.name} ${chapter}:${verse}`, bookStyle("name"));
    if (!passage) return;
    menu.addItem((item) =>
      item
        .setTitle("Compare translations")
        .setIcon("rows-3")
        .setSection("action")
        .onClick(() => void this.topos.openRows(TRANSLATIONS_VIEW, passage)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Commentaries in rows")
        .setIcon("message-square-quote")
        .setSection("action")
        .onClick(() => void this.topos.openRows(VERSE_COMMENTARIES_VIEW, passage)),
    );
  }

  /** A long press on a word that carries Strong's numbers: its entries, with what else it can do */
  protected override onTextHold(_x: number, _y: number, target: Element | null): boolean {
    const reader = this.reader;
    const word = target?.closest<HTMLElement>("[data-strong]");
    if (!reader?.strongs || !word || !reader.content.contains(word) || word.closest(".topos-note") || !this.topos.packages.hasStrongs()) return false;
    const verse = reader.verseOf(word);
    reader.strongs.open(word, (row) => {
      const button = (text: string, run: () => void) => {
        const b = row.appendChild(row.ownerDocument.createElement("button"));
        b.textContent = text;
        b.addEventListener("click", () => {
          reader.strongs?.hide();
          run();
        });
      };
      button("Language tools", () => this.language?.showWord(word));
      button("Copy / Annotate…", () => {
        const range = word.ownerDocument.createRange();
        range.selectNodeContents(word);
        this.openSelectionMenu(range);
      });
      if (verse) button(`${verse.chapter}:${verse.verse}…`, () => this.openVerseMenu(verse.chapter, verse.verse));
    });
    return true;
  }

  /** The verse's (or the selection's) study items, and "Play from 3:16" and "Play 3:16-18" (then stops), for the verse right-clicked or the selection */
  protected override extendSelectionMenu(menu: Menu, info: SelectionInfo): void {
    const reader = this.reader;
    if (!reader) return;
    // A right-click without a selection gives the paragraph: the verse clicked is the one meant
    const click = this.lastClick && !this.lastClick.selected && Date.now() - this.lastClick.at < 1000 ? this.lastClick : null;
    const at = click ? reader.verseAtPoint(click.x, click.y, click.target) : reader.versesOf(info.range);
    const word = click?.target ? (click.target instanceof Element ? click.target : click.target.parentElement)?.closest<HTMLElement>("[data-strong]") ?? null : null;
    if (at) this.addStudyItems(menu, at.chapter, at.verse, word && reader.content.contains(word) ? word : null);
    const recording = this.recording;
    if (!recording) return;
    // A right-click without a selection gives the paragraph: the verse clicked is the one meant
    const verses = click ? null : reader.versesOf(info.range);
    const clicked = click && reader.verseAtPoint(click.x, click.y, click.target);
    const from = verses ?? (clicked ? { chapter: clicked.chapter, verse: clicked.verse, endChapter: clicked.chapter, endVerse: clicked.verse } : reader.versesOf(info.range));
    const several = verses && (verses.endChapter !== verses.chapter || verses.endVerse !== verses.verse);
    if (!from) return;
    const name = (chapter: number, verse: number) => `${chapter}:${verse}`;
    menu.addItem((item) =>
      item
        .setTitle(`Play from ${name(from.chapter, from.verse)}`)
        .setIcon("play")
        .setSection("topos-listen")
        .onClick(() => void this.playFrom(from.chapter, from.verse)),
    );
    if (verses && several) {
      const end = verses.endChapter === verses.chapter ? `${verses.endVerse}` : name(verses.endChapter, verses.endVerse);
      menu.addItem((item) =>
        item
          .setTitle(`Play ${name(verses.chapter, verses.verse)}-${end}`)
          .setIcon("repeat-1")
          .setSection("topos-listen")
          .onClick(() => void this.playPassage([verses])),
      );
    }
  }

  /** Where the last right-click was (and when, and whether text was selected), for the verse it was on */
  private lastClick: { x: number; y: number; target: Node | null; at: number; selected: boolean } | null = null;

  override onload(): void {
    super.onload();
    // Captured before file-plus-plus's menu reads the selection
    this.registerDomEvent(
      this.contentEl,
      "contextmenu",
      (e) => {
        const target = e.composedPath()[0];
        const selection = this.reader?.getSelectionRange();
        this.lastClick = { x: e.clientX, y: e.clientY, target: target instanceof Node ? target : null, at: Date.now(), selected: !!selection && !selection.collapsed };
      },
      { capture: true },
    );
  }

  protected override onTeardown(): void {
    this.commentaries?.detach();
    this.crossReferences?.detach();
    this.language?.detach();
    this.offReader.forEach((off) => off());
    this.offReader = [];
    this.offFollow?.();
    this.offFollow = null;
    this.follower = null;
    // Re-rendering the same book keeps the player (see onReaderReady)
    if (this.reloading) return;
    this.closePlayer();
    this.checked = false;
    this.recording = null;
  }
}

/** Where a tap is something else's: links, notes and their marks, the commentary marks, popups */
const TAP_IGNORES = "a, .topos-note, .tpb-note-ref, .topos-note-marks, .topos-strongs-popup, .tpb-note-popup";

/** What a fourth click selects: the block it's in */
const PARAGRAPHS = "p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, td, pre";
