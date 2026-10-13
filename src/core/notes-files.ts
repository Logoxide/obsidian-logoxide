/**
 * The vault's notes on Bible books: one file a book, shared by every translation (`Bibles/John.md`)
 * or one a translation (`Bibles/ESV/John.md`), named in its frontmatter (`bible-book: John`, and
 * `bible-translation: ESV`), with a heading a chapter (`## John 3`). No Obsidian imports: tested
 * with Node.
 */
import { fileName } from "./stubs.ts";

/** Where notes on a book go: one file shared by the translations, or one a translation */
export type NotesLayout = "shared" | "translation";

/** The frontmatter property naming a notes file's book */
export const BOOK_KEY = "bible-book";
/** The frontmatter property naming a notes file's translation (one a translation) */
export const TRANSLATION_KEY = "bible-translation";

/** A notes file's path: `Bibles/John.md`, or `Bibles/ESV/John.md` (`translation`, with that layout) */
export function notesPath(folder: string, layout: NotesLayout, book: string, translation: string | null): string {
  const base = folder.trim().replace(/^\/+|\/+$/g, "");
  const parts = [base, layout === "translation" && translation ? fileName(translation) : "", `${fileName(book)}.md`].filter(Boolean);
  return parts.join("/");
}

/** A new notes file: its frontmatter, then a heading a chapter */
export function notesText(book: string, translation: string | null, chapters: number): string {
  const lines = ["---", `${BOOK_KEY}: ${yamlText(book)}`];
  if (translation) lines.push(`${TRANSLATION_KEY}: ${yamlText(translation)}`);
  lines.push("---", "");
  for (let chapter = 1; chapter <= chapters; chapter++) lines.push(`## ${book} ${chapter}`, "");
  return lines.join("\n");
}

/** A value as YAML: quoted when it would read as something else (`1 John` is fine; `true`, `: x` aren't) */
function yamlText(value: string): string {
  return /^[\w][\w .'-]*$/.test(value) && !/^(true|false|null|yes|no|~)$/i.test(value) ? value : JSON.stringify(value);
}

/**
 * Where a passage starts, as a verse locator, from its OSIS form: `John.3` is `v=3`, `John.3.16`
 * and `John.3.16-John.3.18` are `v=3:16`; null otherwise
 */
export function osisLocator(osis: string): string | null {
  const first = osis.split(/[-\s]/)[0] ?? "";
  const m = /\.(\d+)(?:\.(\d+))?$/.exec(first);
  if (!m) return null;
  return m[2] ? `v=${m[1]}:${m[2]}` : `v=${m[1]}`;
}

/** The chapter a heading names (`John 3`, `John 3:16`), from the passage's OSIS form, when it's in `bookOsis` */
export function headingChapter(osis: string, bookOsis: string): number | null {
  const first = osis.split(/[-\s]/)[0] ?? "";
  const m = /^([^.]+)\.(\d+)/.exec(first);
  return m && m[1] === bookOsis ? Number(m[2]) : null;
}
