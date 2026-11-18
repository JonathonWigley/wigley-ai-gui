import type { AgentHarnessRegistry } from './agent';
import type { Alerts } from './alerts';
import type { Clock, RandomHex, RandomUuid, Timers } from './ambient';
import type { AppBuild, AppInstance } from './app-instance';
import type {
  ArgOf,
  CommandArg,
  CommandArgShape,
  CommandId,
  CommandKey,
  CommandRunContext,
} from './commands';
import type { Disposable, Registrations } from './disposable';
import type { PageDrops } from './drops';
import type { EditorHost, TextEditor } from './editor';
import type { Files } from './files';
import type { FuzzyMatcher } from './fuzzy';
import type { Git } from './git';
import type { ImageEncoder } from './images';
import type {
  AnchorOptions,
  EditorRemap,
  HintWhere,
  InterceptBind,
  KeyBind,
  KeyGroups,
  Keymap,
  PageBind,
  PendingKeys,
  RuntimeBind,
  ViewScope,
} from './keymap';
import type { ListPickerService } from './list-picker';
import type { PluginLog } from './log';
import type { MarkdownRenderer } from './markdown';
import type { MarkupEditor } from './markup';
import type { FocusTarget, OuterPanes, ResizeTarget } from './panes';
import type { Paths } from './paths';
import type { Platform } from './platform';
import type { ProcessRunner } from './processes';
import type { ScreenCapture } from './screen-capture';
import type { SessionHost } from './session-host';
import type {
  JsonSlot,
  KeyedSlotKey,
  KeyedSlotReader,
  KeyedSlotWriter,
  LayoutState,
  ListSlotKey,
  ListSlotReader,
  ListSlotWriter,
  SlotKey,
  SlotReader,
  SlotWriter,
} from './state';
import type { SystemStats } from './system-stats';
import type { TokenDecl } from './theme';
import type { UiState } from './ui-state';
import type { UserConfig } from './user-config';
import type { VisualFrames } from './visual-frames';

export type ProcessName = 'page' | 'main';

// A provider's `contract.ts` exports one per process that has exports, and a
// dependent reads that view with `api.dependency(key)`; `exportsType` is never
// set.
export interface DependencyKey<
  E,
  P extends ProcessName = ProcessName,
  Id extends string = string,
> {
  readonly id: Id;
  readonly process: P;
  readonly exportsType?: E; // type only; never set
}

// A command as a manifest declares it, under its short id. `arg` is the one
// argument it takes; with none, it takes no argument.
export interface CommandDecl {
  label: string;
  group: string;
  runsIn: ProcessName;
  arg?: CommandArgShape;
}

// A command under its qualified id, `<pluginId>.<short>`, or the core's own id
// with plugin `core`. `runtime` marks one a part added while it runs.
export interface CommandInfo extends CommandDecl {
  id: CommandId;
  plugin: string;
  runtime?: true;
}

// What runs a command. A command acts and returns no result; a failure is logged
// under the plugin that owns the handler, and the run's promise resolves.
// `any`: one registry holds handlers of different arguments.
export type CommandHandler<
  Context = PageCommandContext<any> | MainCommandContext<any>,
> = (context: Context) => void | Promise<void>;

// The argument of `M`'s command `K`. `any` for a manifest type that names no
// particular command: one parts list holds parts with different arguments.
type DeclaredArg<
  M extends PluginManifest,
  K,
> = CommandDecl extends M['commands'][K & keyof M['commands']]
  ? any
  : M['commands'][K & keyof M['commands']] extends { arg: infer S }
    ? ArgOf<S>
    : undefined;

// A part's commands. `run` starts a handler in this process before it returns, or
// sends the run to the process that declares the command, and resolves once the
// handler settles; it throws at the call for an unknown id or a bad argument, and
// a run a page cannot take is logged and resolves. `register` adds a command while
// the part runs, qualified by the plugin's id, and throws when `decl.runsIn` is the
// other process or the id is taken. `intercept` wraps every run of a command in the
// process that runs its handler: the last registered is outermost, `next` runs the
// next wrap and then the handler, and a wrap that does not call `next` stops the
// run; a wrap calling `next` after its own promise settles still runs the handler,
// but `run` has resolved and `onDidRun` hears nothing; it throws for a command the
// catalog knows as the other process's. `onDidRun` hears each run that ended with
// no failure, in the process that ran the handler, once the handler has settled.
// Each handle is filed in the part's registrations.
export interface PluginCommands {
  run(id: CommandId): Promise<void>;
  run<A>(key: CommandKey<A>, arg: A): Promise<void>;
  register(
    short: string,
    decl: CommandDecl,
    handler: CommandHandler,
  ): Disposable;
  intercept(
    id: CommandId,
    wrap: (
      next: () => Promise<void>,
      context: CommandRunContext,
    ) => void | Promise<void>,
  ): Disposable;
  onDidRun(listener: (id: CommandId, arg: unknown) => void): Disposable;
}

// A scope under its qualified id, `<pluginId>.<short>`, or the core's own id
// with plugin `core`; `title` names where its keys act, as help heads them.
export interface ScopeInfo {
  id: ViewScope;
  title: string;
  plugin: string;
}

// A plugin's default keys, naming its scopes `S` and its short command ids:
// binds name commands `PageC`, run in the page; app, global and intercept keys
// name commands `MainC`, run in main. Binds, groups and remaps take the default
// keymap's shape; a remap acts in every editor and names no command or scope.
// The built-in plugins keep their keys in the default keymap and declare none;
// a plugin from outside the app brings its own here.
export interface PluginKeys<
  PageC extends string,
  MainC extends string,
  S extends string,
> {
  binds?: (Omit<KeyBind, 'scope' | 'command'> & {
    scope: S | 'any';
    command: PageC;
  })[];
  groups?: KeyGroups;
  app?: { accelerator: string; command: MainC; arg?: CommandArg }[];
  global?: { accelerator: string; command: MainC; arg?: CommandArg }[];
  intercept?: (Omit<InterceptBind, 'command'> & { command: MainC })[];
  remaps?: readonly EditorRemap[];
}

