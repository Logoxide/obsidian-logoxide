import type { NotesLayout } from "./notes-files.ts";
import { BookStyle } from "logoxide";
import type { BookCompletion } from "./completions.ts";
import { SITES } from "./links.ts";
import { DEFAULT_FORMAT, type FormatSettings } from "./format.ts";
import type { SavedQuery } from "./query.ts";
import type { SortOrder } from "./sort.ts";
import type { ReaderSettings } from "file-plus-plus/core";

export type StyleName = "name" | "abbreviation" | "osis";

/**
 * How a mark in Bible text (verse numbers, notes, the words of Jesus) shows: not at all (the words
 * of Jesus: as the rest of the text), in the text's color faded, the accent color, a soft red (`red`,
 * lighter on a dark theme), or a color like `#7c3aed`
 */
export type MarkLook = "none" | "faded" | "accent" | "red" | (string & {});

/** How a reference's text after it is written (see `ToposSettings.inlineText`) */
export type InlineTextStyle = "italic" | "normal" | "bold" | "bold-italic";

/** What clicking or tapping a reference opens (see `ToposSettings.referenceTap`) */
export type ReferenceTap = "whole" | "part" | "menu";

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
  /**
   * What clicking or tapping a reference opens: all of it, from its first verse (`whole`); the part
   * under the pointer, and a range's last verse on it (`part`); or a menu of where each part starts
   * and ends (`menu`)
   */
  referenceTap: ReferenceTap;
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
  /** Name folder Bibles' books by their titles: a stub beside each book file (`John.bible` beside `JHN.usx`), links moved to it */
  folderStubs: boolean;
  /** With `folderStubs`, hide those Bibles' USX and USFM files in the file explorer */
  hideBookFiles: boolean;
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
  /** Translations in rows' own appearance (font size, font, line spacing…), over each Bible's; empty: theirs */
  rowsAppearance: Partial<ReaderSettings>;
  /** Footnotes' marks in Bible text (and study notes: every note but cross references) */
  footnotes: MarkLook;
  /** Cross references' marks in Bible text */
  crossRefs: MarkLook;
  /** Show section headings in Bible text */
  bibleHeadings: boolean;
  /** The number before each verse */
  verseNumbers: MarkLook;
  /** The words of Jesus' color, in Bibles that mark them (`none`: the text's) */
  wordsOfJesus: MarkLook;
  /**
   * A CSS file in the vault for Bible text (its tab, previews, and embeds), which render where
   * Obsidian's CSS snippets don't reach; "" for none
   */
  bibleCss: string;
  /** Where links to references (`[John 1:1]`, `[text](John 1:1)`) open: the Bible tab or the link site */
  referenceLinks: "bible" | "site";
  /** Embeds and hover previews show the verses around their passage (else each embed's button does) */
  showContext: boolean;
  /** How many verses around a passage its context is (a link's `&c=2` says otherwise) */
  previewContext: number;
  /** How the verses around a preview's passage look: faded, as the passage (`none`), or in a color */
  contextVerses: MarkLook;
  /** Show bare references' text on hover (links and explicit links always preview) */
  previewBare: boolean;
  /** In live preview, a reference's text after it (not where it's embedded): `inlineTextTemplate`, up to `inlineTextLength` characters */
  inlineText: boolean;
  /** What that text is: `{first}`, `{last}`, `{text}`, `{reference}`, `{bible}` (see `core/inline-text.ts`) */
  inlineTextTemplate: string;
  /** Its most characters (0: all of it) */
  inlineTextLength: number;
  /** Whether it wraps onto more lines (else it's cut at the line's end, with an ellipsis) */
  inlineTextWrap: boolean;
  /** Its color: `faded` (the theme's faint text), `muted`, `accent`, or a color */
  inlineTextColor: MarkLook;
  /** Its style */
  inlineTextStyle: InlineTextStyle;
  /** The space before it (its `padding-left`, a CSS length: `1em`, `12px`) */
  inlineTextPadding: string;
  /** Also after a reference in a heading (`## John 3` in a book's notes) */
  inlineTextInHeadings: boolean;
  /**
   * Where to show the text of a bare reference alone on its line, like `![John 1:1]` (in the
   * editor, unless the cursor is near it), on devices that haven't chosen (`embedAloneDevices`)
   */
  embedAlone: EmbedAloneIn;
  /** Each device's own `embedAlone`, by file-plus-plus's device id (a phone and a computer can differ) */
  embedAloneDevices: Record<string, EmbedAloneIn>;
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
  /** The commentary view follows the Bible tab's verse and the reference under the editor's cursor */
  commentaryFollows: boolean;
  /** Where notes on a Bible book go: one file shared by the translations (`Bibles/John.md`), or one a translation (`Bibles/ESV/John.md`) */
  notesLayout: NotesLayout;
  /** The folder of the notes on Bible books */
  notesFolder: string;
  /** In a Bible tab's Highlights list, the places notes write out a verse of its book (`John 3:16`, not a link), under Elsewhere */
  mentionsInHighlights: boolean;
  /** A mark beside each verse a commentary has a note on, in Bible tabs; it opens the *Commentaries* tab */
  commentaryMarks: boolean;
  /** A commentary's note also covers the verses after it up to its next note in the chapter (a verse it skips shows the note before it) */
  stretchNotes: boolean;
  /** Show a Strong's number's dictionary entry on hover (Bible words that carry one, `G25` in notes and the editor) */
  strongsHover: boolean;
  /** Once file-plus-plus's default link label has become `{{reference}}` */
  bibleAliasDefault?: boolean;
  /** Whether file-plus-plus's copy formats have had *Embed* added (once: it can be deleted) */
  embedCopyFormat?: boolean;
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
  referenceTap: "whole",
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
  folderStubs: true,
  hideBookFiles: true,
  followPlayback: true,
  playbackRate: 1,
  bibleAliases: "",
  compareBibles: "",
  rowsAppearance: {},
  footnotes: "none",
  crossRefs: "none",
  bibleHeadings: true,
  verseNumbers: "faded",
  wordsOfJesus: "red",
  bibleCss: "",
  referenceLinks: "bible",
  showContext: false,
  previewContext: 2,
  contextVerses: "faded",
  previewBare: true,
  inlineText: false,
  inlineTextTemplate: "{first}",
  inlineTextLength: 120,
  inlineTextWrap: true,
  inlineTextColor: "faded",
  inlineTextStyle: "italic",
  inlineTextPadding: "1em",
  inlineTextInHeadings: false,
  embedAlone: "off",
  embedAloneDevices: {},
  embedAloneBlankLines: 0,
  embedAloneCursorLines: null,
  pickerTestament: false,
  pickerNumbers: "grid",
  pickerVerse: true,
  markInDocuments: true,
  commentaryFollows: true,
  notesLayout: "shared",
  notesFolder: "Bibles",
  mentionsInHighlights: true,
  commentaryMarks: true,
  stretchNotes: false,
  strongsHover: true,
};

export function bookStyle(name: StyleName): BookStyle {
  return { name: BookStyle.Name, abbreviation: BookStyle.Abbreviation, osis: BookStyle.Osis }[name];
}

/** Where references alone on their line are embedded: live preview, reading view, both, or neither */
export type EmbedAloneIn = "off" | "editor" | "reading" | "both";

/** Where this device embeds references alone on their line (`embedAlone` until it chooses) */
export function embedAloneWhere(settings: ToposSettings, device: string | undefined): EmbedAloneIn {
  return (device && settings.embedAloneDevices?.[device]) || settings.embedAlone;
}

/** Whether this device embeds references alone on their line in the editor's live preview or the reading view */
export function embedsAloneIn(settings: ToposSettings, device: string | undefined, view: "editor" | "reading"): boolean {
  const where = embedAloneWhere(settings, device);
  return where === "both" || where === view;
}

/** How many lines away from an embedded reference the cursor shows it again */
export function embedAloneCursorLines(settings: ToposSettings): number {
  return settings.embedAloneCursorLines ?? settings.embedAloneBlankLines;
}
