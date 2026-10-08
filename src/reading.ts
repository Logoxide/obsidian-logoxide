import { Component, MarkdownRenderChild, type MarkdownPostProcessor } from "obsidian";
import type { Passage } from "topos-bible";
import { findReferences, wholeReference } from "./core/syntax.ts";
import { hoverParent, named } from "./editor/decorations.ts";
import type ToposPlugin from "./main.ts";

/** The class of references this file links (the editor's own highlights are CodeMirror's) */
const RENDERED = "topos-rendered";

/** Elements whose text is never linked */
const SKIP = new Set(["A", "CODE", "PRE", "SCRIPT", "STYLE"]);

/**
 * Rendered Markdown inside a live preview editor: callouts, tables, and embedded notes. The
 * editor keeps these until their text changes, so a new link setting relinks them in place
 */
const RENDERED_IN_EDITOR = ".cm-content .cm-embed-block, .cm-content .markdown-embed";

/**
 * References in reading view (see `core/syntax.ts`): bare references are highlighted (opening their
 * link with Ctrl/Cmd-click, like the editor), `[text](John 1:1)` and `[John 1:1]` become links to
 * the passage, `![John 1:1]` shows its text (and so does a bare reference alone on its line, with
 * `embedAlone`), and all of them preview the passage on hover
 */
export function linkReferences(plugin: ToposPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    if (!plugin.settings.linkInReading) return;
    const owner = new MarkdownRenderChild(el);
    ctx.addChild(owner);
    linkElement(plugin, el, owner, ctx.sourcePath);
  };
}

/** The embeds in blocks relinked in live preview, unloaded when the block is relinked again */
const blockOwners = new WeakMap<HTMLElement, Component>();

