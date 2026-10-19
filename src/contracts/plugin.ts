import type { Alerts } from './alerts';
import type { Clock, RandomHex, Timers } from './ambient';
import type { CommandId } from './commands';
import type { EditorHost, TextEditor } from './editor';
import type { InterceptBind, Keymap, PageBind } from './keymap';
import type { Log } from './log';
import type { MarkdownRenderer } from './markdown';

export type ProcessName = 'page' | 'main';

// A command as a manifest declares it, under its short id.
export interface CommandDecl {
  label: string;
  group: string;
  runsIn: ProcessName;
}

// A command under its qualified id, `<pluginId>.<short>`, or the core's own id
// with plugin `core`.
export interface CommandInfo extends CommandDecl {
  id: CommandId;
  plugin: string;
}

// A plugin's default keys, naming its short command ids `C` and scopes `S`.
export interface PluginKeys<C extends string, S extends string> {
  page: { keys: string[]; scope: S | 'any'; command: C }[];
  editor: { keys: string; command: C }[];
  app: { accelerator: string; command: C }[];
  global: { accelerator: string; command: C }[];
  intercept: (Omit<InterceptBind, 'command'> & { command: C })[];
}

// `settings` holds the plugin's settings with their defaults; `dependsOn`
// names plugins that start before this one.
export interface PluginManifest<
  C extends string = string,
  S extends string = string,
  T extends object = object,
> {
  id: string;
  dependsOn: readonly string[];
  commands: Record<C, CommandDecl>;
  scopes: readonly S[];
  keys: PluginKeys<C, S>;
  settings: T;
}

// The short ids of `M`'s commands that run in process `P`.
export type CommandsRunIn<M extends PluginManifest, P extends ProcessName> = {
  [K in keyof M['commands']]: M['commands'][K]['runsIn'] extends P ? K : never;
}[keyof M['commands']] &
  string;

// A plugin's channel between its two parts: the methods its page part invokes
// on its main part, and the messages main sends the page with their data.
export interface ChannelShape {
  invoke: Record<string, (...args: never[]) => unknown>;
  messages: Record<string, unknown>;
}

// Rejects with main's own error text when main's handler throws.
export interface PageChannel<Ch extends ChannelShape> {
  invoke<K extends keyof Ch['invoke'] & string>(
    method: K,
    ...args: Parameters<Ch['invoke'][K]>
  ): Promise<Awaited<ReturnType<Ch['invoke'][K]>>>;
  on<K extends keyof Ch['messages'] & string>(
    message: K,
    listener: (data: Ch['messages'][K]) => void,
  ): void;
}

export interface MainChannel<Ch extends ChannelShape> {
  handle<K extends keyof Ch['invoke'] & string>(
    method: K,
    handler: Ch['invoke'][K],
  ): void;
  send<K extends keyof Ch['messages'] & string>(
    message: K,
    data: Ch['messages'][K],
  ): void;
}

export type AreaName =
  | 'activityBar'
  | 'sideBar'
  | 'main'
  | 'panel'
  | 'statusBar'
  | 'overlay';

// An area of the window's shell; it shows while anything is contributed to it.
export interface Area {
  contribute(element: HTMLElement): { remove(): void };
}

export type ToastTone = 'success' | 'info' | 'error';

// `editor` is the text box a key fired in.
export interface PageCommandContext {
  editor?: TextEditor;
}

export interface PageServices {
  editor: EditorHost;
  markdown: MarkdownRenderer;
  toast(text: string, tone: ToastTone): void;
  log: Log;
  timers: Timers;
}

// `keys.keymap` is the merged keymap, every plugin's binds qualified;
// `keys.label` falls back to the id for a command with no label.
// `dependency` returns the exports of a plugin the manifest lists in
// `dependsOn`, typed by the caller from that plugin's contract.
export interface PageApi<M extends PluginManifest, Ch extends ChannelShape> {
  areas: Record<AreaName, Area>;
  channel: PageChannel<Ch>;
  keys: {
    setScope(scope: M['scopes'][number]): void;
    keymap: Keymap;
    label(id: CommandId): string;
  };
  settings: M['settings'];
  commands: { run(id: CommandId, context?: PageCommandContext): void };
  services: PageServices;
  dependency<E>(pluginId: string): E;
}

// `exports` reaches the plugins that depend on this one.
export interface PageStart<M extends PluginManifest> {
  commands: Record<
    CommandsRunIn<M, 'page'>,
    (context: PageCommandContext) => void
  >;
  exports?: unknown;
}

// Starts on every page load.
export interface PagePart<M extends PluginManifest = PluginManifest> {
  manifest: M;
  // `any`: one parts list holds parts with different channels.
  start(api: PageApi<M, any>): PageStart<M>;
}

// `expect` is a line the page logs once the keys have run; `checksFit` also
// checks the page fits the window's minimum width.
export interface SelfTestStep {
  keys: string[];
  expect: string;
  checksFit?: true;
}

// `open` starts the fixture for run `run`, returning the line the page logs
// once it shows and the result the script checks with `problems`, which lists
// what was wrong, empty when nothing was.
export interface SelfTestScript {
  pageBinds: PageBind[];
  open(run: number): { shownLine: string; result: Promise<unknown> };
  steps: SelfTestStep[];
  problems(result: unknown): string[];
}

// A part calls `run` once, during its `start`: the script's page binds join
// the config then, and a self-test with no script never finishes.
export interface SelfTestHost {
  run(script: SelfTestScript): void;
}

// `selfTest` is null outside the self-test.
export interface MainServices {
  log: Log;
  clock: Clock;
  randomHex: RandomHex;
  homeDir: string;
  alerts: Alerts;
  window: { show(): void };
  selfTest: SelfTestHost | null;
}

// `dependency` returns the exports of a plugin the manifest lists in
// `dependsOn`, typed by the caller from that plugin's contract.
export interface MainApi<M extends PluginManifest, Ch extends ChannelShape> {
  channel: MainChannel<Ch>;
  settings: M['settings'];
  services: MainServices;
  dependency<E>(pluginId: string): E;
}

// `exports` reaches the plugins that depend on this one; `dispose` runs when
// the app quits, which may exit before a returned promise settles.
export interface MainStart<M extends PluginManifest> {
  commands: Record<CommandsRunIn<M, 'main'>, (chord: string) => void>;
  exports?: unknown;
  dispose?(): void | Promise<void>;
}

// Starts once, at launch.
export interface MainPart<M extends PluginManifest = PluginManifest> {
  manifest: M;
  // `any`: one parts list holds parts with different channels.
  start(api: MainApi<M, any>): MainStart<M>;
}
