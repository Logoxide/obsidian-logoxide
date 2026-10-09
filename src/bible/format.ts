import type { FileFormat } from "file-plus-plus/obsidian";
import { serializeTextFragment, withTextDirective } from "file-plus-plus/core";
import type { App, TFile } from "obsidian";
import { Biblix, ToposBook, type BookVerse, type PassageSegment } from "biblix";
import { formatVerseLocator, parseVerseLocator } from "../core/verse-locator.ts";
import type ToposPlugin from "../main.ts";
import { BOOK_EXTENSIONS } from "../core/bibles.ts";
import { STUB_EXTENSION } from "../core/stubs.ts";
import { BIBLE_SCHEMES, BibleReader, type BibleBook } from "./reader.ts";

/**
 * USX and USFM files (one Bible book each) for file-plus-plus: their own tab, previews, and embeds.
 * USFM is read as USX through biblix
 */
export function createBibleFormat(plugin: ToposPlugin): FileFormat<BibleBook, BibleReader> {
  return {
    name: "Bible",
    noun: "book",
    // A biblix package's books open through their stubs (`.bible`, see core/stubs.ts)
    extensions: [...BOOK_EXTENSIONS, STUB_EXTENSION],
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
    load: (app, file) => loadBook(plugin, app, file),
    // A section per chapter, its verses' text in order; a range is its verses plus the exact words
    extractText: async (app, file) => {
      const doc = await loadBook(plugin, app, file);
      try {
        const sections: { index: number; title: string | null; text: string }[] = [];
        const verses = new Map<number, { verse: BookVerse; start: number }[]>();
        for (const chapter of doc.book.chapters()) {
          const inChapter = doc.book.verses().filter((v) => v.chapter === chapter);
          const passage = {
            bookId: doc.bookId,
            book: doc.name,
            reference: "",
            segments: inChapter.map((v): PassageSegment => ({ tag: "Verses", start: { chapter, verse: v.verse }, end: null })),
            osis: "",
            usfm: "",
          };
          const texts = doc.book.text(passage, plugin.bookTextOptions());
          let text = "";
          const starts: { verse: BookVerse; start: number }[] = [];
          texts.forEach((t, i) => {
            if (text) text += " ";
            starts.push({ verse: inChapter[i]!, start: text.length });
            text += t;
          });
          verses.set(chapter, starts);
          sections.push({ index: chapter, title: `${doc.name} ${chapter}`, text });
        }
        const verseAt = (chapter: number, offset: number) => {
          const starts = verses.get(chapter) ?? [];
          return starts[Math.max(0, starts.findLastIndex((s) => s.start <= offset))]?.verse;
        };
        return {
          sections,
          locator: (chapter, start, end) => {
            const a = verseAt(chapter, start);
            const b = verseAt(chapter, Math.max(start, end - 1));
            const text = sections.find((s) => s.index === chapter)?.text.slice(start, end);
            if (!a || !b || !text) return null;
            const part = { chapter, verse: a.verse, endChapter: chapter, endVerse: b.last };
            return withTextDirective(formatVerseLocator([part]), serializeTextFragment({ start: text }));
          },
        };
      } finally {
        doc.book.dispose();
      }
    },
    unload: (doc) => doc.book.dispose(),
    info: (doc, file) => ({ title: doc.bible ? `${doc.name} (${doc.bible})` : doc.name || file.basename, author: "" }),
    createReader: (host, doc, opts, preview) =>
      new BibleReader(host, doc, { ...opts, text: plugin.bookTextOptions(), stylesheet: plugin.bibleStyles.sheet }, preview),
    // Besides the shared ones ({{book}} is the title, "John (BSB)"; {{chapter}} the chapter, "John 3")
    templateVars: (info, doc) => {
      const parts = parseVerseLocator(info.locator) ?? [];
      const verses = parts.length > 0 ? formatVerseLocator(parts).slice(2).replaceAll(";", "; ") : "";
      return { reference: [doc?.name, verses].filter(Boolean).join(" "), verses, bible: doc?.bible ?? "" };
    },
    extraTemplateVars: "{{reference}} (John 3:16-18), {{verses}} (3:16-18), {{bible}} (the translation)",
    appearance: { hidden: ["dimImages"], publisherName: null },
  };
}

async function loadBook(plugin: ToposPlugin, app: App, file: TFile): Promise<BibleBook> {
  const topos = await plugin.engine();
  let text: string;
  let extension = file.extension;
  let stubBible: string | null = null;
  if (file.extension === STUB_EXTENSION) {
    // A package's book: read from the library, where its stub says
    const target = await plugin.packages.stubTarget(file);
    if (!target) throw new Error(`${file.path}: its package isn't installed (run bx install, or add it again)`);
    text = await app.vault.adapter.read(target.path);
    extension = target.path.slice(target.path.lastIndexOf(".") + 1).toLowerCase();
    stubBible = target.bible;
  } else {
    text = await app.vault.cachedRead(file);
  }
  if (extension === "usfm" || extension === "sfm") text = Biblix.new().usfmToUsx(text);
  const book = ToposBook.parse(topos, "usx", text);
  if (!book) throw new Error("not a USX file");
  const bookId = book.bookId() ?? 0;
  const info = topos.books().find((b) => b.id === bookId);
  // A package's books are in `usx/`: its name is the package's abbreviation
  const bible = stubBible ?? plugin.bibles.ofFile(file.path)?.name ?? file.parent?.name ?? "";
  return { book, bookId, name: info?.name ?? file.basename, bible };
}
