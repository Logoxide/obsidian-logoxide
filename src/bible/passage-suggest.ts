import { AbstractInputSuggest } from "obsidian";
import { CompletionKind, type Completion, type Passage } from "logoxide";
import { applyCompletion, completionsBefore } from "../core/completions.ts";
import { bookStyle } from "../core/settings.ts";
import type ToposPlugin from "../main.ts";
import { renderCompletion, renderSuggestion } from "../suggestions.ts";

/** What the passage field suggests: going to the passage typed, or completing it */
type Choice = { kind: "go"; passage: Passage } | { kind: "completion"; completion: Completion };

/**
 * Autocomplete for a field that goes to a passage (a rows tab's): books, chapters, and verses as
 * they're typed (a verse with its text), as the editor completes them; the passage typed, once
 * it's one, first. A book or chapter completes the field and keeps it open; a verse, or the
 * passage typed, goes there (`go`)
 */
export class PassageSuggest extends AbstractInputSuggest<Choice> {
  /** Whether its list is showing (Enter is then its own) */
  shown = false;

  constructor(
    private readonly plugin: ToposPlugin,
    private readonly input: HTMLInputElement,
    private readonly go: (passage: Passage) => void,
  ) {
    super(plugin.app, input);
    this.limit = plugin.settings.suggestionLimit || 20;
  }

  override open(): void {
    super.open();
    this.shown = true;
  }

  override close(): void {
    super.close();
    this.shown = false;
  }

  protected getSuggestions(query: string): Choice[] {
    const { settings, topos } = this.plugin;
    const style = bookStyle(settings.style);
    const caret = this.input.selectionStart ?? query.length;
    const choices: Choice[] = [];
    const passage = query.trim() ? topos.parse(query, style) : null;
    if (passage) choices.push({ kind: "go", passage });
    const completions = completionsBefore(topos, query.slice(0, caret), style, this.limit, "always", { format: settings.format, after: query.slice(caret) });
    // Not the passage typed again
    for (const completion of completions) if (applyCompletion(query, completion).trim() !== passage?.reference) choices.push({ kind: "completion", completion });
    return choices;
  }

  renderSuggestion(choice: Choice, el: HTMLElement): void {
    if (choice.kind === "go") {
      renderSuggestion(this.plugin, el, { label: choice.passage.reference, kind: "go", icon: "corner-down-left", passage: choice.passage });
      el.addClass("is-insert");
    } else renderCompletion(this.plugin, el, choice.completion);
  }

  override selectSuggestion(choice: Choice, _evt: MouseEvent | KeyboardEvent): void {
    if (choice.kind === "go") return this.done(choice.passage);
    const text = applyCompletion(this.input.value, choice.completion);
    const style = bookStyle(this.plugin.settings.style);
    const passage = choice.completion.kind === CompletionKind.Verse ? this.plugin.topos.parse(text, style) : null;
    if (passage) return this.done(passage);
    // A book or chapter: completed, and on to what's in it
    this.setValue(text);
    this.input.setSelectionRange(text.length, text.length);
    this.input.dispatchEvent(new Event("input"));
  }

  private done(passage: Passage): void {
    this.setValue(passage.reference);
    this.close();
    this.input.blur();
    this.go(passage);
  }
}
