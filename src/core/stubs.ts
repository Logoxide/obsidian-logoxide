/**
 * Book stubs: a small file in the vault for each book of an installed biblix package, standing in
 * for the book. It names the package (as the vault's `biblix.toml` does) and the book's path in
 * it, never a version, so it stays where it is when the package is updated. Opening a stub opens
 * the book it names; links, highlights, and annotation files (beside the stub) point at the stub,
 * so they survive updates, and the package's own files are never shown to be edited.
 *
 * Stubs mirror their package: `Biblix/bsb/usx/JHN.bible` for `usx/JHN.usx` in the package `bsb`.
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

/** Where a book's stub goes: under `root`, in the package's folder, the book's path with `.bible` */
export function stubPath(root: string, stub: Stub): string {
  const dot = stub.path.lastIndexOf(".");
  const slash = stub.path.lastIndexOf("/");
  const stem = dot > slash ? stub.path.slice(0, dot) : stub.path;
  return [root, stub.package, `${stem}.${STUB_EXTENSION}`].filter(Boolean).join("/");
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
