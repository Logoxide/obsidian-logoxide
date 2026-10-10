import { sanitizeHTMLToDom } from "obsidian";
import { strongsIn, wordStrongs } from "../core/strongs.ts";
import { place } from "./notes.ts";
import type { DictionaryEntry } from "./packages.ts";

/**
 * Strong's entries in a popup: over a word whose markup names its Strong's numbers (logoxide-markup's
 * `span.topos-w[data-strong]` in Bible text), or a Strong's number written in a note (`G25`, which
 * `markStrongs` wraps the same way). The entries come from the vault's dictionaries keyed by
 * Strong's numbers (`LogoxideBibles.entries`). Works in the reader's shadow root and in the page.
 */

/** Looks up a key's entries in the vault's dictionaries */
export type EntryLookup = (key: string) => Promise<DictionaryEntry[]>;

export interface StrongsPopupOptions {
  lookup: EntryLookup;
  /** Whether popups show now (the setting) */
  enabled(): boolean;
  /** Also show on a click or tap (else only on hover with a mouse) */
  click?: boolean;
  /** Where the popup goes (the scroller by default; the page's body for a sidebar, which clips it) */
  container?: HTMLElement;
}

const POPUP = "topos-strongs-popup";
const SHOW_MS = 300;
const HIDE_MS = 250;

/** Wraps each Strong's number written in an element's text (`G25`, `H0430`) in a `span.topos-strongs[data-strong]` */
export function markStrongs(el: HTMLElement): void {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest("[data-strong]")) continue;
    const found = strongsIn(node.data);
    if (found.length === 0) continue;
    const fragment = doc.createDocumentFragment();
    let last = 0;
    for (const m of found) {
      fragment.append(node.data.slice(last, m.start));
      const span = doc.createElement("span");
      span.className = "topos-strongs";
      span.dataset.strong = m.key;
      span.textContent = node.data.slice(m.start, m.end);
      fragment.append(span);
      last = m.end;
    }
    fragment.append(node.data.slice(last));
    node.replaceWith(fragment);
  }
}

/** Fills an element with a key's entries (or says it has none) */
export function renderEntries(el: HTMLElement, key: string, entries: DictionaryEntry[]): void {
  el.replaceChildren();
  const doc = el.ownerDocument;
  if (entries.length === 0) {
    const none = el.appendChild(doc.createElement("div"));
    none.className = "topos-strongs-none";
    none.textContent = `${key}: not in the vault's dictionaries`;
    return;
  }
  for (const { dictionary, title, entry } of entries) {
    const item = el.appendChild(doc.createElement("div"));
    item.className = "topos-strongs-entry";
    const heading = item.appendChild(doc.createElement("div"));
    heading.className = "topos-strongs-heading";
    heading.title = title;
    heading.textContent = [entry.key, entry.headword, dictionary].filter(Boolean).join(" · ");
    const body = item.appendChild(doc.createElement("div"));
    body.className = "topos-strongs-body";
    body.append(sanitizeHTMLToDom(entry.html));
  }
}

