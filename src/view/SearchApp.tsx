import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { compileFilters, isEmpty, NO_FILTERS, type Filters, type Testament } from "../core/filters.ts";
import { formatQuery, parseQuery } from "../core/query.ts";
import { cleanPath, patternProblems, patternText } from "../core/paths.ts";
import { written } from "../core/format.ts";
import type { Hit } from "../core/search.ts";
import { groupHits, type SortOrder } from "../core/sort.ts";
import type ToposPlugin from "../main.ts";
import { bookStyle, type StyleName } from "../core/settings.ts";
import { Chips, NameInput, ReferenceInput } from "./inputs.tsx";
import { FilterRow, isEpub, PASSAGE_ROWS, TestamentToggle, useFileLines, type ListKey } from "./parts.tsx";
import { queryScope, searchWhere, type Scope } from "./store.ts";

/** The saved-search list's entry that clears the filters */
const CLEAR = "topos:clear-filters";

/** How many results render before "Show more", so huge vaults stay responsive */
const PAGE = 300;

export function SearchApp({ plugin }: { plugin: ToposPlugin }) {
  const { topos } = plugin;
  const state = useSyncExternalStore(plugin.search.subscribe, plugin.search.get, plugin.search.get);
  const version = () => plugin.indexVersion;
  const indexVersion = useSyncExternalStore(plugin.subscribeIndex, version, version);
  const [styleName, setStyleName] = useState<StyleName>(plugin.settings.style);
  const [activePath, setActivePath] = useState(plugin.app.workspace.getActiveFile()?.path ?? "");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  /** Bumped when EPUB details the page needs are read */
  const [detailsVersion, setDetailsVersion] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(!isEmpty(state.filters));
  /** The name being typed to save the current search, or null */
  const [saving, setSaving] = useState<string | null>(null);
  const style = bookStyle(styleName);

  useEffect(() => {
    const ref = plugin.app.workspace.on("file-open", (file) => {
      if (file) setActivePath(file.path);
    });
    return () => plugin.app.workspace.offref(ref);
  }, [plugin]);

  const filter = useMemo(() => compileFilters(topos, state.filters), [topos, state.filters]);
  // The engine filters, sorts, and counts every reference; only the page shown becomes objects
  const results = useMemo(
    () => plugin.refs.query(state.filters, queryScope(state, activePath), state.sort),
    // indexVersion: recompute when files change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin, state.filters, state.scope, state.paths, state.patterns, state.sort, activePath, indexVersion],
  );
  const hits = useMemo(
    () => results.page(0, shown),
    // detailsVersion: read again once EPUB details are loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, shown, detailsVersion],
  );
  // EPUB results show their CFI and context once the books' details are read
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
    [hits, shown, state.groupBy, books],
  );
  const total = results.total;
  const fileCount = results.files;
  const shownPaths = useMemo(
    () => [...new Set(groups.flatMap((g) => g.hits.map((h) => h.path)))],
    [groups],
  );
  // Notes' lines are read for the page shown (EPUB hits carry the text around them)
  const fileLines = useFileLines(plugin, shownPaths.filter((p) => !isEpub(p)), indexVersion);

  const setFilters = (update: Partial<Filters>) => {
    plugin.search.set({ filters: { ...state.filters, ...update } });
    setShown(PAGE);
  };
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
  const save = () => {
    if (saving?.trim()) void plugin.saveQuery({ name: saving, query });
    setSaving(null);
  };

  const bookOptions = books.map((b) => ({ name: b.name, aliases: [b.abbreviation, b.osis] }));
  const genreOptions = genres.map((g) => ({ name: g.name, aliases: [] }));

  return (
    <div className="topos-search">
      <div className="topos-toolbar">
        <select
          value={state.scope}
          onChange={(e) => plugin.search.set({ scope: e.target.value as Scope })}
          aria-label="Where to search"
        >
          <option value="vault">Whole vault</option>
          <option value="file">Current note</option>
          <option value="paths">Folders</option>
        </select>
        <select
          value={state.sort}
          onChange={(e) => plugin.search.set({ sort: e.target.value as SortOrder })}
          aria-label="Sort"
        >
          <option value="file">Order in notes</option>
          <option value="bible">Order in the Bible</option>
        </select>
        <select
          value={state.groupBy}
          onChange={(e) => plugin.search.set({ groupBy: e.target.value as "file" | "book" })}
          aria-label="Group by"
        >
          <option value="file">Group by note</option>
          <option value="book">Group by book</option>
        </select>
        <select
          value={state.context}
          onChange={(e) => plugin.search.set({ context: Number(e.target.value) })}
          aria-label="Context lines"
          title="Lines of context around each result"
        >
          {[0, 1, 2, 3, 5, 10].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "No context" : `±${n} line${n === 1 ? "" : "s"}`}
            </option>
          ))}
        </select>
        <select
          value={styleName}
          onChange={(e) => setStyleName(e.target.value as StyleName)}
          aria-label="Reference style"
        >
          <option value="name">John 3:16</option>
          <option value="abbreviation">Jn 3:16</option>
          <option value="osis">John.3.16</option>
        </select>
      </div>
      <div className="topos-saved">
        {saving === null ? (
          <>
            <select
              value={active?.name ?? ""}
              onChange={(e) => {
                if (e.target.value === CLEAR) {
                  plugin.search.set({ filters: NO_FILTERS, scope: "vault", paths: [], patterns: [] });
                  setShown(PAGE);
                  return;
                }
                const saved = savedQueries.find((q) => q.name === e.target.value);
                if (!saved) return;
                plugin.applyQuery(saved);
                setFiltersOpen(true);
                setShown(PAGE);
              }}
              aria-label="Saved searches"
            >
              {/* The prompt shows when no saved search matches; picking it does nothing */}
              <option value="" disabled hidden>
                {savedQueries.length === 0 ? "No saved searches" : "Saved searches…"}
              </option>
              <option value={CLEAR} disabled={activeFilters === 0 && state.scope === "vault"}>
                New search (clear filters)
              </option>
              {savedQueries.map((saved) => (
                <option key={saved.name} value={saved.name} title={saved.query}>
                  {saved.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSaving(active?.name ?? "")}
              disabled={activeFilters === 0 && state.scope !== "paths"}
              title="Save these filters under a name"
            >
              Save
            </button>
            {active && (
              <button onClick={() => void plugin.deleteQuery(active.name)} title={`Delete "${active.name}"`}>
                Delete
              </button>
            )}
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      {state.scope === "paths" && (
        <>
          <PathsInput paths={state.paths} onChange={(paths) => plugin.search.set({ paths })} />
          {state.patterns.length > 0 && (
            <div className="topos-patterns-note" title={state.patterns.map(patternText).join("\n")}>
              {`And ${state.patterns.length} pattern${state.patterns.length === 1 ? "" : "s"} (`}
              <a onClick={() => void plugin.openSearchPane(state, true)}>edit in a tab</a>)
            </div>
          )}
        </>
      )}
      {state.scope === "paths" && patternProblems(state.patterns).map((problem) => (
        <div key={problem} className="topos-conflict">⚠ {problem} (searching without it)</div>
      ))}

      <details
        className="topos-filters"
        open={filtersOpen}
        onToggle={(e) => setFiltersOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>
          <span className="topos-filters-title">
            Filters
            {activeFilters > 0 && <span className="topos-badge">{activeFilters}</span>}
          </span>
          {filter.books && !filter.conflict && (
            <span className="topos-filters-books">
              {`${filter.books.size} book${filter.books.size === 1 ? "" : "s"}`}
            </span>
          )}
          {!isEmpty(state.filters) && (
            <button
              className="topos-clear"
              onClick={(e) => {
                e.preventDefault();
                plugin.search.set({ filters: NO_FILTERS });
              }}
            >
              Clear
            </button>
          )}
        </summary>
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
            <Chips
              values={state.filters[row.key]}
              onRemove={removeFrom(row.key)}
              exclude={row.key === "excludeOverlap"}
            />
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
        {query && (
          <div className="topos-query" title="These filters as topos CLI options, for saved searches or the terminal">
            <code>{query}</code>
            <button
              className="topos-copy"
              onClick={() => {
                void navigator.clipboard.writeText(query);
              }}
              title="Copy"
            >
              Copy
            </button>
          </div>
        )}
      </details>

      {filter.conflict && <div className="topos-conflict">⚠ {filter.conflict}</div>}

      <div className="topos-summary">
        <span>
          {`${plugin.indexing ? "Indexing… " : ""}${total.toLocaleString()} reference${total === 1 ? "" : "s"} in ${fileCount.toLocaleString()} note${fileCount === 1 ? "" : "s"}`}
        </span>
        <button
          className="topos-copy"
          onClick={() => void plugin.openSearchPane(state, true)}
          title="Open this search in a tab, with file types and previews"
        >
          Open in a tab
        </button>
      </div>

      <div className="topos-results">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          return (
            <div key={group.key} className="topos-group">
              <div
                className="topos-group-header"
                onClick={() => {
                  const next = new Set(collapsed);
                  if (isCollapsed) next.delete(group.key);
                  else next.add(group.key);
                  setCollapsed(next);
                }}
              >
                <span className={`topos-caret${isCollapsed ? " is-collapsed" : ""}`}>▾</span>
                <span className="topos-group-name">{group.key}</span>
                <span className="topos-count">{group.hits.length}</span>
              </div>
              {!isCollapsed &&
                group.hits.map((hit) => (
                  <HitRow
                    key={`${hit.path}:${hit.start}`}
                    plugin={plugin}
                    hit={hit}
                    reference={written(topos, hit.passage, style, plugin.settings.format)}
                    showPath={state.groupBy === "book"}
                    context={state.context}
                    lines={fileLines.get(hit.path)}
                  />
                ))}
            </div>
          );
        })}
        {total > shown && (
          <button className="topos-more" onClick={() => setShown(shown + PAGE)}>
            Show more ({(total - shown).toLocaleString()} left)
          </button>
        )}
      </div>
    </div>
  );
}

