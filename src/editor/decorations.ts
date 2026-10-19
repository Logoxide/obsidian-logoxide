import { Prec, StateEffect, type Range as DecorationRange } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import { Component, editorLivePreviewField, MarkdownView, Platform, type HoverParent } from "obsidian";
import { BookStyle, type Passage } from "logoxide";
import { embedAloneCursorLines, embedsAloneIn } from "../core/settings.ts";
import { blankAround, findReferences, withHighlight } from "../core/syntax.ts";
import type ToposPlugin from "../main.ts";

/** Rebuilds the references in an editor, after the settings change what they link to */
export const refreshReferences = StateEffect.define<null>();

/**
 * References in the visible part of the editor (see `core/syntax.ts`):
 *
 * - Bare references are highlighted, preview their text on hover, and open their link on click
 *   (Ctrl/Cmd-click by default, so a plain click still places the cursor); they aren't links
 * - `[text](John 1:1)` and `[John 1:1]` are links: in live preview their brackets and target are
 *   hidden unless the cursor is in them, a click opens the passage, and hovering previews it
 * - `![John 1:1]` shows the passage's text in live preview, unless the cursor is in it
 * - With `embedAlone`, so does a bare reference alone on its line with `embedAloneBlankLines` blank
 *   lines above and below it (where this device embeds them: `embedsAloneIn`), unless the cursor is within `embedAloneCursorLines` lines of it
 * - On a phone, a reference's text at its line's end stays while the cursor or a selection is only
 *   put in it, and goes once it's typed in: iOS's selection from a double tap is lost when the line
 *   changes under it, and Backspace then deletes at the cursor before (the line break before the line)
 */
