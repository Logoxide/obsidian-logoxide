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
import { Component, editorLivePreviewField, MarkdownView, type HoverParent } from "obsidian";
import { BookStyle, type Passage } from "topos-bible";
import { findReferences } from "../core/syntax.ts";
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
 */
export function referenceDecorations(plugin: ToposPlugin) {
  class References implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate): void {
      const refresh = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshReferences)));
      if (refresh || update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = this.build(update.view);
    }

    build(view: EditorView): DecorationSet {
      const decorations: DecorationRange<Decoration>[] = [];
      const live = view.state.field(editorLivePreviewField, false) ?? false;
      const { selection } = view.state;
      const editing = (from: number, to: number) => selection.ranges.some((r) => r.from <= to && r.to >= from);
      const site = plugin.linkSite();
      const hasBible = plugin.bibles.all().length > 0;
      // Visible ranges widened to whole lines can overlap
      let lastEnd = -1;
      for (const { from, to } of view.visibleRanges) {
        // Whole lines, so references are not cut at the edge of the viewport
        const start = view.state.doc.lineAt(from).from;
        const end = view.state.doc.lineAt(to).to;
        const text = view.state.doc.sliceString(start, end);
        for (const r of findReferences(plugin.topos, text)) {
          const [a, b] = [start + r.start, start + r.end];
          const [labelA, labelB] = [start + r.labelStart, start + r.labelEnd];
          if (a < lastEnd) continue;
          const data = { "data-topos-osis": r.passage.osis, "data-topos-kind": r.kind };
          if (r.kind === "bare") {
            if (!plugin.settings.linkInEditor) continue;
            const url = plugin.referenceUrl(r.passage);
            if (!url && !hasBible) continue;
            const attributes: Record<string, string> = { ...data, title: url ? `${r.passage.reference}, opens in ${site}` : r.passage.reference };
            if (url) attributes["data-topos-url"] = url;
            decorations.push(Decoration.mark({ class: "topos-reference", attributes }).range(a, b));
          } else if (r.kind === "embed" && live && !editing(a, b)) {
            decorations.push(Decoration.replace({ widget: new EmbedWidget(plugin, r.passage, text.slice(r.labelStart, r.labelEnd)) }).range(a, b));
          } else {
            const hide = live && !editing(a, b);
            if (hide && labelA > a) decorations.push(Decoration.replace({}).range(a, labelA));
            if (labelB > labelA) {
              const title = `${r.passage.reference}${r.kind === "embed" ? " (embedded)" : ""}`;
              decorations.push(Decoration.mark({ class: "topos-link", attributes: { ...data, title } }).range(labelA, labelB));
            }
            // Inclusive, to cover the external link icon Obsidian puts after `[text](John 3:16)`
            if (hide && b > labelB) decorations.push(Decoration.replace({ inclusiveEnd: true }).range(labelB, b));
          }
          lastEnd = b;
        }
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
    if (!el || el.classList.contains("topos-link")) return false;
    const url = el.dataset.toposUrl;
    if (!url || !plugin.settings.linkInEditor || !plugin.clickOpens(event, true, focusedAtPress)) return false;
    event.preventDefault();
    window.open(url, "_blank");
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
        if (passage) void plugin.previewPassage(event, el, passage, hoverParent(plugin, view.dom));
        return false;
      },
    }),
  ];
}

/**
 * Clicks on reference links in editors, caught before Obsidian's: its live preview sees
 * `[text](John 3:16)` as a link to a note named `John`, and would create that note. A plain click
 * opens the passage in live preview (like Obsidian's links), a Ctrl/Cmd-click (or a tap, by the
 * settings) in source mode, and a middle click anywhere
 */
export function interceptLinkClicks(plugin: ToposPlugin, doc: Document): void {
  let focusedAtPress = false;
  const link = (event: Event) => {
    const el = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(".cm-editor .topos-link[data-topos-osis]");
    const editor = el?.closest<HTMLElement>(".cm-editor");
    const view = editor ? EditorView.findFromDOM(editor) : null;
    return el && view ? { el, view } : null;
  };
  const opens = (event: MouseEvent, view: EditorView) =>
    event.button === 1 ||
    (event.button === 0 && ((view.state.field(editorLivePreviewField, false) ?? false) || plugin.clickOpens(event, true, focusedAtPress)));
  plugin.registerDomEvent(doc, "pointerdown", (event) => {
    const found = link(event);
    focusedAtPress = found?.view.hasFocus ?? false;
  }, { capture: true });
  const handle = (event: MouseEvent) => {
    const found = link(event);
    if (!found || !opens(event, found.view)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "mousedown") return;
    const passage = plugin.topos.parse(found.el.dataset.toposOsis ?? "", BookStyle.Name);
    if (passage) void plugin.openPassage(passage, event.button === 1 || event.ctrlKey || event.metaKey ? "tab" : false);
  };
  for (const type of ["mousedown", "click", "auxclick"] as const) plugin.registerDomEvent(doc, type, handle, { capture: true });
}

/** The note view an element is in, which Obsidian's hover previews belong to */
export function hoverParent(plugin: ToposPlugin, el: HTMLElement): HoverParent {
  let parent: HoverParent | null = null;
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    if (!parent && leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(el)) parent = leaf.view;
  });
  return parent ?? { hoverPopover: null };
}

/** `![John 1:1]` in live preview: the passage's text */
class EmbedWidget extends WidgetType {
  private static owners = new WeakMap<HTMLElement, Component>();

  constructor(
    private readonly plugin: ToposPlugin,
    private readonly passage: Passage,
    private readonly label: string,
  ) {
    super();
  }

  eq(other: EmbedWidget): boolean {
    return other.passage.osis === this.passage.osis && other.label === this.label;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    const owner = new Component();
    owner.load();
    EmbedWidget.owners.set(el, owner);
    void this.plugin.embedPassage(el, this.passage, this.label || this.passage.reference, owner);
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