function HitRow({
  plugin,
  hit,
  reference,
  showPath,
  context,
  lines,
}: {
  plugin: ToposPlugin;
  hit: Hit;
  reference: string;
  showPath: boolean;
  context: number;
  lines: string[] | undefined;
}) {
  // A note's line comes from the note (the index keeps only where references are)
  const lineText = hit.lineText || lines?.[hit.line - 1] || "";
  const from = hit.column - 1;
  const to = Math.min(lineText.length, from + (hit.end - hit.start));
  const url = plugin.referenceUrl(hit.passage);
  return (
    <div className={`topos-hit${context > 0 ? " has-context" : ""}`} onClick={() => void plugin.openHit(hit)}>
      <div className="topos-hit-head">
        <span className="topos-hit-reference">{reference}</span>
        <span className="topos-hit-location">
          {hit.epub
            ? `${showPath ? `${hit.path}: ` : ""}${hit.epub.chapter ?? `section ${hit.epub.spineIndex + 1}`}`
            : `${showPath ? `${hit.path}:` : ""}${hit.line}`}
        </span>
        {url && (
          <button
            className="topos-lw"
            title={`Open in ${plugin.linkSite()}`}
            onClick={(e) => {
              e.stopPropagation();
              window.open(url, "_blank");
            }}
          >
            ↗
          </button>
        )}
      </div>
      {context > 0 && lines && !hit.epub && <ContextLines lines={lines} from={hit.line - 1 - context} to={hit.line - 2} />}
      <div className="topos-hit-context">
        {context > 0 ? lineText.slice(0, from) : lineText.slice(0, from).trimStart()}
        <mark>{lineText.slice(from, to)}</mark>
        {lineText.slice(to)}
      </div>
      {context > 0 && lines && !hit.epub && <ContextLines lines={lines} from={hit.line} to={hit.line - 1 + context} />}
    </div>
  );
}

/** Lines `from` to `to` (0-based, inclusive) of a note, for context around a result */
function ContextLines({ lines, from, to }: { lines: string[]; from: number; to: number }) {
  const shown = [];
  for (let i = Math.max(0, from); i <= Math.min(lines.length - 1, to); i++) {
    shown.push(
      <div key={i} className="topos-context-line">
        {lines[i] || "\u00a0"}
      </div>,
    );
  }
  return <>{shown}</>;
}

/** Folders and files to search, separated by commas (kept as typed while it's the same list) */
function PathsInput({ paths, onChange }: { paths: string[]; onChange: (paths: string[]) => void }) {
  const [text, setText] = useState(paths.join(", "));
  const split = (value: string) => value.split(",").map(cleanPath).filter(Boolean);
  // Another change of the paths (a saved search) replaces what was typed
  useEffect(() => {
    if (split(text).join("\n") !== paths.join("\n")) setText(paths.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);
  return (
    <input
      className="topos-folder"
      type="text"
      value={text}
      placeholder="Folders or files, like Sermons/2025, Notes/John.md"
      onChange={(e) => {
        setText(e.target.value);
        onChange(split(e.target.value));
      }}
    />
  );
}
