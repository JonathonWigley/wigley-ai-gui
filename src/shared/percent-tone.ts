// The kit's MeterTone values, which `src/shared` cannot import from the page kit.
export type PercentTone = 'normal' | 'warning' | 'critical';

const WARNING_PERCENT = 70;
const CRITICAL_PERCENT = 90;

// `warning` from 70% and `critical` from 90%, of the percent rounded to a whole number, so a whole-percent label and
// its tone agree at a threshold.
export function percentTone(percent: number): PercentTone {
  const shown = Math.round(percent);
  if (shown < WARNING_PERCENT) {
    return 'normal';
  }
  return shown < CRITICAL_PERCENT ? 'warning' : 'critical';
}
