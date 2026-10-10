import { PREFIX } from "file-plus-plus/core";
import type { Passage } from "logoxide";

/**
 * Footnotes and cross references as marks in the text (`a`, `b`, … and `†`), whose note shows in a
 * popup on hover or tap, instead of inline. Each note's contents move into a hidden body inside it,
 * so the text keeps its order (verse ranges and text fragments find the same words) and copying a
 * selection leaves the notes out.
 */

/** References in notes: found by topos (`3:16` is in the note's book), opened, and previewed by the plugin */
export interface NoteLinks {
  find(text: string): { start: number; end: number; passage: Passage }[];
  open(passage: Passage, event: MouseEvent): void;
  /** A hover preview of a reference (an element of the popup) */
  preview(passage: Passage, el: HTMLElement, event: MouseEvent): void;
}

/** What the popups need from the reader */
export interface NotePopupOptions {
  links: NoteLinks | null;
  /** The book's id, and the verse a note is in: a reference to it isn't linked */
  bookId: number;
  verseOf(note: HTMLElement): { chapter: number; verse: number } | null;
}

/** A note's contents, hidden in the text (the popup shows a copy) */
const BODY = "tpb-note-body";
/** The popup */
const POPUP = "tpb-note-popup";

/** How long the pointer rests on a mark before its note shows, and may be away before it hides */
const SHOW_MS = 120;
const HIDE_MS = 250;

/** Gives each note in a section its mark: footnotes `a`, `b`, … per chapter, cross references `†`, or the note's own caller */
export function markNotes(content: HTMLElement): void {
  const doc = content.ownerDocument;
  const sections = new Map<Element | null, number>();
  for (const note of Array.from(content.querySelectorAll<HTMLElement>(".topos-note"))) {
    if (!note.querySelector(`:scope > .${BODY}`)) {
      const body = doc.createElement("span");
      body.className = BODY;
      body.append(...Array.from(note.childNodes));
      note.append(body);
    }
    const caller = note.dataset.n ?? "+";
    if (caller !== "+" && caller !== "-" && caller.trim()) note.dataset.mark = caller.trim();
    else if (note.classList.contains("topos-crossref")) note.dataset.mark = "†";
    else {
      const section = note.closest(`[data-${PREFIX}-section]`);
      const n = sections.get(section) ?? 0;
      sections.set(section, n + 1);
      note.dataset.mark = letters(n);
    }
    note.setAttribute("role", "button");
    note.setAttribute("aria-label", note.classList.contains("topos-crossref") ? "Cross reference" : "Footnote");
  }
}

/** `a` … `z`, `aa` … */
function letters(n: number): string {
  let s = "";
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(97 + (i % 26)) + s;
  return s;
}

/**
 * Shows a note in a popup beside its mark: on hover with a mouse, and on a click or tap (which
 * keeps it until a click elsewhere, Escape, or scrolling). Returns what removes its listeners
 */
export function notePopups(scroller: HTMLElement, content: HTMLElement, options: NotePopupOptions): () => void {
  const doc = scroller.ownerDocument;
  const passages = new WeakMap<Element, Passage>();
  const win = doc.defaultView ?? window;
  let popup: HTMLElement | null = null;
  let shown: HTMLElement | null = null;
  let pinned = false;
  let timer = 0;

  const refOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>(".tpb-note-ref") : null);
  /** Whether a passage is just the verse the note is in */
  const isCurrent = (note: HTMLElement) => {
    const here = options.verseOf(note);
    return (passage: Passage) => {
      if (!here || passage.bookId !== options.bookId || passage.segments.length !== 1) return false;
      const segment = passage.segments[0]!;
      if (segment.tag !== "Verses") return false;
      const { start, end } = segment;
      return start.chapter === here.chapter && start.verse === here.verse && (!end || (end.chapter === start.chapter && end.verse === start.verse));
    };
  };
  const noteOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>(".topos-note") : null);
  const later = (fn: () => void, ms: number) => {
    win.clearTimeout(timer);
    timer = win.setTimeout(fn, ms);
  };
  const hide = () => {
    win.clearTimeout(timer);
    popup?.remove();
    popup = null;
    shown = null;
    pinned = false;
  };
  const show = (note: HTMLElement) => {
    if (shown === note) return;
    hide();
    const body = note.querySelector(`:scope > .${BODY}`);
    if (!body) return;
    shown = note;
    popup = doc.createElement("div");
    popup.className = POPUP;
    popup.setAttribute("role", "tooltip");
    const copy = body.cloneNode(true) as HTMLElement;
    copy.className = "tpb-note-text";
    // Where the note is from (`fr`, `xo`: "3:16") goes in its heading
    const origin = copy.querySelector('[data-style="fr"], [data-style="xo"]');
    const where = origin?.textContent?.trim().replace(/[:.]$/, "") ?? "";
    origin?.remove();
    const heading = popup.appendChild(doc.createElement("div"));
    heading.className = "tpb-note-heading";
    heading.textContent = `${note.classList.contains("topos-crossref") ? "Cross reference" : "Footnote"}${where ? ` · ${where}` : ""}`;
    popup.append(copy);
    if (options.links) linkReferences(copy, options.links, passages, isCurrent(note));
    // The reader's colors (its theme can differ from Obsidian's)
    const look = win.getComputedStyle(scroller);
    popup.style.background = look.backgroundColor;
    popup.style.color = look.color;
    popup.addEventListener("pointerenter", () => win.clearTimeout(timer));
    // Its references open on a click, and preview on hover; other clicks in it are its own (not the text's)
    popup.addEventListener("click", (e) => {
      e.stopPropagation();
      const ref = refOf(e.target);
      const passage = ref && passages.get(ref);
      if (!passage) return;
      e.preventDefault();
      options.links?.open(passage, e);
    });
    popup.addEventListener("auxclick", (e) => {
      e.stopPropagation();
      const ref = refOf(e.target);
      const passage = ref && passages.get(ref);
      if (passage && e.button === 1) options.links?.open(passage, e);
    });
    popup.addEventListener("mouseover", (e) => {
      const ref = refOf(e.target);
      const passage = ref && passages.get(ref);
      if (passage) options.links?.preview(passage, ref, e);
    });
    popup.addEventListener("pointerleave", () => {
      if (!pinned) later(hide, HIDE_MS);
    });
    scroller.append(popup);
    place(popup, note);
  };

  const over = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const note = noteOf(e.target);
    if (note) {
      if (shown !== note) later(() => show(note), SHOW_MS);
      else win.clearTimeout(timer);
    }
  };
  const out = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || pinned) return;
    const note = noteOf(e.target);
    if (!note || note.contains(e.relatedTarget as Node | null)) return;
    if (shown) later(hide, HIDE_MS);
    else win.clearTimeout(timer);
  };
  // A click or tap on a mark keeps its note open (and isn't a click on the text: no highlight menu)
  const click = (e: MouseEvent) => {
    const note = noteOf(e.target);
    if (!note) return;
    e.preventDefault();
    e.stopPropagation();
    if (shown === note && pinned) return hide();
    show(note);
    pinned = true;
  };
  // On the document, a pointer in the reader's shadow root targets its host: its path says where it is
  const down = (e: PointerEvent) => {
    if (!popup) return;
    const path = e.composedPath();
    if (path.includes(popup) || path.some((node) => node instanceof Element && node.classList.contains("topos-note"))) return;
    hide();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape" && popup) hide();
  };

  content.addEventListener("pointerover", over);
  content.addEventListener("pointerout", out);
  content.addEventListener("click", click, true);
  scroller.addEventListener("scroll", hide, { passive: true });
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("keydown", key);
  return () => {
    hide();
    content.removeEventListener("pointerover", over);
    content.removeEventListener("pointerout", out);
    content.removeEventListener("click", click, true);
    scroller.removeEventListener("scroll", hide);
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("keydown", key);
  };
}

