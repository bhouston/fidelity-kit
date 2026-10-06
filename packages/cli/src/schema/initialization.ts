/** The complement of recorded phases within initialization, including leading and trailing gaps. */
export function uncoveredInitialization(
  phases: readonly { start: number; end?: number }[],
  start: number,
  end: number,
): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = [];
  let cursor = start;
  for (const phase of phases.toSorted((a, b) => a.start - b.start)) {
    const left = Math.max(start, phase.start),
      right = Math.min(end, phase.end ?? end);
    if (right <= left) continue;
    if (left > cursor) gaps.push({ start: cursor, end: left });
    cursor = Math.max(cursor, right);
  }
  if (end > cursor) gaps.push({ start: cursor, end });
  return gaps;
}
