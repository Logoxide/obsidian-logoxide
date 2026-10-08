import { NO_FILTERS, type Filters } from "../core/filters.ts";
import type { SortOrder } from "../core/sort.ts";

export type Scope = "vault" | "file" | "folder";

export interface SearchState {
  filters: Filters;
  scope: Scope;
  folder: string;
  sort: SortOrder;
  groupBy: "file" | "book";
  /** Lines to show before and after each result's line */
  context: number;
  /** File extensions to search (without the dot), or all of them if empty */
  extensions: string[];
}

/**
 * A search's state: the sidebar's is kept on the plugin so commands can set filters and the view
 * survives reloads; each search tab has its own, saved with the workspace
 */
export class SearchStore {
  private state: SearchState;
  private readonly listeners = new Set<() => void>();

  constructor(initial: Partial<SearchState> = {}) {
    this.state = { filters: NO_FILTERS, scope: "vault", folder: "", sort: "file", groupBy: "file", context: 0, extensions: [], ...initial };
  }

  get = (): SearchState => this.state;

  set(update: Partial<SearchState>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
