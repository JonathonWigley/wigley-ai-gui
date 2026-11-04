/** Time accumulated across spans that open and close, as a plain record that holds no clock. */
export interface ActiveTime {
  /** The sum of the closed spans. */
  totalMs: number;
  /** The start of the open span, in epoch ms; null while paused. */
  since: number | null;
}
