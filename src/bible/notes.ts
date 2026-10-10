import { PREFIX } from "file-plus-plus/core";

/**
 * Footnotes and cross references as marks in the text (`a`, `b`, … and `†`), whose note shows in a
 * popup on hover or tap, instead of inline. Each note's contents move into a hidden body inside it,
 * so the text keeps its order (verse ranges and text fragments find the same words) and copying a
 * selection leaves the notes out.
 */

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
export function notePopups(scroller: HTMLElement, content: HTMLElement): () => void {
  const doc = scroller.ownerDocument;
  const win = doc.defaultView ?? window;
  let popup: HTMLElement | null = null;
  let shown: HTMLElement | null = null;
  let pinned = false;
  let timer = 0;

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
    // The reader's colors (its theme can differ from Obsidian's)
    const look = win.getComputedStyle(scroller);
    popup.style.background = look.backgroundColor;
    popup.style.color = look.color;
    popup.addEventListener("pointerenter", () => win.clearTimeout(timer));
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
  const down = (e: PointerEvent) => {
    if (!popup || popup.contains(e.target as Node) || noteOf(e.target)) return;
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
.tpb-note-heading {
  font-family: var(--font-interface, system-ui, sans-serif);
  font-size: 0.8em;
  font-weight: 600;
  opacity: 0.65;
  margin-bottom: 0.2em;
}
`;
