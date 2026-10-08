import {
  Editor,
  EditorSuggest,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
} from "obsidian";
import type { Completion } from "biblix";
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
    const completions = this.completions(editor, cursor);
    if (completions.length === 0) return null;
    const start = Math.min(...completions.map((c) => c.start));
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

  selectSuggestion(completion: Completion): void {
    const context = this.context;
    if (!context) return;
    const line = context.end.line;
    context.editor.replaceRange(
      completion.text,
      { line, ch: completion.start },
      { line, ch: completion.end },
    );
    context.editor.setCursor({ line, ch: completion.start + completion.text.length });
  }
}
