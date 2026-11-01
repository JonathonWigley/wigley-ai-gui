// Ambient services the composition root passes in, so modules stay testable.
export interface Clock {
  // Epoch milliseconds.
  now(): number;
}

// Eight lowercase hex characters, fresh on every call.
export type RandomHex = () => string;

// An RFC 4122 v4 UUID, fresh per call.
export type RandomUuid = () => string;

// One-shot timers for either process, passed in so tests drive time
// themselves: `set` runs `run` once after `ms` and returns a handle; `clear`
// cancels a handle `set` returned.
export interface Timers {
  set(run: () => void, ms: number): number;
  clear(handle: number): void;
}
