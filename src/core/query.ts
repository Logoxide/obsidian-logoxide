import { NO_FILTERS, type Filters, type ListKey, type Testament } from "./filters.ts";
import { cleanPath, EVERYWHERE, type PathPattern, type Where } from "./paths.ts";

/** A named search, saved in the settings */
export interface SavedQuery {
  name: string;
  /**
   * The CLI's filter options, like `--nt -g "Pauline Epistles" -o "John 1"`, with the files and
   * folders to search first, and `--glob`, `--iglob`, and `--path-regex`
   */
  query: string;
}

/** What a query asks for: filters, and which files to search (paths and patterns, like the CLI's) */
export interface ParsedQuery extends Where {
  filters: Filters;
  errors: string[];
}

const LIST_OPTIONS: Record<string, ListKey> = {
  "-g": "genres",
  "--genre": "genres",
  "--exclude-genre": "excludeGenres",
  "-b": "books",
  "--book": "books",
  "--exclude-book": "excludeBooks",
  "-i": "inside",
  "--inside": "inside",
  "--any-overlap": "anyOverlap",
  "--overlaps": "anyOverlap",
  "-o": "explicitOverlap",
  "--explicit-overlap": "explicitOverlap",
  "--exact-overlap": "exactOverlap",
  "--exclude-overlap": "excludeOverlap",
  "--outside": "excludeOverlap",
};

/** Path patterns: the CLI's globs and regular expressions */
const PATTERN_OPTIONS: Record<string, PathPattern["kind"]> = {
  "--glob": "glob",
  "--iglob": "iglob",
  "--path-regex": "regex",
};

const TESTAMENT_OPTIONS: Record<string, "testaments" | "excludeTestaments"> = {
  "-t": "testaments",
  "--testament": "testaments",
  "--exclude-testament": "excludeTestaments",
};

/** Splits on whitespace, keeping "double" or 'single' quoted text together */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"?|'([^']*)'?|([^\s"']+)/g;
  let current: string | null = null;
  let last = -1;
  for (const m of text.matchAll(pattern)) {
    const part = m[1] ?? m[2] ?? m[3] ?? "";
    // Pieces with no space between them are one token, like --book="Song of Solomon"
    if (current !== null && m.index === last) current += part;
    else {
      if (current !== null) tokens.push(current);
      current = part;
    }
    last = m.index + m[0].length;
  }
  if (current !== null) tokens.push(current);
  return tokens;
}

function testament(value: string): Testament | null {
  const v = value.trim().toLowerCase();
  if (["o", "ot", "old", "old testament"].includes(v)) return "old";
  if (["n", "nt", "new", "new testament"].includes(v)) return "new";
  return null;
}

/**
 * Reads the CLI's filter options; anything else is reported in `errors`. With `legacy`, `-o` has
 * its meaning before 0.4.0 (any overlap), for migrating saved searches
 */
export function parseQuery(text: string, { legacy = false }: { legacy?: boolean } = {}): ParsedQuery {
  const filters: Filters = structuredClone(NO_FILTERS);
  const errors: string[] = [];
  const paths: string[] = [];
  const patterns: PathPattern[] = [];
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    let option = tokens[i];
    let value: string | undefined;
    const eq = option.indexOf("=");
    if (option.startsWith("--") && eq !== -1) {
      value = option.slice(eq + 1);
      option = option.slice(0, eq);
    }
    if (option === "--verses") {
      filters.verses = true;
      continue;
    }
    if (option === "--skip-single-chapter") {
      filters.skipSingleChapter = true;
      continue;
    }
    if (option === "--nt" || option === "--ot") {
      const t: Testament = option === "--nt" ? "new" : "old";
      if (!filters.testaments.includes(t)) filters.testaments.push(t);
      continue;
    }
    const list = legacy && option === "-o" ? "anyOverlap" : LIST_OPTIONS[option];
    const testamentKey = TESTAMENT_OPTIONS[option];
    const patternKind = PATTERN_OPTIONS[option];
    if (!list && !testamentKey && !patternKind) {
      if (option.startsWith("-")) errors.push(`Unknown option ${option}`);
      else if (cleanPath(option)) paths.push(cleanPath(option));
      continue;
    }
    value ??= tokens[++i];
    if (value === undefined) {
      errors.push(`${option} needs a value`);
      break;
    }
    if (patternKind) patterns.push({ kind: patternKind, pattern: value });
    else if (list) filters[list].push(value);
    else {
      const t = testament(value);
      if (t === null) errors.push(`Unknown testament "${value}"`);
      else if (!filters[testamentKey].includes(t)) filters[testamentKey].push(t);
    }
  }
  if (filters.skipSingleChapter && !filters.verses) errors.push("--skip-single-chapter needs --verses");
  return { filters, paths, patterns, errors };
}

function quote(value: string): string {
  return /^[\w:.,;\-–/]+$/.test(value) ? value : `"${value.replace(/"/g, "")}"`;
}

/** Writes filters (and the files to search) as CLI options, the inverse of {@link parseQuery} */
export function formatQuery(filters: Filters, where: Where = EVERYWHERE): string {
  const parts: string[] = [];
  for (const path of where.paths) parts.push(quote(path));
  for (const t of filters.testaments) parts.push(t === "new" ? "--nt" : "--ot");
  for (const t of filters.excludeTestaments) parts.push("--exclude-testament", t);
  const lists: [ListKey, string][] = [
    ["genres", "-g"],
    ["excludeGenres", "--exclude-genre"],
    ["books", "-b"],
    ["excludeBooks", "--exclude-book"],
    ["inside", "-i"],
    ["anyOverlap", "--any-overlap"],
    ["explicitOverlap", "-o"],
    ["exactOverlap", "--exact-overlap"],
    ["excludeOverlap", "--exclude-overlap"],
  ];
  for (const [key, option] of lists) for (const value of filters[key]) parts.push(option, quote(value));
  if (filters.verses) parts.push("--verses");
  if (filters.verses && filters.skipSingleChapter) parts.push("--skip-single-chapter");
  const patternOption = { glob: "--glob", iglob: "--iglob", regex: "--path-regex" };
  for (const { kind, pattern } of where.patterns) parts.push(patternOption[kind], quote(pattern));
  return parts.join(" ");
}

/**
 * Rewrites a saved search from before 0.4.0, when `-o` meant any overlap and `--outside` was the
 * exclusion, in today's options; one it can't read is left as it is
 */
export function migrateQuery(text: string): string {
  const parsed = parseQuery(text, { legacy: true });
  return parsed.errors.length > 0 ? text : formatQuery(parsed.filters, parsed);
}
