// A registration that can be undone; `dispose` removes it.
export interface Disposable {
  dispose(): void;
}

// Collects registrations to dispose together. `track` returns its argument.
export interface Registrations {
  track<T extends Disposable>(handle: T): T;
}
