import { Menu, Platform, setIcon, type TFile } from "obsidian";
import type { HighlightSpec, ParsedLocator, SelectionInfo } from "file-plus-plus/core";
import { DocumentEmbed, MediaPlayer, type EmbedContext, type FilePlusPlusPlugin } from "file-plus-plus/obsidian";
import { clipOf } from "../core/timings.ts";
import { END, formatVerseLocator, parseVerseLocator, splitContext, withContext } from "../core/verse-locator.ts";
import { STUB_EXTENSION } from "../core/stubs.ts";
import type ToposPlugin from "../main.ts";
import type { BibleBook, BibleReader } from "./reader.ts";
import { followVerses } from "./view.ts";

/**
 * A passage in a hover preview or an embed (`![John 1:1-5]`, `![[JHN.usx#v=1:1-5]]`): only its
 * verses, as tall as they are (up to the preview height), without the highlight a link into a whole
 * book would draw
 */
export class BibleEmbed extends DocumentEmbed<BibleBook, BibleReader> {
  /** A label for the header instead of the book's name (the reference as written in the note) */
  label = "";
  /** How the header names the Bible instead of its name: a Bible numbered differently, with its own numbers (`KJV (Psalm 51:3)`) */
  bibleLabel = "";
  private player: MediaPlayer | null = null;
  private playButton: HTMLElement | null = null;
  /** Stops the recording playing here and takes its player away */
  private stopPlayer: (() => void) | null = null;
  /** The context shown last, to show again when it's turned back on */
  private lastContext: number | null = null;
  /** The hovered document's text size, kept for when it renders again (its context toggled), with the pointer on the preview by then */
  private documentFontSize: string | null = null;
  /**
   * Writes the embed again in its note with a highlight (`:~:text=so%20loved&color=yellow`), or
   * none (null); null where it can't be (a hover preview)
   */
  onHighlight: ((fragment: string | null) => void) | null = null;

  constructor(plugin: FilePlusPlusPlugin<BibleBook, BibleReader>, ctx: EmbedContext, file: TFile, subpath: string) {
    super(plugin, ctx, file, subpath);
    // `![[John.bible#v=3:16-18]]`: its link in its note
    const { linktext, sourcePath } = ctx;
    if (linktext && sourcePath) this.onHighlight = (fragment) => void rewriteWikiEmbed(plugin, sourcePath, linktext, fragment);
  }

  protected override buildExtraUi(): void {
    this.matchHoveredDocument();
  }

  /**
   * A hover preview over a document (an EPUB in EPUB++, a transcript, a Bible tab) has its text's
   * size, not the notes': the size of the section the pointer is in, which follows the document's
   * own font size setting
   */
  private matchHoveredDocument(): void {
    if (!this.containerEl.closest(".hover-popover")) return;
    this.documentFontSize ??= hoveredDocumentFontSize(this.containerEl.doc, this.host);
    if (this.documentFontSize) this.host.style.setProperty("--topos-passage-font-size", this.documentFontSize);
  }

  protected override onReaderReady(reader: BibleReader, loc: ParsedLocator, range: Range | null): void {
    if (!reader.isPreview) return;
    // Put in its popover after it was built
    if (!this.host.style.getPropertyValue("--topos-passage-font-size")) this.matchHoveredDocument();
    // A link's verses aren't highlighted in its embed, but a highlight in them is (`:~:text=`),
    // if its words are there (else it would be all of them)
    if (!TEXT_DIRECTIVE.test(loc.locator ?? "") || !reader.hasWords(loc.locator ?? "")) reader.setHighlights([]);
    this.offerHighlighting(reader);
    const book = reader.bible;
    // A hover preview from Obsidian has no label: the book and the locator's verses
    const parts = parseVerseLocator(loc.locator ?? "");
    const verses = parts ? formatVerseLocator(parts).slice(2).replaceAll(";", "; ") : "";
    const label = this.label || [book.name, verses].filter(Boolean).join(" ");
    this.title.setText([label, this.bibleLabel || book.bible].filter(Boolean).join(" · "));
    // Fit short passages (the host keeps the preview height as its maximum), also once an editor
    // puts the embed on the page, or the width changes; and one without text (`… has no text`)
    const max = this.plugin.settings.previewHeight;
    const fit = () => {
      const height = reader.passageHeight();
      if (height > 0) this.host.style.height = `${Math.min(max, Math.ceil(height))}px`;
    };
    fit();
    // Scrolled to while the embed was taller than its text, which kept it at the top
    reader.scrollToPassage();
    const observer = new ResizeObserver(fit);
    observer.observe(reader.content);
    this.register(() => observer.disconnect());
    if (!range) return;
    this.offerContext(reader, loc);
    void this.offerPlaying(reader, loc, label);
  }

