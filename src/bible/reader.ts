import { DocumentReader, PREFIX, splitTextDirective, textFragmentScheme, withTextDirective, type LocatorScheme, type ParsedLocator, type ReaderOptions, type TocItem } from "file-plus-plus/core";
import type { BookTextOptions, ToposBook } from "logoxide";
import { END, formatVerseLocator, parseVerseLocator, partSegments, splitEdition, withEdition, type VersePart } from "../core/verse-locator.ts";

/** A Bible book opened from a USX file */
export interface BibleBook {
  book: ToposBook;
  bookId: number;
  /** The book's name: `John` */
  name: string;
  /** The translation (the folder's name): `BSB` */
  bible: string;
  /** For a package's Bible: its version and verse hashes, so links record them and find their verses again */
  edition?: BookEdition;
}

/** A package Bible's version, and its verses by the hash of their words */
export interface BookEdition {
  version: string;
  /** A verse's hash (8 hex digits) */
  hashOf(chapter: number, verse: number): string | undefined;
  /** Where words with this hash are now */
  find(hash: string): { chapter: number; verse: number } | undefined;
  /** Says a link's verse moved, or its words changed */
  said(message: string): void;
}

/** `v=3:16-18`: verses, chapters, and parts joined by `;` (see verse-locator.ts) */
export const verseScheme: LocatorScheme = {
  id: "verse",
  match(s) {
    // The verses, then the edition the link was made with (`&ver=…&vh=…`), then the exact words
    const m = /^v=[^&]*(?:&(?:ver|vh)=[^&]*)*/.exec(s);
    if (!m) return null;
    const parts = parseVerseLocator(m[0]);
    const { text } = splitTextDirective(m[0]);
    const { edition } = splitEdition(m[0]);
    const base = formatVerseLocator(parts ?? []);
    return parts ? { locator: withTextDirective(edition ? withEdition(base, edition) : base, text), rest: s.slice(m[0].length) } : null;
  },
  isRange: () => true,
};

export const BIBLE_SCHEMES: LocatorScheme[] = [verseScheme, textFragmentScheme];

export interface BibleReaderOptions extends ReaderOptions {
  text: BookTextOptions;
  /** The vault's Bible stylesheet for this document (see styles.ts), after the reader's own */
  stylesheet?: (doc: Document) => CSSStyleSheet | null;
}

/** A verse marker in the rendered text */
interface Marker {
  el: HTMLElement;
  chapter: number;
  verse: number;
  last: number;
}

/**
 * Renders a book as one page, a section per chapter, from topos's `ToposBook` (the HTML of
 * topos-bible-markup, whose verse markers are `span.topos-verse[data-n]`). A preview (hover or
 * embed) renders only its passage.
 */
export class BibleReader extends DocumentReader {
  readonly schemes = BIBLE_SCHEMES;
  private markers: Marker[] = [];
  private markerEls: HTMLElement[] = [];
  private _toc: TocItem[] = [];
  private readonly preview: VersePart[] | null;

  constructor(
    host: HTMLElement,
    readonly bible: BibleBook,
    private readonly opts: BibleReaderOptions,
    preview?: ParsedLocator,
  ) {
    super(host, opts);
    const sheet = opts.stylesheet?.(this.doc);
    if (sheet && this.shadow.adoptedStyleSheets && !this.shadow.adoptedStyleSheets.includes(sheet)) {
      this.shadow.adoptedStyleSheets = [...this.shadow.adoptedStyleSheets, sheet];
    }
    this.preview = preview?.scheme === verseScheme.id && preview.locator ? parseVerseLocator(preview.locator) : null;
  }

  get toc(): TocItem[] {
    return this._toc;
  }

  /** Whether only a passage is shown (a hover preview or an embed) */
  get isPreview(): boolean {
    return this.preview !== null;
  }

