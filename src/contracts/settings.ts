import type { Keymap } from './keymap';

export interface Settings {
  window: { width: number; height: number };
}

// Everything the main process loads and serves to the renderer.
export interface AppConfig {
  settings: Settings;
  keymap: Keymap;
}
