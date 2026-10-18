// Ambient services the composition root passes in, so modules stay testable.
export interface Clock {
  // Epoch milliseconds.
  now(): number;
}

// Eight lowercase hex characters, fresh on every call.
export type RandomHex = () => string;
