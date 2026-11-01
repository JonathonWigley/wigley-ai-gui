import type { PaneDirection } from '../../../contracts/panes';
import type { UiState } from '../../../contracts/ui-state';

// A split's sized pane width in CSS pixels (its start pane unless the divider
// sizes the end one), `initial` when nothing is known: `min` is the sized
// pane's least width, `endMin` the least width it leaves the pane beside it;
// no most width.
export interface SplitLimits {
  initial: number;
  min: number;
  endMin: number;
}

// The pixels one keyboard resize moves a divider.
export const SPLIT_NUDGE_STEP = 24;

// `span` is the width both panes share: the split's width less the handle's.
// Non-finite `width` takes `initial`; the result is rounded, then held in
// [min, span - endMin], `min` winning when the span is too small.
export function clampSplitWidth(
  width: number,
  limits: SplitLimits,
  span: number,
): number {
  const wanted = Number.isFinite(width) ? width : limits.initial;
  const most = span - limits.endMin;
  return Math.max(Math.min(Math.round(wanted), most), limits.min);
}

// `width` moved SPLIT_NUDGE_STEP left (smaller) or right (larger), then
// clamped.
export function nudgedSplitWidth(
  width: number,
  direction: Extract<PaneDirection, 'left' | 'right'>,
  limits: SplitLimits,
  span: number,
): number {
  const step = direction === 'left' ? -SPLIT_NUDGE_STEP : SPLIT_NUDGE_STEP;
  return clampSplitWidth(width + step, limits, span);
}

// The width stored under `key`, clamped with span Infinity; `initial` when the
// stored value is not a finite number.
export function storedSplitWidth(
  state: UiState,
  key: string,
  limits: SplitLimits,
): number {
  const stored = state.get(key);
  return clampSplitWidth(
    typeof stored === 'number' ? stored : limits.initial,
    limits,
    Infinity,
  );
}
