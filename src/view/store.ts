import { NO_FILTERS, type Filters } from "../core/filters.ts";
import type { QueryScope } from "../core/index.ts";
import { cleanPath, EVERYWHERE, patternProblems, type PathPattern, type Where } from "../core/paths.ts";
import type { SortOrder } from "../core/sort.ts";

/** The whole vault, the current note, or the files and folders and patterns chosen */
export type Scope = "vault" | "file" | "paths";

export interface SearchState {
  filters: Filters;
  scope: Scope;
  /** With the "paths" scope: files and folders to search (none: all of them) */
  paths: string[];
  /** With the "paths" scope: globs and regular expressions that pick files */
  patterns: PathPattern[];
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
    this.state = {
      filters: NO_FILTERS,
      scope: "vault",
      paths: [],
      patterns: [],
      sort: "file",
      groupBy: "file",
      context: 0,
      extensions: [],
      ...upgrade(initial),
    };
  }

  get = (): SearchState => this.state;

  set(update: Partial<SearchState>): void {
    this.state = { ...this.state, ...upgrade(update) };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** A state from before several paths (a search tab's, saved with the workspace): one `folder` */
function upgrade(state: Partial<SearchState> & { folder?: string; scope?: string }): Partial<SearchState> {
  const { folder, ...rest } = state;
  if ((rest.scope as string) === "folder") rest.scope = "paths";
  if (folder !== undefined && rest.paths === undefined) rest.paths = cleanPath(folder) ? [cleanPath(folder)] : [];
  return rest;
}

/**
 * The files a search looks at, for the index (`activePath`: the current note's), leaving out
 * patterns that can't be read (the search tab shows why)
 */
export function queryScope(state: SearchState, activePath: string): QueryScope {
  if (state.scope === "file") return { kind: "file", path: activePath };
  const patterns = state.patterns.filter((p) => patternProblems([p]).length === 0);
  if (state.scope === "paths" && (state.paths.length > 0 || patterns.length > 0)) {
    return { kind: "paths", paths: state.paths.map(cleanPath).filter(Boolean), patterns };
  }
  return { kind: "vault" };
}

/** The paths and patterns a search is limited to, for its CLI options */
export function searchWhere(state: SearchState): Where {
  return state.scope === "paths" ? { paths: state.paths.map(cleanPath).filter(Boolean), patterns: state.patterns } : EVERYWHERE;
}

/** The state for a saved search's paths and patterns: in them, or in the whole vault */
export function scopeOf(where: Where, current: Scope = "vault"): Pick<SearchState, "scope" | "paths" | "patterns"> {
  if (where.paths.length > 0 || where.patterns.length > 0) return { scope: "paths", paths: where.paths, patterns: where.patterns };
  return { scope: current === "paths" ? "vault" : current, paths: [], patterns: [] };
}