  /**
   * The reader's look, and USX's markers (topos-bible-markup gives each its \`data-style\`: \`q2\`,
   * \`pn\`, \`fr\`), in file-plus-plus's \`document\` layer: the vault's Bible stylesheet isn't in a
   * layer, so its rules win whatever their specificity
   */
  protected override extraCss(): string {
    return /* css */ `@layer document {
.topos-verse::before {
  content: attr(data-n);
  font-size: 0.65em;
  font-family: var(--font-interface, system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
  vertical-align: super;
  line-height: 0;
  opacity: 0.6;
  padding: 0 0.25em 0 0.1em;
  -webkit-user-select: none;
  user-select: none;
}
/* A passage (preview or embed) is short: lay it out now, so it can be measured */
.tpb-passage > .${PREFIX}-section { content-visibility: visible; contain-intrinsic-size: none; }
.tpb-passage { padding-top: 0.25em; padding-bottom: 1em; }
.tpb-passage .topos-title:first-child { margin-top: 0.5em; }
.tpb-chapter { font-size: 1.6em; font-weight: 600; margin: 1.2em 0 0.4em; }
.tpb-gap { text-align: center; opacity: 0.5; margin: 0.6em 0; -webkit-user-select: none; user-select: none; }
.topos-title { font-weight: 600; margin: 1em 0 0.3em; }
.topos-title.topos-d, .topos-title.topos-sp { font-weight: normal; font-style: italic; margin-top: 0.3em; }
.topos-title.topos-r, .topos-title.topos-mr { font-weight: normal; font-style: italic; font-size: 0.9em; }
.topos-woj { color: var(--tpb-woj-color, inherit); }
.topos-divine-name { font-variant: small-caps; }
/* Translators' additions (KJV italics) */
.topos-added { font-style: italic; }
.topos-l { display: inline-block; padding-left: 2em; text-indent: -1em; }
p.topos-p { margin: 0 0 0.6em; }
.topos-note { font-size: 0.85em; opacity: 0.75; }
.topos-note::before { content: " ["; }
.topos-note::after { content: "]"; }
${USX_CSS}
}`;
  }

