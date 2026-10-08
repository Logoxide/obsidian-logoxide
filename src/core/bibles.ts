/**
 * Bibles in the vault: a folder of USX or USFM files (one book each, as Paratext, the Digital Bible
 * Library, and eBible.org publish them) is a translation, named after the folder.
 */

export interface BibleFile {
  path: string;
  /** The file name without its extension */
  basename: string;
  /** The parent folder's path ("" at the vault's root) */
  folder: string;
}

export interface Bible {
  /** The folder's path, which identifies the Bible */
  folder: string;
  /** The folder's name: `BSB` */
  name: string;
  /** Each book's file, by book id (1 for Genesis) */
  books: Map<number, string>;
  /** Files whose book isn't known from their name yet (read their `<book code>`) */
  unknown: string[];
  /** From a biblix package (its verse counts come from biblix, not `VerseCounts`) */
  package?: boolean;
}

/** Book files' extensions: USX, and USFM (read as USX through biblix) */
export const BOOK_EXTENSIONS = ["usx", "usfm"];

/**
 * A book's USFM code from its file name: `JHN.usx`, `jhn.usx`, `43JHN.usx`, `44JHNBSB.usx`
 * (Paratext's), or `B04___01_John.usx`-style names that contain the code as a separate word
 */
export function codeFromName(basename: string, codes: Set<string>): string | null {
  const name = basename.toUpperCase();
  if (codes.has(name)) return name;
  // Paratext: the book number, then the code, then the project
  const paratext = /^\d{2}([A-Z0-9]{3})/.exec(name);
  if (paratext && codes.has(paratext[1])) return paratext[1];
  for (const word of name.split(/[^A-Z0-9]+/)) if (codes.has(word)) return word;
  return null;
}

/** The book code a USX file declares (`<book code="JHN" ...>`), or a USFM file (`\\id JHN`) */
export function codeFromUsx(text: string): string | null {
  const head = text.slice(0, 4096);
  const code = /<book\b[^>]*\bcode="([^"]+)"/.exec(head)?.[1] ?? /\\id\s+(\S+)/.exec(head)?.[1];
  return code?.toUpperCase() ?? null;
}

/** The Bibles these USX files make up, sorted by name */
export function groupBibles(files: BibleFile[], bookIds: Map<string, number>): Bible[] {
  const codes = new Set(bookIds.keys());
  const bibles = new Map<string, Bible>();
  for (const file of files) {
    let bible = bibles.get(file.folder);
    if (!bible) {
      bible = { folder: file.folder, name: file.folder.split("/").pop() || "Bible", books: new Map(), unknown: [] };
      bibles.set(file.folder, bible);
    }
    const code = codeFromName(file.basename, codes);
    const id = code ? bookIds.get(code) : undefined;
    if (id !== undefined && !bible.books.has(id)) bible.books.set(id, file.path);
    else bible.unknown.push(file.path);
  }
  return [...bibles.values()].sort((a, b) => a.name.localeCompare(b.name));
}
