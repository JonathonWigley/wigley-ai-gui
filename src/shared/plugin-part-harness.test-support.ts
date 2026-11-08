import { vi } from 'vitest';
import type { Timers } from '../contracts/ambient';
import type { Alerts } from '../contracts/alerts';
import type { AppInstance } from '../contracts/app-instance';
import type { CommandId } from '../contracts/commands';
import {
  coreModeSlot,
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
  type RuntimeCatalog,
} from '../contracts/core-state';
import type { Disposable, Registrations } from '../contracts/disposable';
import type { EditorHost } from '../contracts/editor';
import type { Files } from '../contracts/files';
import type { FuzzyMatcher } from '../contracts/fuzzy';
import type { ListPickerService } from '../contracts/list-picker';
import type { Git } from '../contracts/git';
import type { ImageEncoder } from '../contracts/images';
import type { AnchorOptions, HintWhere, Keymap } from '../contracts/keymap';
import type {
  FenceContribution,
  MarkdownRenderer,
} from '../contracts/markdown';
import type { Log } from '../contracts/log';
import type { MarkupEditor } from '../contracts/markup';
import type {
  AreaName,
  ChannelShape,
  CommandInfo,
  DependencyKey,
  DriveHost,
  LayoutShow,
  MainApi,
  MainPart,
  MainServices,
  MainStart,
  Mode,
  ModeHandle,
  PageApi,
  PageModes,
  PagePart,
  PageServices,
  PageStart,
  PluginManifest,
  PluginState,
  ProcessName,
  PushedScope,
  ShownLayouts,
  UntypedEvents,
} from '../contracts/plugin';
import type { SessionHost } from '../contracts/session-host';
import type { SlotKey, SlotWriter } from '../contracts/state';
import type { UserConfig } from '../contracts/user-config';
import type { VisualFrames } from '../contracts/visual-frames';
import { CommandRegistry } from './command-registry';
import { dataUrl } from './data-url';
import { createEventBus, type EventBus, pluginEvents } from './event-bus';
import { gateExternalLinks } from './external-links';
import { FakeProcesses } from './fake-processes';
import { fakeDriveHost } from './fake-drive-host';
import { createListeners, type Listeners } from './listeners';
import { createMemoryFiles, type MemoryFiles } from './memory-files';
import { posixPaths } from './paths/posix-paths';
import { fakePlatform } from './platform.test-support';
import { commandTarget } from './command-args';
import { keysFor } from './keys-for';
import { type PartContext, type PluginHost, startPlugins } from './plugin-host';
import { pluginLog } from './plugin-log';
import { createLatestHold } from './latest-hold';
import {
  commandInfos,
  qualify,
  requireDeclaredScope,
} from './plugin-manifests';
import {
  abortableProcesses,
  trackedAlerts,
  trackedEditor,
  trackedFiles,
  trackedMarkdown,
  trackedUserConfig,
} from './plugin-service-views';
import {
  createRuntimeCommands,
  type RuntimeCommands,
} from './runtime-commands';
import { scopedFiles } from './scoped-files';
import {
  createSlotStore,
  layoutState,
  pluginState,
  type SlotStore,
} from './state/slot-store';
import { trackedTimers } from './tracked-timers';

// A provider the part under test depends on, faked: `exports` gets a consumer
// that counts each handle it tracks.
export interface FakeDependency<P extends ProcessName> {
  readonly key: DependencyKey<unknown, P>;
  exports(consumer: Registrations): unknown;
}

export function fakeDependency<E, P extends ProcessName>(
  key: DependencyKey<E, P>,
  exports: (consumer: Registrations) => E,
): FakeDependency<P> {
  return { key, exports };
}

// What the part under test holds live. `listeners`, `observers` and `frames`
// are page globals, so a real provider part's count there too. After `stop()`,
// `registrations` and `timers` cannot fail, as the host disposes the store that
// holds them: they are only meaningful mid-life.
export interface PartCounts {
  registrations: number;
  timers: number;
  listeners: number;
  observers: number;
  frames: number;
}

export const noCounts: Readonly<PartCounts> = {
  registrations: 0,
  timers: 0,
  listeners: 0,
  observers: 0,
  frames: 0,
};

export interface HarnessCommandRun {
  id: CommandId;
  arg: unknown;
}

// `started` throws while the part is stopped. `restart` stops a started part and
// starts it again on a new host with the same fakes and the same counts, so what
// a leaky `dispose` left stays counted. `advance` runs the due timers in due
// order, the clock reading each one's due time, and ends `ms` later. `emitted`
// holds what any started part emitted, in order, under its qualified name; it
// outlives the stop, so a test reads there what a late read emitted. `state` is
// the store every part of the harness shares, across stops and restarts. A test
// writes a slot through `state.publish(key).set(value)`: that claim is held until
// the writer's `dispose` and `counts` does not hold it, so a test publishes each
// key once and disposes the writer of a key the part under test publishes before
// that part starts. `commandRuns` holds each run sent to the other process, in
// order, under its qualified id.
export interface PartHarness<Started> {
  started(): Started;
  counts(): PartCounts;
  advance(ms: number): void;
  emit(qualifiedEvent: string, data: unknown): void;
  readonly logs: readonly { source: string; message: string }[];
  readonly emitted: readonly HarnessEvent[];
  readonly state: SlotStore;
  readonly commandRuns: readonly HarnessCommandRun[];
  stop(): Promise<void>;
  restart(): Promise<void>;
}

// `invoke` calls the live handler of the part under test and throws when none
// is live; `sent` holds what that part sent.
export interface MainPartHarness<M extends PluginManifest> extends PartHarness<
  MainStart<M>
> {
  readonly files: MemoryFiles;
  readonly processes: FakeProcesses;
  readonly drive: ReturnType<typeof fakeDriveHost> | null;
  invoke(method: string, ...args: unknown[]): unknown;
  readonly sent: readonly { message: string; data: unknown }[];
}

export interface HarnessAnchor {
  element: HTMLElement;
  command: CommandId;
  options: AnchorOptions;
}