  protected async renderContent(): Promise<void> {
    const { book } = this.bible;
    const frag = this.doc.createDocumentFragment();
    if (this.preview) {
      this.content.classList.add("tpb-passage");
      const passage = {
        bookId: this.bible.bookId,
        book: this.bible.name,
        reference: "",
        segments: partSegments(this.preview),
        osis: "",
        usfm: "",
      };
      const parts = book.html(passage, this.opts.text);
      parts.forEach((html, index) => {
        const wrapper = this.doc.createElement("div");
        if (index > 0) wrapper.append(gap(this.doc));
        const body = this.doc.createElement("div");
        body.innerHTML = html;
        wrapper.append(body);
        this.addSection({ index, wrapper, body });
        frag.append(wrapper);
      });
      if (parts.length === 0) {
        const wrapper = this.doc.createElement("div");
        const body = this.doc.createElement("div");
        body.textContent = `${this.bible.bible} has no text for this passage.`;
        wrapper.append(body);
        this.addSection({ index: 0, wrapper, body });
        frag.append(wrapper);
      }
    } else {
      const chapters = book.chapters();
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i]!;
        const wrapper = this.doc.createElement("div");
        const heading = this.doc.createElement("div");
        heading.className = "tpb-chapter";
        heading.textContent = chapters.length > 1 ? `${this.bible.name} ${chapter}` : this.bible.name;
        const body = this.doc.createElement("div");
        body.innerHTML = book.chapterHtml(chapter, this.opts.text);
        wrapper.append(heading, body);
        this.addSection({ index: chapter, wrapper, body });
        frag.append(wrapper);
        this._toc.push({ id: `c${chapter}`, label: heading.textContent, href: `v=${chapter}`, children: [], depth: 0 });
        // Long books (Psalms) render in steps, so the tab stays responsive
        if (i % 20 === 19) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (this.destroyed) return;
        }
      }
    }
    this.content.append(frag);
    this.indexMarkers();
  }

  private indexMarkers(): void {
    this.markers = [];
    for (const el of Array.from(this.content.querySelectorAll<HTMLElement>(".topos-verse"))) {
      const place = verseOf(el);
      if (!place) continue;
      const chapter = place.chapter ?? sectionChapter(el) ?? this.markers.at(-1)?.chapter ?? 1;
      this.markers.push({ el, chapter, verse: place.verse, last: place.last });
      if (startsLine(el)) el.classList.add("tpb-line-start");
    }
    this.markerEls = this.markers.map((m) => m.el);
  }

  // Locators

  protected resolveLocator(loc: ParsedLocator): Range | null {
    if (loc.scheme !== verseScheme.id || !loc.locator) return null;
    const parts = this.followed(loc.locator, parseVerseLocator(loc.locator));
    if (!parts) return null;
    // The exact words of one part: searched within its verses (the whole verses when they aren't there)
    const { text } = splitTextDirective(loc.locator);
    if (text && parts.length === 1) {
      const range = this.partRange(parts[0]!);
      return range && (this.resolveTextFragment(text, range) ?? range);
    }
    // A preview shows only its parts, so it highlights all of them; the book, the first
    const first = this.partRange(parts[0]!);
    if (!first || !this.preview || parts.length === 1) return first;
    const last = this.partRange(parts[parts.length - 1]!) ?? first;
    const range = this.doc.createRange();
    range.setStart(first.startContainer, first.startOffset);
    range.setEnd(last.endContainer, last.endOffset);
    return range;
  }

  /**
   * A link's verses where they are in this version: when the link was made with another version
   * whose words at its first verse aren't these, the words are looked for (renumbered: the link
   * goes there, keeping its length) and the reader is told
   */
  private followed(locator: string, parts: VersePart[] | null): VersePart[] | null {
    const { edition: made } = splitEdition(locator);
    const now = this.bible.edition;
    const first = parts?.[0];
    if (!parts || !first || !made?.hash || !now || first.verse === 0) return parts;
    if (now.hashOf(first.chapter, first.verse) === made.hash) return parts;
    const where = `${this.bible.name} ${first.chapter}:${first.verse}`;
    const found = now.find(made.hash);
    if (!found) {
      now.said(`The words of ${where} changed since this link was made (${this.bible.bible} ${made.version}, now ${now.version})`);
      return parts;
    }
    now.said(`${where} (${this.bible.bible} ${made.version}) is ${found.chapter}:${found.verse} in ${now.version}`);
    const moved = { ...first, chapter: found.chapter, verse: found.verse };
    if (first.endChapter === first.chapter) {
      moved.endChapter = found.chapter;
      moved.endVerse = first.endVerse === END ? END : first.endVerse - first.verse + found.verse;
    }
    return [moved, ...parts.slice(1)];
  }

  /** The text of verses (a bridge's whole verses), as a range */
  versesRange(part: VersePart): Range | null {
    return this.partRange(part);
  }

  /** The verses a range covers (a collapsed range: the verse it's in) */
  versesOf(range: Range): VersePart | null {
    const units = this.unitsOfRange(range);
    const a = units && this.markers[units.first];
    const b = units && this.markers[units.last];
    return a && b ? { chapter: a.chapter, verse: a.verse, endChapter: b.chapter, endVerse: b.last } : null;
  }

  /** The verse a verse number is (its marker, `span.topos-verse`) */
  verseOfMarker(el: Element): { chapter: number; verse: number } | null {
    const marker = this.markers.find((m) => m.el === el);
    return marker ? { chapter: marker.chapter, verse: marker.verse } : null;
  }

  /**
   * The verse at a point in the viewport (a right-click without a selection): the last verse
   * number before it in its section, by where the numbers are drawn
   */
  verseAtPoint(x: number, y: number, target: Node | null): { chapter: number; verse: number } | null {
    const body = target instanceof Element ? sectionBody(target as HTMLElement) : target?.parentElement ? sectionBody(target.parentElement) : null;
    let found: Marker | null = null;
    for (const m of this.markers) {
      if (body && !body.contains(m.el)) {
        if (found) break;
        continue;
      }
      const r = m.el.getBoundingClientRect();
      if (r.top > y || (r.bottom >= y && r.left > x)) break;
      found = m;
    }
    return found ? { chapter: found.chapter, verse: found.verse } : null;
  }

  /** The first verse in view */
  verseInView(): { chapter: number; verse: number } | null {
    const part = parseVerseLocator(this.getLocation()?.locator ?? "")?.[0];
    return part ? { chapter: part.chapter, verse: Math.max(1, part.verse) } : null;
  }

  /** From the first verse of a part to the next verse after it (or the end of its chapter) */
  private partRange(part: VersePart): Range | null {
    const key = (c: number, v: number) => c * 1000 + v;
    const start = key(part.chapter, part.verse);
    const end = key(part.endChapter, part.endVerse === END ? 999 : part.endVerse);
    const first = this.markers.findIndex((m) => key(m.chapter, m.last) >= start && key(m.chapter, m.verse) <= end);
    if (first === -1) return null;
    let next = first;
    while (next < this.markers.length && key(this.markers[next]!.chapter, this.markers[next]!.verse) <= end) next++;
    const range = this.doc.createRange();
    const firstMarker = this.markers[first]!;
    // A whole chapter starts with its headings
    const body = part.verse === 0 ? sectionBody(firstMarker.el) : null;
    if (body) range.setStart(body, 0);
    else range.setStartBefore(firstMarker.el);
    const after = this.markers[next];
    const lastBody = sectionBody(this.markers[next - 1]!.el);
    if (after && sectionBody(after.el) === lastBody) range.setEndBefore(after.el);
    else if (lastBody) range.setEnd(lastBody, lastBody.childNodes.length);
    else range.setEndAfter(this.markers[next - 1]!.el);
    return range;
  }

  /**
   * The verses a range covers (`v=3:16-18`), and when it covers only part of them, the exact words
   * (`v=3:16:~:text=so%20loved`), from file-plus-plus's units (the verse markers)
   */
  locatorFromRange(range: Range): string | null {
    const units = this.unitsOfRange(range);
    if (!units) return null;
    const a = this.markers[units.first]!;
    const b = this.markers[units.last]!;
    const part = { chapter: a.chapter, verse: a.verse, endChapter: b.chapter, endVerse: range.collapsed ? a.verse : b.last };
    // A package's Bible: the version, and the first verse's words, so the link can find them again
    const edition = this.bible.edition;
    const hash = edition?.hashOf(a.chapter, a.verse);
    const base = formatVerseLocator([part]);
    return withTextDirective(edition ? withEdition(base, { version: edition.version, hash: hash ?? null }) : base, units.text);
  }

  /** Verse markers are the units of locators, so selections of part of a verse keep their words */
  protected override unitElements(): readonly Element[] {
    return this.markerEls;
  }
}