export function referenceDecorations(plugin: ToposPlugin) {
  class References implements PluginValue {
    decorations: DecorationSet;
    /** The last change was typing (not a tap or a selection), so a reference with the cursor is being edited */
    private typing = false;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.typing = true;
      else if (update.selectionSet) this.typing = false;
      const refresh = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshReferences)));
      if (refresh || update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = this.build(update.view);
      // Line-end texts that don't wrap: the room on their rows may have changed
      if (update.docChanged || update.geometryChanged) refitInlineText(update.view);
    }

    build(view: EditorView): DecorationSet {
      const decorations: DecorationRange<Decoration>[] = [];
      const live = view.state.field(editorLivePreviewField, false) ?? false;
      const { selection } = view.state;
      const editing = (from: number, to: number) => selection.ranges.some((r) => r.from <= to && r.to >= from);
      // Its text at the line's end, which on a phone goes only once it's typed in
      const textEditing = (from: number, to: number) => (!Platform.isMobile || this.typing) && editing(from, to);
      const { doc } = view.state;
      const near = embedAloneCursorLines(plugin.settings);
      const nearCursor = (line: number) =>
        selection.ranges.some((r) => doc.lineAt(r.from).number <= line + near && doc.lineAt(r.to).number >= line - near);
      const lineText = (n: number) => (n >= 1 && n <= doc.lines ? doc.line(n).text : undefined);
      const site = plugin.linkSite();
      const hasBible = plugin.bibles.all().length > 0;
      const embedAlone = embedsAloneIn(plugin.settings, plugin.deviceId, "editor");
      const inline = live && hasBible && plugin.settings.inlineText;
      // Each line's references whose text shows at its end (by the line's end)
      const inlineLines = new Map<number, InlineItem[]>();
      // Visible ranges widened to whole lines can overlap
      let lastEnd = -1;
      for (const { from, to } of view.visibleRanges) {
        // Whole lines, so references are not cut at the edge of the viewport
        const start = view.state.doc.lineAt(from).from;
        const end = view.state.doc.lineAt(to).to;
        const text = view.state.doc.sliceString(start, end);
        for (const r of findReferences(plugin.topos, text, plugin.translations())) {
          const [a, b] = [start + r.start, start + r.end];
          const [labelA, labelB] = [start + r.labelStart, start + r.labelEnd];
          if (a < lastEnd) continue;
          const data: Record<string, string> = { "data-topos-osis": r.passage.osis, "data-topos-kind": r.kind };
          if (r.translation) data["data-topos-translation"] = r.translation;
          if (r.kind === "bare" && embedAlone && live && hasBible) {
            const line = doc.lineAt(a);
            const alone =
              line.text.trim() === text.slice(r.start, r.end) &&
              blankAround(lineText, line.number, line.number, plugin.settings.embedAloneBlankLines);
            if (alone && !nearCursor(line.number)) {
              decorations.push(Decoration.replace({ widget: new EmbedWidget(plugin, r.passage, "", r.translation) }).range(line.from, line.to));
              lastEnd = line.to;
              continue;
            }
          }
          // Its text at the end of its line, unless it's being edited
          const line = doc.lineAt(a);
          const heading = /^#{1,6}\s/.test(line.text);
          if (inline && r.kind !== "embed" && !textEditing(a, b) && (!heading || plugin.settings.inlineTextInHeadings)) {
            const end = line.to;
            const items = inlineLines.get(end) ?? [];
            items.push({ passage: r.passage, translation: r.translation });
            inlineLines.set(end, items);
          }
          if (r.kind === "bare") {
            if (!plugin.settings.linkInEditor) continue;
            const url = plugin.referenceUrl(r.passage, r.translation);
            if (!url && !hasBible) continue;
            const reference = named(r.passage, r.translation);
            const attributes: Record<string, string> = { ...data, title: url ? `${reference}, opens in ${site}` : reference };
            if (url) attributes["data-topos-url"] = url;
            decorations.push(Decoration.mark({ class: "topos-reference", attributes }).range(a, b));
          } else if (r.kind === "embed" && live && !editing(a, b)) {
            decorations.push(Decoration.replace({ widget: new EmbedWidget(plugin, r.passage, text.slice(r.labelStart, r.labelEnd), r.translation, r.fragment) }).range(a, b));
          } else {
            const hide = live && !editing(a, b);
            if (hide && labelA > a) decorations.push(Decoration.replace({}).range(a, labelA));
            if (labelB > labelA) {
              const title = `${named(r.passage, r.translation)}${r.kind === "embed" ? " (embedded)" : ""}`;
              decorations.push(Decoration.mark({ class: "topos-link", attributes: { ...data, title } }).range(labelA, labelB));
            }
            // Inclusive, to cover the external link icon Obsidian puts after `[text](John 3:16)`
            if (hide && b > labelB) decorations.push(Decoration.replace({ inclusiveEnd: true }).range(labelB, b));
            // The shown target of `[text](John 3:16)`, whose Ctrl/Cmd-click Obsidian would take to a note `John`
            else if (b - labelB > 3) decorations.push(Decoration.mark({ class: "topos-link-target", attributes: data }).range(labelB + 2, b - 1));
          }
          lastEnd = b;
        }
      }
      for (const [end, items] of inlineLines) {
        decorations.push(Decoration.widget({ widget: new InlineTextWidget(plugin, items), side: 1 }).range(end));
      }
      return Decoration.set(decorations, true);
    }
  }

  const target = (event: MouseEvent) => (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-topos-osis]") ?? null;
  const passageOf = (el: HTMLElement): Passage | null => plugin.topos.parse(el.dataset.toposOsis ?? "", BookStyle.Name) ?? null;
  // Whether the editor had focus when the pointer went down, before a tap focuses it: on mobile,
  // a tap in an unfocused editor opens the reference, and one in a focused editor moves the cursor
  let focusedAtPress = false;
  const open = (event: MouseEvent, view: EditorView) => {
    const el = target(event);
    // Links are opened by `interceptLinkClicks`, before Obsidian sees them
    if (!el || el.matches(".topos-link, .topos-link-target")) return false;
    const url = el.dataset.toposUrl;
    const passage = passageOf(el);
    if (!url || !passage || !plugin.settings.linkInEditor || !plugin.clickOpens(event, true, focusedAtPress)) return false;
    event.preventDefault();
    const translation = el.dataset.toposTranslation;
    plugin.tapReference(event, passage, clickedText(plugin, view, event), (p) => plugin.openUrl(plugin.referenceUrl(p, translation) ?? url));
    // The tap focused the editor; don't leave the keyboard opening behind the link
    if (!focusedAtPress) view.contentDOM.blur();
    return true;
  };

  return [
    // Above Obsidian's own, whose live preview sees `[text](John 3:16)` as an external link (with
    // an icon) and would draw it over the hidden target
    Prec.highest(ViewPlugin.fromClass(References, { decorations: (value) => value.decorations })),
    EditorView.domEventHandlers({
      click: open,
      // A middle click arrives as auxclick, not click
      auxclick: open,
      pointerdown(_event: PointerEvent, view: EditorView) {
        focusedAtPress = view.hasFocus;
        return false;
      },
      mousedown(event: MouseEvent) {
        // Middle-clicking a reference opens it, so it doesn't paste (Linux) or start autoscrolling
        if (event.button !== 1 || !target(event)) return false;
        event.preventDefault();
        return true;
      },
      mouseover(event: MouseEvent, view: EditorView) {
        const el = target(event);
        if (!el || (el.dataset.toposKind === "bare" && !plugin.settings.previewBare)) return false;
        const passage = passageOf(el);
        if (passage) void plugin.previewPassage(event, el, passage, hoverParent(plugin, view.dom), el.dataset.toposTranslation);
        return false;
      },
    }),
  ];
}