  /**
   * Highlighting in the embed, which writes it again in its note with its highlight (one: a new one
   * replaces it): a menu of colors for a selection (on a right-click, or after selecting on a touch
   * screen), and for its highlight (on a click)
   */
  private offerHighlighting(reader: BibleReader): void {
    const write = this.onHighlight;
    if (!write) return;
    const plugin = this.plugin as unknown as ToposPlugin;
    const show = (at: { x: number; y: number }, selection: SelectionInfo | null, highlights: HighlightSpec[]) => {
      const fragment = selection?.textFragment();
      if (!fragment && highlights.length === 0) return false;
      const menu = new Menu();
      for (const { name } of plugin.settings.palette) {
        const title = fragment ? `Highlight ${name}` : `Make it ${name}`;
        // A new color for its highlight keeps its words
        const words = fragment ?? this.subpath.match(TEXT_DIRECTIVE)?.[0].replace(/&color=[^&]*/, "") ?? null;
        if (words) menu.addItem((i) => i.setTitle(title).setIcon("highlighter").onClick(() => write(`${directive(words)}&color=${name}`)));
      }
      if (highlights.length > 0) menu.addItem((i) => i.setTitle("Remove highlight").setIcon("eraser").onClick(() => write(null)));
      menu.showAtPosition(at);
      return true;
    };
    reader.on("contextmenu", (e, { selection, highlights }) => {
      if (show({ x: e.clientX, y: e.clientY }, selection, highlights)) e.preventDefault();
    });
    reader.on("highlight-click", (e, highlights) => void show({ x: e.clientX, y: e.clientY }, null, highlights));
    // On a touch screen, the menu once the selection stays put a moment
    if (Platform.isDesktop) return;
    let timer = 0;
    reader.on("selectionchange", (selection) => {
      window.clearTimeout(timer);
      if (!selection) return;
      timer = window.setTimeout(() => {
        const now = reader.getSelection();
        if (!now) return;
        const r = now.range.getBoundingClientRect();
        show({ x: r.left + r.width / 2, y: r.bottom + 8 }, now, []);
      }, 600);
    });
    this.register(() => window.clearTimeout(timer));
  }

  /**
   * A button in the header that shows or hides the verses around the passage, in this embed only
   * (its locator's `&c=` changes, and it renders again; the note keeps what it says)
   */
  private offerContext(reader: BibleReader, loc: ParsedLocator): void {
    const parts = parseVerseLocator(loc.locator ?? "");
    const header = this.title.parentElement;
    // Whole chapters have no context
    if (!parts || !header || parts.some((p) => p.verse === 0 && p.endVerse === END)) return;
    // Rendered again (the settings changed): one button
    header.querySelector(".topos-embed-context")?.remove();
    const plugin = this.plugin as unknown as ToposPlugin;
    const shown = reader.hasContext;
    if (shown) this.lastContext = splitContext(this.subpath).context ?? plugin.settings.previewContext;
    const button = header.createDiv({
      cls: `clickable-icon topos-embed-context${shown ? " is-active" : ""}`,
      attr: { "aria-label": shown ? "Hide the verses around it" : "Show the verses around it" },
    });
    setIcon(button, shown ? "fold-vertical" : "unfold-vertical");
    keepFromEditor(button);
    header.insertBefore(button, this.title.nextSibling);
    button.addEventListener("click", (e) => {
      // Not the header's click, which opens the book
      e.preventDefault();
      e.stopPropagation();
      const context = shown ? 0 : this.lastContext || plugin.settings.previewContext || 2;
      const [path, hash] = this.subpath.startsWith("#") ? ["#", this.subpath.slice(1)] : ["", this.subpath];
      this.subpath = path + withContext(splitContext(hash).locator, context);
      this.stopPlayer?.();
      this.stopPlayer = null;
      this.playButton = null;
      void this.loadFile();
    });
  }

