import type { FileFormat } from "file-plus-plus/obsidian";
import { ToposBook } from "topos-bible";
import { parseVerseLocator } from "../core/verse-locator.ts";
import type ToposPlugin from "../main.ts";
import { BIBLE_SCHEMES, BibleReader, type BibleBook } from "./reader.ts";

/** USX files (one Bible book each) for file-plus-plus: their own tab, previews, and embeds */
export function createBibleFormat(plugin: ToposPlugin): FileFormat<BibleBook, BibleReader> {
  return {
    name: "Bible",
    noun: "book",
    extensions: ["usx"],
    plainText: true,
    icon: "book-open-text",
    frontmatterKey: "bible",
    schemes: BIBLE_SCHEMES,
    linkTypeName: "Verses",
    linkTypeDescription: "Verse links (v=3:16-18) cover whole verses and work in any translation of the book. Text fragment links point at the exact words.",
    position: {
      key: (locator: string) => {
        const part = parseVerseLocator(locator)?.[0];
        return part ? part.chapter * 1000 + part.verse : null;
      },
      compare: (a: number, b: number) => a - b,
    },
    load: async (app, file) => {
      const topos = await plugin.engine();
      const book = ToposBook.parse(topos, "usx", await app.vault.cachedRead(file));
      if (!book) throw new Error("not a USX file");
      const bookId = book.bookId() ?? 0;
      const info = topos.books().find((b) => b.id === bookId);
      return { book, bookId, name: info?.name ?? file.basename, bible: file.parent?.name ?? "" };
    },
    unload: (doc) => doc.book.dispose(),
    info: (doc, file) => ({ title: doc.bible ? `${doc.name} (${doc.bible})` : doc.name || file.basename, author: "" }),
    createReader: (host, doc, opts, preview) =>
      new BibleReader(host, doc, { ...opts, text: plugin.bookTextOptions() }, preview),
    templateVars: (info, doc) => {
      const part = parseVerseLocator(info.locator)?.[0];
      return { book: doc?.name ?? "", bible: doc?.bible ?? "", chapter: part ? String(part.chapter) : "", verse: part?.verse ? String(part.verse) : "" };
    },
    extraTemplateVars: "{{book}} (John), {{bible}} (the translation), {{chapter}}, {{verse}}",
    appearance: { hidden: ["dimImages"], publisherName: null },
  };
}
