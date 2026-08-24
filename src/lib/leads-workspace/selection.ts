/** Keeps bulk actions scoped to rows that are still visible in the workspace. */
export function retainVisibleSelection(
  selectedIds: Iterable<string>,
  visibleIds: Iterable<string>,
): Set<string> {
  const visible = new Set(visibleIds);
  return new Set(Array.from(selectedIds).filter((id) => visible.has(id)));
}

export function haveSameSelection(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  return Array.from(left).every((id) => right.has(id));
}