/** USX's paragraph and character styles, as USFM's stylesheet (usfm.sty) describes them */
const USX_CSS = /* css */ `
/* Paragraphs */
p.topos-p[data-style="nb"] { margin-top: -0.6em; }
p.topos-p[data-style="pi"], p.topos-p[data-style="pi1"], p.topos-p[data-style="mi"], p.topos-p[data-style^="pm"] { padding-left: 1.5em; }
p.topos-p[data-style="pi2"] { padding-left: 3em; }
p.topos-p[data-style="pi3"] { padding-left: 4.5em; }
p.topos-p[data-style="pc"], p.topos-p[data-style="pmc"] { text-align: center; }
p.topos-p[data-style="pr"], p.topos-p[data-style="pmr"], p.topos-p[data-style="cls"] { text-align: right; }
p.topos-p[data-style^="li"], p.topos-p[data-style^="ph"] { padding-left: 2em; text-indent: -1em; margin-bottom: 0.2em; }
p.topos-p[data-style="li2"], p.topos-p[data-style="ph2"] { padding-left: 3.5em; }
p.topos-p[data-style="li3"], p.topos-p[data-style="ph3"] { padding-left: 5em; }
p.topos-p[data-style="lit"] { text-align: right; font-weight: 600; }
/*
 * Poetry: a line starts at its level's indent (q1 at 1em, q2 at 3em, ...) and wraps a step
 * further in; a verse number that starts a line hangs to its left, so the words line up
 */
.topos-l[data-style="q2"], .topos-l[data-style="qm2"] { padding-left: 4em; }
.topos-l[data-style="q3"], .topos-l[data-style="qm3"] { padding-left: 6em; }
.topos-l[data-style="q4"] { padding-left: 8em; }
.topos-verse.tpb-line-start { display: inline-block; width: 0; text-indent: 0; }
.topos-verse.tpb-line-start::before { display: inline-block; box-sizing: border-box; width: 2em; margin-left: -2em; padding: 0 0.3em 0 0; text-align: right; }
.topos-l[data-style="qr"] { display: block; text-align: right; }
.topos-l[data-style="qc"] { display: block; text-align: center; }
.topos-l[data-style="qa"] { font-style: italic; font-weight: 600; padding-left: 0; text-indent: 0; }
.topos-l[data-style="qd"] { font-style: italic; padding-left: 0; text-indent: 0; }
/* A paragraph after poetry (after its last line's br) is set off from it, as paragraphs are from each other */
br.topos-l + p.topos-p:not([data-style="nb"]) { margin-top: 0.6em; }
/* Characters */
[data-style="k"], [data-style="sls"], [data-style="sig"], [data-style="rq"], [data-style="qs"], [data-style="iqt"] { font-style: italic; }
[data-style="qs"], [data-style="rq"] { float: right; }
[data-style="rq"] { font-size: 0.85em; }
[data-style="qac"], [data-style="fk"], [data-style="xk"], [data-style="lik"] { font-weight: 600; }
[data-style="ord"], [data-style="fv"] { vertical-align: super; font-size: 0.65em; line-height: 0; }
[data-style="fq"], [data-style="fqa"], [data-style="xq"] { font-style: italic; }
[data-style="jmp"] { text-decoration: underline; }
[data-style="dc"] { opacity: 0.85; }
/* A note sits beside its verse: its origin (\`fr\`, \`xo\`: "3:16") says nothing there */
.topos-note [data-style="fr"], .topos-note [data-style="xo"] { display: none; }
`;