/** Makes the references in a note's text links (`span.tpb-note-ref`), except to the verse it's in */
function linkReferences(el: HTMLElement, links: NoteLinks, passages: WeakMap<Element, Passage>, current: (passage: Passage) => boolean): void {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const found = links.find(node.data).filter((m) => !current(m.passage));
    if (found.length === 0) continue;
    const fragment = doc.createDocumentFragment();
    let last = 0;
    for (const m of found) {
      if (m.start < last) continue;
      fragment.append(node.data.slice(last, m.start));
      const ref = doc.createElement("span");
      ref.className = "tpb-note-ref";
      ref.setAttribute("role", "link");
      ref.title = m.passage.reference;
      ref.textContent = node.data.slice(m.start, m.end);
      passages.set(ref, m.passage);
      fragment.append(ref);
      last = m.end;
    }
    fragment.append(node.data.slice(last));
    node.replaceWith(fragment);
  }
}

/**
 * Puts the popup under its mark (above it when there's no room below), inside the window. It's
 * `position: fixed`, whose box an ancestor's containment or transform can move, so it's measured
 * where it lands and moved by the difference
 */
function place(popup: HTMLElement, note: HTMLElement): void {
  const win = note.ownerDocument.defaultView ?? window;
  const mark = note.getBoundingClientRect();
  const gap = 6;
  const margin = 8;
  popup.style.left = "0px";
  popup.style.top = "0px";
  const origin = popup.getBoundingClientRect();
  const { width, height } = origin;
  let x = Math.min(Math.max(margin, mark.left - 12), win.innerWidth - width - margin);
  let y = mark.bottom + gap;
  if (y + height > win.innerHeight - margin && mark.top - gap - height >= margin) y = mark.top - gap - height;
  x = Math.max(margin, x);
  popup.style.left = `${x - origin.left}px`;
  popup.style.top = `${y - origin.top}px`;
}

/** The marks' and the popup's look, for the reader's stylesheet */
export const NOTES_CSS = /* css */ `
.topos-note { cursor: pointer; }
.topos-note::before {
  content: attr(data-mark);
  font-size: 0.65em;
  font-family: var(--font-interface, system-ui, sans-serif);
  font-style: normal;
  font-weight: 600;
  vertical-align: super;
  line-height: 0;
  padding: 0 0.1em;
  color: var(--text-accent);
  -webkit-user-select: none;
  user-select: none;
}
.topos-note:hover::before { text-decoration: underline; }
.${BODY} { display: none; }
.${POPUP} {
  position: fixed;
  z-index: 50;
  box-sizing: border-box;
  max-width: min(24em, calc(100vw - 16px));
  padding: 0.5em 0.75em;
  border: 1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.3));
  border-radius: var(--radius-m, 8px);
  box-shadow: var(--shadow-s, 0 2px 8px rgba(0, 0, 0, 0.2));
  font-size: 0.9em;
  line-height: 1.45;
  text-align: left;
  text-indent: 0;
  white-space: normal;
}
.tpb-note-ref {
  cursor: pointer;
  color: var(--text-accent);
  text-decoration: underline dashed 1px;
  text-underline-offset: 3px;
}
.tpb-note-ref:hover { text-decoration-style: solid; }
.tpb-note-heading {
  font-family: var(--font-interface, system-ui, sans-serif);
  font-size: 0.8em;
  font-weight: 600;
  opacity: 0.65;
  margin-bottom: 0.2em;
}
`;
