/**
 * The order of a pick list's choices (src/bible/pick-list.ts): those picked first, in their order,
 * then the rest in theirs. No Obsidian imports: tested with Node.
 */

/** The ids in the order a pick list shows them: the picked ones (that exist) first, as picked, then the others */
export function pickOrder(ids: readonly string[], picked: readonly string[]): string[] {
  const known = new Set(ids);
  const first = picked.filter((id) => known.has(id));
  const chosen = new Set(first);
  return [...first, ...ids.filter((id) => !chosen.has(id))];
}

/** The picked ids with one moved to a place among them (clamped to their ends) */
export function moveTo(picked: readonly string[], id: string, index: number): string[] {
  const rest = picked.filter((p) => p !== id);
  if (rest.length === picked.length) return [...picked];
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
