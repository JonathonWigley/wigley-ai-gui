import { vi } from 'vitest';
import type { Timers } from '../contracts/ambient';
import type { Alerts } from '../contracts/alerts';
import type { AppInstance } from '../contracts/app-instance';
import type { Disposable, Registrations } from '../contracts/disposable';
import type { EditorHost } from '../contracts/editor';
import type { Files } from '../contracts/files';
import type { Git } from '../contracts/git';
import type { ImageEncoder } from '../contracts/images';
import type { Keymap } from '../contracts/keymap';
import type {
  FenceContribution,
  MarkdownRenderer,
} from '../contracts/markdown';
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
  ModeHandle,
  Modes,
  PageApi,
  PagePart,
  PageServices,
  PageStart,
  PluginManifest,
  ProcessName,
  PushedScope,
  ShownLayouts,
  UntypedEvents,
} from '../contracts/plugin';
import type { UserConfig } from '../contracts/user-config';
import type { VisualFrames } from '../contracts/visual-frames';
import { CommandRegistry } from './command-registry';
import { dataUrl } from './data-url';
import { createEventBus, type EventBus, pluginEvents } from './event-bus';
import { FakeProcesses } from './fake-processes';
import { fakeDriveHost } from './fake-drive-host';
import { createListeners, type Listeners } from './listeners';
import { createMemoryFiles, type MemoryFiles } from './memory-files';
import { posixPaths } from './paths/posix-paths';
import { type PartContext, type PluginHost, startPlugins } from './plugin-host';
import { pluginLog } from './plugin-log';
import { qualify } from './plugin-manifests';
import {
  abortableProcesses,
  trackedAlerts,
  trackedEditor,
  trackedFiles,
  trackedMarkdown,
  trackedUserConfig,
} from './plugin-service-views';
import { scopedFiles } from './scoped-files';
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