  /** A play button in the header when the Bible has a recording of the passage: it plays here, then stops */
  private async offerPlaying(reader: BibleReader, loc: ParsedLocator, label: string): Promise<void> {
    const plugin = this.plugin as unknown as ToposPlugin;
    const parts = parseVerseLocator(loc.locator ?? "");
    const recording = this.file.extension === STUB_EXTENSION && parts ? await plugin.packages.recording(this.file.path, reader.bible.bookId) : null;
    const clip = recording && parts ? clipOf(recording.timings, parts) : null;
    if (!recording || !clip || this.playButton || reader !== this.reader) return;
    const header = this.title.parentElement;
    if (!header) return;
    const button = (this.playButton = header.createDiv({ cls: "clickable-icon topos-embed-play", attr: { "aria-label": `Play ${label} (${recording.bible})` } }));
    setIcon(button, "play");
    keepFromEditor(button);
    header.insertBefore(button, this.title.nextSibling);
    button.addEventListener("click", (e) => {
      // Not the header's click, which opens the book
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        if (this.player) return this.player.toggle();
        const src = await plugin.media.source(recording, `${reader.bible.name} (${recording.bible})`);
        if (!src || this.player) return;
        const el = createDiv("topos-embed-player");
        header.after(el);
        const player = (this.player = new MediaPlayer(el, src, {
          fallbackDuration: clip.endMs / 1000,
          rate: plugin.settings.playbackRate,
          onRate: (rate) => {
            plugin.settings.playbackRate = rate;
            void plugin.saveData(plugin.settings);
          },
        }));
        const off = followVerses(reader, player, recording.timings, () => {});
        player.on("play", () => setIcon(button, "pause"));
        player.on("pause", () => setIcon(button, "play"));
        // Played again after its end (or from outside it), the passage plays from its start
        const [start, end] = [clip.startMs / 1000, clip.endMs / 1000];
        player.on("play", () => {
          if (player.clipEndsAt === null && (player.time < start - 0.5 || player.time >= end - 0.1)) player.playClip(start, end);
        });
        this.stopPlayer = () => {
          off();
          player.destroy();
          el.remove();
          this.player = null;
        };
        this.register(() => this.stopPlayer?.());
        player.playClip(clip.startMs / 1000, clip.endMs / 1000);
      })();
    });
  }
}

/**
 * Keeps a press on a header button from the editor around an embed: in live preview, a press would
 * otherwise move the cursor onto the embed's line, which shows its source and closes it
 */
function keepFromEditor(button: HTMLElement): void {
  const keep = (e: Event) => {
    e.stopPropagation();
    // Not on touch: that would cancel the tap's click
    if (e.type === "mousedown") e.preventDefault();
  };
  for (const type of ["pointerdown", "mousedown", "touchstart"]) button.addEventListener(type, keep);
}

/**
 * The text size of the file-plus-plus document under the pointer, if it's over one (not `own`, the
 * preview's own reader): the section it's in (a `data-<prefix>-section` element, whatever the
 * plugin's prefix) in the reader's shadow root, which Obsidian's `:hover` doesn't look into
 */
function hoveredDocumentFontSize(doc: Document, own: HTMLElement): string | null {
  const hosts = Array.from(doc.querySelectorAll(":hover")).filter((el) => el.shadowRoot && el !== own);
  for (const host of hosts.reverse()) {
    const hovered = Array.from(host.shadowRoot!.querySelectorAll(":hover"));
    const section = hovered.reverse().find((el) => el.getAttributeNames().some((n) => SECTION_ATTRIBUTE.test(n)));
    if (section) return getComputedStyle(section).fontSize;
  }
  return null;
}

/** What file-plus-plus marks each section of a document with, `data-fpp-section` before its build renames it */
const SECTION_ATTRIBUTE = /^data-[a-z]+-section$/;

/** A highlight's words in a locator, and its color after them: `:~:text=so%20loved&color=yellow` */
const TEXT_DIRECTIVE = /(:~:|%3A~%3A)text=.*$/i;

/**
 * Writes a wikilink embed (`![[John.bible#v=3:16-18]]`) again in its note with a highlight, or
 * none: its verses keep their locator, and the highlight follows them (the first such embed)
 */
async function rewriteWikiEmbed(plugin: FilePlusPlusPlugin<BibleBook, BibleReader>, sourcePath: string, linktext: string, fragment: string | null): Promise<void> {
  const file = plugin.app.vault.getFileByPath(sourcePath);
  if (!file) return;
  const hash = linktext.indexOf("#");
  const [path, subpath] = hash === -1 ? [linktext, ""] : [linktext.slice(0, hash), linktext.slice(hash + 1)];
  const verses = subpath.replace(TEXT_DIRECTIVE, "");
  const next = `${path}#${verses}${fragment ?? ""}`;
  await plugin.app.vault.process(file, (data) => {
    const at = data.search(new RegExp(`!\\[\\[${escapeRegExp(linktext)}(?=[|\\]])`));
    return at === -1 ? data : data.slice(0, at + 3) + next + data.slice(at + 3 + linktext.length);
  });
}

/** A text fragment as it follows an embed's verses: `:~:text=…` */
function directive(fragment: string): string {
  const s = fragment.replace(/^%3A~%3A/i, ":~:");
  return s.startsWith(":~:") ? s : `:~:${s}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