// `send` tells the channel listeners of the part under test. `fireWindow` calls
// each live `window` listener of `type` in added order, with `{ type }` when
// `event` is left out. `fences` holds the fences live through the default
// `services.markdown`. `anchors` holds each anchor named through the fake
// `keys.anchor`, disposed ones included; `setWhere` moves the fake box focus and
// tells `keys.onWhereChanged`; `hintsShown` reads what `keys.setHintsShown` left.
// `picked` holds the qualified id of each mode whose handle's `picked` ran, in
// order.
// `pushSettings` replaces what `settings()` reads for the part under test and tells
// its `onSettingsChanged` listeners. The fake `modes` writes `coreModeSlot` on each
// change of the shown mode, unless a test holds that slot's claim.
export interface PagePartHarness<M extends PluginManifest> extends PartHarness<
  PageStart<M>
> {
  send(message: string, data: unknown): void;
  fireWindow(type: string, event?: unknown): void;
  showLayouts(shown: ShownLayouts<unknown>): void;
  pushKeymap(keymap: Keymap): void;
  pushSettings(settings: M['settings']): void;
  readonly fences: readonly FenceContribution[];
  readonly anchors: readonly HarnessAnchor[];
  readonly picked: readonly string[];
  setWhere(where: HintWhere): void;
  hintsShown(): boolean;
}

// `services` replaces the named default services, and a replaced service counts
// nothing. A replaced `files`, `processes`, `alerts` or `userConfig` still runs
// through its per-plugin view, as `createMainApi` does. `parts` holds real
// providers, started before the part in listed order and stopped after it.
// `state` replaces the harness's own slot store, to seed a slot before the start.
export interface MainPartHarnessOptions<M extends PluginManifest> {
  dependencies?: readonly FakeDependency<'main'>[];
  settings?: M['settings'];
  services?: Partial<Omit<MainServices, 'timers' | 'log'>>;
  drive?: boolean;
  parts?: readonly MainPart[];
  state?: SlotStore;
}

// `invoke` answers the `channel.invoke` of the part under test, which otherwise
// never settles. A replaced `editor` or `markdown` still runs through its
// per-plugin view, as `createPageApi` does. `firstModeTaken` holds the first mode
// the app's own first part would add, so no mode the part adds shows as it is
// added. `parts` and `state` are as on main.
export interface PagePartHarnessOptions<M extends PluginManifest> {
  // Runs at each fake anchor's `dispose`, to make one throw.
  anchorDispose?(): void;
  dependencies?: readonly FakeDependency<'page'>[];
  settings?: M['settings'];
  services?: Partial<Omit<PageServices, 'timers' | 'log'>>;
  invoke?(method: string, ...args: unknown[]): Promise<unknown>;
  firstModeTaken?: boolean;
  parts?: readonly PagePart[];
  state?: SlotStore;
}

export interface HarnessEvent {
  event: string;
  data: unknown;
}

interface HarnessLogLine {
  source: string;
  message: string;
}

// What every part of one harness shares, across restarts.
interface HarnessWorld {
  scheduler: Scheduler;
  bus: EventBus;
  logs: HarnessLogLine[];
  emitted: HarnessEvent[];
  state: SlotStore;
  commandRuns: HarnessCommandRun[];
  commands: RuntimeCommands<any>;
}

interface Scheduler {
  now(): number;
  set(run: () => void, ms: number): number;
  // False for a handle already run or cleared.
  clear(handle: number): boolean;
  advance(ms: number): void;
}

// What a host holds for each part it starts.
interface HostedStart {
  commands: object;
  exports?(consumer: Registrations): unknown;
  dispose?(): void | Promise<void>;
}

interface HostedPart {
  manifest: PluginManifest;
  begin(context: PartContext): HostedStart;
}

