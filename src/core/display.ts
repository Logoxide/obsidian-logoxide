import type { MarkLook, ToposSettings } from "./settings.ts";

/** The settings that change how Bible text looks */
export type DisplaySettings = Pick<ToposSettings, "footnotes" | "crossRefs" | "verseNumbers" | "wordsOfJesus" | "contextVerses">;

/**
 * The display settings as CSS for Bible text (its tab, previews, and embeds), in the readers'
 * `document` layer, after their own rules: the vault's Bible stylesheet, outside any layer, still
 * wins. Notes are rendered when either kind is shown, so this hides the other kind
 */
export function displayCss(settings: DisplaySettings): string {
  const rules = [
    // A verse number is its marker's ::before (the marker stays, for locators); a note goes with its mark
    mark(".topos-verse", settings.verseNumbers, ".topos-verse::before { content: none; }"),
    mark(".topos-note:not(.topos-crossref)", settings.footnotes, ".topos-note:not(.topos-crossref) { display: none; }"),
    mark(".topos-note.topos-crossref", settings.crossRefs, ".topos-note.topos-crossref { display: none; }"),
  ];
  // The words of Jesus: the Bible stylesheet's color, else the setting's
  if (settings.wordsOfJesus !== "none") rules.push(`.topos-woj { color: var(--tpb-woj-color, ${cssColor(settings.wordsOfJesus)}); }`);
  // The verses around a preview's passage (`v=3:16&c=2`): faded, as the passage, or in a color
  if (settings.contextVerses === "faded") rules.push(".tpb-context { opacity: 0.5; }");
  else if (settings.contextVerses !== "none") rules.push(`.tpb-context { color: ${cssColor(settings.contextVerses)}; }`);
  return `@layer document {\n${rules.join("\n")}\n}\n`;
}

/** A mark's rule: its `::before` (a verse number, a note's letter) in its color, or `hidden` */
function mark(selector: string, look: MarkLook, hidden: string): string {
  if (look === "none") return hidden;
  return `${selector}::before { color: ${cssColor(look)}; opacity: ${look === "faded" ? 0.6 : 1}; }`;
}

/**
 * A look's color (`faded`: the text's; `accent`: the theme's; `red`: a soft red, styles.css's for
 * the light or dark theme), or the text's color if it isn't one (it goes into CSS as is)
 */
function cssColor(look: MarkLook): string {
  if (look === "accent") return "var(--text-accent)";
  if (look === "red") return `var(--topos-red-letters, ${RED_LETTERS})`;
  return /^#[0-9a-f]{3,8}$/i.test(look.trim()) ? look.trim() : "currentColor";
}

/** The words of Jesus' red when the theme doesn't say (styles.css gives one for each theme) */
export const RED_LETTERS = "#c0453e";

/** Whether notes are rendered (either kind shows) */
export function notesShown(settings: Pick<ToposSettings, "footnotes" | "crossRefs">): boolean {
  return settings.footnotes !== "none" || settings.crossRefs !== "none";
}
