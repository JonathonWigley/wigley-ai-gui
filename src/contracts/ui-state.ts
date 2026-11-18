import type { Disposable } from './disposable';

// App-written view state that survives a restart, such as split widths,
// scoped to one plugin: its keys never meet another plugin's. Values are JSON
// values; `set(key, undefined)` deletes the key, and `get` of an absent key is
// `undefined`. `on` calls `listener` after each `set` of `key` through any
// scope of this plugin's prefix in this page, the setter's own included, and
// returns the `Disposable` that stops it; a set in another window's page is
// not heard.
export interface UiState {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  on(key: string, listener: () => void): Disposable;
}
