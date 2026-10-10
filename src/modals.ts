import { App, Editor, SuggestModal, setIcon } from "obsidian";
import { CompletionKind, type Completion } from "logoxide";
import { applyCompletion, completionsBefore } from "./core/completions.ts";
import { written } from "./core/format.ts";
import { NO_FILTERS } from "./core/filters.ts";
import type { SavedQuery } from "./core/query.ts";
import type { Hit } from "./core/search.ts";
import type ToposPlugin from "./main.ts";
import { bookStyle } from "./settings.ts";
import { renderCompletion, renderHit, renderSuggestion } from "./suggestions.ts";

/** A completion, or the typed reference itself when it is already complete */
type Choice = { kind: "completion"; completion: Completion } | { kind: "reference"; text: string };

/** Type a reference with autocomplete, then insert it at the cursor */
export class InsertReferenceModal extends SuggestModal<Choice> {
  private readonly plugin: ToposPlugin;
  private readonly editor: Editor;

  constructor(app: App, plugin: ToposPlugin, editor: Editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
    this.setPlaceholder("Type a reference, like John 3:16");
    this.setInstructions([
      { command: "↵", purpose: "complete, or insert a finished reference" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  getSuggestions(query: string): Choice[] {
    const { settings, topos } = this.plugin;
    const style = bookStyle(settings.style);
    const choices: Choice[] = [];
    const passage = query.trim() ? topos.parse(query, style) : null;
    if (passage) choices.push({ kind: "reference", text: written(topos, passage, style, settings.format) });
    const completions = completionsBefore(topos, query, style, settings.suggestionLimit, "always", {
      format: settings.format,
    });
    choices.push(...completions.map((completion) => ({ kind: "completion" as const, completion })));
    return choices;
  }

  renderSuggestion(choice: Choice, el: HTMLElement): void {
    if (choice.kind === "reference") {
      const passage = this.plugin.topos.parse(choice.text, bookStyle(this.plugin.settings.style));
      renderSuggestion(this.plugin, el, { label: choice.text, kind: "insert", icon: "corner-down-left", passage });
      el.addClass("is-insert");
    } else renderCompletion(this.plugin, el, choice.completion);
  }

  /** Books and chapters keep the dialog open so the reference can be refined */
  selectSuggestion(choice: Choice, evt: MouseEvent | KeyboardEvent): void {
    if (choice.kind === "completion" && choice.completion.kind !== CompletionKind.Verse) {
      this.inputEl.value = applyCompletion(this.inputEl.value, choice.completion);
      this.inputEl.dispatchEvent(new Event("input"));
      return;
    }
    super.selectSuggestion(choice, evt);
  }

  onChooseSuggestion(choice: Choice): void {
    const text =
      choice.kind === "reference" ? choice.text : applyCompletion(this.inputEl.value, choice.completion);
    this.editor.replaceSelection(text);
  }
}

/** Type a passage and jump to any reference in the vault that overlaps it */
export class GoToReferenceModal extends SuggestModal<Hit> {
  private readonly plugin: ToposPlugin;

  constructor(app: App, plugin: ToposPlugin) {
    super(app);
    this.plugin = plugin;
    this.limit = 200;
    this.setPlaceholder("Type a passage, like Romans 8");
    this.emptyStateText = "No references to it in the vault.";
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "↵", purpose: "to open" },
      { command: "esc", purpose: "to dismiss" },
    ]);
  }

  getSuggestions(query: string): Hit[] {
    const { topos, refs: index } = this.plugin;
    if (!query.trim() || !topos.parse(query, 0)) return [];
    return index.query({ ...NO_FILTERS, anyOverlap: [query] }, { kind: "vault" }, "bible").page(0, this.limit);
  }

  renderSuggestion(hit: Hit, el: HTMLElement): void {
    const style = bookStyle(this.plugin.settings.style);
    renderHit(this.plugin, el, hit, written(this.plugin.topos, hit.passage, style, this.plugin.settings.format));
  }

  onChooseSuggestion(hit: Hit): void {
    void this.plugin.openHit(hit);
  }
}

/** Pick a saved search to show in the sidebar */
export class SavedQueryModal extends SuggestModal<SavedQuery> {
  private readonly plugin: ToposPlugin;

  constructor(app: App, plugin: ToposPlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder("Saved search");
    this.emptyStateText = "No saved searches match. Save one from verse search.";
  }

  getSuggestions(query: string): SavedQuery[] {
    const q = query.trim().toLowerCase();
    return this.plugin.settings.queries.filter(
      (saved) => saved.name.toLowerCase().includes(q) || saved.query.toLowerCase().includes(q),
    );
  }

  renderSuggestion(saved: SavedQuery, el: HTMLElement): void {
    el.addClass("topos-suggestion");
    setIcon(el.createSpan({ cls: "topos-suggestion-icon" }), "bookmark");
    const main = el.createDiv({ cls: "topos-suggestion-main" });
    main.createDiv({ cls: "topos-suggestion-label", text: saved.name });
    main.createEl("code", { text: saved.query || "(no filters)", cls: "topos-query-text" });
  }

  onChooseSuggestion(saved: SavedQuery): void {
    void this.plugin.openQuery(saved);
  }
}
