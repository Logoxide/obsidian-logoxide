/**
 * The text shown after a reference in live preview (`inlineText`), from a template: `{first}` is
 * its first verse's text, `{last}` its last verse's, `{text}` all of it, `{reference}` the
 * reference (`John 3:16-18`), and `{bible}` the Bible the text is from
 */
export interface InlineValues {
  first: string;
  last: string;
  text: string;
  reference: string;
  bible: string;
}

export const INLINE_PLACEHOLDERS: (keyof InlineValues)[] = ["first", "last", "text", "reference", "bible"];

/** Which of the values a template uses, so only those are looked up */
export function inlineNeeds(template: string): Set<keyof InlineValues> {
  return new Set(INLINE_PLACEHOLDERS.filter((name) => template.includes(`{${name}}`)));
}

/**
 * A template filled in, on one line, cut to `max` characters (at a word, with an ellipsis); null
 * when what it shows is empty
 */
export function inlineText(template: string, values: InlineValues, max: number): string | null {
  // Without paragraph marks (the KJV's `¶`), which mean nothing on one line
  const value = (name: keyof InlineValues) => values[name].replace(/¶\s*/g, "");
  const filled = template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? value(name as keyof InlineValues) : whole));
  const text = filled.replace(/\s+/g, " ").trim();
  if (!text || !INLINE_PLACEHOLDERS.some((name) => template.includes(`{${name}}`) && values[name])) return null;
  if (max <= 0 || text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.—–-]+$/, "")}…`;
}
