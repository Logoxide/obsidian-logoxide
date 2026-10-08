/** A path's extension, lowercase, without the dot ("" if its name has none), like the index's */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The extensions a query is limited to: none (every file) when all of them are chosen, or none is */
export function chosenExtensions(chosen: string[], available: string[]): string[] {
  const kept = available.filter((e) => chosen.includes(e));
  return kept.length === available.length ? [] : kept;
}

/**
 * Toggles a file type in the choice (`only`: chooses just it), where an empty choice is every
 * type; the last type left can't be turned off
 */
export function toggleExtension(chosen: string[], available: string[], extension: string, only = false): string[] {
  if (only) return available.length === 1 ? [] : [extension];
  const current = chosenExtensions(chosen, available);
  const on = current.length === 0 ? available : current;
  const next = on.includes(extension) ? on.filter((e) => e !== extension) : [...on, extension];
  if (next.length === 0) return current;
  return chosenExtensions(next, available);
}
