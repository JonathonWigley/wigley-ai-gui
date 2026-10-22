// App-written view state that survives a restart, such as split widths,
// scoped to one plugin: its keys never meet another plugin's. Values are JSON
// values; `set(key, undefined)` deletes the key, and `get` of an absent key is
// `undefined`.
export interface UiState {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}
