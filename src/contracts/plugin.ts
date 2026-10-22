import type { AgentHarness } from './agent';
import type { Alerts } from './alerts';
import type { Clock, RandomHex, RandomUuid, Timers } from './ambient';
import type { CommandId } from './commands';
import type { Disposable } from './disposable';
import type { EditorHost, TextEditor } from './editor';
import type { Files } from './files';
import type {
  EditorMode,
  InterceptBind,
  Keymap,
  PageBind,
  PendingKeys,
  ViewScope,
} from './keymap';
import type { Log } from './log';
import type { MarkdownRenderer } from './markdown';
import type { Platform } from './platform';
import type { ProcessRunner } from './processes';
import type { TokenDecl } from './theme';
import type { UiState } from './ui-state';

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

// A scope under its qualified id, `<pluginId>.<short>`, or the core's own id
// with plugin `core`; `title` names where its keys act, as help heads them.
export interface ScopeInfo {
  id: ViewScope;
  title: string;
  plugin: string;
}

// A plugin's default keys, naming its scopes `S` and its short command ids:
// page and editor keys name commands `PageC`, run in the page; app, global and
// intercept keys name commands `MainC`, run in main.
export interface PluginKeys<
  PageC extends string,
  MainC extends string,
  S extends string,
> {
  page: { keys: string[]; scope: S | 'any'; command: PageC }[];
  editor: {
    keys: string;
    scope: S | 'any';
    command: PageC;
    mode?: EditorMode;
  }[];
  app: { accelerator: string; command: MainC }[];
  global: { accelerator: string; command: MainC }[];
  intercept: (Omit<InterceptBind, 'command'> & { command: MainC })[];
}

// The JSON kind a setting takes when its default cannot show it: the default
// is null, or the setting is left unset.
export type SettingKind = 'string' | 'number' | 'boolean';

// `scopes` holds each scope's title by its short id; `settings` holds the
// plugin's settings with their defaults; `optionalSettings` holds the kind of
// each setting whose default is null or unset, by its dotted path inside
// `settings` (an array element's fields under `<path>[]`); `themeTokens`
// declares the plugin's own theme tokens by their unqualified names
// (`origin-caused`), each with its kind and default; `dependsOn` names plugins
// that start before this one.
export interface PluginManifest<
  C extends string = string,
  S extends string = string,
  T extends object = object,
> {
  // Lowercase letters, digits and `-`: the `wigley-data:` URL host carries the
  // id, and Chromium lowercases a URL's host.
  id: string;
  dependsOn: readonly string[];
  commands: Record<C, CommandDecl>;
  scopes: Readonly<Record<S, string>>;
  keys: PluginKeys<C, C, S>;
  settings: T;
  optionalSettings?: Readonly<Record<string, SettingKind>>;
  themeTokens: Readonly<Record<string, TokenDecl>>;
}

// The short ids of the commands in `Cmds` that run in process `P`.
export type CommandsDeclaredIn<
  Cmds extends Record<string, CommandDecl>,
  P extends ProcessName,
> = {
  [K in keyof Cmds]: Cmds[K]['runsIn'] extends P ? K : never;
}[keyof Cmds] &
  string;

// The short ids of `M`'s commands that run in process `P`.
export type CommandsRunIn<
  M extends PluginManifest,
  P extends ProcessName,
> = CommandsDeclaredIn<M['commands'], P>;

// A plugin's channel between its two parts: the methods its page part invokes
// on its main part, and the messages main sends the page with their data.
export interface ChannelShape {
  invoke: Record<string, (...args: never[]) => unknown>;
  messages: Record<string, unknown>;
}