/**
 * Clicks on reference links in editors, caught before Obsidian's: its live preview sees
 * `[text](John 3:16)` as a link to a note named `John`, and would create that note. A plain click
 * opens the passage in live preview (like Obsidian's links), a Ctrl/Cmd-click (or a tap, by the
 * settings) in source mode, and a middle click anywhere. A link's target, shown while editing it, opens as
 * Obsidian would open it: by a Ctrl/Cmd-click or a middle click
 */
export function interceptLinkClicks(plugin: ToposPlugin, doc: Document): void {
  plugin.registerDomEvent(doc, "pointerdown", (event) => {
    const found = clickedLink(event);
    focusedAtPress = found?.view.hasFocus ?? false;
  }, { capture: true });
  const handle = (event: MouseEvent) => void openClickedLink(plugin, event);
  for (const type of ["mousedown", "click", "auxclick"] as const) plugin.registerDomEvent(doc, type, handle, { capture: true });

  // On iOS, Obsidian doesn't wait for the click: a listener on the window takes a tap's touchend,
  // makes a click of its own, and hands it to the editor, which would open a note named after the
  // target's first word (`1` for `[Grumble](1 Corinthians 10:10)`). A tap on a link is taken first
  // here, and neither that listener nor the browser's click sees it
  let touch: { id: number; x: number; y: number; time: number } | null = null;
  plugin.registerDomEvent(doc, "touchstart", (event) => {
    const t = event.touches.length === 1 ? event.touches[0] : undefined;
    touch = t && clickedLink(event) ? { id: t.identifier, x: t.clientX, y: t.clientY, time: Date.now() } : null;
  }, { capture: true });
  plugin.registerDomEvent(doc, "touchend", (event) => {
    const start = touch;
    touch = null;
    const t = start && Array.from(event.changedTouches).find((c) => c.identifier === start.id);
    // A tap, as Obsidian counts one: short, and without moving
    if (!start || !t || Date.now() - start.time >= 600 || Math.abs(t.clientX - start.x) >= 5 || Math.abs(t.clientY - start.y) >= 5) return;
    const click = new MouseEvent("click", { clientX: t.clientX, clientY: t.clientY, button: 0, bubbles: true, cancelable: true });
    Object.defineProperty(click, "target", { value: event.target });
    if (!openClickedLink(plugin, click)) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });
}

/** Whether the editor had focus when the pointer went down on a link, before a tap focused it */
let focusedAtPress = false;

/** The reference link (or link target) an event is on, and its editor */
function clickedLink(event: Event): { el: HTMLElement; view: EditorView } | null {
  const el = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(
    ".cm-editor .topos-link[data-topos-osis], .cm-editor .topos-link-target[data-topos-osis]",
  );
  const editor = el?.closest<HTMLElement>(".cm-editor");
  const view = editor ? EditorView.findFromDOM(editor) : null;
  return el && view ? { el, view } : null;
}

