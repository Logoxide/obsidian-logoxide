import { DocumentReader, PREFIX, splitTextDirective, textFragmentScheme, withTextDirective, type LocatorScheme, type ParsedLocator, type ReaderOptions, type TocItem } from "file-plus-plus/core";
import type { BookTextOptions, LogoxideBook } from "logoxide";
import { markNotes, notePopups, NOTES_CSS, type NoteLinks } from "./notes.ts";
import { STRONGS_CSS, strongsPopups, type StrongsPopupOptions, type StrongsPopups } from "./strongs.ts";
import { END, formatVerseLocator, parseVerseLocator, partSegments, splitBible, splitContext, splitEdition, withBible, withContext, withContextVerses, withEdition, type VersePart } from "../core/verse-locator.ts";

/** A Bible book opened from a USX file */
export interface BibleBook {
  book: LogoxideBook;
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

/** `v=3:16-18`: verses, chapters, and parts joined by `;` (see verse-locator.ts), maybe with context (`&c=2`) */
export const verseScheme: LocatorScheme = {
  id: "verse",
  match(s) {
    // The verses, then the edition the link was made with (`&ver=…&vh=…`), the context it asks for
    // (`&c=2`), and the Bible it names (`&bible=BSB`), then the exact words
    const m = /^v=[^&]*(?:&(?:ver|vh|c|bible)=[^&]*)*/.exec(s);
    if (!m) return null;
    const parts = parseVerseLocator(m[0]);
    const { text } = splitTextDirective(m[0]);
    const { edition } = splitEdition(m[0]);
    const { context } = splitContext(m[0]);
    const { bible } = splitBible(m[0]);
    const base = formatVerseLocator(parts ?? []);
    const locator = withBible(withContext(edition ? withEdition(base, edition) : base, context), bible);
    return parts ? { locator: withTextDirective(locator, text), rest: s.slice(m[0].length) } : null;
  },
  // A whole chapter (`v=3`) is a place to go, not a passage to flash
  isRange: (locator) => !!splitTextDirective(locator).text || (parseVerseLocator(locator)?.some((p) => !(p.verse === 0 && p.endVerse === END)) ?? true),
};

export const BIBLE_SCHEMES: LocatorScheme[] = [verseScheme, textFragmentScheme];

export interface BibleReaderOptions extends ReaderOptions {
  text: BookTextOptions;
  /** The vault's Bible stylesheet for this document (see styles.ts), after the reader's own */
  stylesheet?: (doc: Document) => CSSStyleSheet | null;
  /** References in the book's notes: links in their popups */
  noteLinks?: (book: BibleBook) => NoteLinks | null;
  /** How many verses a preview shows around its passage, unless its locator says (`&c=2`) */
  context?: number;
  /** Strong's entries over words whose markup names their numbers */
  strongs?: StrongsPopupOptions;
}

/** A verse marker in the rendered text */
interface Marker {
  el: HTMLElement;
  chapter: number;
  verse: number;
  last: number;
}

/**
 * Renders a book as one page, a section per chapter, from logoxide's `LogoxideBook` (the HTML of
 * logoxide-markup, whose verse markers are `span.topos-verse[data-n]`). A preview (hover or
 * embed) renders only its passage.
 */
export class BibleReader extends DocumentReader {
  readonly schemes = BIBLE_SCHEMES;
  private markers: Marker[] = [];
  /** The Strong's popups over the text's words (`open` shows one, pinned) */
  strongs: StrongsPopups | null = null;
  private markerEls: HTMLElement[] = [];
  private _toc: TocItem[] = [];
  private readonly preview: VersePart[] | null;
  /** A preview's passage with the verses around it, and those verses (set apart) */
  private readonly shown: VersePart[] | null = null;
  private readonly contextParts: VersePart[] = [];

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
    const context = (preview?.locator ? splitContext(preview.locator).context : null) ?? opts.context ?? 0;
    if (this.preview && context > 0) {
      const chapters = bible.book.chapters();
      const counts = bible.book.chapterVerses();
      const byChapter = new Map(Array.from(chapters, (c, i) => [c, counts[i] ?? 0]));
      const wider = withContextVerses(this.preview, context, byChapter);
      this.shown = wider.shown;
      this.contextParts = wider.context;
    }
    this.cleanup.push(
      notePopups(this.scroller, this.content, {
        links: opts.noteLinks?.(bible) ?? null,
        bookId: bible.bookId,
        verseOf: (note) => this.verseBefore(note),
      }),
    );
    if (opts.strongs) {
      this.strongs = strongsPopups(this.scroller, this.content, opts.strongs);
      this.cleanup.push(this.strongs);
    }
  }

