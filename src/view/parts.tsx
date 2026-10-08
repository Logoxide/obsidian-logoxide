import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Filters, Testament } from "../core/filters.ts";
import type { Hit } from "../core/search.ts";
import type ToposPlugin from "../main.ts";

/** The filters that are lists of names or passages */
export type ListKey = Exclude<keyof Filters, "testaments" | "excludeTestaments">;

/** The passage filters, like the CLI's */
export const PASSAGE_ROWS: { key: ListKey; label: string; hint: string; placeholder: string }[] = [
  { key: "inside", label: "Inside", hint: "entirely within", placeholder: "Romans 8" },
  { key: "explicitOverlap", label: "Names", hint: "names its verses", placeholder: "John 3:16-21" },
  { key: "anyOverlap", label: "Overlaps", hint: "any shared verse", placeholder: "John 3:16-21" },
  { key: "exactOverlap", label: "Exactly", hint: "same verses", placeholder: "John 3:16" },
  { key: "excludeOverlap", label: "Not", hint: "no shared verse", placeholder: "Psalm 23" },
];

export function FilterRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="topos-filter-row">
      <label title={hint}>
        {label}
        {hint && <span className="topos-filter-hint">{hint}</span>}
      </label>
      <div className="topos-filter-values">{children}</div>
    </div>
  );
}

/** Cycles a testament through any, included, and excluded */
export function TestamentToggle({
  testament,
  filters,
  onChange,
}: {
  testament: Testament;
  filters: Filters;
  onChange: (update: Partial<Filters>) => void;
}) {
  const included = filters.testaments.includes(testament);
  const excluded = filters.excludeTestaments.includes(testament);
  const label = testament === "old" ? "OT" : "NT";
  const without = (list: Testament[]) => list.filter((t) => t !== testament);
  return (
    <button
      className={`topos-toggle${included ? " is-include" : excluded ? " is-exclude" : ""}`}
      title={included ? "Included (click to exclude)" : excluded ? "Excluded (click to clear)" : "Click to include"}
      onClick={() =>
        onChange(
          included
            ? { testaments: without(filters.testaments), excludeTestaments: [...filters.excludeTestaments, testament] }
            : excluded
              ? { excludeTestaments: without(filters.excludeTestaments) }
              : { testaments: [...filters.testaments, testament] },
        )
      }
    >
      {excluded ? `not ${label}` : label}
    </button>
  );
}

/**
 * The lines of the notes being shown, for context (read on demand, so it works the same whichever
 * engine indexed them, and costs nothing with context off)
 */
export function useFileLines(plugin: ToposPlugin, paths: string[], indexVersion: number): Map<string, string[]> {
  const [lines, setLines] = useState(() => new Map<string, string[]>());
  // Notes already read (until the index changes), so changing filters reads only new ones
  const read = useRef({ version: indexVersion, lines: new Map<string, string[]>() });
  const key = paths.join("\n");
  useEffect(() => {
    if (read.current.version !== indexVersion) read.current = { version: indexVersion, lines: new Map() };
    const known = read.current.lines;
    const missing = paths.filter((path) => !known.has(path));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const path of missing) {
        const file = plugin.app.vault.getFileByPath?.(path);
        if (!file) continue;
        known.set(path, (await plugin.app.vault.cachedRead(file)).split(/\r?\n/));
      }
      if (!cancelled) setLines(new Map(known));
    })();
    return () => {
      cancelled = true;
    };
    // paths is summarized by key; indexVersion re-reads notes that changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin, key, indexVersion]);
  return lines;
}

export function isEpub(path: string): boolean {
  return path.toLowerCase().endsWith(".epub");
}

/** How many results are shown, a page more at a time */
export interface Pages {
  shown: number;
  /** Shows another page ("Show more") */
  more: () => void;
  /** Back to the first page (for a new search) */
  reset: () => void;
  /** Where the page "Show more" asked for starts, until it has been seen to show something */
  loading: RefObject<number | null>;
}

export function usePages(page: number): Pages {
  const [shown, setShown] = useState(page);
  const loading = useRef<number | null>(null);
  return {
    shown,
    more: () => {
      loading.current = shown;
      setShown(shown + page);
    },
    reset: () => {
      loading.current = null;
      setShown(page);
    },
    loading,
  };
}

/**
 * After "Show more": when every result it added went into a collapsed group, nothing new can be
 * seen, so it loads another page, until one shows something or there are no more
 */
export function useLoadPastHidden(pages: Pages, hits: Hit[], total: number, hidden: (hit: Hit) => boolean): void {
  useEffect(() => {
    const start = pages.loading.current;
    if (start === null) return;
    const added = hits.slice(start);
    if (added.length > 0 && added.every(hidden) && total > pages.shown) pages.more();
    else pages.loading.current = null;
    // Once each page has loaded (`hidden` is read as it is then)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);
}