/** Opens the passage of a reference link clicked, if the click opens it; whether it was a link's */
function openClickedLink(plugin: ToposPlugin, event: MouseEvent): boolean {
  const found = clickedLink(event);
  if (!found || !linkClickOpens(plugin, event, found.view, found.el)) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.type === "mousedown") return true;
  const passage = plugin.topos.parse(found.el.dataset.toposOsis ?? "", BookStyle.Name);
  const newLeaf = event.button === 1 || event.ctrlKey || event.metaKey ? "tab" : false;
  const translation = found.el.dataset.toposTranslation;
  if (passage) plugin.tapReference(event, passage, clickedText(plugin, found.view, event), (p) => void plugin.openPassage(p, newLeaf, translation));
  return true;
}

function linkClickOpens(plugin: ToposPlugin, event: MouseEvent, view: EditorView, el: HTMLElement): boolean {
  if (event.button === 1) return true;
  if (event.button !== 0) return false;
  if (el.classList.contains("topos-link-target")) return event.ctrlKey || event.metaKey;
  return (view.state.field(editorLivePreviewField, false) ?? false) || plugin.clickOpens(event, true, focusedAtPress);
}

/**
 * The text of the reference clicked, and where in it the click was: a reference's text, or a
 * link's shown target, not a link's own text (`[text](John 3:16; 4:5)`)
 */
function clickedText(plugin: ToposPlugin, view: EditorView, event: MouseEvent): { text: string; offset: number } | null {
  let pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return null;
  // The character under the pointer, not the gap nearest it (the right half of `7` is after it)
  const gap = view.coordsAtPos(pos, -1);
  if (gap && event.clientX < gap.left && pos > 0) pos--;
  const line = view.state.doc.lineAt(pos);
  const at = pos - line.from;
  for (const r of findReferences(plugin.topos, line.text, plugin.translations())) {
    if (at < r.start || at >= r.end) continue;
    // The reference is what's shown, or the link's target, between `](` and `)`
    const [start, end] = r.kind === "explicit" || r.kind === "bare" ? [r.labelStart, r.labelEnd] : [r.labelEnd + 2, r.end - 1];
    return at >= start && at < end ? { text: line.text.slice(start, end), offset: at - start } : null;
  }
  return null;
}

/** A reference and the translation it names, for titles: `John 3:16 (KJV)` */
export function named(passage: Passage, translation?: string): string {
  return translation ? `${passage.reference} (${translation})` : passage.reference;
}

/** The note view (or other view with hover previews, like verse search) an element is in, which Obsidian's hover previews belong to */
export function hoverParent(plugin: ToposPlugin, el: HTMLElement): HoverParent {
  let parent: HoverParent | null = null;
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (!parent && (view instanceof MarkdownView || "hoverPopover" in view) && view.containerEl.contains(el)) parent = view as unknown as HoverParent;
  });
  return parent ?? { hoverPopover: null };
}

/** A reference whose text shows at the end of its line */
interface InlineItem {
  passage: Passage;
  translation?: string;
}

/**
 * The text of a line's references at its end in live preview (the `inlineText` settings), joined
 * by ` · `. Tapping it puts the cursor at the line's end. Without wrapping, it's as wide as the
 * room left on the line's last row, measured again when the text or the editor's size changes
 */
class InlineTextWidget extends WidgetType {
  /** Each editor's line-end texts that fit their row, to fit again (`refitInlineText`) */
  static readonly fits = new WeakMap<EditorView, Set<() => void>>();
  private static readonly owned = new WeakMap<HTMLElement, { view: EditorView; fit: () => void }>();
  private readonly generation: number;
  /** The settings its text and layout follow (its color and style are CSS variables) */
  private readonly look: string;

  constructor(
    private readonly plugin: ToposPlugin,
    private readonly items: InlineItem[],
  ) {
    super();
    this.generation = plugin.inlineGeneration;
    const { inlineTextTemplate, inlineTextLength, inlineTextWrap } = plugin.settings;
    this.look = `${inlineTextTemplate}\n${inlineTextLength}\n${inlineTextWrap}`;
  }

  private get key(): string {
    return this.items.map((i) => `${i.passage.osis} ${i.translation ?? ""}`).join("\n");
  }