interface PartLifecycle<Started> {
  start(): void;
  started(): Started;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

// The members both fake APIs build the same way, for one part.
interface CommonApi {
  register<T extends Disposable>(handle: T): T;
  liveHandle(): Disposable;
  events: MainApi<
    PluginManifest,
    ChannelShape,
    UntypedEvents,
    UntypedEvents
  >['events'];
  settings(): object;
  onSettingsChanged(): Disposable;
  dependency(key: DependencyKey<unknown>): unknown;
  log: MainServices['log'];
  timers: Timers;
  clock: { now(): number };
  state: PluginState<PluginManifest, ProcessName>;
}

function zeroCounts(): PartCounts {
  return { ...noCounts };
}

// Counts `handle` until its first `dispose`, from whichever caller.
function countedHandle<T extends Disposable>(handle: T, counts: PartCounts): T {
  const ownDispose = handle.dispose;
  let isLive = true;
  counts.registrations += 1;
  handle.dispose = () => {
    if (isLive) {
      isLive = false;
      counts.registrations -= 1;
      ownDispose.call(handle);
    }
  };
  return handle;
}

function countingConsumer(
  consumer: Registrations,
  counts: PartCounts,
): Registrations {
  return { track: (handle) => consumer.track(countedHandle(handle, counts)) };
}

function createScheduler(): Scheduler {
  const pending = new Map<number, { dueAt: number; run: () => void }>();
  let now = 0;
  let lastHandle = 0;
  const nextDueBy = (end: number) => {
    let next: { handle: number; dueAt: number; run: () => void } | undefined;
    for (const [handle, timer] of pending) {
      const isDue = timer.dueAt <= end;
      if (isDue && (next === undefined || timer.dueAt < next.dueAt)) {
        next = { handle, ...timer };
      }
    }
    return next;
  };
  return {
    now: () => now,
    set(run, ms) {
      lastHandle += 1;
      pending.set(lastHandle, { dueAt: now + ms, run });
      return lastHandle;
    },
    clear: (handle) => pending.delete(handle),
    advance(ms) {
      const end = now + ms;
      let next = nextDueBy(end);
      while (next !== undefined) {
        now = next.dueAt;
        pending.delete(next.handle);
        next.run();
        next = nextDueBy(end);
      }
      now = end;
    },
  };
}

function countingTimers(scheduler: Scheduler, counts: PartCounts): Timers {
  return {
    set(run, ms) {
      counts.timers += 1;
      return scheduler.set(() => {
        counts.timers -= 1;
        run();
      }, ms);
    },
    clear(handle) {
      if (scheduler.clear(handle)) {
        counts.timers -= 1;
      }
    },
  };
}

// Takes the catalog slot's claim at its first write, so a test that publishes a slot
// or shares a store with another harness meets no clash until a part writes.
function lazyCatalogWriter(
  store: SlotStore,
  key: SlotKey<RuntimeCatalog>,
): SlotWriter<RuntimeCatalog> {
  let writer: SlotWriter<RuntimeCatalog> | null = null;
  const reader = store.read(key, 'core');
  return {
    get: () => reader.get(),
    set(value) {
      writer ??= store.publish(key);
      writer.set(value);
    },
    dispose() {
      writer?.dispose();
    },
  };
}

// What every part of the harness runs commands on: a real registry and router over
// the commands `manifests` declare and the catalog slots. A run sent to the other
// process joins `commandRuns`.
function createWorld(
  state: SlotStore | undefined,
  process: ProcessName,
  manifests: readonly PluginManifest[],
): HarnessWorld {
  const logs: HarnessLogLine[] = [];
  const log: Log = (source, message) => {
    logs.push({ source, message });
  };
  const store = state ?? createSlotStore(log);
  const commandRuns: HarnessCommandRun[] = [];
  const registry = new CommandRegistry<any>(log);
  const declared = commandInfos({}, manifests);
  const [ownKey, otherKey] =
    process === 'main'
      ? [coreRuntimeMainSlot, coreRuntimePageSlot]
      : [coreRuntimePageSlot, coreRuntimeMainSlot];
  return {
    scheduler: createScheduler(),
    bus: createEventBus(),
    logs,
    emitted: [],
    state: store,
    commandRuns,
    commands: createRuntimeCommands<any>({
      process,
      registry,
      writer: lazyCatalogWriter(store, ownKey),
      other: store.read(otherKey, 'core'),
      served: () => declared,
      leader: () => ' ',
      remote(id, arg) {
        commandRuns.push({ id, arg });
        return Promise.resolve();
      },
    }),
  };
}

function commonApi(
  manifest: PluginManifest,
  context: PartContext,
  world: HarnessWorld,
  counts: PartCounts,
  settings: object,
  process: ProcessName,
): CommonApi {
  const register = <T extends Disposable>(handle: T): T =>
    context.registrations.track(countedHandle(handle, counts));
  const liveHandle = () => register<Disposable>({ dispose() {} });
  const coreLog = (source: string, message: string) => {
    world.logs.push({ source, message });
  };
  const recordingBus: EventBus = {
    on: world.bus.on,
    emit(qualifiedEvent, data) {
      world.emitted.push({ event: qualifiedEvent, data });
      world.bus.emit(qualifiedEvent, data);
    },
  };
  const events = pluginEvents<UntypedEvents, UntypedEvents>(
    recordingBus,
    manifest.id,
    coreLog,
  );
  return {
    register,
    liveHandle,
    events: {
      emit: events.emit,
      on: (qualifiedEvent, listener) =>
        register(events.on(qualifiedEvent, listener)),
    },
    settings: () => settings,
    onSettingsChanged: liveHandle,
    dependency: (key) => context.dependency(key.id),
    log: pluginLog(coreLog, manifest.id),
    timers: trackedTimers(
      countingTimers(world.scheduler, counts),
      context.registrations,
    ),
    clock: { now: world.scheduler.now },
    state: pluginState(world.state, manifest.id, process, register),
  };
}

// `picker` checking each scope against `manifest` as the page service does: at
// the `create` for a string or a function's first value, at the push for a
// function's later value.
function scopeCheckedPicker(
  manifest: PluginManifest,
  picker: ListPickerService,
): ListPickerService {
  return {
    ...picker,
    create(options = {}) {
      const { scope = 'picker' } = options;
      const scopeName = typeof scope === 'string' ? () => scope : scope;
      requireDeclaredScope(manifest, scopeName());
      return picker.create({
        ...options,
        scope: () => {
          const name = scopeName();
          requireDeclaredScope(manifest, name);
          return name;
        },
      });
    },
  };
}

// A service function that throws when called.
function notFakedCall(name: string): () => never {
  return () => {
    throw new Error(
      `part harness: services.${name} is not faked; pass it in options`,
    );
  };
}

// `name`'s service with every member not in `faked` throwing when called, so a
// part reads it freely and fails only on what it uses.
function notFaked<T extends object>(name: string, faked: Partial<T> = {}): T {
  return new Proxy(faked, {
    get: (target, member) =>
      member in target
        ? Reflect.get(target, member)
        : () => {
            throw new Error(
              `part harness: services.${name}.${String(member)} is not faked; pass it in options.services`,
            );
          },
  }) as T;
}

function neverSettles<T>(): Promise<T> {
  return new Promise(() => {});
}

function requireFakesListed(
  part: PluginManifest,
  process: ProcessName,
  dependencies: readonly FakeDependency<ProcessName>[],
) {
  for (const { key } of dependencies) {
    if (!part.dependsOn[process].includes(key.id)) {
      throw new Error(
        `part harness: fake dependency "${key.id}" is not in ${part.id}'s dependsOn.${process}`,
      );
    }
  }
}

function requireNoFakeIsReal(
  dependencies: readonly FakeDependency<ProcessName>[],
  realParts: readonly { manifest: PluginManifest }[],
) {
  for (const { key } of dependencies) {
    if (realParts.some(({ manifest }) => manifest.id === key.id)) {
      throw new Error(
        `part harness: "${key.id}" is both a fake dependency and a real part`,
      );
    }
  }
}

function providerManifest(id: string): PluginManifest {
  return {
    id,
    dependsOn: { main: [], page: [] },
    reads: { main: [], page: [] },
    commands: {},
    scopes: {},
    settings: {},
    settingInfo: {},
    themeTokens: {},
  };
}

// The ids in the `dependsOn[process]` of `manifests` that nothing provides.
function idsToStub(
  manifests: readonly PluginManifest[],
  process: ProcessName,
  provided: ReadonlySet<string>,
): string[] {
  const listed = manifests.flatMap((manifest) => manifest.dependsOn[process]);
  return [...new Set(listed)].filter((id) => !provided.has(id));
}

// Starts `underTest` through the real host with one provider part per fake
// dependency, one stub per other listed id, and the real parts. `consumerView`
// counts only what the part under test files, since the host hands a provider
// each dependent's own store.
function partLifecycle<Started>(
  process: ProcessName,
  underTest: HostedPart,
  dependencies: readonly FakeDependency<ProcessName>[],
  realParts: readonly HostedPart[],
  counts: PartCounts,
  commands: CommandRegistry<any>,
): PartLifecycle<Started> {
  let underTestStore: Registrations | null = null;
  const consumerView = (consumer: Registrations) =>
    consumer === underTestStore ? countingConsumer(consumer, counts) : consumer;
  const fakes: HostedPart[] = dependencies.map((dependency) => ({
    manifest: providerManifest(dependency.key.id),
    begin: () => ({
      commands: {},
      exports: (consumer) => dependency.exports(consumerView(consumer)),
    }),
  }));
  const reals: HostedPart[] = realParts.map(({ manifest, begin }) => ({
    manifest,
    begin(context) {
      const started = begin(context);
      return {
        commands: started.commands,
        exports: (consumer) => started.exports?.(consumerView(consumer)),
        dispose: () => started.dispose?.(),
      };
    },
  }));
  const stubs = idsToStub(
    [underTest.manifest, ...realParts.map(({ manifest }) => manifest)],
    process,
    new Set([...fakes, ...reals].map(({ manifest }) => manifest.id)),
  ).map((id): HostedPart => ({
    manifest: providerManifest(id),
    begin: () => ({ commands: {} }),
  }));
  const hosted = [...fakes, ...stubs, ...reals, underTest];
  let host: PluginHost<HostedStart> | null = null;

  const lifecycle: PartLifecycle<Started> = {
    start() {
      host = startPlugins(hosted, process, (part, context) => {
        const isUnderTest = part === underTest;
        if (isUnderTest) {
          underTestStore = context.registrations;
        }
        const started = part.begin(context);
        for (const [short, handler] of Object.entries(started.commands)) {
          const handle = commands.register(
            qualify(part.manifest.id, short),
            handler,
            part.manifest.id,
          );
          context.registrations.track(
            isUnderTest ? countedHandle(handle, counts) : handle,
          );
        }
        return started;
      });
    },
    started() {
      if (host === null) {
        throw new Error(`part harness: ${underTest.manifest.id} is stopped`);
      }
      return host.started.get(underTest.manifest.id) as Started;
    },
    async stop() {
      const stopping = host;
      host = null;
      await stopping?.stopAll();
    },
    async restart() {
      await lifecycle.stop();
      lifecycle.start();
    },
  };
  return lifecycle;
}

function baseHarness<Started>(
  lifecycle: PartLifecycle<Started>,
  world: HarnessWorld,
  counts: PartCounts,
): PartHarness<Started> {
  return {
    started: lifecycle.started,
    counts: () => ({ ...counts }),
    advance: world.scheduler.advance,
    emit: world.bus.emit,
    logs: world.logs,
    emitted: world.emitted,
    state: world.state,
    commandRuns: world.commandRuns,
    stop: lifecycle.stop,
    restart: lifecycle.restart,
  };
}

// What main's fake API writes to for one part. A real part gets its own, which
// nothing reads, so its handles count nowhere and its channel stays its own.
interface MainRecord {
  counts: PartCounts;
  handlers: Map<string, (...args: never[]) => unknown>;
  sent: { message: string; data: unknown }[];
  layoutsRegistered: boolean;
}

function newMainRecord(counts: PartCounts = zeroCounts()): MainRecord {
  return { counts, handlers: new Map(), sent: [], layoutsRegistered: false };
}

// What every main part of one harness shares.
interface MainWorld extends HarnessWorld {
  files: MemoryFiles;
  processes: FakeProcesses;
  drive: ReturnType<typeof fakeDriveHost> | null;
  replaced: Partial<Omit<MainServices, 'timers' | 'log'>>;
  randomHex(): string;
  randomUuid(): string;
}

const DEV_APP: AppInstance = {
  id: 'wigley-ai-gui-dev',
  displayName: 'Auri Dev',
  isDev: true,
};

// Each member calls `files`' own at call time, so a spy a test sets after the
// part starts sees the part's calls.
function countingWatches(files: Files, counts: PartCounts): Files {
  return {
    read: (...args) => files.read(...args),
    modified: (...args) => files.modified(...args),
    readStart: (...args) => files.readStart(...args),
    write: (...args) => files.write(...args),
    writeBytes: (...args) => files.writeBytes(...args),
    append: (...args) => files.append(...args),
    readBytes: (...args) => files.readBytes(...args),
    list: (...args) => files.list(...args),
    stat: (...args) => files.stat(...args),
    realPath: (...args) => files.realPath(...args),
    makeFolder: (...args) => files.makeFolder(...args),
    rename: (...args) => files.rename(...args),
    trash: (...args) => files.trash(...args),
    watch: (...args) => countedHandle(files.watch(...args), counts),
  };
}

function createMainWorld(
  drive: boolean,
  replaced: MainWorld['replaced'],
  state: SlotStore | undefined,
  manifests: readonly PluginManifest[],
): MainWorld {
  const world = createWorld(state, 'main', manifests);
  let hexes = 0;
  let uuids = 0;
  return {
    ...world,
    files: createMemoryFiles({ now: world.scheduler.now }),
    processes: new FakeProcesses(),
    drive: drive ? fakeDriveHost() : null,
    replaced,
    randomHex() {
      hexes += 1;
      return String(hexes).padStart(8, '0');
    },
    randomUuid() {
      uuids += 1;
      return `00000000-0000-4000-8000-${String(uuids).padStart(12, '0')}`;
    },
  };
}

function countedDrive(
  host: DriveHost | undefined,
  register: CommonApi['register'],
): DriveHost | null {
  if (host === undefined) {
    return null;
  }
  return { add: (name, action) => register(host.add(name, action)) };
}

function fakeLayoutsRegister(
  manifest: PluginManifest,
  record: MainRecord,
  register: CommonApi['register'],
): Disposable {
  if (record.layoutsRegistered) {
    throw new Error(`layouts of ${manifest.id} already registered`);
  }
  record.layoutsRegistered = true;
  return register({
    dispose() {
      record.layoutsRegistered = false;
    },
  });
}

function fakeMainApi(
  manifest: PluginManifest,
  context: PartContext,
  world: MainWorld,
  record: MainRecord,
  settings: object,
): MainApi<PluginManifest, any, any, any> {
  const common = commonApi(
    manifest,
    context,
    world,
    record.counts,
    settings,
    'main',
  );
  const { register } = common;
  const { handlers, sent, counts } = record;
  const { replaced } = world;
  const defaultFiles = countingWatches(world.files, counts);
  const partFiles = trackedFiles(defaultFiles, context.registrations);
  const pluginCommands = world.commands.forPlugin(manifest.id, register);
  return {
    commands: pluginCommands.commands,
    keys: { bind: pluginCommands.bind },
    channel: {
      handle(method, handler) {
        if (handlers.has(method)) {
          throw new Error(
            `Plugin "${manifest.id}" registered a main handler for "${method}" twice`,
          );
        }
        handlers.set(method, handler);
        return register({
          dispose() {
            if (handlers.get(method) === handler) {
              handlers.delete(method);
            }
          },
        });
      },
      send(message, data) {
        sent.push({ message, data });
      },
    },
    events: common.events,
    settings: common.settings,
    onSettingsChanged: common.onSettingsChanged,
    dependency: common.dependency as MainApi<
      PluginManifest,
      any,
      any,
      any
    >['dependency'],
    data: scopedFiles(partFiles, `/data/${manifest.id}`, posixPaths),
    drive: countedDrive(world.drive?.host, register),
    layouts: {
      register: () => fakeLayoutsRegister(manifest, record, register),
      names: () => ['default'],
    },
    state: common.state,
    services: {
      clock: common.clock,
      randomHex: world.randomHex,
      randomUuid: world.randomUuid,
      homeDir: '/home',
      tempFolders: [],
      paths: posixPaths,
      platform: fakePlatform('macos'),
      runMode: 'selfTest',
      selfTest: null,
      appInstance: DEV_APP,
      window: {
        show() {},
        summon: () => false,
        isFocused: () => false,
        chooseFolder: async () => null,
        capture: () =>
          Promise.reject(new Error('part harness: no window to capture')),
      },
      openExternal: gateExternalLinks(async () => undefined),
      agentHarnesses: [],
      git: notFaked<Git>('git'),
      sessionHost: notFaked<SessionHost>('sessionHost'),
      images: notFaked<ImageEncoder>('images'),
      ...replaced,
      files:
        replaced.files === undefined
          ? partFiles
          : trackedFiles(replaced.files, context.registrations),
      userConfig:
        replaced.userConfig === undefined
          ? notFaked<UserConfig>('userConfig')
          : trackedUserConfig(replaced.userConfig, context.registrations),
      processes: abortableProcesses(
        replaced.processes ?? world.processes,
        context.registrations,
      ),
      alerts: trackedAlerts(
        replaced.alerts ?? notFaked<Alerts>('alerts'),
        context.registrations,
      ),
      log: common.log,
      timers: common.timers,
    },
  };
}

export function startMainPart<M extends PluginManifest>(
  part: MainPart<M>,
  options: MainPartHarnessOptions<M> = {},
): MainPartHarness<M> {
  const dependencies = options.dependencies ?? [];
  const realParts = options.parts ?? [];
  requireFakesListed(part.manifest, 'main', dependencies);
  requireNoFakeIsReal(dependencies, realParts);
  const world = createMainWorld(
    options.drive === true,
    options.services ?? {},
    options.state,
    [part.manifest, ...realParts.map(({ manifest }) => manifest)],
  );
  const record = newMainRecord();
  const beginOn = (
    each: { manifest: PluginManifest; start(api: never): HostedStart },
    partRecord: MainRecord,
    settings: object,
  ): HostedPart => ({
    manifest: each.manifest,
    begin: (context) =>
      each.start(
        fakeMainApi(
          each.manifest,
          context,
          world,
          partRecord,
          settings,
        ) as never,
      ),
  });
  const lifecycle = partLifecycle<MainStart<M>>(
    'main',
    beginOn(part, record, options.settings ?? part.manifest.settings),
    dependencies,
    realParts.map((real) =>
      beginOn(real, newMainRecord(), real.manifest.settings),
    ),
    record.counts,
    world.commands.registry,
  );
  lifecycle.start();
  return {
    ...baseHarness(lifecycle, world, record.counts),
    files: world.files,
    processes: world.processes,
    drive: world.drive,
    sent: record.sent,
    invoke(method, ...args) {
      const handler = record.handlers.get(method) as
        | ((...handlerArgs: unknown[]) => unknown)
        | undefined;
      if (handler === undefined) {
        throw new Error(`part harness: no handler for ${method}`);
      }
      return handler(...args);
    },
  };
}

// What the page's fake API writes to for one part; see `MainRecord`.
interface PageRecord {
  counts: PartCounts;
  channelListeners: Map<string, Listeners<unknown>>;
  shows: Listeners<ShownLayouts<unknown>>;
  uiState: Map<string, unknown>;
  settings: object;
  settingsListeners: Listeners<object>;
  invoke?(method: string, ...args: unknown[]): Promise<unknown>;
}

function newPageRecord(
  settings: object,
  counts: PartCounts = zeroCounts(),
  invoke?: PageRecord['invoke'],
): PageRecord {
  return {
    counts,
    channelListeners: new Map(),
    shows: createListeners(),
    uiState: new Map(),
    settings,
    settingsListeners: createListeners(),
    invoke,
  };
}

// A mode the fake registry holds: its qualified id and the calls it hears.
interface FakeLiveMode {
  id: string;
  mode: Pick<Mode, 'shown' | 'hidden'>;
}

// What every page part of one harness shares: the page core's single slots.
interface PageWorld extends HarnessWorld {
  replaced: Partial<Omit<PageServices, 'timers' | 'log'>>;
  keymapListeners: Listeners<Keymap>;
  keymap: Keymap;
  scope: string;
  transparency: 'full' | 'reduced' | null;
  // The live modes in add order, and the shown one.
  liveModes: FakeLiveMode[];
  shownMode: FakeLiveMode | null;
  picked: string[];
  fences: FenceContribution[];
  anchors: HarnessAnchor[];
  where: HintWhere;
  whereListeners: Listeners<HintWhere>;
  hintsShown: boolean;
  hintsHold: { hold(shown: boolean): Disposable };
  anchorDispose?(): void;
}

function createPageWorld(
  replaced: PageWorld['replaced'],
  firstModeTaken: boolean,
  state: SlotStore | undefined,
  manifests: readonly PluginManifest[],
): PageWorld {
  const firstMode: FakeLiveMode | null = firstModeTaken
    ? {
        id: 'part-harness.first-mode',
        mode: { shown() {}, hidden() {} },
      }
    : null;
  const world: PageWorld = {
    ...createWorld(state, 'page', manifests),
    replaced,
    keymapListeners: createListeners(),
    keymap: {
      editor: { leader: ' ', remaps: [], binds: [] },
      page: [],
      app: [],
      intercept: [],
      global: [],
      groups: {},
    },
    scope: 'idle',
    transparency: null,
    liveModes: firstMode === null ? [] : [firstMode],
    shownMode: firstMode,
    picked: [],
    fences: [],
    anchors: [],
    where: 'page',
    whereListeners: createListeners(),
    hintsShown: true,
    hintsHold: createLatestHold<boolean>(true, (shown) => {
      world.hintsShown = shown;
    }),
  };
  tellShownMode(world.state, firstMode?.id ?? '');
  return world;
}

function fakePushedScope(
  scope: string,
  common: Pick<CommonApi, 'register' | 'liveHandle'>,
): PushedScope {
  let isPopped = false;
  const pushed: PushedScope = {
    pop() {
      if (isPopped) {
        throw new Error(`Scope ${scope} was already popped`);
      }
      pushed.dispose();
    },
    onBaseChanged: common.liveHandle,
    dispose() {
      isPopped = true;
    },
  };
  return common.register(pushed);
}

// Writes `coreModeSlot` as the page core does on each change, unless a test holds
// the slot's claim to write it itself.
function tellShownMode(state: SlotStore, modeId: string): void {
  if (state.isHeld(coreModeSlot.id)) {
    return;
  }
  const writer = state.publish(coreModeSlot);
  writer.set(modeId);
  writer.dispose();
}

function revealFakeMode(world: PageWorld, entry: FakeLiveMode): void {
  world.shownMode = entry;
  entry.mode.shown();
  tellShownMode(world.state, entry.id);
}

// The registry of `createModes` without its DOM: the side bar stays hidden and no
// element's `hidden` changes.
function fakeModes(
  manifest: PluginManifest,
  world: PageWorld,
  common: CommonApi,
): PageModes {
  const { liveModes } = world;
  return {
    add(mode) {
      const id = qualify(manifest.id, mode.id);
      if (liveModes.some((live) => live.id === id)) {
        throw new Error(`Mode "${id}" is added twice`);
      }
      const entry: FakeLiveMode = { id, mode };
      liveModes.push(entry);
      const isDisposed = () => !liveModes.includes(entry);
      const handle: ModeHandle = common.register({
        show() {
          if (world.shownMode === entry || isDisposed()) {
            return;
          }
          world.shownMode?.mode.hidden();
          revealFakeMode(world, entry);
        },
        isShown: () => world.shownMode === entry,
        setContext() {},
        toggleSideBar() {
          if (mode.sideBar === undefined && !isDisposed()) {
            throw new Error(`Mode "${id}" has no side bar`);
          }
        },
        picked() {
          world.picked.push(id);
        },
        sideBarShown: () => false,
        dispose() {
          if (isDisposed()) {
            return;
          }
          liveModes.splice(liveModes.indexOf(entry), 1);
          if (world.shownMode !== entry) {
            return;
          }
          world.shownMode = null;
          const [first] = liveModes;
          if (first === undefined) {
            tellShownMode(world.state, '');
          } else {
            revealFakeMode(world, first);
          }
        },
      });
      if (world.shownMode === null) {
        revealFakeMode(world, entry);
      }
      return handle;
    },
    shown() {
      if (world.shownMode === null) {
        throw new Error('part harness: no mode is live');
      }
      return world.shownMode.id;
    },
  };
}

function fenceKey({ language }: FenceContribution): string {
  return language.trim().toLowerCase();
}

function fakeMarkdown(
  world: PageWorld,
  counts: PartCounts,
  registrations: Registrations,
): MarkdownRenderer {
  const fences = notFaked<MarkdownRenderer>('markdown', {
    addFence(fence) {
      const key = fenceKey(fence);
      if (world.fences.some((live) => fenceKey(live) === key)) {
        throw new Error(`fence ${key} is already registered`);
      }
      world.fences.push(fence);
      return countedHandle(
        {
          dispose() {
            world.fences.splice(world.fences.indexOf(fence), 1);
          },
        },
        counts,
      );
    },
  });
  return notFaked<MarkdownRenderer>(
    'markdown',
    trackedMarkdown(fences, registrations),
  );
}

function fakeLayoutShow<L>(
  shows: Listeners<ShownLayouts<unknown>>,
  setLayouts: (shown: ShownLayouts<L>) => void,
  register: CommonApi['register'],
): LayoutShow {
  const listening = shows.add((shown) => setLayouts(shown as ShownLayouts<L>));
  return register<LayoutShow>({
    refresh() {},
    dispose: () => listening.dispose(),
  });
}

function fakePageChannelOn(
  record: PageRecord,
  message: string,
  listener: (data: never) => void,
  register: CommonApi['register'],
): Disposable {
  const listeners =
    record.channelListeners.get(message) ?? createListeners<unknown>();
  record.channelListeners.set(message, listeners);
  return register(listeners.add(listener as (data: unknown) => void));
}

// A command `manifest` declares, by its qualified id: a part's kit checks its own
// commands exist as it starts.
function ownCommand(
  manifest: PluginManifest,
  id: string,
): CommandInfo | undefined {
  const prefix = `${manifest.id}.`;
  const declared = id.startsWith(prefix)
    ? manifest.commands[id.slice(prefix.length)]
    : undefined;
  return declared && { ...declared, id, plugin: manifest.id };
}

function fakePageApi(
  manifest: PluginManifest,
  context: PartContext,
  world: PageWorld,
  record: PageRecord,
): PageApi<PluginManifest, any, any, any> {
  const common = commonApi(
    manifest,
    context,
    world,
    record.counts,
    record.settings,
    'page',
  );
  const { register, liveHandle } = common;
  const { replaced } = world;
  const pluginCommands = world.commands.forPlugin(manifest.id, register);
  const area = {
    contribute: liveHandle,
  };
  const areas: Record<
    Exclude<AreaName, 'activityBar' | 'sideBar' | 'main'>,
    typeof area
  > = {
    titleBar: area,
    panel: area,
    statusBar: area,
    rightBar: area,
    overlay: area,
  };
  return {
    areas,
    channel: {
      invoke: (method: string, ...args: unknown[]) =>
        record.invoke === undefined
          ? neverSettles()
          : record.invoke(method, ...args),
      on: (message: string, listener: (data: never) => void) =>
        fakePageChannelOn(record, message, listener, register),
    } as PageApi<PluginManifest, any, any, any>['channel'],
    events: common.events,
    keys: {
      setScope(scope) {
        world.scope = qualify(manifest.id, scope);
      },
      pushScope: (scope) =>
        fakePushedScope(qualify(manifest.id, scope), common),
      scope: () => world.scope,
      onPending: liveHandle,
      holdPending() {},
      cancelPending() {},
      keymap: () => world.keymap,
      onKeymapChanged: (listener) =>
        register(world.keymapListeners.add(listener)),
      label: (id) => id,
      command: (id) => ownCommand(manifest, id),
      scopes: [],
      bind: pluginCommands.bind,
      keysFor: (command, scope, where, arg) =>
        keysFor(world.keymap, command, scope, 'macos', where, arg),
      anchor(element, command, options = {}) {
        world.anchors.push({ element, command, options });
        return register<Disposable>({
          dispose: world.anchorDispose ?? (() => undefined),
        });
      },
      where: () => world.where,
      onWhereChanged: (listener) =>
        register(world.whereListeners.add(listener)),
      setHintsShown: (shown) => register(world.hintsHold.hold(shown)),
      placedIn: (scope) =>
        new Set(
          world.anchors
            .filter(({ options }) => [scope, undefined].includes(options.scope))
            .map(({ command, options }) => commandTarget(command, options.arg)),
        ),
    },
    modes: fakeModes(manifest, world, common),
    shell: { setLayout: liveHandle },
    transparency: {
      override(transparency) {
        world.transparency = transparency;
      },
      overridden: () => world.transparency,
    },
    panes: {
      setResizeTarget() {},
      setFocusTarget() {},
      setOuterPanes() {},
    },
    drops: { addTarget: liveHandle, savePasted: () => neverSettles() },
    settings: () => record.settings,
    onSettingsChanged: (listener) =>
      register(record.settingsListeners.add(listener)),
    platform: fakePlatform('macos'),
    commands: pluginCommands.commands,
    dependency: common.dependency as PageApi<
      PluginManifest,
      any,
      any,
      any
    >['dependency'],
    dataUrl: (path, revision) => dataUrl(manifest.id, revision, path),
    layouts: {
      show: (options) =>
        fakeLayoutShow(record.shows, options.setLayouts, register),
    },
    state: {
      ...common.state,
      forLayouts: layoutState(world.state, manifest.id, register),
    },
    services: {
      fuzzy: notFaked<FuzzyMatcher>('fuzzy'),
      chooseFolder: notFakedCall('chooseFolder'),
      openExternal: notFakedCall('openExternal'),
      markup: notFaked<MarkupEditor>('markup'),
      visualFrames: notFaked<VisualFrames>('visualFrames'),
      toast(text, tone) {
        world.logs.push({
          source: manifest.id,
          message: `toast ${tone}: ${text}`,
        });
      },
      clock: common.clock,
      paths: posixPaths,
      homeDir: '/home',
      runMode: 'selfTest',
      uiState: {
        get: (key) => record.uiState.get(key),
        set(key, value) {
          if (value === undefined) {
            record.uiState.delete(key);
          } else {
            record.uiState.set(key, value);
          }
        },
      },
      ...replaced,
      picker:
        replaced.picker === undefined
          ? notFaked<ListPickerService>('picker')
          : scopeCheckedPicker(manifest, replaced.picker),
      editor:
        replaced.editor === undefined
          ? notFaked<EditorHost>('editor')
          : trackedEditor(replaced.editor, context.registrations),
      markdown:
        replaced.markdown === undefined
          ? fakeMarkdown(world, record.counts, context.registrations)
          : trackedMarkdown(replaced.markdown, context.registrations),
      log: common.log,
      timers: common.timers,
    },
  };
}

interface LiveDomListener {
  type: string;
  listener: (event: unknown) => void;
  isCapture: boolean;
}

function isCaptureOption(options: unknown): boolean {
  return (
    options === true ||
    (options as { capture?: boolean } | undefined)?.capture === true
  );
}

// Listeners as a DOM target keeps them: one per type, listener and capture flag.
function countingEventTarget(counts: PartCounts) {
  const live: LiveDomListener[] = [];
  const indexOf = (type: string, listener: unknown, options: unknown) =>
    live.findIndex(
      (each) =>
        each.type === type &&
        each.listener === listener &&
        each.isCapture === isCaptureOption(options),
    );
  return {
    members: {
      addEventListener(
        type: string,
        listener: (event: unknown) => void,
        options?: unknown,
      ) {
        if (indexOf(type, listener, options) === -1) {
          live.push({ type, listener, isCapture: isCaptureOption(options) });
          counts.listeners += 1;
        }
      },
      removeEventListener(type: string, listener: unknown, options?: unknown) {
        const index = indexOf(type, listener, options);
        if (index !== -1) {
          live.splice(index, 1);
          counts.listeners -= 1;
        }
      },
    },
    fire(type: string, event: unknown) {
      for (const each of Array.from(live)) {
        if (each.type === type && live.includes(each)) {
          each.listener(event);
        }
      }
    },
  };
}

function countingObserverClass(counts: PartCounts) {
  return class {
    private readonly targets = new Set<unknown>();

    observe(target: unknown) {
      if (this.targets.size === 0) {
        counts.observers += 1;
      }
      this.targets.add(target);
    }

    unobserve(target: unknown) {
      if (this.targets.delete(target) && this.targets.size === 0) {
        counts.observers -= 1;
      }
    }

    disconnect() {
      if (this.targets.size > 0) {
        counts.observers -= 1;
      }
      this.targets.clear();
    }

    takeRecords() {
      return [];
    }
  };
}

function countingFrames(counts: PartCounts) {
  const pending = new Set<number>();
  let lastFrame = 0;
  return {
    requestAnimationFrame() {
      lastFrame += 1;
      pending.add(lastFrame);
      counts.frames += 1;
      return lastFrame;
    },
    cancelAnimationFrame(frame: number) {
      if (pending.delete(frame)) {
        counts.frames -= 1;
      }
    },
  };
}

// A copy, so `vi.unstubAllGlobals` restores the existing `document` untouched. A
// test reads `document` after `startPagePart`, never the object
// `installFocusFakeDom` returned.
function copyOfDocument(): object {
  const existing = (globalThis as { document?: object }).document;
  return existing === undefined
    ? {}
    : Object.create(
        Object.getPrototypeOf(existing),
        Object.getOwnPropertyDescriptors(existing),
      );
}

// Stubs the page globals with counting fakes; returns what fires `window`'s
// listeners.
function stubPageGlobals(counts: PartCounts) {
  const windowTarget = countingEventTarget(counts);
  const documentTarget = countingEventTarget(counts);
  const frames = countingFrames(counts);
  const Observer = countingObserverClass(counts);
  vi.stubGlobal('window', { ...windowTarget.members, ...frames });
  vi.stubGlobal(
    'document',
    Object.assign(copyOfDocument(), documentTarget.members),
  );
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('MutationObserver', Observer);
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('requestAnimationFrame', frames.requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', frames.cancelAnimationFrame);
  return windowTarget.fire;
}

export function startPagePart<M extends PluginManifest>(
  part: PagePart<M>,
  options: PagePartHarnessOptions<M> = {},
): PagePartHarness<M> {
  const dependencies = options.dependencies ?? [];
  const realParts = options.parts ?? [];
  requireFakesListed(part.manifest, 'page', dependencies);
  requireNoFakeIsReal(dependencies, realParts);
  const world = createPageWorld(
    options.services ?? {},
    options.firstModeTaken === true,
    options.state,
    [part.manifest, ...realParts.map(({ manifest }) => manifest)],
  );
  world.anchorDispose = options.anchorDispose;
  const record = newPageRecord(
    options.settings ?? part.manifest.settings,
    zeroCounts(),
    options.invoke,
  );
  const fireWindowListeners = stubPageGlobals(record.counts);
  const beginOn = (
    each: { manifest: PluginManifest; start(api: never): HostedStart },
    partRecord: PageRecord,
  ): HostedPart => ({
    manifest: each.manifest,
    begin: (context) =>
      each.start(
        fakePageApi(each.manifest, context, world, partRecord) as never,
      ),
  });
  const lifecycle = partLifecycle<PageStart<M>>(
    'page',
    beginOn(part, record),
    dependencies,
    realParts.map((real) =>
      beginOn(real, newPageRecord(real.manifest.settings)),
    ),
    record.counts,
    world.commands.registry,
  );
  lifecycle.start();
  return {
    ...baseHarness(lifecycle, world, record.counts),
    fences: world.fences,
    anchors: world.anchors,
    picked: world.picked,
    setWhere(where) {
      world.where = where;
      world.whereListeners.tell(where);
    },
    hintsShown: () => world.hintsShown,
    send(message, data) {
      record.channelListeners.get(message)?.tell(data);
    },
    fireWindow(type, event = { type }) {
      fireWindowListeners(type, event);
    },
    showLayouts: record.shows.tell,
    pushSettings(settings) {
      record.settings = settings;
      record.settingsListeners.tell(settings);
    },
    pushKeymap(keymap) {
      world.keymap = keymap;
      world.keymapListeners.tell(keymap);
    },
  };
}

// The data of each event `harness` holds as emitted under `qualifiedEvent`.
export function dataEmitted(
  harness: Pick<PartHarness<unknown>, 'emitted'>,
  qualifiedEvent: string,
): unknown[] {
  return harness.emitted
    .filter(({ event }) => event === qualifiedEvent)
    .map(({ data }) => data);
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((settled, failed) => {
    resolve = settled;
    reject = failed;
  });
  return { promise, resolve, reject };
}

// An editor host that counts the editors it holds live and every one it made;
// `type` edits the last one made. After `stop()`, `live` cannot fail, as the
// per-plugin view destroys what the part left: it is only meaningful mid-life.
export function countingEditors() {
  let live = 0;
  let made = 0;
  let type: (text: string) => void = () => undefined;
  const host: EditorHost = {
    create(_parent, doc, events) {
      live += 1;
      made += 1;
      type = (text) => events.changed(text);
      return {
        text: () => doc,
        setText() {},
        insert() {},
        charBeforeCursor: () => '',
        focus() {},
        blur() {},
        destroy() {
          live -= 1;
        },
      };
    },
    createDocument() {
      throw new Error('part harness: countingEditors makes no document editor');
    },
    contains: () => false,
    takesChordKey: () => false,
    typeInto() {},
    onPendingKeys: () => ({ dispose() {} }),
    cancelPendingKeys() {},
    setKeymap() {},
  };
  return {
    host,
    live: () => live,
    made: () => made,
    type: (text: string) => type(text),
  };
}
