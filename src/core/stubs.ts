/**
 * Book stubs: a small file in the vault for each book of an installed logoxide package, standing in
 * for the book. It names the package (as the vault's `logoxide.toml` does) and the book's path in
 * it, never a version, so it stays where it is when the package is updated. Opening a stub opens
 * the book it names; links, highlights, and annotation files (beside the stub) point at the stub,
 * so they survive updates, and the package's own files are never shown to be edited.
 *
 * Stubs are named by their book's title, in their package's folder: `Logoxide/bsb/John.bible` for
 * `usx/JHN.usx` in the package `bsb` (a title changes only in a package's major release; when it
 * does, the stub is renamed and links to it follow). A package's EPUBs are copied the same way:
 * `Logoxide/the-dorean-principle/The Dorean Principle.epub`. A file of several books (a whole Bible
 * in OSIS or ThML, as CCEL's) has a stub for each book, named by the book and naming it by its
 * USFM code: `Logoxide/kjv/John.bible`.
 */

/** A stub's extension: the Bible format opens these */
export const STUB_EXTENSION = "bible";

/** What a stub names */
export interface Stub {
  /** The package, by the name the vault's `logoxide.toml` gives it (`bsb`, `kjv-bob`) */
  package: string;
  /** The book's path in the package (`usx/JHN.usx`) */
  path: string;
  /** Its USFM code (`JHN`), when the file holds several books (a whole Bible in OSIS or ThML) */
  book?: string;
}

/** Folder names in the library a package's stubs can't use (the library's own) */
export const RESERVED = ["packages", "imports"];

/** A file's path without its extension (`usx/JHN.usx` is `usx/JHN`) */
function stem(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? path.slice(0, dot) : path;
}

/**
 * Where a book's stub (or copy) goes: under `root`, in the package's folder, named `name` with
 * `extension`. Without a name, the book's path in the package (`usx/JHN.bible`)
 */
export function stubPath(root: string, stub: Stub, name: string | null = null, extension = STUB_EXTENSION): string {
  return [root, stub.package, `${name ?? stem(stub.path)}.${extension}`].filter(Boolean).join("/");
}

/** A title as a file name: without what Obsidian or links can't take (`/ \ : * ? " < > | # ^ [ ]`) */
export function fileName(title: string): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
}

/**
 * Each file's name in its package's folder, from its title (by path): titles two files share get
 * their file's name after (`John (JHN)`), and a file without a title keeps its path
 */
export function stubNames(files: { path: string; title: string | null }[]): Map<string, string | null> {
  const named = files.map((f) => ({ path: f.path, name: f.title ? fileName(f.title) || null : null }));
  const counts = new Map<string, number>();
  for (const { name } of named) if (name) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  return new Map(
    named.map(({ path, name }) => {
      if (!name) return [path, null];
      const shared = (counts.get(name.toLowerCase()) ?? 0) > 1;
      const base = path.slice(path.lastIndexOf("/") + 1);
      return [path, shared ? `${name} (${fileName(stem(base))})` : name];
    }),
  );
}

/** A stub's text */
export function stubText(stub: Stub): string {
  return `${JSON.stringify({ logoxide: stub.package, path: stub.path, ...(stub.book ? { book: stub.book } : {}) })}\n`;
}

/** What a stub's text names (null when it isn't a stub) */
export function parseStub(text: string): Stub | null {
  try {
    const value = JSON.parse(text) as { logoxide?: unknown; path?: unknown; book?: unknown };
    if (typeof value.logoxide !== "string" || typeof value.path !== "string") return null;
    return { package: value.logoxide, path: value.path, ...(typeof value.book === "string" ? { book: value.book } : {}) };
  } catch {
    return null;
  }
}

/** Stubs on disk that no package has now (to remove: only stubs, never other files) */
export function staleStubs(existing: string[], wanted: Set<string>): string[] {
  return existing.filter((path) => path.endsWith(`.${STUB_EXTENSION}`) && !wanted.has(path));
}

/**
 * A folder Bible's stub: beside a book's own file (USX or USFM) in a folder of them, named by the
 * book (`Bibles/BSB/John.bible` for `JHN.usx`), naming that file. The Bible's books open through
 * these, so its tabs, links, and annotation files have the book's name; the file itself is left as
 * it is (a folder Bible may be a git checkout, or synced from elsewhere)
 */
export function folderStubText(file: string): string {
  return `${JSON.stringify({ file })}\n`;
}

/** The file a folder Bible's stub names, beside it (null when the text isn't one) */
export function parseFolderStub(text: string): string | null {
  try {
    const value = JSON.parse(text) as { file?: unknown; logoxide?: unknown };
    return typeof value.file === "string" && value.logoxide === undefined && !value.file.includes("/") ? value.file : null;
  } catch {
    return null;
  }
}