// `started` throws while the part is stopped. `restart` stops a started part and
// starts it again on a new host with the same fakes and the same counts, so what
// a leaky `dispose` left stays counted. `advance` runs the due timers in due
// order, the clock reading each one's due time, and ends `ms` later. `emitted`
// holds what any started part emitted, in order, under its qualified name; it
// outlives the stop, so a test reads there what a late read emitted.
export interface PartHarness<Started> {
  started(): Started;
  counts(): PartCounts;
  advance(ms: number): void;
  emit(qualifiedEvent: string, data: unknown): void;
  readonly logs: readonly { source: string; message: string }[];
  readonly emitted: readonly HarnessEvent[];
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

// `send` tells the channel listeners of the part under test. `fireWindow` calls
// each live `window` listener of `type` in added order, with `{ type }` when
// `event` is left out. `fences` holds the fences live through the default
// `services.markdown`.
export interface PagePartHarness<M extends PluginManifest> extends PartHarness<
  PageStart<M>
> {
  send(message: string, data: unknown): void;
  fireWindow(type: string, event?: unknown): void;
  showLayouts(shown: ShownLayouts<unknown>): void;
  pushKeymap(keymap: Keymap): void;
  readonly fences: readonly FenceContribution[];
}

// `services` replaces the named default services, and a replaced service counts
// nothing. A replaced `files`, `processes`, `alerts` or `userConfig` still runs
// through its per-plugin view, as `createMainApi` does. `parts` holds real
// providers, started before the part in listed order and stopped after it.
export interface MainPartHarnessOptions<M extends PluginManifest> {
  dependencies?: readonly FakeDependency<'main'>[];
  settings?: M['settings'];
  services?: Partial<Omit<MainServices, 'timers' | 'log'>>;
  drive?: boolean;
  parts?: readonly MainPart[];
}

// `invoke` answers the `channel.invoke` of the part under test, which otherwise
// never settles. A replaced `editor` or `markdown` still runs through its
// per-plugin view, as `createPageApi` does. `firstModeTaken` holds the first mode
// the app's own first part would add, so no mode the part adds shows as it is
// added. `parts` is as on main.
export interface PagePartHarnessOptions<M extends PluginManifest> {
  dependencies?: readonly FakeDependency<'page'>[];
  settings?: M['settings'];
  services?: Partial<Omit<PageServices, 'timers' | 'log'>>;
  invoke?(method: string, ...args: unknown[]): Promise<unknown>;
  firstModeTaken?: boolean;
  parts?: readonly PagePart[];
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

function createWorld(): HarnessWorld {
  return {
    scheduler: createScheduler(),
    bus: createEventBus(),
    logs: [],
    emitted: [],
  };
}

function commonApi(
  manifest: PluginManifest,
  context: PartContext,
  world: HarnessWorld,
  counts: PartCounts,
  settings: object,
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
  const commands = new CommandRegistry<never>();
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
): MainWorld {
  const world = createWorld();
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
  const common = commonApi(manifest, context, world, record.counts, settings);
  const { register } = common;
  const { handlers, sent, counts } = record;
  const { replaced } = world;
  const defaultFiles = countingWatches(world.files, counts);
  const partFiles = trackedFiles(defaultFiles, context.registrations);
  return {
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
    services: {
      clock: common.clock,
      randomHex: world.randomHex,
      randomUuid: world.randomUuid,
      homeDir: '/home',
      tempFolders: [],
      paths: posixPaths,
      runMode: 'selfTest',
      selfTest: null,
      appInstance: DEV_APP,
      window: {
        show() {},
        isFocused: () => false,
        chooseFolder: async () => null,
        capture: () =>
          Promise.reject(new Error('part harness: no window to capture')),
      },
      openExternal: async () => {},
      agentHarnesses: [],
      git: notFaked<Git>('git'),
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
  const world = createMainWorld(options.drive === true, options.services ?? {});
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
  invoke?(method: string, ...args: unknown[]): Promise<unknown>;
}

function newPageRecord(
  counts: PartCounts = zeroCounts(),
  invoke?: PageRecord['invoke'],
): PageRecord {
  return {
    counts,
    channelListeners: new Map(),
    shows: createListeners(),
    uiState: new Map(),
    invoke,
  };
}

// What every page part of one harness shares: the page core's single slots.
interface PageWorld extends HarnessWorld {
  replaced: Partial<Omit<PageServices, 'timers' | 'log'>>;
  keymapListeners: Listeners<Keymap>;
  keymap: Keymap;
  scope: string;
  transparency: 'full' | 'reduced' | null;
  // The qualified ids of the live modes, in add order; the first one shows.
  liveModes: string[];
  fences: FenceContribution[];
}

function createPageWorld(
  replaced: PageWorld['replaced'],
  firstModeTaken: boolean,
): PageWorld {
  return {
    ...createWorld(),
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
    liveModes: firstModeTaken ? ['part-harness.first-mode'] : [],
    fences: [],
  };
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

function fakeModes(
  manifest: PluginManifest,
  { liveModes }: PageWorld,
  common: CommonApi,
): Modes {
  return {
    add(mode) {
      const id = qualify(manifest.id, mode.id);
      if (liveModes.includes(id)) {
        throw new Error(`Mode "${id}" is added twice`);
      }
      const isFirst = liveModes.length === 0;
      liveModes.push(id);
      const handle: ModeHandle = common.register({
        show() {},
        isShown: () => liveModes[0] === id,
        setContext() {},
        toggleSideBar() {},
        picked() {},
        sideBarShown: () => false,
        dispose() {
          liveModes.splice(liveModes.indexOf(id), 1);
        },
      });
      if (isFirst) {
        mode.shown();
      }
      return handle;
    },
    shown() {
      if (liveModes.length === 0) {
        throw new Error('part harness: no mode is live');
      }
      return liveModes[0];
    },
    onChanged: common.liveHandle,
  };
}

function fakeMarkdown(
  world: PageWorld,
  counts: PartCounts,
  registrations: Registrations,
): MarkdownRenderer {
  const fences = notFaked<MarkdownRenderer>('markdown', {
    addFence(fence) {
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
  settings: object,
): PageApi<PluginManifest, any, any, any> {
  const common = commonApi(manifest, context, world, record.counts, settings);
  const { register, liveHandle } = common;
  const { replaced } = world;
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
      onScopeChanged: liveHandle,
      onPending: liveHandle,
      holdPending() {},
      cancelPending() {},
      keymap: () => world.keymap,
      onKeymapChanged: (listener) =>
        register(world.keymapListeners.add(listener)),
      label: (id) => id,
      command: (id) => ownCommand(manifest, id),
      scopes: [],
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
    settings: common.settings,
    onSettingsChanged: common.onSettingsChanged,
    platform: 'macos',
    commands: { run() {} },
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
    services: {
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
  );
  const record = newPageRecord(zeroCounts(), options.invoke);
  const fireWindowListeners = stubPageGlobals(record.counts);
  const beginOn = (
    each: { manifest: PluginManifest; start(api: never): HostedStart },
    partRecord: PageRecord,
    settings: object,
  ): HostedPart => ({
    manifest: each.manifest,
    begin: (context) =>
      each.start(
        fakePageApi(
          each.manifest,
          context,
          world,
          partRecord,
          settings,
        ) as never,
      ),
  });
  const lifecycle = partLifecycle<PageStart<M>>(
    'page',
    beginOn(part, record, options.settings ?? part.manifest.settings),
    dependencies,
    realParts.map((real) =>
      beginOn(real, newPageRecord(), real.manifest.settings),
    ),
    record.counts,
  );
  lifecycle.start();
  return {
    ...baseHarness(lifecycle, world, record.counts),
    fences: world.fences,
    send(message, data) {
      record.channelListeners.get(message)?.tell(data);
    },
    fireWindow(type, event = { type }) {
      fireWindowListeners(type, event);
    },
    showLayouts: record.shows.tell,
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
// `type` edits the last one made.
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
