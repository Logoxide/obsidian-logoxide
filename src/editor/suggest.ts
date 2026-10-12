import {
  type App,
  Editor,
  EditorSuggest,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
} from "obsidian";
import { keymap, type EditorView } from "@codemirror/view";
import type { Completion } from "logoxide";
import { completionsBefore } from "../core/completions.ts";
import { renderCompletion } from "../suggestions.ts";
import type ToposPlugin from "../main.ts";
import { bookStyle } from "../settings.ts";


/** Suggests books, chapters, verses, and translations for the reference being typed in the editor */
export class ReferenceSuggest extends EditorSuggest<Completion> {
  private readonly plugin: ToposPlugin;

  constructor(plugin: ToposPlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to complete" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  private completions(editor: Editor, cursor: EditorPosition): Completion[] {
    const { settings, topos } = this.plugin;
    const line = editor.getLine(cursor.line);
    return completionsBefore(
      topos,
      line.slice(0, cursor.ch),
      bookStyle(settings.style),
      settings.suggestionLimit,
      settings.bookCompletion,
      { needsNumber: true, format: settings.format, after: line.slice(cursor.ch), translations: this.plugin.translations() },
    );
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    if (!this.plugin.settings.autocomplete) return null;
    // This suggester comes first (`suggestFirst`), but a note link being typed (`[[John 3`) is
    // Obsidian's, and so is a tag (`#John`)
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    if (/\[\[[^\]]*$/.test(before)) return null;
    const completions = this.completions(editor, cursor);
    if (completions.length === 0) return null;
    const start = Math.min(...completions.map((c) => c.start));
    if (before[start - 1] === "#") return null;
    return {
      start: { line: cursor.line, ch: start },
      end: cursor,
      query: editor.getLine(cursor.line).slice(start, cursor.ch),
    };
  }

  getSuggestions(context: EditorSuggestContext): Completion[] {
    return this.completions(context.editor, context.end);
  }

  renderSuggestion(completion: Completion, el: HTMLElement): void {
    renderCompletion(this.plugin, el, completion);
  }

  selectSuggestion(completion: Completion, event: MouseEvent | KeyboardEvent): void {
    const context = this.context;
    if (!context) return;
    const line = context.end.line;
    // Enter on what's typed already is a new line, as it would be without suggestions (a space is
    // still a space): passed on to the editor, which continues a list
    const typed = context.editor.getRange({ line, ch: completion.start }, { line, ch: completion.end });
    if ((event as KeyboardEvent | undefined)?.key === "Enter" && typed === completion.text) {
      this.close();
      newLine(context.editor);
      return;
    }
    context.editor.replaceRange(
      completion.text,
      { line, ch: completion.start },
      { line, ch: completion.end },
    );
    context.editor.setCursor({ line, ch: completion.start + completion.text.length });
  }
}

/**
 * A new line in an editor as Enter makes it (continuing a list or quote): the editor's own Enter
 * command, the first of its key bindings for Enter that applies; Obsidian's plain new line without
 * one. Not by sending it an Enter: on iOS, CodeMirror runs a key it's sent a moment later, after
 * this has gone on to make the line itself
 */
function newLine(editor: Editor): void {
  const view = (editor as { cm?: EditorView }).cm;
  if (view) {
    for (const bindings of view.state.facet(keymap)) {
      for (const binding of bindings) if (binding.key === "Enter" && binding.run?.(view)) return;
    }
  }
  editor.exec("newlineAndIndent");
}

/**
 * Puts a suggester before every other plugin's (Obsidian asks them in order, and shows the first
 * that has suggestions)
 */
export function suggestFirst(app: App, suggest: EditorSuggest<unknown>): void {
  const suggests = (app.workspace as { editorSuggest?: { suggests?: EditorSuggest<unknown>[] } }).editorSuggest?.suggests;
  if (!suggests) return;
  const at = suggests.indexOf(suggest);
  if (at > 0) suggests.unshift(...suggests.splice(at, 1));
}