/** Shows a word's Strong's entries in a popup beside it; returns what removes its listeners, whose `hide` hides the popup (before the content is drawn again) */
export function strongsPopups(scroller: HTMLElement, content: HTMLElement, options: StrongsPopupOptions): (() => void) & { hide(): void } {
  const doc = scroller.ownerDocument;
  const win = doc.defaultView ?? window;
  let popup: HTMLElement | null = null;
  let shown: HTMLElement | null = null;
  let pinned = false;
  let timer = 0;
  const later = (fn: () => void, ms: number) => {
    win.clearTimeout(timer);
    timer = win.setTimeout(fn, ms);
  };
  const wordOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-strong]") : null);
  const hide = () => {
    win.clearTimeout(timer);
    popup?.remove();
    popup = null;
    shown = null;
    pinned = false;
  };
  const show = async (word: HTMLElement) => {
    if (shown === word) return;
    const keys = wordStrongs(word.dataset.strong);
    if (keys.length === 0) return;
    hide();
    shown = word;
    const el = (popup = doc.createElement("div"));
    el.className = POPUP;
    el.setAttribute("role", "tooltip");
    el.textContent = "…";
    // The reader's colors (its theme can differ from Obsidian's), unless it has no background of its own
    const look = win.getComputedStyle(scroller);
    if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(look.backgroundColor)) {
      el.style.background = look.backgroundColor;
      el.style.color = look.color;
    }
    el.addEventListener("pointerenter", () => win.clearTimeout(timer));
    el.addEventListener("pointerleave", () => {
      if (!pinned) leave();
    });
    el.addEventListener("click", (e) => e.stopPropagation());
    (options.container ?? scroller).append(el);
    place(el, word);
    const found = await Promise.all(keys.map(async (key) => ({ key, entries: await options.lookup(key) })));
    if (popup !== el) return;
    el.replaceChildren();
    for (const { key, entries } of found) renderEntries(el.appendChild(doc.createElement("div")), key, entries);
    place(el, word);
  };
  const kept = () => !!popup?.matches(":hover") || (!!shown?.isConnected && shown.matches(":hover"));
  const leave = () => {
    const check = () => (kept() ? later(check, HIDE_MS) : hide());
    later(check, HIDE_MS);
  };
  const over = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || !options.enabled()) return;
    const word = wordOf(e.target);
    if (!word) return;
    if (shown !== word) later(() => void show(word), SHOW_MS);
    else win.clearTimeout(timer);
  };
  const out = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || pinned) return;
    const word = wordOf(e.target);
    if (!word || word.contains(e.relatedTarget as Node | null)) return;
    if (shown) leave();
    else win.clearTimeout(timer);
  };
  const click = (e: MouseEvent) => {
    if (!options.click || !options.enabled()) return;
    const word = wordOf(e.target);
    if (!word) return;
    e.preventDefault();
    e.stopPropagation();
    if (shown === word && pinned) return hide();
    hide();
    void show(word);
    pinned = true;
  };
  const down = (e: PointerEvent) => {
    if (popup && !e.composedPath().some((node) => node === popup || (node instanceof Element && node.hasAttribute("data-strong")))) hide();
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
  const off = () => {
    hide();
    content.removeEventListener("pointerover", over);
    content.removeEventListener("pointerout", out);
    content.removeEventListener("click", click, true);
    scroller.removeEventListener("scroll", hide);
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("keydown", key);
  };
  return Object.assign(off, { hide });
}

/** The popup's look (the reader's stylesheet has it too, since it renders in a shadow root) */
export const STRONGS_CSS = /* css */ `
.topos-strongs { text-decoration: underline dotted 1px; text-underline-offset: 3px; cursor: help; }
.${POPUP} {
  position: fixed;
  z-index: 50;
  box-sizing: border-box;
  max-width: min(26em, calc(100vw - 16px));
  max-height: min(24em, calc(100vh - 16px));
  overflow-y: auto;
  padding: 0.5em 0.75em;
  background: var(--background-primary, Canvas);
  color: var(--text-normal, CanvasText);
  border: 1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.3));
  border-radius: var(--radius-m, 8px);
  box-shadow: var(--shadow-s, 0 2px 8px rgba(0, 0, 0, 0.2));
  font-size: 0.9em;
  line-height: 1.45;
  text-align: left;
  text-indent: 0;
  white-space: normal;
}
.topos-strongs-entry + .topos-strongs-entry { margin-top: 0.5em; }
.topos-strongs-heading {
  font-family: var(--font-interface, system-ui, sans-serif);
  font-size: 0.8em;
  font-weight: 600;
  opacity: 0.65;
  margin-bottom: 0.2em;
}
.topos-strongs-none { opacity: 0.65; font-style: italic; }
`;