  get toc(): TocItem[] {
    return this._toc;
  }

  /** Whether a preview shows verses around its passage */
  get hasContext(): boolean {
    return this.contextParts.length > 0;
  }

  /** Whether only a passage is shown (a hover preview or an embed) */
  get isPreview(): boolean {
    return this.preview !== null;
  }

  /**
   * The reader's look, and USX's markers (logoxide-markup gives each its \`data-style\`: \`q2\`,
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
.tpb-passage .topos-title:first-child { margin-top: 0.5em; }
.tpb-chapter { font-size: 1.6em; font-weight: 600; margin: 1.2em 0 0.4em; }
.tpb-gap { text-align: center; opacity: 0.5; line-height: 1; margin: 0 0 0.3em; -webkit-user-select: none; user-select: none; }
.topos-title { font-weight: 600; margin: 1em 0 0.3em; }
.topos-title.topos-d, .topos-title.topos-sp { font-weight: normal; font-style: italic; margin-top: 0.3em; }
.topos-title.topos-r, .topos-title.topos-mr { font-weight: normal; font-style: italic; font-size: 0.9em; }
.topos-woj { color: var(--tpb-woj-color, inherit); }
.topos-divine-name { font-variant: small-caps; }
/* Translators' additions (KJV italics) */
.topos-added { font-style: italic; }
.topos-l { display: inline-block; padding-left: 2em; text-indent: -1em; }
p.topos-p { margin: 0 0 0.6em; }
${NOTES_CSS}
${STRONGS_CSS}
${USX_CSS}
}
/* A passage (preview or embed) is as big as the note's text (a preview over a document, as its
   text: \`--topos-passage-font-size\`, BibleEmbed), and as tall as its own: not a book's room to
   scroll past its end. Outside the layer, as file-plus-plus's padding is */
.${PREFIX}-content.tpb-passage { padding-top: 0.25em; padding-bottom: 0.5em; --${PREFIX}-font-size: var(--topos-passage-font-size, var(--font-text-size, 16px)); }
.tpb-passage > .${PREFIX}-section + .${PREFIX}-section { margin-top: 0; }
.tpb-passage p.topos-p:last-child { margin-bottom: 0; }
${NOTE_MARKS_CSS}`;
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
        segments: partSegments(this.shown ?? this.preview),
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
    markNotes(this.content);
    this.indexMarkers();
    for (const part of this.contextParts) {
      const range = this.partRange(part);
      if (range) setApart(range, this.markerEls);
    }
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
    // The exact words: searched within each part's verses in turn (the verses when they aren't there)
    const { text } = splitTextDirective(loc.locator);
    if (text) {
      for (const part of parts) {
        const range = this.partRange(part);
        const words = range && this.resolveTextFragment(text, range);
        if (words) return words;
      }
    }
    // A preview shows only its parts, so it highlights all of them; the book, the first
    return this.preview ? this.spanning(parts) : this.partRange(parts[0]!);
  }

  /** Whether a locator's exact words (`v=1:1-3;6-9:~:text=Word`) are in its verses */
  hasWords(locator: string): boolean {
    const { text } = splitTextDirective(locator);
    const parts = text ? parseVerseLocator(locator) : null;
    return !!parts?.some((part) => {
      const range = this.partRange(part);
      return !!range && !!this.resolveTextFragment(text!, range);
    });
  }

  /** From the first part's start to the last one's end */
  private spanning(parts: VersePart[]): Range | null {
    const first = parts[0] && this.partRange(parts[0]);
    if (!first || parts.length === 1) return first ?? null;
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

  /**
   * A preview with verses around its passage: the passage at the top, where it is without them, so
   * the verses before it are a scroll up, and those after it below it
   */
  override scrollToRange(range: Range, opts: Parameters<DocumentReader["scrollToRange"]>[1] = {}): void {
    if (!this.scrollToPassage()) super.scrollToRange(range, opts);
  }

  /** A preview with verses around its passage: scrolls its passage's first line to the very top; whether it has one */
  scrollToPassage(): boolean {
    const passage = this.preview && this.hasContext ? this.spanning(this.preview) : null;
    if (!passage) return false;
    this.scroller.scrollTop += passage.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top;
    return true;
  }

  /**
   * How tall a preview's text is, with its padding: all of it, or with verses around it, from its
   * passage down (those before it are scrolled past)
   */
  passageHeight(): number {
    const style = getComputedStyle(this.content);
    const last = this.content.lastElementChild ?? this.content;
    const passage = this.preview && this.hasContext ? this.spanning(this.preview) : null;
    const top = passage ? passage.getBoundingClientRect().top : this.content.getBoundingClientRect().top;
    return last.getBoundingClientRect().bottom - top + parseFloat(style.paddingBottom);
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

  /** The verse an element of the text is in */
  verseOf(el: Element): { chapter: number; verse: number } | null {
    return this.verseBefore(el);
  }

  /** The verse an element is in: the last verse number before it */
  private verseBefore(el: Element): { chapter: number; verse: number } | null {
    let found: Marker | null = null;
    for (const m of this.markers) {
      if (!(m.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      found = m;
    }
    return found ? { chapter: found.chapter, verse: found.verse } : null;
  }

  /** A verse's number (its marker), if the book has it */
  markerOf(chapter: number, verse: number): HTMLElement | null {
    return this.markers.find((m) => m.chapter === chapter && m.verse <= verse && verse <= m.last)?.el ?? null;
  }

  /** Each verse number with its place, in order */
  verseMarkers(): readonly { el: HTMLElement; chapter: number; verse: number }[] {
    return this.markers;
  }

  /** A chapter's last verse (0 when the book hasn't it) */
  lastVerse(chapter: number): number {
    let last = 0;
    for (const m of this.markers) if (m.chapter === chapter) last = Math.max(last, m.last);
    return last;
  }

  /** The book's last chapter */
  lastChapter(): number {
    return this.markers.at(-1)?.chapter ?? 0;
  }

  /** Whether a verse's number is in view */
  verseShown(chapter: number, verse: number): boolean {
    const el = this.markerOf(chapter, verse);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const box = this.scroller.getBoundingClientRect();
    return r.bottom > box.top && r.top < box.bottom;
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
    // A package's Bible: the version, and the first verse's words, so the link can find them again;
    // and the Bible's name, so the link says which it means without its path
    const edition = this.bible.edition;
    const hash = edition?.hashOf(a.chapter, a.verse);
    const base = formatVerseLocator([part]);
    const locator = withBible(edition ? withEdition(base, { version: edition.version, hash: hash ?? null }) : base, this.bible.bible || null);
    return withTextDirective(locator, units.text);
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
`;

