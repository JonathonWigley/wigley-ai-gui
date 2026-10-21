import type { CommandId } from './commands';
import type { Keymap } from './keymap';
import type { CommandInfo, ScopeInfo } from './plugin';
import type { Theme } from './theme';

// `system` follows the OS's reduce-transparency preference.
export type Transparency = 'system' | 'full' | 'reduced';

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
  // Whether glass materials show through, or turn opaque through the theme's
  // `reduced` overrides.
  transparency: Transparency;
  // Each member, when set, overrides the theme token `FONT_TOKENS` names;
  // `uiSize` and `monoSize` are CSS pixels.
  fonts: { ui?: string; mono?: string; uiSize?: number; monoSize?: number };
  // How long a page key sequence waits for its next key.
  keySequenceTimeoutMs: number;
  // `command` is the `claude` executable a session runs; a leading `~/` means
  // the home folder, since an app started from the Dock has no shell `PATH`.
  claude: { command: string };
}

// A config file that could not be applied, and why.
export interface ConfigProblem {
  file: string;
  message: string;
}

// Everything the main process loads and serves to the renderer.
export interface AppConfig {
  settings: Settings;
  keymap: Keymap;
  // Every command by its qualified id.
  commands: Record<CommandId, CommandInfo>;
  // Every scope: each plugin's in declaration order, plugins in list order,
  // then the core's.
  scopes: ScopeInfo[];
  // Each plugin's settings, by plugin id.
  pluginSettings: Record<string, object>;
  theme: Theme;
  // Every config file that could not be applied; empty when none.
  problems: ConfigProblem[];
}
