import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { Passage } from "topos-bible";
import { chosenExtensions, extensionOf, toggleExtension } from "../core/file-types.ts";
import { cleanPath, excludes, parsePattern, patternProblems, patternText, type PathPattern } from "../core/paths.ts";
import { compileFilters, isEmpty, NO_FILTERS, type Filters, type Testament } from "../core/filters.ts";
import { written } from "../core/format.ts";
import { formatQuery, parseQuery } from "../core/query.ts";
import type { Hit } from "../core/search.ts";
import { groupHits, mergeNearby, type HitRun, type SortOrder } from "../core/sort.ts";
import { bookStyle, type StyleName } from "../core/settings.ts";
import type ToposPlugin from "../main.ts";
import { Chips, NameInput, ReferenceInput } from "./inputs.tsx";
import {
  FilterRow,
  isEpub,
  PASSAGE_ROWS,
  TestamentToggle,
  useFileLines,
  useCollapsed,
  useLoadPastHidden,
  usePages,
  type ListKey,
} from "./parts.tsx";
import { queryScope, scopeOf, searchWhere, type Scope, type SearchStore } from "./store.ts";

/** How many results render at a time (more load as the list scrolls to its end) */
const PAGE = 100;

/** Narrower than this, the filters go above the results instead of beside them */
const NARROW = 760;

/** What the search tab needs from Obsidian (kept out of this file so it renders in tests) */
export interface PaneHost {
  /** Renders Markdown from a note into an element; resolves once rendered, and `unload` frees it */
  markdown(el: HTMLElement, markdown: string, sourcePath: string): { done: Promise<void>; unload: () => void };
  /** Shows a passage's text from the vault's Bibles in an element */
  verses(el: HTMLElement, passage: Passage, label: string): { unload: () => void };
  icon(el: HTMLElement, name: string): void;
  /** Opens a result beside the search tab (in a new tab with `newTab`) */
  open(hit: Hit, newTab: boolean): void;
  /** Opens a passage in the Bible tab, or with the link site */
  openPassage(passage: Passage, newTab: boolean): void;
  copy(text: string): void;
  /** The vault's folders, for the paths' suggestions */
  folders(): string[];
}

export type PreviewMode = "rendered" | "source";

/** How results look, remembered with the tab */
export interface PaneLook {
  preview: PreviewMode;
  /** Show each result's verses */
  verses: boolean;
  style: StyleName;
  /** Show references near each other (within their context lines) as one result */
  merge: boolean;
  /** List each merged result's references above its preview (else only how many) */
  references: boolean;
}

export const DEFAULT_LOOK: PaneLook = { preview: "rendered", verses: false, style: "name", merge: true, references: false };

/** The file types the settings search (EPUBs too when they're searched), lowercase */
export function settingsExtensions(plugin: ToposPlugin): string[] {
  const extensions = plugin.extensions().map((e) => e.toLowerCase());
  if (plugin.settings.searchEpubs) extensions.push("epub");
  return [...new Set(extensions)];
}

const FILE_ICONS: Record<string, string> = {
  md: "file-text",
  txt: "file-type",
  epub: "book-marked",
  srt: "captions",
  vtt: "captions",
  html: "file-code",
  pdf: "file-text",
};

