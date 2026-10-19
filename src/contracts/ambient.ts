// Ambient services the composition root passes in, so modules stay testable.
export interface Clock {
  // Epoch milliseconds.
  now(): number;
}

// Eight lowercase hex characters, fresh on every call.
export type RandomHex = () => string;

// The page's timers, passed in so tests drive time themselves.
export interface Timers {
  set(run: () => void, ms: number): number;
  clear(handle: number): void;
}
