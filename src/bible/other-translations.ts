import type { TFile } from "obsidian";
import type { Annotation, AnnotationProvider, HighlightEntry } from "file-plus-plus/obsidian";
import type { Bible } from "../core/bibles.ts";
import { formatVerseLocator, parseVerseLocator } from "../core/verse-locator.ts";
import type ToposPlugin from "../main.ts";

export const OTHER_TRANSLATIONS = "logoxide-other-translations";

/** What other Bibles' highlights are drawn in (their own color is in the hover) */
const OTHER_COLOR = "gray";

/** A highlight in another Bible, as marked in this one */
interface OtherHighlight {
  entry: HighlightEntry;
  /** The Bible it's in */
  bible: Bible;
  /** Its words there, when it's part of the verses (`so loved the world`) */
  words: string | null;
}

/** A highlight's words (its locator's `:~:text=`), or null for whole verses */
function highlightWords(locator: string): string | null {
  const m = /(?::~:|%3A~%3A)text=([^&]*)/i.exec(locator);
  if (!m) return null;
  try {
    return m[1]
      .split(",")
      .map((part) => decodeURIComponent(part).replace(/-$|^-/, ""))
      .join(" … ");
  } catch {
    return null;
  }
}

/**
 * Highlights made in the other Bibles, faint in this one: each over the whole verses it's in (their
 * words differ, so its own words can't be found), placed through the vault's versification maps when
 * the two are numbered differently, all in grey. Hover shows where it's from, its color, its words, and its comment; the
 * menu opens it there, or its note
 */
export function otherTranslationsProvider(plugin: ToposPlugin): AnnotationProvider<OtherHighlight> {
  const marked = (file: TFile): Annotation<OtherHighlight>[] => {
    const here = plugin.notes.bookOf(file.path);
    if (!here) return [];
    const bookId = here.book.id;
    const out: Annotation<OtherHighlight>[] = [];
    for (const bible of plugin.bibles.all()) {
      if (bible.folder === here.bible.folder) continue;
      // A folder Bible's highlights may link to its stub or to its book file
      const paths = new Set([bible.books.get(bookId), bible.files?.get(bookId)].filter((p): p is string => !!p));
      for (const path of paths) {
        for (const entry of plugin.annotator.index.get(path)) {
          if (entry.mention) continue;
          const parts = parseVerseLocator(entry.locator);
          if (!parts) continue;
          const placed = plugin.placePartsIn(bookId, parts, bible, here.bible);
          if (placed.parts.length === 0) continue;
          out.push({
            id: `${bible.folder}:${entry.id}`,
            locator: formatVerseLocator(placed.parts),
            // Grey whatever its color: several overlapping ones don't mix into another color
            color: OTHER_COLOR,
            label: `Highlighted in ${bible.name}`,
            data: { entry, bible, words: highlightWords(entry.locator) },
          });
        }
      }
    }
    return out;
  };
  return {
    id: OTHER_TRANSLATIONS,
    name: "Highlights in other translations",
    noun: "highlights in other translations",
    icon: "languages",
    // Over whole verses: a long press selects their words, a tap opens the menu
    holdSelects: true,
    // Faint: a grey wash under the verses, dotted beneath
    style: (c) => `background-color: color-mix(in srgb, ${c} 14%, transparent); text-decoration: underline dotted 1px color-mix(in srgb, ${c} 70%, transparent); text-underline-offset: 4px;`,
    annotations: (file) => marked(file),
    tooltip: (a) => {
      const { bible, words, entry } = a.data as OtherHighlight;
      const color = entry.color ?? plugin.settings.defaultColor;
      const what = color ? `${color[0].toUpperCase()}${color.slice(1)} highlight` : "Highlighted";
      return [`${what} in ${bible.name}${words ? `: “${words}”` : ""}`, entry.comment ?? ""].filter(Boolean).join("\n");
    },
    menu: (menu, annotations) => {
      for (const a of annotations) {
        const { bible, entry } = a.data as OtherHighlight;
        const file = plugin.app.vault.getFileByPath(entry.targetPath);
        menu.addItem((i) =>
          i
            .setTitle(`Open in ${bible.name}`)
            .setIcon("book-open")
            .onClick(() => {
              if (file) void plugin.openDocument(file, entry.locator.replace(/(:~:|%3A~%3A).*$/i, ""), false, { eState: { link: true } });
            }),
        );
        menu.addItem((i) =>
          i
            .setTitle(`Open the ${bible.name} highlight's note`)
            .setIcon("file-text")
            .onClick(() => void plugin.annotator.openSource(entry)),
        );
      }
    },
  };
}

/** The Bible book files whose marks change when highlights in these files do: the same book in every Bible */
export function siblingPaths(plugin: ToposPlugin, changed: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const path of changed) {
    const of = plugin.notes.bookOf(path);
    if (!of) continue;
    for (const bible of plugin.bibles.all()) {
      const p = bible.books.get(of.book.id);
      if (p) out.add(p);
      const f = bible.files?.get(of.book.id);
      if (f) out.add(f);
    }
  }
  return [...out];
}
