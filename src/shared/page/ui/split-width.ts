import type { UiState } from '../../../contracts/ui-state';

// A split's start pane width in CSS pixels: `initial` when nothing is known,
// held inside `[min, max]`.
export interface SplitLimits {
  initial: number;
  min: number;
  max: number;
}

// `width` rounded to a whole pixel and held inside the limits; a width that is
// not finite takes `initial`.
export function clampSplitWidth(width: number, limits: SplitLimits): number {
  const wanted = Number.isFinite(width) ? width : limits.initial;
  return Math.min(Math.max(Math.round(wanted), limits.min), limits.max);
}

// The width stored under `key`, clamped; `initial` when the stored value is
// not a finite number.
export function storedSplitWidth(
  state: UiState,
  key: string,
  limits: SplitLimits,
): number {
  const stored = state.get(key);
  return clampSplitWidth(
    typeof stored === 'number' ? stored : limits.initial,
    limits,
  );
}