/** Links the references in an element's text, leaving links and linked ones alone */
export function linkElement(plugin: ToposPlugin, el: HTMLElement, owner: Component, sourcePath = ""): void {
  const doc = el.ownerDocument;
  linkUnresolved(plugin, el, sourcePath);
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let parent = node.parentElement; parent && parent !== el; parent = parent.parentElement) {
        // A table cell being edited is an editor of its own, with the editor's highlights
        if (SKIP.has(parent.tagName) || parent.classList.contains("cm-editor") || parent.classList.contains(RENDERED)) {
          return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  const hasBible = plugin.bibles.all().length > 0;
  for (const node of nodes) {
    const text = node.data;
    const found = findReferences(plugin.topos, text, plugin.translations());
    if (found.length === 0) continue;
    const fragment = doc.createDocumentFragment();
    let last = 0;
    for (const r of found) {
      let element: HTMLElement;
      if (r.kind === "bare" && plugin.settings.embedAlone && hasBible && aloneOnLine(node, text, r.start, r.end)) {
        element = doc.createElement("div");
        element.classList.add(RENDERED);
        // Unlinking puts the reference back
        element.dataset.toposText = text.slice(r.start, r.end);
        void plugin.embedPassage(element, r.passage, r.passage.reference, owner, r.translation);
      } else if (r.kind === "bare") {
        const url = plugin.referenceUrl(r.passage, r.translation);
        if (!url && !hasBible) continue;
        element = doc.createElement("span");
        element.className = `topos-reference ${RENDERED}`;
        element.textContent = text.slice(r.start, r.end);
        if (url) element.dataset.toposUrl = url;
        element.title = url ? `${named(r.passage, r.translation)}, opens in ${plugin.linkSite()}` : named(r.passage, r.translation);
        openOnClick(plugin, element, r.passage, false, r.translation);
      } else if (r.kind === "embed") {
        element = doc.createElement("div");
        element.classList.add(RENDERED);
        void plugin.embedPassage(element, r.passage, text.slice(r.labelStart, r.labelEnd) || r.passage.reference, owner, r.translation);
      } else {
        element = doc.createElement("a");
        element.className = `topos-link ${RENDERED}`;
        element.textContent = text.slice(r.labelStart, r.labelEnd);
        element.title = named(r.passage, r.translation);
        openOnClick(plugin, element, r.passage, true, r.translation);
      }
      element.dataset.toposOsis = r.passage.osis;
      if (r.translation) element.dataset.toposTranslation = r.translation;
      const kind = element.dataset.toposText === undefined ? r.kind : "embed";
      element.dataset.toposKind = kind;
      previewOnHover(plugin, element, r.passage, kind === "bare", r.translation);
      fragment.append(text.slice(last, r.start), element);
      last = r.end;
    }
    if (last === 0) continue;
    fragment.append(text.slice(last));
    node.replaceWith(fragment);
  }
}

/** Whether `text[start..end]` is all of a line in a paragraph: between line breaks, with only spaces around it */
function aloneOnLine(node: Text, text: string, start: number, end: number): boolean {
  const parent = node.parentElement;
  if (!parent || !["P", "DIV"].includes(parent.tagName)) return false;
  const lineEdge = (sibling: ChildNode | null) => sibling === null || sibling.nodeName === "BR";
  return !text.slice(0, start).trim() && !text.slice(end).trim() && lineEdge(node.previousSibling) && lineEdge(node.nextSibling);
}

/**
 * Obsidian's links whose target is a reference and no note, like `[osis](John.3.16)` or
 * `[text](<John 3:16>)`: marked as reference links, previewing the passage (clicks go through
 * `openLinkText`, which the plugin opens the passage from)
 */
function linkUnresolved(plugin: ToposPlugin, el: HTMLElement, sourcePath: string): void {
  // Obsidian marks unresolved links after post-processing, so look the target up here
  for (const a of Array.from(el.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
    const href = a.dataset.href ?? "";
    if (!href || plugin.app.metadataCache.getFirstLinkpathDest(href.split("#")[0]!, sourcePath)) continue;
    const passage = wholeReference(plugin.topos, href);
    if (!passage) continue;
    a.classList.add("topos-link");
    a.classList.remove("is-unresolved");
    a.dataset.toposOsis = passage.osis;
    a.dataset.toposKind = "link";
    previewOnHover(plugin, a, passage, false);
  }
}

function openOnClick(plugin: ToposPlugin, element: HTMLElement, passage: Passage, link: boolean, translation?: string): void {
  const open = (event: MouseEvent) => {
    // Links open on a plain click, like Obsidian's; bare references like in the editor
    if (link ? event.button > 1 : !plugin.clickOpens(event, false)) return;
    // In live preview, a click in a callout would otherwise start editing it
    event.preventDefault();
    event.stopPropagation();
    if (link) void plugin.openPassage(passage, event.button === 1 || event.ctrlKey || event.metaKey ? "tab" : false, translation);
    else if (element.dataset.toposUrl) element.ownerDocument.defaultView?.open(element.dataset.toposUrl, "_blank");
  };
  element.addEventListener("click", open);
  // A middle click arrives as auxclick; its mousedown would paste (Linux) or autoscroll
  element.addEventListener("auxclick", open);
  element.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
}

function previewOnHover(plugin: ToposPlugin, element: HTMLElement, passage: Passage, bare: boolean, translation?: string): void {
  element.addEventListener("mouseover", (event) => {
    if (bare && !plugin.settings.previewBare) return;
    void plugin.previewPassage(event, element, passage, hoverParent(plugin, element), translation);
  });
}

/** Turns an element's linked references back into text (and removes its embeds) */
export function unlinkElement(el: HTMLElement): void {
  const links = el.querySelectorAll<HTMLElement>(`.${RENDERED}`);
  for (const link of Array.from(links)) {
    const source = link.dataset.toposText ?? (link.dataset.toposKind === "embed" ? "" : (link.textContent ?? ""));
    link.replaceWith(source);
  }
  if (links.length > 0) el.normalize();
}

/** Relinks the rendered blocks in a live preview editor for the current settings */
export function relinkEditor(plugin: ToposPlugin, editorEl: HTMLElement): void {
  for (const block of Array.from(editorEl.querySelectorAll<HTMLElement>(RENDERED_IN_EDITOR))) {
    // Embedded notes are inside embed blocks too; relink each block only once
    if (block.parentElement?.closest(RENDERED_IN_EDITOR)) continue;
    blockOwners.get(block)?.unload();
    unlinkElement(block);
    if (!plugin.settings.linkInReading) continue;
    const owner = new Component();
    owner.load();
    blockOwners.set(block, owner);
    linkElement(plugin, block, owner);
  }
}

