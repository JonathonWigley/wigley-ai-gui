// The page's timers, passed in so tests drive time themselves.
export interface Timers {
  set(run: () => void, ms: number): number;
  clear(handle: number): void;
}
