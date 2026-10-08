import type { ParsedLocator } from "file-plus-plus/core";
import { DocumentEmbed } from "file-plus-plus/obsidian";
import type { BibleBook, BibleReader } from "./reader.ts";

/**
 * A passage in a hover preview or an embed (`![John 1:1-5]`, `![[JHN.usx#v=1:1-5]]`): only its
 * verses, as tall as they are (up to the preview height), without the highlight a link into a whole
 * book would draw
 */
export class BibleEmbed extends DocumentEmbed<BibleBook, BibleReader> {
  /** A label for the header instead of the book's name (the reference as written in the note) */
  label = "";

  protected override onReaderReady(reader: BibleReader, loc: ParsedLocator, range: Range | null): void {
    if (!reader.isPreview) return;
    reader.setHighlights([]);
    const book = reader.bible;
    // A hover preview from Obsidian has no label: the book and the locator's verses
    const verses = loc.locator?.replace(/^v=/, "").replaceAll(";", "; ") ?? "";
    const label = this.label || [book.name, verses].filter(Boolean).join(" ");
    this.title.setText([label, book.bible].filter(Boolean).join(" · "));
    if (!range) return;
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
}
