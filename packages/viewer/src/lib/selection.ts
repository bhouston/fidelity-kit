/** Stable category ordering, with a fallback for suites without grouping metadata. */
export function categoryGroups<T extends { category?: string }>(items: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const category = item.category ?? 'Other';
    const group = groups.get(category) ?? [];
    group.push(item);
    groups.set(category, group);
  }
  return [...groups];
}
export function selectionState(ids: readonly string[], selected: ReadonlySet<string>): 'none' | 'some' | 'all' {
  const count = ids.filter((id) => selected.has(id)).length;
  return count === 0 ? 'none' : count === ids.length ? 'all' : 'some';
}
/** A partial group selects all; an entirely selected group clears all. Other selections are preserved. */
export function toggleGroup(ids: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const clear = selectionState(ids, selected) === 'all';
  for (const id of ids) {
    if (clear) next.delete(id);
    else next.add(id);
  }
  return next;
}
