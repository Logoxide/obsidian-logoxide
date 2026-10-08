import { setIcon } from "obsidian";
import { BookStyle, CompletionKind, type Passage } from "biblix";
import type { Hit } from "./core/search.ts";
import type ToposPlugin from "./main.ts";

/** Each completion kind's name and icon */
const KINDS: Record<number, { name: string; icon: string }> = {
  [CompletionKind.Book]: { name: "book", icon: "book" },
  [CompletionKind.Chapter]: { name: "chapter", icon: "book-open" },
  [CompletionKind.Verse]: { name: "verse", icon: "text-quote" },
  [CompletionKind.Translation]: { name: "translation", icon: "languages" },
};

const FILE_ICONS: Record<string, string> = {
  md: "file-text",
  txt: "file-type",
  epub: "book-marked",
  srt: "captions",
  vtt: "captions",
};

/**
 * A suggestion in the editor or a dialog: an icon, the label, and a tag for its kind; with
 * `passage`, the passage's text from the vault's Bible below it (filled in once read)
 */
export function renderSuggestion(
  plugin: ToposPlugin,
  el: HTMLElement,
  { label, kind, icon, passage = null }: { label: string; kind: string; icon: string; passage?: Passage | null },
): void {
  el.addClass("topos-suggestion");
  setIcon(el.createSpan({ cls: "topos-suggestion-icon" }), icon);
  const main = el.createDiv({ cls: "topos-suggestion-main" });
  main.createDiv({ cls: "topos-suggestion-label", text: label });
  el.createSpan({ cls: "topos-suggestion-kind", text: kind });
  if (!passage) return;
  void plugin.bibles.text(passage).then((text) => {
    if (text) main.createDiv({ cls: "topos-suggestion-text", text });
  });
}

/** A completion as a suggestion; a verse shows its text */
export function renderCompletion(plugin: ToposPlugin, el: HTMLElement, completion: { label: string; kind: number }): void {
  const kind = KINDS[completion.kind] ?? { name: "", icon: "dot" };
  const passage = completion.kind === CompletionKind.Verse ? plugin.topos.parse(completion.label, BookStyle.Name) : null;
  renderSuggestion(plugin, el, { label: completion.label, kind: kind.name, icon: kind.icon, passage });
}

/**
 * A reference in the vault as a suggestion, like a result in verse search: the reference, its file
 * and place, and its line with the reference marked (a note's line is read from the note)
 */
export function renderHit(plugin: ToposPlugin, el: HTMLElement, hit: Hit, reference: string): void {
  el.addClass("topos-hit-suggestion");
  const head = el.createDiv({ cls: "topos-hit-head" });
  head.createSpan({ cls: "topos-pill", text: reference });
  const where = head.createSpan({ cls: "topos-hit-where" });
  const extension = hit.path.slice(hit.path.lastIndexOf(".") + 1).toLowerCase();
  setIcon(where.createSpan({ cls: "topos-hit-icon" }), FILE_ICONS[extension] ?? "file");
  const slash = hit.path.lastIndexOf("/");
  if (slash > 0) where.createSpan({ cls: "topos-hit-folder", text: hit.path.slice(0, slash + 1) });
  const name = hit.path.slice(slash + 1);
  where.createSpan({ cls: "topos-hit-name", text: extension === "md" ? name.slice(0, -3) : name });
  where.createSpan({
    cls: "topos-hit-line",
    text: hit.epub ? (hit.epub.chapter ?? `Section ${hit.epub.spineIndex + 1}`) : `Line ${hit.line}`,
  });
  const context = el.createDiv({ cls: "topos-hit-context" });
  const show = (line: string) => {
    const from = hit.column - 1;
    const to = from + (hit.end - hit.start);
    // The line from a little before the reference, so it stays in view
    const start = from > 40 ? line.lastIndexOf(" ", from - 40) + 1 : 0;
    context.empty();
    context.append((start > 0 ? "…" : "") + line.slice(start, from).trimStart());
    context.createEl("mark", { text: line.slice(from, to) });
    context.append(line.slice(to));
  };
  if (hit.lineText) show(hit.lineText);
  else if (hit.epub) {
    // An EPUB's text around its references is in its details, read on demand
    void plugin.indexer.loadFileDetails(hit.path).then(() => {
      const loaded = plugin.refs.get(hit.path).find((h) => h.start === hit.start);
      if (loaded?.lineText) show(loaded.lineText);
    });
  } else {
    const file = plugin.app.vault.getFileByPath(hit.path);
    if (file) void plugin.app.vault.cachedRead(file).then((text) => show(text.split(/\r?\n/)[hit.line - 1] ?? ""));
  }
}
