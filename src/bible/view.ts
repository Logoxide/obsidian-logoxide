import { Notice, setIcon, type Menu } from "obsidian";
import { DocumentView, MediaPlayer, PlaybackFollower } from "file-plus-plus/obsidian";
import { PREFIX, type SelectionInfo, type TocItem } from "file-plus-plus/core";
import { clipOf, timingAt, timingOf, type Timing } from "../core/timings.ts";
import { parseVerseLocator, type VersePart } from "../core/verse-locator.ts";
import { STUB_EXTENSION } from "../core/stubs.ts";
import type ToposPlugin from "../main.ts";
import { openPassagePicker } from "./picker.ts";
import type { Recording } from "./packages.ts";
import type { BibleBook, BibleReader } from "./reader.ts";
import { CommentariesTab } from "./study-tab.ts";

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
    this.register(() => this.commentaries?.destroy());
  }

  protected override onReaderReady(reader: BibleReader): void {
    const follower = (this.follower = new PlaybackFollower(reader));
    // A verse number plays from its verse: while the player is open, or with Ctrl/Cmd
    const onClick = (e: MouseEvent) => {
      const el = e.composedPath()[0];
      if (!(el instanceof Element) || !el.classList.contains("topos-verse") || !this.recording) return;
      if (!this.player && !(e.ctrlKey || e.metaKey)) return;
      const verse = reader.verseOfMarker(el);
      if (!verse) return;
      e.preventDefault();
      e.stopPropagation();
      void this.playFrom(verse.chapter, verse.verse);
    };
    reader.scroller.addEventListener("click", onClick, true);
    // The commentary view follows the verse at the top
    const offRelocated = reader.on("relocated", (loc) => {
      if (this.leaf === this.app.workspace.getMostRecentLeaf()) this.topos.followReader(reader, loc.locator);
    });
    this.offReader.push(
      () => offRelocated?.(),
      () => reader.scroller.removeEventListener("click", onClick, true),
      () => follower.destroy(),
    );
    // Re-rendered (edited, or the settings changed): the player keeps playing, now marking this reader
    if (this.player && this.recording) this.bindPlayer(this.player, this.recording);
    void this.findRecording(reader);
    this.commentaries?.attach(reader);
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

  /** "Play from 3:16" and "Play 3:16-18" (then stops), for the verse right-clicked or the selection */
  protected override extendSelectionMenu(menu: Menu, info: SelectionInfo): void {
    const reader = this.reader;
    const recording = this.recording;
    if (!reader || !recording) return;
    // A right-click without a selection gives the paragraph: the verse clicked is the one meant
    const click = this.lastClick && !this.lastClick.selected && Date.now() - this.lastClick.at < 1000 ? this.lastClick : null;
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