// `invoke` rejects with main's own error text when main's handler throws.
// `on` calls `listener` with each `message` main sends, until the returned
// handle's `remove`; a second `remove` does nothing. Listening twice with one
// listener registers it twice, each `remove` dropping its own registration.
export interface PageChannel<Ch extends ChannelShape> {
  invoke<K extends keyof Ch['invoke'] & string>(
    method: K,
    ...args: Parameters<Ch['invoke'][K]>
  ): Promise<Awaited<ReturnType<Ch['invoke'][K]>>>;
  on<K extends keyof Ch['messages'] & string>(
    message: K,
    listener: (data: Ch['messages'][K]) => void,
  ): { remove(): void };
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

// A plugin's events: each name it publishes, with its payload. It is an object
// type with no index signature, so an interface extending it holds only the
// names it declares and `emit` rejects any other; a primitive does not extend it.
export type EventShape = object & { [K in never]: unknown };

// Events whose names and payloads the type system does not know: what the
// core's untyped bus hands every part, which narrows them with its own
// contracts through the `any` its `start` takes.
export type UntypedEvents = Record<string, unknown>;

// Publisher `Id`'s events `Ev` under their qualified names, `<Id>.<event>`:
// what a part that hears them lists as its `Heard`.
export type QualifiedEvents<Id extends string, Ev extends EventShape> = {
  [K in keyof Ev & string as `${Id}.${K}`]: Ev[K];
};

// `emit` publishes one of the plugin's own events `Ev` under its qualified
// name (`<pluginId>.<event>`), rejecting an undeclared name or a wrong
// payload. `on` hears another plugin's event by its qualified name, naming
// only an event in `Heard` (built with `QualifiedEvents` from each
// publisher's contract), its listener typed from it; a part that declares no
// `Heard` hears nothing. Listeners run before `emit` returns, and a
// listener's throw reaches the emitter.
export interface PluginEvents<
  Ev extends EventShape,
  Heard extends EventShape = Record<never, never>,
> {
  emit<K extends keyof Ev & string>(event: K, data: Ev[K]): void;
  on<K extends keyof Heard & string>(
    qualifiedEvent: K,
    listener: (data: Heard[K]) => void,
  ): void;
}

export type AreaName =
  | 'titleBar'
  | 'activityBar'
  | 'sideBar'
  | 'main'
  | 'panel'
  | 'statusBar'
  | 'overlay';

// Where a contribution sits in its area: contributions sort by `align`
// (`start`, then `center`, then `end`; default `start`), then by `order`
// ascending (default `0`), then in the order they were contributed.
export interface ContributeOptions {
  order?: number;
  align?: Alignment;
}

export type Alignment = 'start' | 'center' | 'end';

// An area of the window's shell. `contribute` places `element` in the area
// where its options sort it, until the returned handle's `dispose`; a second
// `dispose` does nothing. The area hides while it holds no contribution.
export interface Area {
  contribute(element: HTMLElement, options?: ContributeOptions): Disposable;
}

// The areas a plugin contributes to: the core draws the activity bar and the
// side bar from the modes, and `main` belongs to the modes, filled through
// `modes.add`.
export type PluginAreas = Record<
  'titleBar' | 'panel' | 'statusBar' | 'overlay',
  Area
>;

// What the title bar shows for a mode at its centre: `title`, with `detail`
// after it in the secondary text colour when it is not null.
export interface ModeContext {
  title: string;
  detail: string | null;
}

// A view that fills the window's content sheet; the core shows one mode at a
// time. `icon` is a Codicon name the activity bar draws for the mode, with
// `title` as its label and tooltip. `sideBar`, when set, shows in the window's
// side bar while this mode shows. `shown` runs each time this mode becomes the
// shown one, the first mode's at its `add` included; the mode's plugin sets
// its base key scope there, so a hidden view never keeps the scope. `hidden`
// runs each time another mode's `show` hides this one, after its element and
// side bar are hidden and before the other mode's `shown`.
export interface Mode {
  id: string;
  title: string;
  icon: string;
  element: HTMLElement;
  sideBar?: HTMLElement;
  shown(): void;
  hidden(): void;
}

// `show` hides the shown mode and shows this one; on the shown mode it does
// nothing. `setContext` keeps the mode's title bar context, starting null,
// and shows it while the mode shows. `toggleSideBar` flips the mode's side bar
// choice: while the window is wide it hides or shows the side bar beside the
// content, while narrow it opens or closes it over the content; each mode
// keeps its own choice, and a hidden mode's toggle applies at its next show.
// It throws `Mode "<id>" has no side bar` on a mode without one.
// `sideBarShown` is true while the mode shows and its side bar lies beside or
// over the content.
export interface ModeHandle {
  show(): void;
  isShown(): boolean;
  setContext(context: ModeContext | null): void;
  toggleSideBar(): void;
  sideBarShown(): boolean;
}

// The first mode added shows and every later one is added hidden; a hidden
// mode keeps its DOM and state. `add` throws on an id already added, and calls
// the first mode's `shown` before it returns, so that `shown` cannot read the
// handle. `shown` is the shown mode's id and throws before any `add`. A `show`
// that changes the shown mode hides the old mode's element and side bar, calls
// the old mode's `hidden`, unhides the new mode's element and side bar, marks
// it in the activity bar, lays out its side bar, shows its context, calls its
// `shown`, then `onChanged` listeners hear the new id.
export interface Modes {
  add(mode: Mode): ModeHandle;
  shown(): string;
  onChanged(listener: (modeId: string) => void): void;
}

// An area the layout splits by alignment: `element` is the area's own element,
// and each contribution goes into the `tracks` container of its `align`.
export interface AlignedArea {
  element: HTMLElement;
  tracks: Record<Alignment, HTMLElement>;
}

// Places the shell's areas: `mount` builds them inside `root`, which the shell
// has emptied, and returns each area's element, or its `AlignedArea`. The
// shell then fills them: it puts each contribution, in sorted order, into its
// alignment's track or else straight into the area's element, sets
// `data-align` on each contribution, hides an area's element while the area
// holds no contribution (the side bar's while the shown mode shows none), and
// sets `data-side-bar` (`beside`, `over` or `hidden`) on the side bar's
// element; the layout's CSS turns these into position.
export interface ShellLayout {
  mount(root: HTMLElement): Record<AreaName, HTMLElement | AlignedArea>;
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
  // This plugin's own ui state, its keys kept apart from every other plugin's.
  uiState: UiState;
}

// A scope `keys.pushScope` laid over the set scope. `pop` removes it wherever
// it sits and throws on a second call; `onBaseChanged` listeners hear the set
// scope, qualified, each time it changes while this scope is pushed.
export interface PushedScope {
  pop(): void;
  onBaseChanged(listener: (base: ViewScope) => void): void;
}

// The page's session override of the `transparency` setting. `override` holds
// the page at `full` or `reduced` until the page loads again, applying it at
// once, and `null` hands transparency back to the setting; `overridden` is the
// override in force, null for none. A settings change under an override keeps
// the override, and nothing is written to the user's settings.
export interface PageTransparency {
  override(transparency: 'full' | 'reduced' | null): void;
  overridden(): 'full' | 'reduced' | null;
}

// `keys.setScope` sets the scope page keys fire in, under any pushed scope;
// `keys.pushScope` lays a scope over it until the `PushedScope`'s `pop`.
// `keys.scope` is the qualified scope keys fire in now, and
// `keys.onScopeChanged` hears it each time it changes. `keys.onPending` hears
// the keys of an unfinished sequence on the page or in an editor, `null` once
// none are pending; `keys.holdPending` keeps a pending page sequence past its
// timeout until it ends, and `keys.cancelPending` drops whichever sequence is
// pending, running nothing. `keys.keymap` reads the merged keymap as the user
// config now sets it, every plugin's binds qualified, and
// `keys.onKeymapChanged` hears it each time it changes, until its `dispose`;
// `keys.label` falls back to the id for a command with no label;
// `keys.command` reads a command by its qualified id; `keys.scopes` lists
// every scope as main serves them.
// `settings` reads the plugin's settings as the user config now sets them, and
// `onSettingsChanged` hears them each time they change, until its `dispose`.
// `platform` is the OS the app runs on, fixed for the page load.
// `modes.add` qualifies the mode's id by the plugin (`browse` in plugin `p`
// is `p.browse`), and `modes.shown` and `modes.onChanged` read qualified ids.
// `shell.setLayout` places the shell's areas by `layout` in place of the one
// in use, moving every contribution into it, and returns the `Disposable` that
// restores the default layout; that `dispose` does nothing once another
// `setLayout` replaced the layout.
// `transparency` is the page's one transparency override, shared by every
// plugin (see `PageTransparency`).
// `dependency` returns the exports of a plugin the manifest lists in
// `dependsOn`, typed by the caller from that plugin's contract. `Ev` is the
// plugin's own events and `Heard` the other plugins' events it hears, as
// `PluginEvents` takes them; a part that declares no `Heard` hears nothing.
// `dataUrl` is the `wigley-data:` URL of `path` in the plugin's data folder;
// a new `revision` makes the file and every relative import under it load
// fresh.
export interface PageApi<
  M extends PluginManifest,
  Ch extends ChannelShape,
  Ev extends EventShape = Record<never, never>,
  Heard extends EventShape = Record<never, never>,
> {
  areas: PluginAreas;
  channel: PageChannel<Ch>;
  events: PluginEvents<Ev, Heard>;
  keys: {
    setScope(scope: keyof M['scopes'] & string): void;
    pushScope(scope: keyof M['scopes'] & string): PushedScope;
    scope(): ViewScope;
    onScopeChanged(listener: (scope: ViewScope) => void): void;
    onPending(listener: (pending: PendingKeys | null) => void): void;
    holdPending(): void;
    cancelPending(): void;
    keymap(): Keymap;
    onKeymapChanged(listener: (keymap: Keymap) => void): Disposable;
    label(id: CommandId): string;
    command(id: CommandId): CommandInfo | undefined;
    scopes: readonly ScopeInfo[];
  };
  modes: Modes;
  shell: { setLayout(layout: ShellLayout): Disposable };
  transparency: PageTransparency;
  settings(): M['settings'];
  onSettingsChanged(listener: (settings: M['settings']) => void): Disposable;
  platform: Platform;
  commands: { run(id: CommandId, context?: PageCommandContext): void };
  services: PageServices;
  dependency<E>(pluginId: string): E;
  dataUrl(path: string, revision: number): string;
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
  // `any`: one parts list holds parts with different channels and events.
  start(api: PageApi<M, any, any, any>): PageStart<M>;
}

// `writeFile`, when set, writes `text` to `path` before the keys run, as an
// outside program changing a file on disk would; `path` is relative to the
// self-test's temp home (`MainServices.homeDir` under the self-test), and one
// that resolves outside it fails the self-test. `expect` is a line the page
// logs once the write and the keys have run; `checksFit` also checks the page
// fits the window's minimum width. `screenshot`, when set, saves a PNG of the
// window once the step's line has been waited for, as
// `<pluginId>-<screenshot>.png` in the run's screenshot folder; the name is
// lowercase letters and digits in words joined by `-`.
export interface SelfTestStep {
  writeFile?: { path: string; text: string };
  keys: string[];
  expect: string;
  checksFit?: true;
  screenshot?: string;
}

// `open` starts the fixture for run `run`, returning the line the page logs
// once it shows and the result the script checks with `problems`, which lists
// what was wrong, empty when nothing was. `scrollsItself` lists CSS selectors
// for the elements a fit check lets scroll or clip in their own box rather
// than wrap, nothing inside them checked either; empty when nothing does.
// `settings` overrides plugin settings in the config main serves the page, by
// plugin id, each holding only the settings it changes; main parts have
// already started on their defaults.
export interface SelfTestScript {
  pageBinds: PageBind[];
  settings: Record<string, object>;
  open(run: number): { shownLine: string; result: Promise<unknown> };
  steps: SelfTestStep[];
  scrollsItself: string[];
  problems(result: unknown): string[];
}

// Each plugin's part calls `run` at most once, during its `start`, and the
// script's page binds and settings join the config. The driver runs the handed
// scripts in hand-over order on each run. `run` throws on a plugin's second
// script or after the parts have started, and a self-test that got no script
// fails.
export interface SelfTestHost {
  run(script: SelfTestScript): void;
}

// How the app was started: by the user (`live`), by `npm run selftest`
// (`selfTest`), or as a drive run the agent controls (`drive`). The self-test
// and a drive run both start on a temp home, offscreen.
export type RunMode = 'live' | 'selfTest' | 'drive';

// A fixture or step a plugin offers a drive run. `description` says what it
// does and `args` the shape of the args `run` takes, both shown to the agent;
// `run` resolves to the result the agent reads.
export interface DriveAction {
  description: string;
  args: string;
  run(args: unknown): Promise<unknown>;
}

// `add` registers a drive action under `name` qualified by the plugin id, as
// commands are (`openRound` in plugin `forms` is `forms.openRound`); the
// returned `Disposable` removes it. `MainApi.drive` is null outside a drive
// run.
export interface DriveHost {
  add(name: string, action: DriveAction): Disposable;
}

// `runMode` is how the app was started. `selfTest` is the plugin's own
// self-test host, null outside the self-test.
// `files` takes absolute paths; outside a live run, `files.trash` deletes for
// good. `processes` runs the machine's programs. `agentHarnesses` lists every
// harness adapter the app runs, found by `id`. `window.chooseFolder` opens the
// native folder dialog over the window and resolves to null when the user
// cancels; `window.isFocused` is true while the app's window has focus.
// `openExternal` opens an http or https URL in the user's default app,
// and rejects with `Refused to open <url>: …` for any other scheme or a URL
// that does not parse.
export interface MainServices {
  files: Files;
  processes: ProcessRunner;
  log: Log;
  clock: Clock;
  randomHex: RandomHex;
  randomUuid: RandomUuid;
  homeDir: string;
  alerts: Alerts;
  agentHarnesses: readonly AgentHarness[];
  window: {
    show(): void;
    isFocused(): boolean;
    chooseFolder(): Promise<string | null>;
  };
  openExternal(url: string): Promise<void>;
  runMode: RunMode;
  selfTest: SelfTestHost | null;
}

// `dependency` returns the exports of a plugin the manifest lists in
// `dependsOn`, typed by the caller from that plugin's contract. `Ev` and
// `Heard` are as on `PageApi`. `data` is the files service scoped to the
// plugin's data folder: its paths are relative to that folder, and one that
// resolves outside it fails. `settings` reads the plugin's settings as the
// user config now sets them; `onSettingsChanged` hears them each time they
// change, until its `dispose`. `drive` is the plugin's own drive host, null
// outside a drive run.
export interface MainApi<
  M extends PluginManifest,
  Ch extends ChannelShape,
  Ev extends EventShape = Record<never, never>,
  Heard extends EventShape = Record<never, never>,
> {
  channel: MainChannel<Ch>;
  events: PluginEvents<Ev, Heard>;
  settings(): M['settings'];
  onSettingsChanged(listener: (settings: M['settings']) => void): Disposable;
  services: MainServices;
  dependency<E>(pluginId: string): E;
  data: Files;
  drive: DriveHost | null;
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
  // `any`: one parts list holds parts with different channels and events.
  start(api: MainApi<M, any, any, any>): MainStart<M>;
}
