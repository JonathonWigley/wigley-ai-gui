/**
 * Time accumulated across spans that open and close, as a plain record that holds no clock: every
 * function takes the caller's `now`, in epoch ms.
 *
 * - `startActiveTime` opens a span. On a running time it returns the same object, so the first
 *   start wins.
 * - `stopActiveTime` closes the open span into `totalMs`. On a paused time it returns the same
 *   object.
 * - `activeMsAt` reads the total at `now`, the open span included.
 * - A `now` before `since` (a clock step back) counts the open span as 0, never as negative.
 */
export interface ActiveTime {
  /** The sum of the closed spans. */
  totalMs: number;
  /** The start of the open span; null while paused. */
  since: number | null;
}

export const NO_ACTIVE_TIME: ActiveTime = { totalMs: 0, since: null };

export function startActiveTime(time: ActiveTime, now: number): ActiveTime {
  return time.since === null ? { totalMs: time.totalMs, since: now } : time;
}

export function stopActiveTime(time: ActiveTime, now: number): ActiveTime {
  return time.since === null
    ? time
    : { totalMs: activeMsAt(time, now), since: null };
}

export function activeMsAt(time: ActiveTime, now: number): number {
  return time.since === null
    ? time.totalMs
    : time.totalMs + Math.max(0, now - time.since);
}
