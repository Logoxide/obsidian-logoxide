import { setIcon } from "obsidian";
import type { ParsedLocator } from "file-plus-plus/core";
import { DocumentEmbed, MediaPlayer } from "file-plus-plus/obsidian";
import { clipOf } from "../core/timings.ts";
import { parseVerseLocator } from "../core/verse-locator.ts";
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
  private player: MediaPlayer | null = null;
  private playButton: HTMLElement | null = null;

  protected override onReaderReady(reader: BibleReader, loc: ParsedLocator, range: Range | null): void {
    if (!reader.isPreview) return;
    reader.setHighlights([]);
    const book = reader.bible;
    // A hover preview from Obsidian has no label: the book and the locator's verses
    const verses = loc.locator?.replace(/^v=/, "").replaceAll(";", "; ") ?? "";
    const label = this.label || [book.name, verses].filter(Boolean).join(" ");
    this.title.setText([label, book.bible].filter(Boolean).join(" · "));
    if (!range) return;
    void this.offerPlaying(reader, loc, label);
    // Fit short passages (the host keeps the preview height as its maximum), also once an editor
    // puts the embed on the page, or the width changes
    const max = this.plugin.settings.previewHeight;
    const fit = () => {
      // To the end of the last section: the content has room to scroll past its end
      const last = reader.content.lastElementChild ?? reader.content;
      const height = last.getBoundingClientRect().bottom - reader.content.getBoundingClientRect().top;
      if (height > 0) this.host.style.height = `${Math.min(max, Math.ceil(height) + 24)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(reader.content);
    this.register(() => observer.disconnect());
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
        this.register(() => {
          off();
          player.destroy();
          el.remove();
        });
        player.playClip(clip.startMs / 1000, clip.endMs / 1000);
      })();
    });
  }
}
