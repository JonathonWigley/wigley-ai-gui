import type { CommandId } from './commands';
import type { Disposable } from './disposable';
import type { LayoutOwner, LayoutSet } from './layouts';
import type { Log } from './log';
import type { CatalogProblem } from './plugin-catalog';
import type { AppConfig } from './settings';
import type { SlotChange, StateSnapshot } from './state';

export const BRIDGE_CHANNELS = {
  chooseFolder: 'bridge:choose-folder',
  commandRun: 'bridge:command-run',
  commandRunDone: 'bridge:command-run-done',
  commandRunInPage: 'bridge:command-run-in-page',
  config: 'bridge:config',
  configChanged: 'bridge:config-changed',
  layoutsRead: 'bridge:layouts-read',
  layoutsChanged: 'bridge:layouts-changed',
  log: 'bridge:log',
  openExternal: 'bridge:open-external',
  pluginInvoke: 'plugin:invoke',
  pluginMessage: 'plugin:message',
  pluginParts: 'bridge:plugin-parts',
  pluginPartsDone: 'bridge:plugin-parts-done',
  savePasted: 'bridge:save-pasted',
  serveVisual: 'bridge:serve-visual',
  stateChanged: 'bridge:state-changed',
  stateSnapshot: 'bridge:state-snapshot',
  stateWrite: 'bridge:state-write',
  uiStateRead: 'bridge:ui-state-read',
  uiStateWrite: 'bridge:ui-state-write',
} as const;

export type PluginPartsRequest =
  | { kind: 'mayStop'; ids: readonly string[] } // reply: { reason: string | null }
  | { kind: 'stop'; ids: readonly string[] } // reply: { stopped: readonly string[] }
  | { kind: 'start'; ids: readonly string[] } // reply: { started: readonly string[]; problems: readonly CatalogProblem[] }
  | { kind: 'reload'; id: string } // reply: { reloaded: readonly string[] }
  | { kind: 'remove'; id: string }; // reply: { stopped: readonly string[] }
// `problems`: page-side load and start failures, one per id. `problem`: why
// the page could not load the new `page.js`, null when it loaded.
export type PluginPartsReply =
  | { reason: string | null }
  | { stopped: readonly string[] }
  | { started: readonly string[]; problems: readonly CatalogProblem[] }
  | { reloaded: readonly string[]; problem: string | null };

// What the core claims once at start through `window.wigley.claim()`.
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
  // Every slot main holds and the `seq` of the last change it applied.
  stateSnapshot(): Promise<StateSnapshot>;
  // Sends one page writer's change to main. Throws at the caller for a value IPC
  // cannot clone.
  stateWrite(change: SlotChange): void;
  // Calls `listener` with each main writer's change and its `seq`, until the
  // returned handle's `dispose`.
  onStateChange(
    listener: (seq: number, change: SlotChange) => void,
  ): Disposable;
  // Runs a main command and resolves once its handler settles; rejects with
  // main's text when main knows no such command or the argument is bad.
  runCommand(id: CommandId, arg: unknown): Promise<void>;
  // Calls `listener` with each page command main runs, and tells main once the
  // returned promise settles.
  onRunCommand(listener: (id: CommandId, arg: unknown) => Promise<void>): void;
  // Calls `method` on the main part of plugin `pluginId`; rejects with main's
  // own error text when the handler throws.
  invoke(pluginId: string, method: string, args: unknown[]): Promise<unknown>;
  // Calls `listener` with each `message` main sends plugin `pluginId`, until
  // the returned handle's `dispose`.
  onMessage(
    pluginId: string,
    message: string,
    listener: (data: unknown) => void,
  ): Disposable;
  // The full path on disk of a dropped `file`; '' for a file with no path, as
  // a clipboard image.
  pathForFile(file: File): string;
  // Saves a file with no path on disk under the app instance's pasted/ folder
  // and resolves with its full path; rejects with main's own error text when
  // the save fails.
  savePasted(bytes: Uint8Array, mediaType: string): Promise<string>;
  // The native folder dialog over the window; null when the user dismisses it.
  // Rejects with main's own error text when it fails.
  chooseFolder(): Promise<string | null>;
  // Opens an http or https URL in the user's default app; rejects with main's
  // own error text for any other URL.
  openExternal(url: string): Promise<void>;
  // The page answers main's requests through its host.
  onPluginParts(
    answer: (request: PluginPartsRequest) => Promise<PluginPartsReply>,
  ): void;
}
