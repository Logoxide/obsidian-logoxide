import type { ToposSettings } from "./settings.ts";

/** The settings that change how Bible text looks */
export type DisplaySettings = Pick<ToposSettings, "bibleNotes" | "bibleCrossRefs" | "bibleVerseNumbers" | "bibleRedLetters" | "verseNumberColor">;

/**
 * The display settings as CSS for Bible text (its tab, previews, and embeds), in the readers'
 * `document` layer, after their own rules: the vault's Bible stylesheet, outside any layer, still
 * wins. Notes are rendered when either kind is shown, so this hides the other kind
 */
export function displayCss(settings: DisplaySettings): string {
  const rules: string[] = [];
  if (!settings.bibleVerseNumbers) rules.push(".topos-verse::before { content: none; }");
  else if (settings.verseNumberColor) rules.push(`.topos-verse::before { color: ${cssColor(settings.verseNumberColor)}; opacity: 1; }`);
  if (!settings.bibleNotes) rules.push(".topos-note:not(.topos-crossref) { display: none; }");
  if (!settings.bibleCrossRefs) rules.push(".topos-note.topos-crossref { display: none; }");
  if (settings.bibleRedLetters) rules.push(".topos-woj { color: var(--tpb-woj-color, var(--color-red, #e93147)); }");
  return rules.length ? `@layer document {\n${rules.join("\n")}\n}\n` : "";
}

/** A color from the settings, or the text's color if it isn't one (it goes into CSS as is) */
function cssColor(color: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(color.trim()) ? color.trim() : "currentColor";
}
