import { normalizePath, type TAbstractFile } from "obsidian";
import type ToposPlugin from "../main.ts";

/**
 * The vault's Bible stylesheet (the `bibleCss` setting): a CSS file applied to every Bible tab,
 * hover preview, and embed, after the reader's own styles. Readers render in shadow roots, which
 * Obsidian's CSS snippets don't reach, so each adopts its window's one constructed sheet, and a
 * change to the file restyles them all at once.
 */
export class BibleStyles {
  private css = "";
  /** A sheet per window (a constructed sheet only works in its own document) */
  private readonly sheets = new Map<Document, CSSStyleSheet>();

  constructor(private readonly plugin: ToposPlugin) {}

  /** The stylesheet's vault path, or "" for none */
  path(): string {
    const path = this.plugin.settings.bibleCss.trim();
    return path ? normalizePath(path) : "";
  }

  /** Reads the stylesheet again (a missing file is no styles) */
  async load(): Promise<void> {
    const path = this.path();
    let css = "";
    if (path) {
      try {
        css = await this.plugin.app.vault.adapter.read(path);
      } catch {
        // Not written yet
      }
    }
    this.css = css;
    for (const sheet of this.sheets.values()) replace(sheet, css);
  }

  /** Reloads when the stylesheet is written, moved, or deleted */
  changed(file: TAbstractFile, oldPath?: string): void {
    const path = this.path();
    if (path && (file.path === path || oldPath === path)) void this.load();
  }

  /** The sheet for a reader's document, or null where shadow roots can't adopt sheets */
  sheet = (doc: Document): CSSStyleSheet | null => {
    let sheet = this.sheets.get(doc);
    if (sheet) return sheet;
    const Sheet = (doc.defaultView as (Window & typeof globalThis) | null)?.CSSStyleSheet;
    if (!Sheet) return null;
    try {
      sheet = new Sheet();
    } catch {
      return null;
    }
    replace(sheet, this.css);
    this.sheets.set(doc, sheet);
    return sheet;
  };

  /** Forgets closed windows' sheets */
  forget(doc: Document): void {
    this.sheets.delete(doc);
  }
}

function replace(sheet: CSSStyleSheet, css: string): void {
  try {
    sheet.replaceSync(css);
  } catch {
    // Not a constructed sheet (happy-dom), or @import (not allowed in replaceSync)
  }
}