// The JSON kind a setting takes when its default cannot show it: the default
// is null, or the setting is left unset.
export type SettingKind = 'string' | 'number' | 'boolean';

// What Settings mode shows on a setting's row: a sentence-case label and a
// one-line description.
export interface SettingInfo {
  label: string;
  description: string;
}

// Every leaf of `T` as a dotted path: a member whose value, null and undefined
// aside, is a plain object recurses as `<key>.<path>`; an array, a scalar or
// null is a leaf, and so is an optional member whose value is no object.
export type SettingPath<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends readonly unknown[]
    ? K
    : NonNullable<T[K]> extends object
      ? `${K}.${SettingPath<NonNullable<T[K]>>}`
      : K;
}[keyof T & string];

// A declaration for each leaf of `T`, by its dotted path. A `T` with no leaf
// takes no declaration at all, so any key in it fails to compile.
export type SettingInfos<T> = [SettingPath<T>] extends [never]
  ? Readonly<Record<string, never>>
  : { readonly [P in SettingPath<T>]: SettingInfo };

// `scopes` holds each scope's title by its short id; `settings` holds the
// plugin's settings with their defaults; `optionalSettings` holds the kind of
// each setting whose default is null or unset, by its dotted path inside
// `settings` (an array element's fields under `<path>[]`); `settingInfo`
// declares each leaf setting's label and description by its dotted path, as
// `SettingPath` names the leaves (`definePlugin` checks the paths);
// `settingControls` binds a leaf setting, by the same dotted path, to the id of
// the control kind its row draws with; `themeTokens` declares the plugin's own
// theme tokens by their unqualified names (`origin-caused`), each with its kind
// and default; each `dependsOn` list names the plugins whose exports that
// process reads or whose events it hears there; they start before this plugin's
// part in that process; each `reads` list names the plugins whose slots that
// process reads or whose events it hears with no start order, so a disabled or
// unlisted plugin there is no problem and reads `undefined`.
export interface PluginManifest<
  C extends string = string,
  S extends string = string,
  T extends object = object,
> {
  // Lowercase letters, digits and `-`: the `wigley-data:` and `wigley-layout:`
  // URL hosts carry the id, and Chromium lowercases a URL's host.
  id: string;
  // The plugin's name as Settings' Plugins section shows it, in sentence case
  // (`Agent lines`).
  label: string;
  // One sentence on what the plugin adds for the user, as Settings' Plugins
  // section shows it.
  description: string;
  dependsOn: {
    readonly main: readonly string[];
    readonly page: readonly string[];
  };
  reads: { readonly main: readonly string[]; readonly page: readonly string[] };
  commands: Record<C, CommandDecl>;
  scopes: Readonly<Record<S, string>>;
  keys?: PluginKeys<C, C, S>;
  settings: T;
  optionalSettings?: Readonly<Record<string, SettingKind>>;
  settingInfo: Readonly<Record<string, SettingInfo>>;
  settingControls?: Readonly<Record<string, string>>;
  themeTokens: Readonly<Record<string, TokenDecl>>;
}

// The plugins whose slots `M`'s part in process `P` may read: itself, its
// `dependsOn` and `reads` there, and the core, which every part reads.
export type ReadableOwner<M extends PluginManifest, P extends ProcessName> =
  | M['id']
  | M['dependsOn'][P][number]
  | M['reads'][P][number]
  | 'core';

