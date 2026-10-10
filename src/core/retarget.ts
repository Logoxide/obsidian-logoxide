/**
 * Links in a note's text that point at one file, pointed at another instead: what Obsidian does on
 * a rename, for files that don't move (a folder Bible's book file and its stub, `core/stubs.ts`)
 */

/** A link in a note, as Obsidian's metadata cache has it */
export interface NoteLink {
  /** Where it is in the text (null for a link in the properties, found by its text) */
  start: number | null;
  end: number | null;
  /** As written: `[[JHN.usx#v=3:16|John 3:16]]`, `[x](JHN.usx#v=3:16)` */
  original: string;
  /** Its target, decoded: `JHN.usx#v=3:16` */
  link: string;
}

/** A link written to `to` (a link path, as `fileToLinktext` gives), keeping its subpath and text; null when it can't be */
export function retargetLink(link: NoteLink, to: string): string | null {
  const hash = link.link.indexOf("#");
  const path = hash === -1 ? link.link : link.link.slice(0, hash);
  if (!path) return null;
  const { original } = link;
  // A wikilink: the path right after `[[`
  const wiki = /^!?\[\[/.exec(original);
  if (wiki) {
    const at = wiki[0].length;
    return original.startsWith(path, at) ? original.slice(0, at) + to + original.slice(at + path.length) : null;
  }
  // A Markdown link: the path after `](`, encoded or in angle brackets
  const open = original.lastIndexOf("](");
  if (open === -1) return null;
  const at = open + 2;
  for (const [written, replacement] of [
    [`<${path}`, `<${to}`],
    [encodeURI(path), encodeURI(to)],
    [path.replace(/ /g, "%20"), to.replace(/ /g, "%20")],
    [path, to.replace(/ /g, "%20")],
  ] as const) {
    if (original.startsWith(written, at)) return original.slice(0, at) + replacement + original.slice(at + written.length);
  }
  return null;
}

/**
 * A note's text with these links pointed at `to`: links with a place are changed there (when the
 * text there is still the link), links in the properties where their text first appears in them.
 * Also how many were changed
 */
export function retargetLinks(text: string, links: NoteLink[], to: string): { text: string; changed: number } {
  let changed = 0;
  const placed = links.filter((l) => l.start !== null && l.end !== null).sort((a, b) => b.start! - a.start!);
  for (const link of placed) {
    if (text.slice(link.start!, link.end!) !== link.original) continue;
    const next = retargetLink(link, to);
    if (next === null) continue;
    text = text.slice(0, link.start!) + next + text.slice(link.end!);
    changed++;
  }
  // Properties: between the opening `---` and the closing one
  const front = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  if (front) {
    let block = front[0];
    for (const link of links.filter((l) => l.start === null)) {
      const next = retargetLink(link, to);
      if (next === null || !block.includes(link.original)) continue;
      block = block.replace(link.original, () => next);
      changed++;
    }
    text = block + text.slice(front[0].length);
  }
  return { text, changed };
}