  eq(other: InlineTextWidget): boolean {
    return other.key === this.key && other.generation === this.generation && other.look === this.look;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "topos-inline-text";
    const wrap = this.plugin.settings.inlineTextWrap;
    const show = (texts: (string | null | undefined)[]) => (el.textContent = texts.filter(Boolean).join(" · "));
    // Known already: drawn now, not a moment later (which would flicker)
    const known = this.items.map((i) => this.plugin.inlineVerseTextNow(i.passage, i.translation));
    if (known.every((t) => t !== undefined)) show(known);
    else void Promise.all(this.items.map((i) => this.plugin.inlineVerseText(i.passage, i.translation))).then(show).then(() => wrap || fit());
    // A tap puts the cursor at the end of the line, as it would on text there
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(el) } });
      view.focus();
    });
    if (wrap) return el;
    el.classList.add("is-nowrap");
    // The room left on the row: from where the line's text ends to the line's right edge, read
    // without narrowing it first (which would show it empty a moment); written only when it changes
    const fit = () =>
      view.requestMeasure({
        read: () => {
          const line = el.closest<HTMLElement>(".cm-line");
          if (!line || !el.isConnected) return null;
          const end = view.coordsAtPos(view.posAtDOM(el), -1);
          if (!end) return null;
          const style = getComputedStyle(line);
          const right = line.getBoundingClientRect().right - (parseFloat(style.paddingRight) || 0);
          return Math.max(0, Math.floor(right - end.right - (parseFloat(getComputedStyle(el).paddingLeft) || 0)));
        },
        write: (room) => {
          if (room !== null && el.style.maxWidth !== `${room}px`) el.style.maxWidth = `${room}px`;
        },
      });
    fit();
    const fits = InlineTextWidget.fits.get(view) ?? new Set();
    InlineTextWidget.fits.set(view, fits.add(fit));
    InlineTextWidget.owned.set(el, { view, fit });
    return el;
  }

  destroy(dom: HTMLElement): void {
    const owned = InlineTextWidget.owned.get(dom);
    if (owned) InlineTextWidget.fits.get(owned.view)?.delete(owned.fit);
  }

  /** Its clicks are its own (they put the cursor at the line's end) */
  ignoreEvent(): boolean {
    return true;
  }
}

/** Fits an editor's line-end texts to their rows again (its text or size changed) */
function refitInlineText(view: EditorView): void {
  for (const fit of InlineTextWidget.fits.get(view) ?? []) fit();
}

/** `![John 1:1]` in live preview: the passage's text */
class EmbedWidget extends WidgetType {
  private static owners = new WeakMap<HTMLElement, Component>();

  constructor(
    private readonly plugin: ToposPlugin,
    private readonly passage: Passage,
    private readonly label: string,
    private readonly translation?: string,
    private readonly fragment?: string,
  ) {
    super();
  }

  eq(other: EmbedWidget): boolean {
    return (
      other.passage.osis === this.passage.osis && other.label === this.label && other.translation === this.translation && other.fragment === this.fragment
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("div");
    const owner = new Component();
    owner.load();
    EmbedWidget.owners.set(el, owner);
    // A highlight made in it writes the embed again, where it is now
    const onHighlight = (fragment: string | null) => {
      const pos = view.posAtDOM(el);
      const line = view.state.doc.lineAt(pos);
      const found = findReferences(this.plugin.topos, line.text, this.plugin.translations()).filter((r) => r.passage.osis === this.passage.osis);
      const r = found.find((r) => line.from + r.start <= pos && pos <= line.from + r.end) ?? found[0];
      if (r) view.dispatch({ changes: { from: line.from + r.start, to: line.from + r.end, insert: withHighlight(line.text, r, fragment) } });
    };
    void this.plugin.embedPassage(el, this.passage, this.label || this.passage.reference, owner, this.translation, { fragment: this.fragment, onHighlight });
    return el;
  }

  destroy(dom: HTMLElement): void {
    EmbedWidget.owners.get(dom)?.unload();
  }

  get estimatedHeight(): number {
    return 120;
  }

  /** Scrolling and clicking in the passage don't move the cursor */
  ignoreEvent(): boolean {
    return true;
  }
}
