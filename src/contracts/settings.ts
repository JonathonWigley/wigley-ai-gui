import type { CommandId } from './commands';
import type { Keymap } from './keymap';
import type { CommandInfo } from './plugin';
import type { ThemeChoice } from './theme';

export interface Settings {
  // `minWidth` and `minHeight` are the smallest size the user can drag to.
  window: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  };
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
  // Every command by its qualified id.
  commands: Record<CommandId, CommandInfo>;
  // Each plugin's settings, by plugin id.
  pluginSettings: Record<string, object>;
  theme: ThemeChoice;
}
