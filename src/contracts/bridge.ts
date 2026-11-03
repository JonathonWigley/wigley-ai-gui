import type { LayoutOwner, LayoutSet } from './layouts';
import type { Log } from './log';
import type { AppConfig } from './settings';

export const BRIDGE_CHANNELS = {
  config: 'bridge:config',
  configChanged: 'bridge:config-changed',
  layoutsRead: 'bridge:layouts-read',
  layoutsChanged: 'bridge:layouts-changed',
  log: 'bridge:log',
  pluginInvoke: 'plugin:invoke',
  pluginMessage: 'plugin:message',
  savePasted: 'bridge:save-pasted',
  serveVisual: 'bridge:serve-visual',
  uiStateRead: 'bridge:ui-state-read',
  uiStateWrite: 'bridge:ui-state-write',
} as const;

// What the preload exposes to the renderer as `window.wigley`.
export interface Bridge {
  config(): Promise<AppConfig>;
  // Calls `listener` with each new config main serves after a config file
  // changes.
  onConfig(listener: (config: AppConfig) => void): void;
  onLog(listener: Log): void;
  // The layouts `owner` holds now; null until the owner's registry has listed
  // them, or for an owner that never registered.
  layouts(owner: LayoutOwner): Promise<LayoutSet | null>;
  // Calls `listener` with each owner's set main sends: its first once its
  // registry has listed, then one after each change in a layout's folder.
  onLayouts(listener: (owner: LayoutOwner, set: LayoutSet) => void): void;
  // Keeps a visual's source in main and resolves the `wigley-visual:` URL that
  // serves it; the same source always gets the same URL.
  serveVisual(source: string): Promise<string>;
  // Every saved ui-state key, qualified by its plugin id (`forms.rail`), and
  // its value.
  uiState(): Promise<Record<string, unknown>>;
  // Saves one qualified ui-state key; `undefined` deletes it. Throws at the
  // caller for a value IPC cannot clone.
  setUiState(key: string, value: unknown): void;
  // Calls `method` on the main part of plugin `pluginId`; rejects with main's
  // own error text when the handler throws.
  invoke(pluginId: string, method: string, args: unknown[]): Promise<unknown>;
  // Calls `listener` with each `message` main sends plugin `pluginId`.
  onMessage(
    pluginId: string,
    message: string,
    listener: (data: unknown) => void,
  ): void;
  // The full path on disk of a dropped `file`; '' for a file with no path, as
  // a clipboard image.
  pathForFile(file: File): string;
  // Saves a file with no path on disk under the app instance's pasted/ folder
  // and resolves with its full path; rejects with main's own error text when
  // the save fails.
  savePasted(bytes: Uint8Array, mediaType: string): Promise<string>;
}
