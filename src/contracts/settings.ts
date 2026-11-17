import type { AppInstance } from './app-instance';
import type { CommandId } from './commands';
import type { Keymap } from './keymap';
import type { Platform } from './platform';
import type { CommandInfo, RunMode, ScopeInfo } from './plugin';
import type { ServedPlugin } from './plugin-catalog';
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
  // `uiSize`, `monoSize` and `proseSize` are CSS pixels.
  fonts: {
    ui?: string;
    mono?: string;
    uiSize?: number;
    monoSize?: number;
    proseSize?: number;
  };
  // How long a page key sequence waits for its next key.
  keySequenceTimeoutMs: number;
  // The layout the shell chrome draws with: a folder in `layouts/shell/`, or
  // `default`.
  shell: { layout: string };
  // Plugin ids neither process starts; an id no plugin has disables nothing.
  plugins: { disabled: string[] };
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
  platform: Platform;
  // The real path of the home folder main's plugins run in: the user's in a
  // live run, the temp home under the self-test and a drive run.
  homeDir: string;
  // Which app runs, the stable or the dev one.
  appInstance: AppInstance;
  runMode: RunMode;
  // One per plugin the config admitted, in catalog order.
  plugins: readonly ServedPlugin[];
  // Every config file that could not be applied; empty when none.
  problems: ConfigProblem[];
}
