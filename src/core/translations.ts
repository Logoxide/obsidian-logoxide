import { ToposTranslations } from "logoxide";

/**
 * Translations a reference can name (`John 3:16 KJV`, `[John 3:16 (KJV)]`): the Bibles in the vault
 * (by folder name), and the names and aliases in the settings, one translation per line:
 *
 * ```
 * KJV: AV, King James
 * ESV
 * ```
 *
 * A name without a Bible in the vault still counts, so its links can name it (`{translation}` in
 * the link template); its text comes from the current Bible.
 */

/** Each line's name and its aliases: `KJV: AV, King James` */
export function parseAliases(text: string): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const [name = "", aliases = ""] = line.split(":");
    const trimmed = name.trim();
    if (!trimmed) continue;
    const list = aliases
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    names.set(trimmed, [...(names.get(trimmed) ?? []), ...list]);
  }
  return names;
}

/** A book's verse counts in a translation (from `LogoxideBook.usxChapterVerses`) */
export interface TranslationCounts {
  translation: string;
  bookId: number;
  counts: Uint8Array | number[];
}

/**
 * The translations: each Bible's name, then the settings' names and aliases (a Bible's name matched
 * ignoring case), with each book's verse counts
 */
export function buildTranslations(bibles: string[], aliases: Map<string, string[]>, counts: TranslationCounts[] = []): ToposTranslations {
  let translations = ToposTranslations.create();
  // Each method returns new translations; the ones before are freed
  const next = (made: ToposTranslations) => {
    translations.dispose();
    translations = made;
  };
  const names = new Map<string, string[]>();
  for (const bible of bibles) names.set(bible, []);
  for (const [name, list] of aliases) {
    const bible = bibles.find((b) => b.toLowerCase() === name.toLowerCase()) ?? name;
    names.set(bible, [...(names.get(bible) ?? []), ...list]);
  }
  for (const [name, list] of names) next(translations.add(name, list));
  for (const c of counts) next(translations.chapterVerses(c.translation, c.bookId, Uint8Array.from(c.counts)));
  return translations;
}