// One part's slots. `publish` takes a key of this plugin and process whose value is
// JSON and returns its writer; it throws `Slot "<id>" is held by a live part` while
// another writer holds the key, and at a key another plugin or process owns. The
// writer and every reader `on` are filed in the part's registrations. A slot's value
// outlives its owner's stop: the next start publishes the key again and reads the
// last value through `writer.get()`. Owners read through the writer and keep no
// second copy. A slot no owner has written reads `undefined`, or `[]` for a list.
export interface PluginState<M extends PluginManifest, P extends ProcessName> {
  publish<V>(key: SlotKey<V, P, M['id']> & JsonSlot<V>): SlotWriter<V>;
  publish<V>(
    key: KeyedSlotKey<V, P, M['id']> & JsonSlot<V>,
  ): KeyedSlotWriter<V>;
  publish<V extends { readonly id: string }>(
    key: ListSlotKey<V, P, M['id']> & JsonSlot<V>,
  ): ListSlotWriter<V>;
  read<V>(key: SlotKey<V, ProcessName, ReadableOwner<M, P>>): SlotReader<V>;
  read<V>(
    key: KeyedSlotKey<V, ProcessName, ReadableOwner<M, P>>,
  ): KeyedSlotReader<V>;
  read<V extends { readonly id: string }>(
    key: ListSlotKey<V, ProcessName, ReadableOwner<M, P>>,
  ): ListSlotReader<V>;
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

// `M`'s commands that run in process `P` under their qualified ids,
// `<pluginId>.<short>`; a union of manifests gives every one's.
export type QualifiedCommandId<
  M extends PluginManifest,
  P extends ProcessName,
> = M extends PluginManifest ? `${M['id']}.${CommandsRunIn<M, P>}` : never;

// `M`'s scopes under their qualified ids, `<pluginId>.<short>`; a union of
// manifests gives every one's.
export type QualifiedScopeId<M extends PluginManifest> =
  M extends PluginManifest ? `${M['id']}.${keyof M['scopes'] & string}` : never;

// A plugin's channel between its two parts: the methods its page part invokes
// on its main part, and the messages main sends the page with their data.
export interface ChannelShape {
  invoke: Record<string, (...args: never[]) => unknown>;
  messages: Record<string, unknown>;
}

// `invoke` rejects with main's own error text when main's handler throws.
// `on` calls `listener` with each `message` main sends, until the returned
// handle's `dispose`; a second `dispose` does nothing. Listening twice with one
// listener registers it twice, each `dispose` dropping its own registration.
export interface PageChannel<Ch extends ChannelShape> {
  invoke<K extends keyof Ch['invoke'] & string>(
    method: K,
    ...args: Parameters<Ch['invoke'][K]>
  ): Promise<Awaited<ReturnType<Ch['invoke'][K]>>>;
  on<K extends keyof Ch['messages'] & string>(
    message: K,
    listener: (data: Ch['messages'][K]) => void,
  ): Disposable;
}

// `handle` throws for a method already handled. Its `dispose` drops the
// handler, so an invoke rejects and the method can be handled again; a second
// `dispose` does nothing.
export interface MainChannel<Ch extends ChannelShape> {
  handle<K extends keyof Ch['invoke'] & string>(
    method: K,
    handler: Ch['invoke'][K],
  ): Disposable;
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
// publisher's contract), its listener typed from it, until the returned
// handle's `dispose`; a part that declares no `Heard` hears nothing. Listeners
// run before `emit` returns; a listener's throw is logged under the listening
// plugin's id and never reaches the emitter or the other listeners.
export interface PluginEvents<
  Ev extends EventShape,
  Heard extends EventShape = Record<never, never>,
> {
  emit<K extends keyof Ev & string>(event: K, data: Ev[K]): void;
  on<K extends keyof Heard & string>(
    qualifiedEvent: K,
    listener: (data: Heard[K]) => void,
  ): Disposable;
}

export type AreaName =
  | 'titleBar'
  | 'activityBar'
  | 'sideBar'
  | 'main'
  | 'rightBar'
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

// A right-bar contribution's placement, and its turn under the core's focus
// keys. `focus` makes the contribution a stop for them, in the right bar's
// drawn order: the core calls it when Alt+l leaves main's right edge and this
// is the first stop, or Alt+j/Alt+k reach it from the stop before or after.
// It sets the contribution's own key scope, draws its cursor and moves the DOM
// focus into the contribution's element. The turn ends when the DOM focus
// leaves the right bar (a click into main, on a focusable spot or not, a mode
// change), Alt+h moves back to main, a base scope change the core did not make
// runs, or the contribution is disposed; the core calls `left` each time, then
// blurs the focused element if the contribution's element still holds it. The
// core calls the shown mode's `focusMain` on Alt+h, when the DOM focus left for
// no element, when it landed on an element whose view set no base scope of its
// own, and on a disposal holding the keys. While a scope is pushed (a
// dialog, a picker, help) the DOM focus moving into its overlay leaves the turn
// running, and a disposal ends it but holds `focusMain` until no scope is
// pushed.
export interface RightBarOptions extends ContributeOptions {
  focus?(): void;
  left?(): void;
}

// The right bar beside `main`: an `Area` whose contributions take
// `RightBarOptions`.
export interface RightBarArea {
  contribute(element: HTMLElement, options?: RightBarOptions): Disposable;
}

// The areas a plugin contributes to: the title bar, the panel, the status
// bar, the right bar beside `main` (a `RightBarArea`, whose contributions may
// be stops for the core's focus keys) and the overlay. The core draws the
// activity bar and the side bar from the modes, and `main` belongs to the
// modes, filled through `modes.add`.
export type PluginAreas = Record<
  'titleBar' | 'panel' | 'statusBar' | 'overlay',
  Area
> & { rightBar: RightBarArea };

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
// `sideBarHidden` runs each time this mode's side bar hides while the mode
// shows: by `toggleSideBar`, `picked`, or the window widening with its
// overlay open, and after `shown` when the mode shows with its side bar
// hidden; the plugin moves focus out of the side bar there. A window
// narrowing hides the side bar without it. `sideBarOpenedOver` runs each time
// the side bar opens over the content while the mode shows, by
// `toggleSideBar` or after `shown`; the plugin moves focus into the side bar
// there. Neither
// runs for a hidden mode, a mode without a side bar, or a side bar already
// in that state.
// `focusSideBar` runs when the core's Alt+h leaves main's left edge while
// this mode shows with its side bar beside or over the content: it sets the
// side bar's key scope, focuses the side bar's list and draws its cursor, and
// the core then holds the side bar as the area with the keys. A mode without
// it is no stop on the left. `focusMain` runs when Alt+l leaves the side bar,
// Alt+h leaves the right bar, or the right-bar stop holding the keys is
// disposed: it gives main's last focused pane back its key scope, its resize
// and focus targets and the DOM focus, as `shown` does for that pane, so no
// box in the area left behind keeps the caret.
// `stepTab` runs when the next-tab or previous-tab key fires while this mode
// shows: it steps the mode's own tabs by `by` and returns true, or returns
// false to leave the key to the session tabs, as a mode without it does.
export interface Mode {
  id: string;
  title: string;
  icon: string;
  element: HTMLElement;
  sideBar?: HTMLElement;
  shown(): void;
  hidden(): void;
  sideBarHidden?(): void;
  sideBarOpenedOver?(): void;
  focusSideBar?(): void;
  focusMain(): void;
  stepTab?(by: 1 | -1): boolean;
}

// `show` hides the shown mode and shows this one; on the shown mode it does
// nothing. `setContext` keeps the mode's title bar context, starting null, and
// shows it while the mode shows. `toggleSideBar` flips the mode's side bar
// choice: while the window is wide it hides or shows the side bar beside the
// content, while narrow it opens or closes it over the content; each mode keeps
// its own choice, and a hidden mode's toggle applies at its next show. It
// throws `Mode "<id>" has no side bar` on a mode without one. `picked` tells
// the core the user picked something in the mode's side bar: in a narrow window
// it closes the side bar's overlay, logging `side bar hidden`, only when the
// shown mode's overlay was open; a hidden mode's overlay closes for its next
// show. Otherwise it does nothing. `sideBarShown` is true while the mode shows
// and its side bar lies beside or over the content. `dispose` takes the mode's
// element, side bar and activity item out of the window, without calling its
// `hidden`, and frees its id; a disposed shown mode gives way to the remaining
// mode whose id was first added earliest (the activity bar's order), as `show`
// would show it, and `onChanged` listeners hear its id, or `''` when no mode
// remains. Once disposed, every member does nothing, and `isShown` and
// `sideBarShown` return false.
export interface ModeHandle extends Disposable {
  show(): void;
  isShown(): boolean;
  setContext(context: ModeContext | null): void;
  toggleSideBar(): void;
  picked(): void;
  sideBarShown(): boolean;
}

// The first mode added shows and every later one is added hidden; a hidden
// mode keeps its DOM and state. `add` throws on an id already added, and calls
// the first mode's `shown`, and its side bar callback, before it returns, so
// that neither can read the handle; `onChanged` listeners then hear that mode's
// id. The registry keeps the id of the shown mode a `dispose` takes away, even
// when no mode remains; a fallback shown in its place that gives way too keeps
// the older id. An `add` of that id shows the added mode as `show` would, and
// the registry forgets the id; so does a `show` that changes the shown mode.
// So the mode shown before a plugin's stop shows again at its start, for a
// restart and for a switch-off then switch-on with no other mode picked in
// between. A mode's activity item keeps the place of its id's first add, so an
// `add` after a `dispose` puts the item back where it was. `shown` is the shown mode's id and throws
// before any `add` and once every mode is disposed. A `show`
// that changes the shown mode hides the old mode's element and side bar, calls
// the old mode's `hidden`, unhides the new mode's element and side bar, marks
// it in the activity bar, lays out its side bar, shows its context, calls its
// `shown` and then `sideBarHidden` or `sideBarOpenedOver` by its side bar's
// layout, then `onChanged` listeners hear the new id, until their `dispose`.
// `stepTab` asks the shown mode's `stepTab` and returns its answer; false with
// no mode shown or a shown mode without one.
export interface Modes {
  add(mode: Mode): ModeHandle;
  shown(): string;
  stepTab(by: 1 | -1): boolean;
  onChanged(listener: (modeId: string) => void): Disposable;
}

// What a plugin holds of the registry: a part hears the shown mode through
// `coreModeSlot`.
export type PageModes = Omit<Modes, 'onChanged'>;

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

// What an owner hands `show`. The host supplies the log, with the owner as each
// line's source, and toast, so they are not options.
export interface ShowLayoutOptions<L> {
  defaultLayout: L;
  // The bundled URL of the owner's `layouts/default/layout.css`, or null for an
  // owner with no default CSS.
  defaultStylesheet: string | null;
  // The owner's reader: the layout a user's `layout.js` module holds, or a
  // throw naming the first part it gets wrong.
  read(module: unknown, name: string): L;
  // The setting's layout name, read again on each set, each config change and
  // each `refresh()`.
  userLayout(): string;
  // The names the owner's content names beside the user's, read again on each
  // set, each config change and each `refresh()`. Left out: no names (`[]`).
  namesInUse?(): readonly string[];
  setLayouts(shown: ShownLayouts<L>): void;
}

// The layouts a page draws with, by name, `default` always included, and the
// name of the user's layout: the setting's when `layouts` holds it, else
// `default`.
export interface ShownLayouts<L> {
  layouts: ReadonlyMap<string, L>;
  user: string;
}

export interface LayoutShow {
  // Reads the setting and the names in use again, after the names in use
  // may have changed outside a config change.
  refresh(): void;
  // Stops the show hearing sets and config changes, removes its stylesheet
  // links, and calls `setLayouts` no more.
  dispose(): void;
}

// A layout part `draw` draws: `(parent, input, kit)` returning an object
// whose `element` it appended to `parent`. The kit parameter is matched as
// `never`, so this file names no kit type.
type LayoutPartShape = (
  parent: HTMLElement,
  input: never,
  kit: never,
) => { element: HTMLElement };

// The names of `L`'s parts of that shape (an optional part included).
export type LayoutPartName<L> = {
  [K in keyof L]-?: NonNullable<L[K]> extends LayoutPartShape ? K : never;
}[keyof L] &
  string;

// The input and the returned object of part `K` of `L`, read from its builder.
export type LayoutPartInput<L, K extends keyof L> =
  NonNullable<L[K]> extends (
    parent: HTMLElement,
    input: infer I,
    kit: never,
  ) => unknown
    ? I
    : never;
export type LayoutPartBuilt<L, K extends keyof L> =
  NonNullable<L[K]> extends (...args: never[]) => infer R ? R : never;

// A drawn part: the part's returned object, the name of the layout that
// drew it, and the dispose of every anchor, slot subscription and markdown
// mount its kit recorded. `dispose` does not remove `built.element`.
export interface DrawnLayoutPart<R> {
  built: R;
  layoutName: string;
  dispose(): void;
}

// `scope` is a short scope the plugin's manifest declares; the part's key
// hints show in it. Left out: no scope, so a hint shows in every scope.
export interface LayoutPartDrawOptions {
  scope?: string;
}

// The show a page part's `layouts.show` returns.
export interface PageLayoutShow<L> extends LayoutShow {
  // Draws part `part` into `parent` with the layout the show picks now (the
  // user's layout when it defines the part, else `defaultLayout`; before the
  // first `setLayouts`, `defaultLayout`) and with the plugin's base kit, its
  // key hints in `options.scope`. A user layout's part that throws is rolled
  // back, logged once as `layout <name> <part> failed: <error>`, and
  // `defaultLayout` draws in its place. The root gets `data-layout` and
  // `data-layout-owner`. Throws for a scope the manifest does not declare,
  // drawing nothing, and when `defaultLayout`'s part throws. The show's
  // `dispose` disposes every draw not yet disposed; removing a drawn element
  // stays with the caller. A `draw` after the show's `dispose` throws `Layout
  // show of "<id>" is disposed`, drawing nothing.
  draw<K extends LayoutPartName<L>>(
    part: K,
    parent: HTMLElement,
    input: LayoutPartInput<L, K>,
    options?: LayoutPartDrawOptions,
  ): DrawnLayoutPart<LayoutPartBuilt<L, K>>;
}

// `editor` is the text box a key fired in. `arg` is the command's argument.
export interface PageCommandContext<A = undefined> {
  editor?: TextEditor;
  arg: A;
}

export interface PageServices {
  editor: EditorHost;
  markdown: MarkdownRenderer;
  fuzzy: FuzzyMatcher;
  // Builds the shared list picker, wired to the plugin's scope, log and overlay.
  picker: ListPickerService;
  // The native folder dialog over the window; null when the user dismisses it.
  chooseFolder(): Promise<string | null>;
  // Opens an http or https URL in the user's default app; rejects with main's
  // `Refused to open <url>: …` for any other.
  openExternal(url: string): Promise<void>;
  markup: MarkupEditor;
  // Opens a visual's html in a sandboxed frame (`src/contracts/visual-frames.ts`).
  visualFrames: VisualFrames;
  toast(text: string, tone: ToastTone): void;
  // Logs under the plugin's id, called as `log(message)`.
  log: PluginLog;
  timers: Timers;
  // Epoch milliseconds, for times drawn relative to now.
  clock: Clock;
  // Full paths by the rules of the OS the served config names.
  paths: Paths;
  // The home folder the served config names, which `paths.tilde` shows as `~`.
  homeDir: string;
  // How the app was started, as the served config names it.
  runMode: RunMode;
  // This plugin's own ui state, its keys kept apart from every other plugin's.
  uiState: UiState;
}

// A scope `keys.pushScope` laid over the set scope. `pop` removes it wherever
// it sits and throws on a second call; `dispose` pops it when it is still
// pushed and otherwise does nothing. `onBaseChanged` listeners hear the set
// scope, qualified, each time it changes while this scope is pushed, until
// their `dispose`.
export interface PushedScope extends Disposable {
  pop(): void;
  onBaseChanged(listener: (base: ViewScope) => void): Disposable;
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

// What a view needs to show keys. `keysFor` reads the keys that run the
// qualified `command`, as the user reads them: the first such bind in the merged
// keymap firing in the qualified `scope` (an `any` bind included), or in any scope
// when `scope` is left out, on the page or, for `where` `box`, inside a text box;
// null when none is bound. With `arg`, only a bind carrying that argument counts.
// `anchor` draws the keys of `command` into `element`, which the view places and
// leaves empty, and keeps them drawn and shown or hidden by scope until its
// `dispose`. `onKeymapChanged` hears each change to the merged keymap, after which
// `keysFor` reads the new keys, until its `dispose`. PageApi['keys'] extends it.
export interface KeyHints {
  keysFor(
    command: CommandId,
    scope?: ViewScope,
    where?: HintWhere,
    arg?: CommandArg,
  ): string | null;
  anchor(
    element: HTMLElement,
    command: CommandId,
    options?: AnchorOptions,
  ): Disposable;
  onKeymapChanged(listener: (keymap: Keymap) => void): Disposable;
}

// The restores of a restore window: what the parts put back from their place
// slots. Restores belong to a restore window, which a page load or a live
// start opens; a live start during an open window joins it. A part hands
// `track` each restore that settles after its `start` returns (a doc reopened
// through main), and a restore started inside a tracked one is tracked before
// that one settles. A window has settled once every part its opener started
// ran `ready()` and none of its tracked restores is pending: a restore nobody
// tracked is not waited on, nor one tracked while no window is open (the last
// one settled and no live start opened another). A restore of a settled window
// that settles later changes nothing in a newer one. A tracked restore can wait
// on main: docs' restored open waits on its view's index read, and on a rebuild
// when that index does not list the doc, so the restores can settle seconds
// after every part's `ready()` ran. A restore main never answers, or one no
// later step ever ends, is waited on only until a time cap after that, when
// the restores settle with the count still pending logged. Until they settle,
// a part cannot tell a restore's key base change from the user's: the user's
// moves before then leave notes' restored popup open. `onSettled` calls its
// listener once the open window settles, or at once with no window open,
// until its `dispose`. A part that prunes the saved places of rows main does
// not hold prunes from `onSettled` in its `start`, so the rows a restore
// reopens are in the page mirror first. A part's stop stops waiting on the
// restores it left pending.
export interface PageRestores {
  track(restore: Promise<unknown>): void;
  onSettled(listener: () => void): Disposable;
}

// `keys.setScope` sets the scope page keys fire in, under any pushed scope;
// `keys.pushScope` lays a scope over it until the `PushedScope`'s `pop`.
// `keys.scope` is the qualified scope keys fire in now, and a part hears each
// change of it through `coreScopeSlot`.
// `keys.bind` adds a bind under the user's `keymap.json` while the part runs, its
// scope and command qualified; a later re-serve puts it in force, and the user's
// bind on those keys wins. It throws when the command is not known yet or runs in
// main, the argument is bad, the keys cannot expand, or the keys clash with another
// runtime bind; the handle is filed in the part's registrations.
// `keys.onPending` hears the keys of an unfinished sequence on the page or in
// an editor, `null` once none are pending, until its `dispose`;
// `keys.holdPending` keeps a pending page sequence past its
// timeout until it ends, and `keys.cancelPending` drops whichever sequence is
// pending, running nothing. `keys.captureKey` hands the next key or chord
// pressed to `onKey` in the keymap's vim notation, as a bind's `keys` is written
// (`T`, `<C-t>`, `<A-S-o>`, `<CR>`), ahead of every bind, a pending sequence
// (it cancels one first) and a text box; Esc runs `onCancel` and is never
// captured; a bare modifier, a key no bind can name and an auto-repeat keydown
// are waited past. Arming a second capture cancels the first, the last armed
// staying armed, and the handle's `dispose` disarms with no callback; the
// handle is filed in the part's registrations. Keys main takes first (app menu
// accelerators, intercept and global binds) never reach it.
// `keys.keymap` reads the merged keymap as the user
// config now sets it, every plugin's binds qualified, and
// `keys.onKeymapChanged` hears it each time it changes, until its `dispose`;
// `keys.label` falls back to the id for a command with no label;
// `keys.command` reads a command by its qualified id, from the freshest catalog
// the page has, so a command a part registered counts before main serves it
// again; `keys.scopes` lists
// every scope as main serves them. `keysFor`, `anchor` and `onKeymapChanged` are as
// `KeyHints` says, each handle filed in the part's registrations.
// `keys.where` reads whether focus is in a text box now, and `keys.onWhereChanged`
// hears it move between the page and a box, until its `dispose`.
// `keys.setHintsShown` hides or shows every anchored hint. The latest handle's
// `dispose` shows them again, and an older handle's `dispose` does nothing, so
// a new call then the old handle's `dispose` keeps the new value.
// `keys.placedIn` is the placement check's source: the command targets anchored in
// `scope` or with no scope during this page load.
// `settings` reads the plugin's settings as the user config now sets them, and
// `onSettingsChanged` hears them each time they change, until its `dispose`.
// `platform` is the record of the OS the app runs on, fixed for the page load.
// `modes.add` qualifies the mode's id by the plugin (`browse` in plugin `p`
// is `p.browse`), and `modes.shown` and `coreModeSlot` read qualified ids.
// `shell.setLayout` places the shell's areas by `layout` in place of the one
// in use, moving every contribution into it, and returns the `Disposable` that
// restores the default layout; that `dispose` does nothing once another
// `setLayout` replaced the layout.
// `transparency` is the page's one transparency override, shared by every
// plugin (see `PageTransparency`); stopping the plugin clears the override only
// while it still holds the value this plugin last set.
// `panes.setResizeTarget` hands the core the divider its resize commands move
// and `panes.setFocusTarget` the view's own panes its focus commands move
// between, null for none; a view calls both after each `keys.setScope`, since
// every change of the set scope drops both targets and a pushed scope keeps
// them. A resize asks the view's target, then the outer panes', then the side
// bar, stopping at the first that returns true; a focus asks the view's
// target, then the outer panes', and does neither while a scope is pushed,
// since a move would dismiss it. `panes.setOuterPanes` hands over the panes
// around the view, kept across scope changes until their owner sets null.
// Stopping the plugin clears each of the three only while it still holds what
// this plugin last set.
// `drops.addTarget` registers an element and what takes the files dropped or
// pasted on it, returning the `Disposable` that removes it; `drops.savePasted`
// saves a file with no path and returns its path.
// `restores` is the restores of the page's restore windows, as `PageRestores`
// says; its
// `onSettled` handles are filed in the part's registrations.
// `dependency` takes the page key from a provider's contract, for a plugin the
// manifest lists in `dependsOn.page`, and returns this part's view of that
// plugin's exports. `Ev` is the
// plugin's own events and `Heard` the other plugins' events it hears, as
// `PluginEvents` takes them; a part that declares no `Heard` hears nothing.
// `dataUrl` is the `wigley-data:` URL of `path` in the plugin's data folder;
// a new `revision` makes the file and every relative import under it load
// fresh. `layouts.show` shows the plugin's own layouts, loading each set main
// announces for the plugin and handing `options.setLayouts` the result, and
// refreshes the show on each change of the plugin's settings until the
// show's `dispose`; the show's `draw` draws a part of those layouts with the
// plugin's base kit, so a user `page.js` draws through its layout kit. `state` is as `PluginState` says, and `state.forLayouts` reads
// any slot by its id, for a layout's kit.
export interface PageApi<
  M extends PluginManifest,
  Ch extends ChannelShape,
  Ev extends EventShape = Record<never, never>,
  Heard extends EventShape = Record<never, never>,
> {
  areas: PluginAreas;
  channel: PageChannel<Ch>;
  events: PluginEvents<Ev, Heard>;
  keys: KeyHints & {
    setScope(scope: keyof M['scopes'] & string): void;
    pushScope(scope: keyof M['scopes'] & string): PushedScope;
    scope(): ViewScope;
    onPending(listener: (pending: PendingKeys | null) => void): Disposable;
    holdPending(): void;
    cancelPending(): void;
    captureKey(onKey: (keys: string) => void, onCancel: () => void): Disposable;
    keymap(): Keymap;
    label(id: CommandId): string;
    command(id: CommandId): CommandInfo | undefined;
    scopes: readonly ScopeInfo[];
    bind(bind: RuntimeBind<'page'>): Disposable;
    where(): HintWhere;
    onWhereChanged(listener: (where: HintWhere) => void): Disposable;
    setHintsShown(shown: boolean): Disposable;
    placedIn(scope: ViewScope): ReadonlySet<string>;
  };
  modes: PageModes;
  shell: { setLayout(layout: ShellLayout): Disposable };
  transparency: PageTransparency;
  panes: {
    setResizeTarget(target: ResizeTarget | null): void;
    setFocusTarget(target: FocusTarget | null): void;
    setOuterPanes(panes: OuterPanes | null): void;
  };
  drops: PageDrops;
  restores: PageRestores;
  settings(): M['settings'];
  onSettingsChanged(listener: (settings: M['settings']) => void): Disposable;
  platform: Platform;
  commands: PluginCommands;
  services: PageServices;
  dependency<E, Id extends M['dependsOn']['page'][number]>(
    key: DependencyKey<E, 'page', Id>,
  ): E;
  dataUrl(path: string, revision: number): string;
  layouts: { show<L>(options: ShowLayoutOptions<L>): PageLayoutShow<L> };
  state: PluginState<M, 'page'> & { forLayouts: LayoutState };
}

export interface PageStart<M extends PluginManifest> {
  commands: {
    [K in CommandsRunIn<M, 'page'>]: CommandHandler<
      PageCommandContext<DeclaredArg<M, K>>
    >;
  };
  // Called once for each dependent, with that dependent's registrations; returns
  // that dependent's view.
  exports?(consumer: Registrations): unknown;
  // Runs when the host stops the part.
  dispose?(): void | Promise<void>;
  // Called by the host once every part of this process has started at launch
  // (main) or page load (page), and after a live start, once every part that
  // start brought up has started.
  ready?(): void;
  // A reason the part must not stop now, in words the user reads (a round is
  // open in <session>), or null. The switch asks it before a switch-off; a
  // restart and quit do not ask.
  mayStop?(): string | null;
}

// Starts on every page load, and again when the host starts or restarts it
// live.
export interface PagePart<M extends PluginManifest = PluginManifest> {
  manifest: M;
  // `any`: one parts list holds parts with different channels and events.
  start(api: PageApi<M, any, any, any>): PageStart<M>;
}

// `writeFile`, when set, writes `text` to `path` before the keys run, as an
// outside program changing a file on disk would; `path` is relative to the
// self-test's temp home (`MainServices.homeDir` under the self-test), and one
// that resolves outside it fails the self-test. `remove`, when set, removes
// the file or folder at `path` (relative to the self-test's temp home, as
// `writeFile`'s path is) after the write and before the keys, as an outside
// program deleting it would; one that resolves outside the home fails the
// self-test. `expect` is a line the page logs once the write, the removal and
// the keys have run, and `alsoExpect`, when set, holds
// patterns that each match a line logged after the step began, before or
// after `expect`, for a line carrying a value the script cannot know, such as
// a random id, or a second line the step's keys cause, in either order; a
// repeating step takes none. `checksFit` also checks the page
// fits the window's minimum width, or, as `'held'`, the width the step holds,
// for what shows only while the window is wide (a side bar beside the view).
// `screenshot`, when set, saves a PNG of the window once the step's line has
// been waited for, as `<pluginId>-<screenshot>.png` in the run's screenshot
// folder; the name is lowercase letters and digits in words joined by `-`.
// `why`, when set, says what the step proves, and a failed step prints it after
// its group's. `width`, when set, sets the window's content width before the
// write and the keys, `'start'` meaning the width the self-test started on, and
// holds it, the fit check returning to it, until a later step sets another or
// the script ends, which restores the start width; a number is a positive
// integer. `repeat`, when set, presses the keys again after each `expect` line
// until the `until` line is logged, failing when `max` presses (the first
// included, at least 2) have not reached it; its `screenshot` saves one PNG per
// press, as `<pluginId>-<screenshot>-<n>.png`. `timeoutMs`, when set, is how
// long the step waits for each of its lines in place of the run's step wait, for
// slow work such as a compile; a positive integer.
export interface SelfTestStep {
  writeFile?: { path: string; text: string };
  remove?: string;
  keys: string[];
  expect: string;
  alsoExpect?: RegExp[];
  checksFit?: true | 'held';
  screenshot?: string;
  why?: string;
  width?: number | 'start';
  repeat?: { until: string; max: number };
  timeoutMs?: number;
}

// A script's steps under one name. `name` is short words naming what the group
// covers, unique within its script, and the report prints it before the
// group's steps; `why` says what the group proves, printed under each of its
// failed steps.
export interface SelfTestGroup {
  name: string;
  why: string;
  steps: SelfTestStep[];
}

// `open` starts the fixture for run `run`, returning the line the page logs
// once it shows and the result the script checks with `problems`, which lists
// what was wrong, empty when nothing was. `alsoShown`, when set, holds
// patterns that each match a line logged after `open` began, before or after
// the shown line, for another line the opening itself causes: one logged
// before the first step began would never reach that step's `alsoExpect`.
// `scrollsItself` lists CSS selectors for the elements a fit check lets
// scroll or clip in their own box rather than wrap, nothing inside them
// checked either; empty when nothing does.
// `settings` overrides plugin settings in the config main serves the page, by
// plugin id, each holding only the settings it changes; main parts have
// already started on their defaults.
export interface SelfTestScript {
  pageBinds: PageBind[];
  settings: Record<string, object>;
  open(run: number): {
    shownLine: string;
    alsoShown?: RegExp[];
    result: Promise<unknown>;
  };
  groups: SelfTestGroup[];
  scrollsItself: string[];
  problems(result: unknown): string[];
}

// Each plugin's part calls `run` at most once, during its `start`, and the
// script's page binds and settings join the config. The driver runs the handed
// scripts in hand-over order, each cut after its last kept group on a filtered
// run. `run` throws on a plugin's second script or after the parts have
// started, and a self-test that got no script fails.
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
// self-test host, null outside the self-test. `log` logs under the plugin's
// id, called as `log(message)`.
// `timers` runs one-shot timers, the `Timers` seam the page shares, and caps a
// delay at the longest a timer takes.
// `files` takes absolute paths; outside a live run, `files.trash` deletes for
// good. `paths` handles full paths by the rules of the OS main runs on, and
// `platform` is the record of that OS, picked by the composition root.
// `processes` runs the machine's programs; `git` is the one way a plugin runs
// `git`, and stopping the plugin leaves a `git` run to finish. `alerts` gets
// the user's attention, and stopping the plugin zeroes the open counts it set.
// Stopping the plugin also clears its pending `timers`, disposes its live
// `files` watches and stops its running `processes`, each of which then rejects
// with `Stopped <command>`, and kills its spawned ones with `SIGKILL`.
// `agentHarnesses` is the harness registry: a harness
// plugin registers its adapter there, and stopping the plugin disposes its
// registrations. `agentEnvironment` is the whole environment an agent process
// the app starts gets: the app's own plus the relay's endpoint folder as
// `WIGLEY_AI_GUI_ENDPOINT_DIR`. `agentHomeDir` is the home folder an agent
// harness runs as: the user's real home in a drive run on a real harness,
// `homeDir` in every other run. `window.summon` brings the app
// forward from behind another app and returns whether the window came forward.
// `window.chooseFolder` opens the native folder dialog over the window and
// resolves to null when the user cancels; `window.isFocused` is true while the app's window has focus;
// `window.capture` resolves to a PNG of the window's content as the user sees
// it, at the display's device pixels, and rejects when the capture is empty.
// `openExternal` opens an http or https URL in the user's default app,
// and rejects with `Refused to open <url>: …` for any other scheme or a URL
// that does not parse. `tempFolders` are the OS's temporary folders as real
// paths, none in the self-test; a folder inside one is scratch space.
// `userConfig` reads and writes the user's `settings.json` and `keymap.json`
// layers through the ConfigStore's checks. `appInstance` names which app runs,
// the stable or the dev one. `appBuild` is the commit and clone the installed
// app was packaged from; null in the dev app, when the clone folder is
// missing, and outside a live run. `images` re-encodes an image smaller, as PNG or
// JPEG only, for `shrinkToFit`. `systemStats` reads the machine's CPU, GPU,
// memory, network and disk counters. `screenCapture` lists the windows the OS
// can stream, each with its owner's pid and bounds, and opens the OS's screen
// capture settings. `sessionHost` owns every agent process, so a
// process outlives the app (`docs/features/session-host/design.md`).
// `pluginSwitch` tells whether a plugin may switch off now.
export interface MainServices {
  files: Files;
  processes: ProcessRunner;
  git: Git;
  log: PluginLog;
  clock: Clock;
  timers: Timers;
  randomHex: RandomHex;
  randomUuid: RandomUuid;
  homeDir: string;
  tempFolders: readonly string[];
  userConfig: UserConfig;
  paths: Paths;
  platform: Platform;
  alerts: Alerts;
  images: ImageEncoder;
  systemStats: SystemStats;
  screenCapture: ScreenCapture;
  agentHarnesses: AgentHarnessRegistry;
  agentEnvironment: Readonly<Record<string, string>>;
  agentHomeDir: string;
  sessionHost: SessionHost;
  window: {
    show(): void;
    summon(): boolean;
    isFocused(): boolean;
    chooseFolder(): Promise<string | null>;
    capture(): Promise<Uint8Array>; // PNG of the window's content, as shown
  };
  openExternal(url: string): Promise<void>;
  runMode: RunMode;
  appInstance: AppInstance;
  appBuild: AppBuild | null;
  selfTest: SelfTestHost | null;
  pluginSwitch: PluginSwitchService;
}

// The part of main's plugin switch a main part reaches: the reason turning
// `pluginId` off would be refused now, or null.
export interface PluginSwitchService {
  mayDisable(pluginId: string): Promise<string | null>;
}

// `dependency` takes the main key from a provider's contract, for a plugin the
// manifest lists in `dependsOn.main`, and returns this part's view of that
// plugin's exports. `Ev` and
// `Heard` are as on `PageApi`. `data` is the files service scoped to the
// plugin's data folder: its paths are `/`-separated and relative to that
// folder on every OS, and one that resolves outside it fails. `dataFolder` is
// that folder's full path, for a program the plugin starts that writes there.
// `settings` reads the plugin's settings as the user config now sets them;
// `onSettingsChanged` hears them each time they change, until its `dispose`.
// `drive` is the plugin's own drive host, null outside a drive run.
// `services.log` logs under the plugin's id, called as `log(message)`.
// `layouts.register` writes the plugin's layout contract `layoutTypes` to its
// layouts folder and watches that folder, and the plugin's default folder:
// `layouts/default` in a user plugin's own folder, else
// `src/plugins/<id>/layouts/default` in the repo clone, until the returned
// `Disposable`'s `dispose`; it throws for a second registration.
// `layouts.names` lists the plugin's layouts, `default` first; only `default`
// before the folder has been listed or while unregistered. `state` is as
// `PluginState` says. `commands` is as `PluginCommands` says. `keys.bind` adds an
// app or intercept bind while the part runs, as `PageApi.keys.bind` does a page one.
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
  dependency<E, Id extends M['dependsOn']['main'][number]>(
    key: DependencyKey<E, 'main', Id>,
  ): E;
  data: Files;
  dataFolder: string;
  drive: DriveHost | null;
  layouts: {
    register(options: { layoutTypes: string }): Disposable;
    names(): string[];
  };
  state: PluginState<M, 'main'>;
  commands: PluginCommands;
  keys: { bind(bind: RuntimeBind<'main'>): Disposable };
}

// `chord` is the chord that fired the command; a run from code or the page has
// none. `arg` is the command's argument.
export interface MainCommandContext<A = undefined> {
  chord?: string;
  arg: A;
}

export interface MainStart<M extends PluginManifest> {
  commands: {
    [K in CommandsRunIn<M, 'main'>]: CommandHandler<
      MainCommandContext<DeclaredArg<M, K>>
    >;
  };
  // Called once for each dependent, with that dependent's registrations; returns
  // that dependent's view.
  exports?(consumer: Registrations): unknown;
  // Runs when the host stops the part, before the host disposes the part's
  // registrations, and undoes only what the plugin API cannot see. `stop` says
  // whether the part starts again right after (`PartStop`). Quit stops every
  // main part, and the live app may exit before a returned promise settles.
  dispose?(stop: PartStop): void | Promise<void>;
  // Called by the host once every part of this process has started at launch
  // (main) or page load (page), and after a live start, once every part that
  // start brought up has started.
  ready?(): void;
  // A reason the part must not stop now, in words the user reads (a round is
  // open in <session>), or null. The switch asks it before a switch-off; a
  // restart and quit do not ask.
  mayStop?(): string | null;
}

// How the host stops a part: `restart` when it starts the part again right
// after, as a restart or a reload of the plugin, or of a plugin it depends on,
// does (that start may still fail); `end` for a switch-off and a removal;
// `quit` for the app's quit, which stops every part.
export type PartStop = 'restart' | 'end' | 'quit';

// Starts at launch, and again when the host starts or restarts it live.
export interface MainPart<M extends PluginManifest = PluginManifest> {
  manifest: M;
  // `any`: one parts list holds parts with different channels and events.
  start(api: MainApi<M, any, any, any>): MainStart<M>;
}
