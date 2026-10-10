import { BookStyle } from "logoxide";
import type { BookCompletion } from "./completions.ts";
import { SITES } from "./links.ts";
import { DEFAULT_FORMAT, type FormatSettings } from "./format.ts";
import type { SavedQuery } from "./query.ts";
import type { SortOrder } from "./sort.ts";

export type StyleName = "name" | "abbreviation" | "osis";

/** How a mark in Bible text (verse numbers, notes) shows: not at all, in the text's color faded, the accent color, or a color like `#7c3aed` */
export type MarkLook = "none" | "faded" | "accent" | (string & {});

export interface ToposSettings {
  /** How references are written by autocomplete, normalizing, and the sidebar */
  style: StyleName;
  /** Where references open: a link template (see links.ts), or "" for no links */
  linkTemplate: string;
  /** Highlight references in the editor and make them clickable */
  linkInEditor: boolean;
  /** Turn references into links in reading view */
  linkInReading: boolean;
  /** On desktop, only open references with Ctrl/Cmd-click */
  clickNeedsModifier: boolean;
  /** On mobile, a tap on a reference in an unfocused editor opens it (instead of placing the cursor) */
  tapOpensInEditor: boolean;
  /** References' color, like `#d8b4fe` ("" uses the theme's accent color) */
  referenceColor: string;
  /** Suggest chapters, verses, and books while typing */
  autocomplete: boolean;
  /** Book names in prose would trigger on every word, so by default they need a capital */
  bookCompletion: BookCompletion;
  suggestionLimit: number;
  /** How references are written everywhere (with `style` for the book) */
  format: FormatSettings;
  /** File extensions to search, separated by commas */
  extensions: string;
  /** Also search EPUBs (needs the EPUB++ plugin, which opens them and shows their references) */
  searchEpubs: boolean;
  /**
   * On a phone or tablet, search EPUBs that no other device has indexed yet (slow for a big
   * library; off, they wait for a computer to index them and sync)
   */
  searchEpubsOnMobile: boolean;
  /** Folders to leave out of search, one per line */
  excludeFolders: string;
  /** The sidebar's order and grouping, remembered between sessions */
  sort: SortOrder;
  groupBy: "file" | "book";
  /** Lines of context around each result in the sidebar */
  context: number;
  /** Named searches, with the CLI's filter options */
  queries: SavedQuery[];
  /** 2 once saved searches use 0.4.0's options (`-o` is explicit overlap) */
  queryFormat?: number;
  /** Index the vault in a background thread, or with the topos CLI (desktop only) */
  engine: "builtin" | "cli";
  /** Path to the topos command ("" finds it in ~/.cargo/bin or PATH) */
  cliPath: string;
  /** Let the CLI reuse results for unchanged files between runs */
  cliCache: boolean;
  /** The Bible references open in and preview from: a folder of USX files ("" for the first) */
  bible: string;
  /**
   * The logoxide library's folder: installed packages (`packages/<id>/<version>/`). A dot-folder by
   * default, so it isn't synced or shown: each device installs what `logoxide.lock` pins
   */
  logoxideLibrary: string;
  /**
   * The vault's Bible packages folder: its `logoxide.toml` and `logoxide.lock` (unless they're at the
   * vault's root), imports, each Bible book's stub, and each book package's EPUBs
   */
  logoxideBooks: string;
  /** Hide the packages folder from the file explorer and from Obsidian's search */
  hideLogoxideBooks: boolean;
  /** While a Bible's recording plays, keep the verse being read in view */
  followPlayback: boolean;
  /** The recordings' playback speed (the player's speed button) */
  playbackRate: number;
  /** Translations' names and aliases, one per line: `KJV: AV, King James` (see core/translations.ts) */
  bibleAliases: string;
  /** Bibles embeds also show, by name, separated by commas: `KJV, NET` */
  compareBibles: string;
  /** Footnotes' marks in Bible text (and study notes: every note but cross references) */
  footnotes: MarkLook;
  /** Cross references' marks in Bible text */
  crossRefs: MarkLook;
  /** Show section headings in Bible text */
  bibleHeadings: boolean;
  /** The number before each verse */
  verseNumbers: MarkLook;
  /** Show the words of Jesus in red */
  bibleRedLetters: boolean;
  /**
   * A CSS file in the vault for Bible text (its tab, previews, and embeds), which render where
   * Obsidian's CSS snippets don't reach; "" for none
   */
  bibleCss: string;
  /** Where links to references (`[John 1:1]`, `[text](John 1:1)`) open: the Bible tab or the link site */
  referenceLinks: "bible" | "site";
  /** Show bare references' text on hover (links and explicit links always preview) */
  previewBare: boolean;
  /**
   * Show the text of a bare reference alone on its line, like `![John 1:1]` (in the editor, unless
   * the cursor is near it)
   */
  embedAlone: boolean;
  /** Blank lines that must be above and below such a reference (0: it only needs a line of its own) */
  embedAloneBlankLines: number;
  /** In the editor, how many lines away the cursor shows the reference again (null: `embedAloneBlankLines`) */
  embedAloneCursorLines: number | null;
  /** The passage picker first asks for the Old or New Testament, so its books have more room */
  pickerTestament: boolean;
  /** The passage picker's chapters and verses: a grid of numbers, or a field that brings up the number pad */
  pickerNumbers: "grid" | "keypad";
  /** The passage picker asks for a verse after the chapter (else it opens the chapter's start) */
  pickerVerse: boolean;
  /** Mark references in other plugins' documents (Transcript++'s transcripts, the Bible tab) */
  markInDocuments: boolean;
  /** Once file-plus-plus's default link label has become `{{reference}}` */
  bibleAliasDefault?: boolean;
  /** The entry this plugin added to Obsidian's excluded files to hide the packages folder (`Logoxide/`), to take out again */
  hiddenFilter?: string;
}

export const DEFAULT_SETTINGS: ToposSettings = {
  style: "name",
  linkTemplate: SITES[0]!.template,
  linkInEditor: true,
  linkInReading: true,
  clickNeedsModifier: true,
  tapOpensInEditor: false,
  referenceColor: "",
  autocomplete: true,
  bookCompletion: "capitalized",
  suggestionLimit: 20,
  format: DEFAULT_FORMAT,
  extensions: "md, txt",
  searchEpubs: false,
  searchEpubsOnMobile: false,
  excludeFolders: "",
  sort: "file",
  groupBy: "file",
  context: 0,
  queries: [],
  engine: "builtin",
  cliPath: "",
  cliCache: true,
  bible: "",
  logoxideLibrary: ".logoxide",
  logoxideBooks: "Logoxide",
  hideLogoxideBooks: false,
  followPlayback: true,
  playbackRate: 1,
  bibleAliases: "",
  compareBibles: "",
  footnotes: "none",
  crossRefs: "none",
  bibleHeadings: true,
  verseNumbers: "faded",
  bibleRedLetters: false,
  bibleCss: "",
  referenceLinks: "bible",
  previewBare: true,
  embedAlone: false,
  embedAloneBlankLines: 0,
  embedAloneCursorLines: null,
  pickerTestament: false,
  pickerNumbers: "grid",
  pickerVerse: true,
  markInDocuments: true,
};

export function bookStyle(name: StyleName): BookStyle {
  return { name: BookStyle.Name, abbreviation: BookStyle.Abbreviation, osis: BookStyle.Osis }[name];
}

/** How many lines away from an embedded reference the cursor shows it again */
export function embedAloneCursorLines(settings: ToposSettings): number {
  return settings.embedAloneCursorLines ?? settings.embedAloneBlankLines;
}
