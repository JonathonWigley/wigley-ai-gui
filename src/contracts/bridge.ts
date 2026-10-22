import type { Log } from './log';
import type { AppConfig } from './settings';

export const BRIDGE_CHANNELS = {
  config: 'bridge:config',
  configChanged: 'bridge:config-changed',
  log: 'bridge:log',
  pluginInvoke: 'plugin:invoke',
  pluginMessage: 'plugin:message',
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
}
