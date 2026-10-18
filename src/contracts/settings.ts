import type { Keymap } from './keymap';

export interface Settings {
  window: { width: number; height: number };
  // A theme `name`, built-in or from the user's themes folder.
  theme: string;
  // `uiSize` and `monoSize` are CSS pixels.
  fonts: { ui: string; mono: string; uiSize: number; monoSize: number };
  // How long a page key sequence waits for its next key.
  keySequenceTimeoutMs: number;
}

// Everything the main process loads and serves to the renderer.
export interface AppConfig {
  settings: Settings;
  keymap: Keymap;
}