/** Sets a range's words apart (the context around a passage): its text in faded spans, and its verse numbers */
function setApart(range: Range, markers: readonly HTMLElement[]): void {
  const root = range.commonAncestorContainer;
  const doc = range.startContainer.ownerDocument ?? (root as Document);
  const texts: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) texts.push(root as Text);
  else {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (range.intersectsNode(node)) texts.push(node as Text);
  }
  for (const marker of markers) if (range.intersectsNode(marker) && marker !== range.endContainer) marker.classList.add("tpb-context");
  // A heading goes with the verse after it: one ending the context (before the passage) isn't set apart
  const title = (text: Text) => text.parentElement?.closest(".topos-title") ?? null;
  const lastWords = texts.findLastIndex((t) => !title(t) && t.data.trim() !== "");
  texts.splice(lastWords + 1);
  const [startNode, startOffset, endNode, endOffset] = [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
  for (let text of texts) {
    if (text === endNode) text.splitText(endOffset);
    if (text === startNode && startOffset > 0) text = text.splitText(startOffset);
    if (!text.data.trim()) continue;
    const span = doc.createElement("span");
    span.className = "tpb-context";
    text.replaceWith(span);
    span.append(text);
  }
}

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

/** The marks' look, in the reader's shadow root (`CommentariesTab`) */
const NOTE_MARKS_CSS = /* css */ `
.topos-note-marks { position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2; }
.topos-note-mark {
  position: absolute; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;
  color: var(--text-faint, gray); opacity: 0.7; cursor: pointer; border-radius: 4px;
  -webkit-user-select: none; user-select: none;
}
.topos-note-mark:hover { color: var(--interactive-accent, #7c5cff); opacity: 1; background: var(--background-modifier-hover, rgba(127,127,127,0.15)); }
.topos-note-mark svg { width: 13px; height: 13px; }
/* A finger's worth to tap, without a bigger mark */
.topos-note-mark::after { content: ""; position: absolute; inset: -6px; }
/* A word the Language tools tab points at */
.topos-word-shown { background: color-mix(in srgb, var(--interactive-accent, #7c5cff) 25%, transparent); border-radius: 3px; }
`;
