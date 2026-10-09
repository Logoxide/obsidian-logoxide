/**
 * Book stubs: a small file in the vault for each book of an installed biblix package, standing in
 * for the book. It names the package (as the vault's `biblix.toml` does) and the book's path in
 * it, never a version, so it stays where it is when the package is updated. Opening a stub opens
 * the book it names; links, highlights, and annotation files (beside the stub) point at the stub,
 * so they survive updates, and the package's own files are never shown to be edited.
 *
 * Stubs are named by their book's title, in their package's folder: `Biblix/bsb/John.bible` for
 * `usx/JHN.usx` in the package `bsb` (a title changes only in a package's major release; when it
 * does, the stub is renamed and links to it follow). A package's EPUBs are copied the same way:
 * `Biblix/the-dorean-principle/The Dorean Principle.epub`.
 */

/** A stub's extension: the Bible format opens these */
export const STUB_EXTENSION = "bible";

/** What a stub names */
export interface Stub {
  /** The package, by the name the vault's `biblix.toml` gives it (`bsb`, `kjv-bob`) */
  package: string;
  /** The book's path in the package (`usx/JHN.usx`) */
  path: string;
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
  return `${JSON.stringify({ biblix: stub.package, path: stub.path })}\n`;
}

/** What a stub's text names (null when it isn't a stub) */
export function parseStub(text: string): Stub | null {
  try {
    const value = JSON.parse(text) as { biblix?: unknown; path?: unknown };
    if (typeof value.biblix !== "string" || typeof value.path !== "string") return null;
    return { package: value.biblix, path: value.path };
  } catch {
    return null;
  }
}

/** Stubs on disk that no package has now (to remove: only stubs, never other files) */
export function staleStubs(existing: string[], wanted: Set<string>): string[] {
  return existing.filter((path) => path.endsWith(`.${STUB_EXTENSION}`) && !wanted.has(path));
}
