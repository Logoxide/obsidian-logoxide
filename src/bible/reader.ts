import { DocumentReader, PREFIX, textFragmentScheme, type LocatorScheme, type ParsedLocator, type ReaderOptions, type TocItem } from "file-plus-plus/core";
import type { BookTextOptions, ToposBook } from "topos-bible";
import { END, formatVerseLocator, parseVerseLocator, partSegments, type VersePart } from "../core/verse-locator.ts";

/** A Bible book opened from a USX file */
export interface BibleBook {
  book: ToposBook;
  bookId: number;
  /** The book's name: `John` */
  name: string;
  /** The translation (the folder's name): `BSB` */
  bible: string;
}

/** `v=3:16-18`: verses, chapters, and parts joined by `;` (see verse-locator.ts) */
export const verseScheme: LocatorScheme = {
  id: "verse",
  match(s) {
    const m = /^v=[^&]*/.exec(s);
    if (!m) return null;
    const parts = parseVerseLocator(m[0]);
    return parts ? { locator: formatVerseLocator(parts), rest: s.slice(m[0].length) } : null;
  },
  isRange: () => true,
};

export const BIBLE_SCHEMES: LocatorScheme[] = [verseScheme, textFragmentScheme];

export interface BibleReaderOptions extends ReaderOptions {
  text: BookTextOptions;
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
  private _toc: TocItem[] = [];
  private readonly preview: VersePart[] | null;

  constructor(
    host: HTMLElement,
    readonly bible: BibleBook,
    private readonly opts: BibleReaderOptions,
    preview?: ParsedLocator,
  ) {
    super(host, opts);
    this.preview = preview?.scheme === verseScheme.id && preview.locator ? parseVerseLocator(preview.locator) : null;
  }

  get toc(): TocItem[] {
    return this._toc;
  }

  /** Whether only a passage is shown (a hover preview or an embed) */
  get isPreview(): boolean {
    return this.preview !== null;
  }

  protected override extraCss(): string {
    return /* css */ `
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
.topos-nd { font-variant: small-caps; }
.topos-l { display: inline-block; padding-left: 1.5em; text-indent: -1em; }
p.topos-p { margin: 0 0 0.6em; }
.topos-note { font-size: 0.85em; opacity: 0.75; }
.topos-note::before { content: " ["; }
.topos-note::after { content: "]"; }
`;
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
    }
  }

  // Locators

  protected resolveLocator(loc: ParsedLocator): Range | null {
    if (loc.scheme !== verseScheme.id || !loc.locator) return null;
    const parts = parseVerseLocator(loc.locator);
    if (!parts) return null;
    // A preview shows only its parts, so it highlights all of them; the book, the first
    const first = this.partRange(parts[0]!);
    if (!first || !this.preview || parts.length === 1) return first;
    const last = this.partRange(parts[parts.length - 1]!) ?? first;
    const range = this.doc.createRange();
    range.setStart(first.startContainer, first.startOffset);
    range.setEnd(last.endContainer, last.endOffset);
    return range;
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

  locatorFromRange(range: Range): string | null {
    const a = this.markerAt(range.startContainer, range.startOffset, true);
    if (!a) return null;
    const b = range.collapsed ? a : (this.markerAt(range.endContainer, range.endOffset, false) ?? a);
    const end = b.chapter * 1000 + b.last < a.chapter * 1000 + a.verse ? a : b;
    return formatVerseLocator([{ chapter: a.chapter, verse: a.verse, endChapter: end.chapter, endVerse: range.collapsed ? a.verse : end.last }]);
  }

  /** The verse a point is in: the last marker before it (or the first verse, before any) */
  private markerAt(node: Node, offset: number, start: boolean): Marker | null {
    if (this.markers.length === 0) return null;
    const point = this.doc.createRange();
    point.setStart(node, offset);
    let lo = 0;
    let hi = this.markers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      // Markers before the point (at it too, for a start: a selection ending right at a
      // marker ends in the verse before it)
      // The marker's own place (before it, in its parent), which a range set before it starts at
      const el = this.markers[mid]!.el;
      const parent = el.parentNode!;
      const side = point.comparePoint(parent, Array.prototype.indexOf.call(parent.childNodes, el));
      if (side < 0 || (start && side === 0)) lo = mid + 1;
      else hi = mid;
    }
    return this.markers[Math.max(0, lo - 1)] ?? null;
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

function sectionBody(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>(`.${PREFIX}-body`);
}

function sectionChapter(el: HTMLElement): number | null {
  const n = Number(el.closest<HTMLElement>(`[data-${PREFIX}-section]`)?.getAttribute(`data-${PREFIX}-section`));
  return Number.isFinite(n) && n > 0 ? n : null;
}