/** The search tab: every filter the engine has, file types, and results previewed as they look in notes */
export function PaneApp({
  plugin,
  store,
  host,
  look: initialLook = DEFAULT_LOOK,
  onLook,
}: {
  plugin: ToposPlugin;
  store: SearchStore;
  host: PaneHost;
  look?: PaneLook;
  onLook?: (look: PaneLook) => void;
}) {
  const { topos } = plugin;
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  // The sidebar's store changes when searches are saved or deleted (from either)
  useSyncExternalStore(plugin.search.subscribe, plugin.search.get, plugin.search.get);
  const version = () => plugin.indexVersion;
  const indexVersion = useSyncExternalStore(plugin.subscribeIndex, version, version);
  const [look, setLookState] = useState<PaneLook>(initialLook);
  const setLook = (update: Partial<PaneLook>) => {
    const next = { ...look, ...update };
    setLookState(next);
    onLook?.(next);
  };
  const [activePath, setActivePath] = useState(plugin.app.workspace.getActiveFile()?.path ?? "");
  const collapsed = useCollapsed();
  const pages = usePages(PAGE);
  const { shown } = pages;
  const [detailsVersion, setDetailsVersion] = useState(0);
  /** The query being typed, or null while it shows the filters */
  const [draft, setDraft] = useState<string | null>(null);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  /** Results whose verses are shown (besides all of them, with the look's `verses`) */
  const [versesOpen, setVersesOpen] = useState<Set<string>>(new Set());
  /** Merged results whose references are listed (or, with the look's `references`, not listed) */
  const [referencesToggled, setReferencesToggled] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(rootRef);
  // Narrow, the filters start folded so the results show first
  const [filtersOpen, setFiltersOpen] = useState(false);
  const style = bookStyle(look.style);

  useEffect(() => {
    const ref = plugin.app.workspace.on("file-open", (file) => {
      if (file) setActivePath(file.path);
    });
    return () => plugin.app.workspace.offref(ref);
  }, [plugin]);

  const available = settingsExtensions(plugin);
  const extensions = chosenExtensions(state.extensions, available);
  const extensionsKey = extensions.join(",");

  const filter = useMemo(() => compileFilters(topos, state.filters), [topos, state.filters]);
  const scope = useMemo(
    () => queryScope(state, activePath),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.scope, state.paths, state.patterns, activePath],
  );
  // Every file type's results, for the counts on the file type chips
  const everyType = useMemo(
    () => plugin.refs.query(state.filters, scope, state.sort),
    // indexVersion: recompute when files change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, state.filters, scope, state.sort, indexVersion],
  );
  const results = useMemo(
    () => (extensions.length === 0 ? everyType : plugin.refs.query(state.filters, scope, state.sort, extensions)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [everyType, extensionsKey],
  );
  // The files with references, for the paths' suggestions
  const indexedPaths = useMemo(
    () => (state.scope === "paths" ? plugin.refs.core.paths() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, state.scope === "paths", indexVersion],
  );
  const typeCounts = useMemo(() => new Map(everyType.extensionCounts().map((c) => [c.extension, c])), [everyType]);
  const hits = useMemo(
    () => results.page(0, shown),
    // detailsVersion: read again once EPUB details are loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, shown, detailsVersion],
  );
  useEffect(() => {
    const names = results.missingDetails(0, shown);
    if (names.length === 0) return;
    let cancelled = false;
    void plugin.indexer.loadDetails(names).then(() => {
      if (!cancelled) setDetailsVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [plugin, results, shown]);

  const books = useMemo(() => topos.books(), [topos]);
  const genres = useMemo(() => topos.genres(), [topos]);
  const bookName = (id: number) => books.find((b) => b.id === id)?.name ?? `Book ${id}`;
  const groups = useMemo(
    () => groupHits(hits, state.groupBy, bookName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hits, state.groupBy, books],
  );
  // "Show more" goes on while what it adds is all in collapsed groups
  const groupOf = (hit: Hit) => (state.groupBy === "file" ? hit.path : bookName(hit.passage.bookId));
  useLoadPastHidden(pages, hits, results.total, groupOf, collapsed);
  const shownPaths = useMemo(() => [...new Set(hits.map((h) => h.path))], [hits]);
  const fileLines = useFileLines(plugin, shownPaths.filter((p) => !isEpub(p)), indexVersion);
  // Each shown note's references, to find a result among the rendered ones
  const fileHits = useMemo(
    () => new Map(shownPaths.filter((p) => !isEpub(p)).map((p) => [p, plugin.refs.get(p)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, shownPaths.join("\n"), indexVersion],
  );

  const reset = pages.reset;
  const set = (update: Parameters<SearchStore["set"]>[0]) => {
    store.set(update);
    reset();
  };
  const setFilters = (update: Partial<Filters>) => set({ filters: { ...state.filters, ...update } });
  const addTo = (key: ListKey) => (value: string) =>
    setFilters({ [key]: [...state.filters[key], value] } as Partial<Filters>);
  const removeFrom = (key: ListKey) => (i: number) =>
    setFilters({ [key]: state.filters[key].filter((_, j) => j !== i) } as Partial<Filters>);

  const activeFilters = Object.values(state.filters).reduce((n, values) => n + values.length, 0);
  const query = formatQuery(state.filters, searchWhere(state));
  const savedQueries = plugin.settings.queries;
  const sameQuery = (text: string) => {
    const parsed = parseQuery(text);
    return parsed.errors.length === 0 && formatQuery(parsed.filters, parsed) === query;
  };
  const active = savedQueries.find((saved) => sameQuery(saved.query)) ?? null;
  const applyText = (text: string): string[] => {
    const parsed = parseQuery(text);
    if (parsed.errors.length > 0) return parsed.errors;
    set({ filters: parsed.filters, ...scopeOf(parsed, state.scope) });
    return [];
  };
  const save = () => {
    if (saving?.trim()) void plugin.saveQuery({ name: saving, query });
    setSaving(null);
  };

  const bookOptions = books.map((b) => ({ name: b.name, aliases: [b.abbreviation, b.osis] }));
  const genreOptions = genres.map((g) => ({ name: g.name, aliases: [] }));
  const total = results.total;
  const fileCount = results.files;
  const runKey = (run: HitRun) => `${run.hits[0]!.path}:${run.hits[0]!.start}`;

  const filtersPanel = (
    <aside className="topos-pane-filters">
      <section className="topos-pane-section">
        <h4>
          Filters
          {activeFilters > 0 && <span className="topos-badge">{activeFilters}</span>}
          {filter.books && !filter.conflict && (
            <span className="topos-pane-muted">{`${filter.books.size} book${filter.books.size === 1 ? "" : "s"}`}</span>
          )}
          {!isEmpty(state.filters) && (
            <button className="topos-pane-link" onClick={() => setFilters(NO_FILTERS)}>
              Clear
            </button>
          )}
        </h4>
        <div className="topos-filter-row">
          <label>Testament</label>
          <div className="topos-testaments">
            {(["old", "new"] as Testament[]).map((t) => (
              <TestamentToggle key={t} testament={t} filters={state.filters} onChange={setFilters} />
            ))}
          </div>
        </div>
        <FilterRow label="Genres">
          <Chips values={state.filters.genres} onRemove={removeFrom("genres")} />
          <NameInput options={genreOptions} placeholder="Gospels" onSubmit={addTo("genres")} />
        </FilterRow>
        <FilterRow label="Not genres">
          <Chips values={state.filters.excludeGenres} onRemove={removeFrom("excludeGenres")} exclude />
          <NameInput options={genreOptions} placeholder="Pauline Epistles" onSubmit={addTo("excludeGenres")} />
        </FilterRow>
        <FilterRow label="Books">
          <Chips values={state.filters.books} onRemove={removeFrom("books")} />
          <NameInput options={bookOptions} placeholder="John" onSubmit={addTo("books")} />
        </FilterRow>
        <FilterRow label="Not books">
          <Chips values={state.filters.excludeBooks} onRemove={removeFrom("excludeBooks")} exclude />
          <NameInput options={bookOptions} placeholder="Psalm" onSubmit={addTo("excludeBooks")} />
        </FilterRow>
        {PASSAGE_ROWS.map((row) => (
          <FilterRow key={row.key} label={row.label} hint={row.hint}>
            <Chips values={state.filters[row.key]} onRemove={removeFrom(row.key)} exclude={row.key === "excludeOverlap"} />
            <ReferenceInput
              topos={topos}
              style={style}
              placeholder={row.placeholder}
              onSubmit={addTo(row.key)}
              format={plugin.settings.format}
            />
          </FilterRow>
        ))}
        {filter.errors.length > 0 && (
          <ul className="topos-errors">
            {filter.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="topos-pane-section">
        <h4>
          Saved searches
          <button
            className="topos-pane-link"
            onClick={() => setSaving(active?.name ?? "")}
            disabled={saving !== null || (activeFilters === 0 && state.scope !== "paths")}
            title="Save these filters under a name"
          >
            Save
          </button>
        </h4>
        {saving !== null && (
          <div className="topos-pane-save">
            <input
              type="text"
              autoFocus
              value={saving}
              placeholder="Name this search"
              onChange={(e) => setSaving(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setSaving(null);
              }}
            />
            <button className="mod-cta" onClick={save} disabled={!saving.trim()}>
              Save
            </button>
            <button onClick={() => setSaving(null)}>Cancel</button>
          </div>
        )}
        {savedQueries.length === 0 ? (
          <p className="topos-pane-muted">None yet: set some filters, then save them here.</p>
        ) : (
          <ul className="topos-pane-saved">
            {savedQueries.map((saved) => (
              <li key={saved.name} className={saved === active ? "is-active" : ""}>
                <button
                  className="topos-pane-saved-name"
                  title={saved.query}
                  onClick={() => {
                    const errors = applyText(saved.query);
                    setDraftErrors(errors);
                  }}
                >
                  <span>{saved.name}</span>
                  <code>{saved.query}</code>
                </button>
                <IconButton
                  host={host}
                  icon="trash-2"
                  title={`Delete "${saved.name}"`}
                  onClick={() => void plugin.deleteQuery(saved.name)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );

  return (
    <div className={`topos-pane${narrow ? " is-narrow" : ""}`} ref={rootRef}>
      <header className="topos-pane-header">
        <div className="topos-pane-querybar">
          <Icon host={host} name="search" className="topos-pane-querybar-icon" />
          <input
            type="text"
            spellCheck={false}
            className="topos-pane-query"
            aria-label="Search options, like the topos CLI's"
            placeholder={'Filters as topos options: --nt -b John -o "John 3" Sermons/2025'}
            value={draft ?? query}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftErrors([]);
            }}
            onBlur={() => {
              if (draft !== null && draft === query) setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft !== null) {
                const errors = applyText(draft);
                setDraftErrors(errors);
                if (errors.length === 0) setDraft(null);
              }
              if (e.key === "Escape") {
                setDraft(null);
                setDraftErrors([]);
              }
            }}
          />
          {draft !== null && draft !== query && <kbd className="topos-pane-hint">Enter</kbd>}
          {query && draft === null && (
            <IconButton host={host} icon="copy" title="Copy these options" onClick={() => host.copy(query)} />
          )}
        </div>
        {draftErrors.length > 0 && (
          <ul className="topos-errors">
            {draftErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        <div className="topos-pane-controls">
          <Segmented
            value={state.scope}
            options={[
              { value: "vault", label: "Vault", icon: "vault" },
              { value: "paths", label: "Paths", icon: "folder-tree", title: "Some files and folders, or globs and regular expressions" },
              { value: "file", label: "Note", icon: "file" },
            ]}
            host={host}
            onChange={(scope: Scope) => set({ scope })}
            label="Where to search"
          />
          {state.scope === "file" && (
            <span className="topos-pane-scope-file" title={activePath}>
              {activePath ? activePath.slice(activePath.lastIndexOf("/") + 1) : "No note open"}
            </span>
          )}
          <span className="topos-pane-spacer" />
          <Segmented
            value={state.sort}
            options={[
              { value: "file", label: "Notes", icon: "list-ordered", title: "Order in notes" },
              { value: "bible", label: "Bible", icon: "book-open", title: "Order in the Bible" },
            ]}
            host={host}
            onChange={(sort: SortOrder) => set({ sort })}
            label="Sort"
          />
          <Segmented
            value={state.groupBy}
            options={[
              { value: "file", label: "By note", icon: "files", title: "Group by note" },
              { value: "book", label: "By book", icon: "library", title: "Group by book" },
            ]}
            host={host}
            onChange={(groupBy: "file" | "book") => store.set({ groupBy })}
            label="Group by"
          />
        </div>

        {state.scope === "paths" && (
          <PathsRow
            host={host}
            paths={state.paths}
            patterns={state.patterns}
            files={indexedPaths}
            onPaths={(paths) => set({ paths })}
            onPatterns={(patterns) => set({ patterns })}
          />
        )}
        <div className="topos-pane-controls">
          <div className="topos-pane-types" role="group" aria-label="File types">
            <button
              className={`topos-pane-type${extensions.length === 0 ? " is-on" : ""}`}
              onClick={() => set({ extensions: [] })}
              title="Search every file type"
            >
              All
              <span className="topos-pane-type-count">{everyType.total.toLocaleString()}</span>
            </button>
            {available.map((extension) => {
              const on = extensions.length === 0 || extensions.includes(extension);
              const count = typeCounts.get(extension);
              return (
                <button
                  key={extension}
                  className={`topos-pane-type${on && extensions.length > 0 ? " is-on" : ""}${on ? "" : " is-off"}`}
                  aria-pressed={on}
                  title={`${count ? `${plural(count.references, "reference")} in ${plural(count.files, `.${extension} file`)}` : `No references in .${extension} files`}. Click to toggle; Ctrl/Cmd-click for only .${extension}`}
                  onClick={(e) =>
                    set({ extensions: toggleExtension(state.extensions, available, extension, e.ctrlKey || e.metaKey) })
                  }
                >
                  <Icon host={host} name={FILE_ICONS[extension] ?? "file"} />
                  {extension}
                  <span className="topos-pane-type-count">{(count?.references ?? 0).toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          <span className="topos-pane-spacer" />
          <Segmented
            value={look.preview}
            options={[
              { value: "rendered", label: "Rendered", icon: "eye", title: "Show results as they look in notes" },
              { value: "source", label: "Source", icon: "code", title: "Show results' Markdown" },
            ]}
            host={host}
            onChange={(preview: PreviewMode) => setLook({ preview })}
            label="Preview"
          />
          <select
            value={state.context}
            onChange={(e) => store.set({ context: Number(e.target.value) })}
            aria-label="Context lines"
            title="Lines of context around each result"
          >
            {[0, 1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Line only" : `±${n} line${n === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
          <select
            value={look.style}
            onChange={(e) => setLook({ style: e.target.value as StyleName })}
            aria-label="Reference style"
          >
            <option value="name">John 3:16</option>
            <option value="abbreviation">Jn 3:16</option>
            <option value="osis">John.3.16</option>
          </select>
          <button
            className={`topos-pane-toggle${look.merge ? " is-on" : ""}`}
            aria-pressed={look.merge}
            onClick={() => setLook({ merge: !look.merge })}
            title={
              state.context === 0
                ? "Show references on the same line as one result"
                : `Show references whose ±${state.context} lines of context meet as one result`
            }
          >
            <Icon host={host} name="combine" />
            Merge nearby
          </button>
          {look.merge && (
            <button
              className={`topos-pane-toggle${look.references ? " is-on" : ""}`}
              aria-pressed={look.references}
              onClick={() => {
                setLook({ references: !look.references });
                setReferencesToggled(new Set());
              }}
              title="List the references in each merged result (or click a result's count)"
            >
              <Icon host={host} name="tags" />
              References
            </button>
          )}
          <button
            className={`topos-pane-toggle${look.verses ? " is-on" : ""}`}
            aria-pressed={look.verses}
            onClick={() => setLook({ verses: !look.verses })}
            title="Show each result's verses"
          >
            <Icon host={host} name="book-open-text" />
            Verses
          </button>
        </div>
      </header>

      <div className="topos-pane-body">
        {narrow ? (
          <details className="topos-pane-filters-fold" open={filtersOpen} onToggle={(e) => setFiltersOpen((e.target as HTMLDetailsElement).open)}>
            <summary>
              Filters and saved searches
              {activeFilters > 0 && <span className="topos-badge">{activeFilters}</span>}
            </summary>
            {filtersPanel}
          </details>
        ) : (
          filtersPanel
        )}

        <main className="topos-pane-results">
          {filter.conflict && <div className="topos-conflict">⚠ {filter.conflict}</div>}
          <div className="topos-pane-summary">
            <span className="topos-pane-stat">
              <strong>{total.toLocaleString()}</strong>
              {total === 1 ? " reference" : " references"}
            </span>
            <span className="topos-pane-stat">
              <strong>{fileCount.toLocaleString()}</strong>
              {fileCount === 1 ? " file" : " files"}
            </span>
            {plugin.indexing && <span className="topos-pane-indexing">Indexing…</span>}
            <span className="topos-pane-spacer" />
            {groups.length > 0 && (
              <>
                <button
                  className={`topos-pane-link${collapsed.all ? " is-on" : ""}`}
                  aria-pressed={collapsed.all}
                  title="Collapse every group, also ones that appear later"
                  onClick={collapsed.collapseAll}
                >
                  Collapse all
                </button>
                <button className="topos-pane-link" title="Expand every group" onClick={collapsed.expandAll}>
                  Expand all
                </button>
              </>
            )}
          </div>

          {total === 0 && !filter.conflict && (
            <div className="topos-pane-empty">
              <Icon host={host} name="search-x" />
              <p>{plugin.indexing ? "Still indexing the vault…" : "No references match."}</p>
              {(activeFilters > 0 || extensions.length > 0 || state.scope !== "vault") && (
                <button onClick={() => set({ filters: NO_FILTERS, extensions: [], scope: "vault", paths: [], patterns: [] })}>
                  Search everything
                </button>
              )}
            </div>
          )}

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            const toggle = () => collapsed.toggle(group.key);
            return (
              <section key={group.key} className={`topos-pane-group${isCollapsed ? " is-collapsed" : ""}`}>
                <div className="topos-pane-group-head" onClick={toggle}>
                  <Icon host={host} name="chevron-down" className="topos-pane-caret" />
                  {state.groupBy === "file" ? (
                    <>
                      <Icon host={host} name={FILE_ICONS[extensionOf(group.key)] ?? "file"} />
                      <PathName path={group.key} />
                    </>
                  ) : (
                    <>
                      <Icon host={host} name="book" />
                      <span className="topos-pane-group-name">{group.key}</span>
                    </>
                  )}
                  <span className="topos-pane-count">{group.hits.length}</span>
                  {state.groupBy === "file" && (
                    <IconButton
                      host={host}
                      icon="arrow-up-right"
                      title="Open"
                      onClick={(e) => {
                        e.stopPropagation();
                        host.open(group.hits[0]!, e.ctrlKey || e.metaKey);
                      }}
                    />
                  )}
                </div>
                {!isCollapsed && (
                  <div className="topos-pane-cards">
                    {(look.merge ? mergeNearby(group.hits, state.context) : group.hits.map(single)).map((run) => {
                      const key = runKey(run);
                      const path = run.hits[0]!.path;
                      return (
                        <HitCard
                          key={key}
                          plugin={plugin}
                          host={host}
                          run={run}
                          references={run.hits.map((hit) => written(topos, hit.passage, style, plugin.settings.format))}
                          showPath={state.groupBy === "book"}
                          context={state.context}
                          lines={fileLines.get(path)}
                          fileHits={fileHits.get(path)}
                          preview={look.preview}
                          verses={look.verses || versesOpen.has(key)}
                          onVerses={() => {
                            const next = new Set(versesOpen);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            setVersesOpen(next);
                          }}
                          listReferences={look.references !== referencesToggled.has(key)}
                          onListReferences={() => {
                            const next = new Set(referencesToggled);
                            if (!next.delete(key)) next.add(key);
                            setReferencesToggled(next);
                          }}
                          onFind={() =>
                            set({ filters: { ...NO_FILTERS, anyOverlap: [...new Set(run.hits.map((h) => h.passage.osis))] } })
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          {total > shown && (
            <LoadMore onLoad={pages.more}>
              Show more ({(total - shown).toLocaleString()} left)
            </LoadMore>
          )}
        </main>
      </div>
    </div>
  );
}

/** The files and folders to search, and the patterns that pick files, each with a picker */
function PathsRow({
  host,
  paths,
  patterns,
  files,
  onPaths,
  onPatterns,
}: {
  host: PaneHost;
  paths: string[];
  patterns: PathPattern[];
  /** Files to suggest (those with references) */
  files: string[];
  onPaths: (paths: string[]) => void;
  onPatterns: (patterns: PathPattern[]) => void;
}) {
  const problems = useMemo(() => patternProblems(patterns), [patterns]);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [patternDraft, setPatternDraft] = useState("");
  const problemOf = (pattern: PathPattern) => problems.find((p) => p.includes(`"${pattern.pattern}"`));
  const addPattern = () => {
    const pattern = parsePattern(patternDraft, ignoreCase);
    if (!pattern) return;
    onPatterns([...patterns, pattern]);
    setPatternDraft("");
  };
  return (
    <div className="topos-pane-paths">
      <div className="topos-pane-paths-part">
        <span className="topos-pane-paths-label">
          <Icon host={host} name="folder" />
          In
        </span>
        <div className="topos-chips">
          {paths.map((path, i) => (
            <span key={path} className="topos-chip topos-pane-path-chip" title={path}>
              <Icon host={host} name={extensionOf(path) ? "file" : "folder"} />
              {path}
              <button aria-label={`Remove ${path}`} onClick={() => onPaths(paths.filter((_, j) => j !== i))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <PathPicker
          host={host}
          folders={host.folders()}
          files={files}
          chosen={paths}
          onPick={(path) => onPaths([...paths, path])}
          placeholder={paths.length === 0 ? "Every folder; add folders or files" : "Add a folder or file"}
        />
      </div>
      <div className="topos-pane-paths-part">
        <span className="topos-pane-paths-label">
          <Icon host={host} name="asterisk" />
          Match
        </span>
        <div className="topos-chips">
          {patterns.map((pattern, i) => {
            const problem = problemOf(pattern);
            const flip = () => {
              const text = excludes(pattern) ? pattern.pattern.slice(1) : `!${pattern.pattern}`;
              onPatterns(patterns.map((p, j) => (j === i ? { ...p, pattern: text } : p)));
            };
            return (
              <span
                key={`${pattern.kind}:${pattern.pattern}:${i}`}
                className={`topos-chip topos-pane-pattern${excludes(pattern) ? " is-exclude" : ""}${problem ? " is-invalid" : ""}`}
                title={problem ?? `${excludes(pattern) ? "Leaves out" : "Keeps"} matching files (click to ${excludes(pattern) ? "keep" : "leave out"} them)`}
                onClick={flip}
              >
                <span className="topos-pane-pattern-kind">
                  {pattern.kind === "regex" ? "regex" : pattern.kind === "iglob" ? "glob, any case" : "glob"}
                </span>
                <code>{patternText(pattern)}</code>
                <button
                  aria-label={`Remove ${patternText(pattern)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPatterns(patterns.filter((_, j) => j !== i));
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <div className="topos-pane-pattern-input">
          <input
            type="text"
            spellCheck={false}
            value={patternDraft}
            placeholder={"Glob or /regex/: *.srt, Sermons/**, !drafts, /20\\d\\d/"}
            onChange={(e) => setPatternDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addPattern();
              if (e.key === "Escape") setPatternDraft("");
            }}
          />
          <button
            className={`topos-pane-case${ignoreCase ? " is-on" : ""}`}
            aria-pressed={ignoreCase}
            title={ignoreCase ? "Ignoring case (click to match case)" : "Matching case (click to ignore case)"}
            onClick={() => setIgnoreCase(!ignoreCase)}
          >
            Aa
          </button>
        </div>
      </div>
      {problems.length > 0 && (
        <ul className="topos-errors" title="Searching without these">
          {problems.map((problem) => (
            <li key={problem}>{`${problem} (searching without it)`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How many suggestions a path picker lists */
const PATH_SUGGESTIONS = 40;

/** Picks a folder or file, suggesting those whose path has what's typed; Enter adds what's typed */
function PathPicker({
  host,
  folders,
  files,
  chosen,
  onPick,
  placeholder,
}: {
  host: PaneHost;
  folders: string[];
  files: string[];
  chosen: string[];
  onPick: (path: string) => void;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const options = useMemo(() => {
    const query = text.trim().toLowerCase();
    const all = [
      ...folders.map((path) => ({ path, folder: true })),
      ...[...files].sort((a, b) => a.localeCompare(b)).map((path) => ({ path, folder: false })),
    ].filter(({ path }) => !chosen.includes(path) && path.toLowerCase().includes(query));
    // Paths starting with what's typed (or a folder named so) come first
    const starts = (path: string) => path.toLowerCase().startsWith(query) || path.toLowerCase().includes(`/${query}`);
    return [...all.filter((o) => starts(o.path)), ...all.filter((o) => !starts(o.path))].slice(0, PATH_SUGGESTIONS);
  }, [text, folders, files, chosen]);
  const pick = (path: string) => {
    const clean = cleanPath(path);
    if (clean && !chosen.includes(clean)) onPick(clean);
    setText("");
    setActive(0);
  };
  const activeItem = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeItem.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div className="topos-input topos-pane-path-picker">
      <input
        type="text"
        spellCheck={false}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && options.length > 0) {
            e.preventDefault();
            setActive((active + 1) % options.length);
          } else if (e.key === "ArrowUp" && options.length > 0) {
            e.preventDefault();
            setActive((active - 1 + options.length) % options.length);
          } else if (e.key === "Enter" || (e.key === "Tab" && options[active] && text)) {
            e.preventDefault();
            // A suggestion while typing, else exactly what's typed
            pick(options[active] && text.trim() ? options[active].path : text);
          } else if (e.key === "Escape") setText("");
        }}
      />
      {focused && options.length > 0 && (
        <ul className="topos-dropdown">
          {options.map((option, i) => (
            <li
              key={option.path}
              ref={i === active ? activeItem : undefined}
              className={i === active ? "is-active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(option.path);
              }}
            >
              <span className="topos-pane-path-option">
                <Icon host={host} name={option.folder ? "folder" : FILE_ICONS[extensionOf(option.path)] ?? "file"} />
                {option.path}
              </span>
              <span className="topos-suggestion-kind">{option.folder ? "folder" : "file"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A hit as a result of its own */
function single(hit: Hit): HitRun {
  return { hits: [hit], firstLine: hit.line, lastLine: hit.line };
}

/** `1 reference`, `2 references` */
function plural(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}

/** Whether the element is narrower than {@link NARROW} */
function useNarrow(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setNarrow(el.clientWidth > 0 && el.clientWidth < NARROW));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}

/** Becomes true once the element is near the visible part of its scroller, and stays true */
function useVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

/** "Show more", which also loads more by itself when scrolled to */
function LoadMore({ onLoad, children }: { onLoad: () => void; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const load = useRef(onLoad);
  load.current = onLoad;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) load.current();
    }, { rootMargin: "200px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <button ref={ref} className="topos-pane-more" onClick={onLoad}>
      {children}
    </button>
  );
}

function Icon({ host, name, className = "" }: { host: PaneHost; name: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) host.icon(ref.current, name);
  }, [host, name]);
  return <span ref={ref} className={`topos-pane-icon ${className}`} aria-hidden="true" />;
}

function IconButton({
  host,
  icon,
  title,
  onClick,
  active = false,
}: {
  host: PaneHost;
  icon: string;
  title: string;
  onClick: (e: ReactMouseEvent) => void;
  active?: boolean;
}) {
  return (
    <button
      className={`clickable-icon topos-pane-icon-button${active ? " is-active" : ""}`}
      aria-label={title}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      <Icon host={host} name={icon} />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  host,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon: string; title?: string }[];
  onChange: (value: T) => void;
  host: PaneHost;
  label: string;
}) {
  return (
    <div className="topos-pane-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "is-on" : ""}
          title={option.title ?? option.label}
          onClick={() => onChange(option.value)}
        >
          <Icon host={host} name={option.icon} />
          <span className="topos-pane-segment-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A path as its folder (quiet) and name */
function PathName({ path }: { path: string }) {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return (
    <span className="topos-pane-group-name" title={path}>
      {slash > 0 && <span className="topos-pane-folder-name">{path.slice(0, slash + 1)}</span>}
      {dot > 0 ? name.slice(0, dot) : name}
    </span>
  );
}

function HitCard({
  plugin,
  host,
  run,
  references,
  showPath,
  context,
  lines,
  fileHits,
  preview,
  verses,
  onVerses,
  listReferences,
  onListReferences,
  onFind,
}: {
  plugin: ToposPlugin;
  host: PaneHost;
  run: HitRun;
  /** Each hit's reference, as written in the chosen style */
  references: string[];
  showPath: boolean;
  context: number;
  lines: string[] | undefined;
  fileHits: Hit[] | undefined;
  preview: PreviewMode;
  verses: boolean;
  onVerses: () => void;
  /** With several references: list them (else only their count) */
  listReferences: boolean;
  onListReferences: () => void;
  onFind: () => void;
}) {
  const first = run.hits[0]!;
  const many = run.hits.length > 1;
  const hasBible = plugin.bibles.all().length > 0;
  const url = many ? null : plugin.referenceUrl(first.passage);
  const location = first.epub
    ? first.epub.chapter ?? `Section ${first.epub.spineIndex + 1}`
    : run.firstLine === run.lastLine
      ? `Line ${run.firstLine}`
      : `Lines ${run.firstLine}–${run.lastLine}`;
  const rendered = preview === "rendered" && extensionOf(first.path) === "md" && lines !== undefined;
  // Each passage once, for the verses
  const passages = run.hits
    .map((hit, i) => ({ passage: hit.passage, label: references[i]! }))
    .filter((p, i, all) => all.findIndex((o) => o.passage.osis === p.passage.osis) === i);
  return (
    <article
      className={`topos-pane-card${many ? " is-merged" : ""}`}
      tabIndex={0}
      onClick={(e) => {
        // Clicks on links and references in the preview are theirs
        if ((e.target as HTMLElement).closest("a, .topos-reference, .topos-link, .topos-embed")) return;
        host.open(first, e.ctrlKey || e.metaKey);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) host.open(first, e.ctrlKey || e.metaKey);
      }}
    >
      <div className={`topos-pane-card-head${many && !listReferences ? " is-unlisted" : ""}`}>
        {(!many || listReferences) && (
          <span className="topos-pane-pills">
            {run.hits.map((hit, i) => (
              <span
                key={hit.start}
                className="topos-pane-pill"
                title={many ? `Open this one (line ${hit.line})` : undefined}
                onClick={(e) => {
                  if (!many) return;
                  e.stopPropagation();
                  host.open(hit, e.ctrlKey || e.metaKey);
                }}
              >
                {references[i]}
              </span>
            ))}
          </span>
        )}
        {many && (
          <button
            className={`topos-pane-matches${listReferences ? " is-open" : ""}`}
            aria-expanded={listReferences}
            title={listReferences ? "Hide the references" : `Show them: ${references.join("; ")}`}
            onClick={(e) => {
              e.stopPropagation();
              onListReferences();
            }}
          >
            <Icon host={host} name="chevron-right" className="topos-pane-matches-caret" />
            {`${run.hits.length} matches`}
          </button>
        )}
        <span className="topos-pane-where">
          {showPath && <span className="topos-pane-where-path">{first.path}</span>}
          {location}
        </span>
        <span className="topos-pane-actions">
          {hasBible && (
            <IconButton host={host} icon="book-open-text" title="Show the verses" active={verses} onClick={onVerses} />
          )}
          {hasBible && (
            <IconButton
              host={host}
              icon="book-open"
              title={many ? `Open ${references[0]} in the Bible` : "Open in the Bible"}
              onClick={(e) => host.openPassage(first.passage, e.ctrlKey || e.metaKey)}
            />
          )}
          <IconButton
            host={host}
            icon="copy"
            title={many ? "Copy the references" : "Copy the reference"}
            onClick={() => host.copy(references.join("; "))}
          />
          <IconButton
            host={host}
            icon="filter"
            title={many ? "Find references that share a verse with any of them" : "Find references that share a verse with it"}
            onClick={onFind}
          />
          {url && (
            <IconButton
              host={host}
              icon="external-link"
              title={`Open in ${plugin.linkSite()}`}
              onClick={() => window.open(url, "_blank")}
            />
          )}
        </span>
      </div>
      {rendered ? (
        <RenderedPreview host={host} run={run} lines={lines} context={context} fileHits={fileHits ?? []} />
      ) : (
        <SourcePreview run={run} lines={lines} context={context} />
      )}
      {verses &&
        hasBible &&
        passages.map(({ passage, label }) => <VerseText key={passage.osis} host={host} passage={passage} label={label} />)}
    </article>
  );
}

/** The result's lines as Markdown, as they look in the note, with its references marked */
function RenderedPreview({
  host,
  run,
  lines,
  context,
  fileHits,
}: {
  host: PaneHost;
  run: HitRun;
  lines: string[];
  context: number;
  fileHits: Hit[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useVisible(ref);
  const path = run.hits[0]!.path;
  // From the first line's context to the last's
  const first = Math.max(0, run.firstLine - 1 - context);
  const last = Math.min(lines.length - 1, run.lastLine - 1 + context);
  const markdown = lines.slice(first, last + 1).join("\n");
  // Each hit among the rendered references with its passage: (passage, which one)
  const targets = run.hits
    .map((hit) => {
      const ordinal = fileHits.filter(
        (h) => h.passage.osis === hit.passage.osis && h.line - 1 >= first && h.start < hit.start,
      ).length;
      return `${hit.passage.osis}\n${ordinal}`;
    })
    .join("\t");
  useEffect(() => {
    const el = ref.current;
    if (!el || !visible) return;
    el.replaceChildren();
    let cancelled = false;
    const rendered = host.markdown(el, markdown, path);
    void rendered.done.then(() => {
      if (cancelled) return;
      for (const target of targets.split("\t")) {
        const [osis = "", ordinal = "0"] = target.split("\n");
        const escaped = typeof CSS !== "undefined" ? CSS.escape(osis) : osis;
        const found = el.querySelectorAll<HTMLElement>(`[data-topos-osis="${escaped}"]`);
        (found[Number(ordinal)] ?? found[0])?.classList.add("topos-pane-target");
      }
    });
    return () => {
      cancelled = true;
      rendered.unload();
    };
  }, [host, visible, markdown, path, targets]);
  return <div ref={ref} className="topos-pane-preview markdown-rendered" />;
}

/** A line's text with ranges in it marked */
function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (from < at) continue;
    parts.push(text.slice(at, from), <mark key={from}>{text.slice(from, Math.min(text.length, to))}</mark>);
    at = Math.min(text.length, to);
  }
  parts.push(text.slice(at));
  return <span>{parts}</span>;
}

/** The result's lines as text, with its references marked */
function SourcePreview({ run, lines, context }: { run: HitRun; lines: string[] | undefined; context: number }) {
  const range = (hit: Hit): [number, number] => [hit.column - 1, hit.column - 1 + (hit.end - hit.start)];
  // An EPUB's references show the text around them, a line each
  if (run.hits[0]!.epub || !lines) {
    const byLine = new Map<number, Hit[]>();
    for (const hit of run.hits) byLine.set(hit.line, [...(byLine.get(hit.line) ?? []), hit]);
    return (
      <div className={`topos-pane-preview topos-pane-source${run.hits[0]!.epub ? " is-prose" : ""}`}>
        {[...byLine].map(([line, hits]) => (
          <div key={line} className="topos-pane-source-line">
            {!hits[0]!.epub && <span className="topos-pane-line-number">{line}</span>}
            <Marked text={hits[0]!.lineText} ranges={hits.map(range)} />
          </div>
        ))}
      </div>
    );
  }
  const first = Math.max(1, run.firstLine - context);
  const last = Math.min(lines.length, run.lastLine + context);
  const shown = [];
  for (let line = first; line <= last; line++) {
    const hits = run.hits.filter((h) => h.line === line);
    shown.push(
      <div key={line} className={`topos-pane-source-line${hits.length === 0 ? " is-context" : ""}`}>
        <span className="topos-pane-line-number">{line}</span>
        {hits.length > 0 ? <Marked text={lines[line - 1] ?? ""} ranges={hits.map(range)} /> : <span>{lines[line - 1] || "\u00a0"}</span>}
      </div>,
    );
  }
  return <div className="topos-pane-preview topos-pane-source">{shown}</div>;
}

/** The passage's text, from the vault's Bibles, once scrolled to */
function VerseText({ host, passage, label }: { host: PaneHost; passage: Passage; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useVisible(ref);
  useEffect(() => {
    const el = ref.current;
    if (!el || !visible) return;
    el.replaceChildren();
    const shown = host.verses(el, passage, label);
    return () => shown.unload();
  }, [host, visible, passage, label]);
  return <div ref={ref} className="topos-pane-verses" onClick={(e) => e.stopPropagation()} />;
}