function gap(doc: Document): HTMLElement {
  const el = doc.createElement("div");
  el.className = "tpb-gap";
  el.textContent = "…";
  return el;
}

/** A marker's chapter and verse, from `data-osis-id` (`JHN 3:16`, `John.3.16`) and `data-n` */
function verseOf(el: HTMLElement): { chapter: number | null; verse: number; last: number } | null {
  const id = el.dataset.osisId ?? "";
  const m = /(\d+)[:.](\d+)(?:-(\d+))?\s*$/.exec(id);
  const n = /^(\d+)(?:\s*[-–,]\s*(\d+))?/.exec(el.dataset.n ?? "");
  const verse = n ? Number(n[1]) : m ? Number(m[2]) : NaN;
  if (!Number.isFinite(verse)) return null;
  const last = n?.[2] ? Number(n[2]) : m?.[3] ? Number(m[3]) : verse;
  return { chapter: m ? Number(m[1]) : null, verse, last: Math.max(verse, last) };
}

/** Whether a verse marker starts a poetry line (nothing but space before it in the line) */
function startsLine(el: HTMLElement): boolean {
  const line = el.closest(".topos-l");
  if (!line) return false;
  const range = el.ownerDocument.createRange();
  range.setStart(line, 0);
  range.setEndBefore(el);
  return range.toString().trim() === "";
}

function sectionBody(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>(`.${PREFIX}-body`);
}

function sectionChapter(el: HTMLElement): number | null {
  const n = Number(el.closest<HTMLElement>(`[data-${PREFIX}-section]`)?.getAttribute(`data-${PREFIX}-section`));
  return Number.isFinite(n) && n > 0 ? n : null;
}
