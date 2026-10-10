import { ToposPaths } from "logoxide";

/**
 * A glob (ripgrep's `--glob`, gitignore's rules: `*.md`, `drafts`, `Sermons/**`), a glob ignoring
 * case (`--iglob`), or a regular expression matched anywhere in the path; `!` before it excludes
 */
export interface PathPattern {
  kind: "glob" | "iglob" | "regex";
  pattern: string;
}

/** Which files to search by path: files and folders, and patterns (none of either: every file) */
export interface Where {
  paths: string[];
  patterns: PathPattern[];
}

export const EVERYWHERE: Where = { paths: [], patterns: [] };

/** A path as the index has it: no `./`, no trailing `/` */
export function cleanPath(path: string): string {
  return path.trim().replace(/^\.\/?/, "").replace(/\/+$/, "");
}

/**
 * Reads a typed pattern: `/regex/` (with `i` after it to ignore case) or a glob (ignoring case
 * with `ignoreCase`); `!` before either excludes
 */
export function parsePattern(text: string, ignoreCase = false): PathPattern | null {
  const trimmed = text.trim();
  const exclude = trimmed.startsWith("!");
  const body = exclude ? trimmed.slice(1) : trimmed;
  if (!body) return null;
  const regex = /^\/(.+)\/(i?)$/.exec(body);
  if (regex) {
    const insensitive = regex[2] === "i" || ignoreCase;
    return { kind: "regex", pattern: `${exclude ? "!" : ""}${insensitive ? "(?i)" : ""}${regex[1]}` };
  }
  return { kind: ignoreCase ? "iglob" : "glob", pattern: trimmed };
}

/** Whether a pattern leaves files out */
export function excludes(pattern: PathPattern): boolean {
  return pattern.pattern.startsWith("!");
}

/** A pattern as it's typed: `!drafts`, `/^Sermons\/20\d\d/` */
export function patternText(pattern: PathPattern): string {
  if (pattern.kind !== "regex") return pattern.pattern;
  const bang = excludes(pattern) ? "!" : "";
  const body = bang ? pattern.pattern.slice(1) : pattern.pattern;
  return body.startsWith("(?i)") ? `${bang}/${body.slice(4)}/i` : `${bang}/${body}/`;
}

/** The engine's path filter: these files and folders and patterns, with one of the extensions */
export function toPaths(where: Where, extensions: string[] = []): ToposPaths {
  let paths = ToposPaths.create();
  for (const path of where.paths) paths = paths.path(cleanPath(path));
  for (const { kind, pattern } of where.patterns) paths = paths[kind](pattern);
  for (const extension of extensions) paths = paths.extension(extension);
  return paths;
}

/** Why each pattern that can't be read can't be */
export function patternProblems(patterns: PathPattern[]): string[] {
  if (patterns.length === 0) return [];
  const paths = toPaths({ paths: [], patterns });
  try {
    return paths.problems();
  } finally {
    paths.dispose();
  }
}
