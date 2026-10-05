export const DEFAULT_WORKFLOW_COLUMN_WIDTHS = [210, 110, 70, 240, 260, 150, 90, 280];
export const MIN_WORKFLOW_COLUMN_WIDTHS = [160, 100, 60, 160, 180, 135, 80, 280];

const sum = (widths: number[]) => widths.reduce((total, width) => total + width, 0);

export function fitWorkflowColumnWidths(availableWidth: number, widths: number[]): number[] {
  const next = [...widths];
  const target = Math.max(Math.floor(availableWidth), sum(MIN_WORKFLOW_COLUMN_WIDTHS));
  let difference = target - sum(next);
  if (difference === 0) return widths;

  if (difference > 0) {
    // Keep Name and Actions compact while the wider text columns absorb spare room.
    const share = Math.floor(difference / 3);
    next[3] += share;
    next[4] += share;
    next[5] += difference - 2 * share;
  } else {
    for (const index of [4, 3, 5, 0, 1, 6, 2]) {
      const shrink = Math.min(-difference, next[index] - MIN_WORKFLOW_COLUMN_WIDTHS[index]);
      next[index] -= shrink;
      difference += shrink;
      if (difference === 0) break;
    }
  }
  return next;
}

export function resizeWorkflowColumnPair(widths: number[], index: number, requestedWidth: number): number[] {
  if (index < 0 || index >= widths.length - 1) return widths;
  const left = widths[index];
  const right = widths[index + 1];
  const delta = Math.max(
    MIN_WORKFLOW_COLUMN_WIDTHS[index] - left,
    Math.min(Math.round(requestedWidth) - left, right - MIN_WORKFLOW_COLUMN_WIDTHS[index + 1]),
  );
  if (delta === 0) return widths;
  const next = [...widths];
  next[index] += delta;
  next[index + 1] -= delta;
  return next;
}
