import { describe, expect, it } from 'vitest';
import type { AgentHarness, AgentHarnessRegistry } from '../../contracts/agent';
import type { AlertNoun, Alerts } from '../../contracts/alerts';
import type { Timers } from '../../contracts/ambient';
import type { Disposable } from '../../contracts/disposable';
import type { Files } from '../../contracts/files';
import type {
  ChannelShape,
  DriveHost,
  MainChannel,
  MainCommandContext,
  PluginManifest,
  SelfTestHost,
} from '../../contracts/plugin';
import type { SpawnExit } from '../../contracts/processes';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
  type RuntimeCatalog,
} from '../../contracts/core-state';
import type { SlotKey } from '../../contracts/state';
import type { UserConfig } from '../../contracts/user-config';
import { CommandRegistry } from '../../shared/command-registry';
import { createEventBus, type EventBus } from '../../shared/event-bus';
import { FakeProcesses } from '../../shared/fake-processes';
import { createMemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import { createRegistrations } from '../../shared/registrations';
import {
  createRuntimeCommands,
  EMPTY_RUNTIME_CATALOG,
  type RuntimeCommandsDeps,
} from '../../shared/runtime-commands';
import { createSlotStore, type SlotStore } from '../../shared/state/slot-store';
import type { LayoutService } from '../layouts/layout-service';
import {
  createMainApi,
  type MainApiDeps,
  type MainApiServices,
} from './main-api';

const manifest: PluginManifest = {
  id: 'p',
  label: 'p',
  description: 'A test plugin.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
};

const ownSlot: SlotKey<number, 'main', 'p'> = {
  id: 'p.v',
  process: 'main',
  kind: 'value',
};

const fixedSettings = {
  pluginSettings: () => ({ p: {} }),
  onPluginSettingsChanged: () => ({ dispose: () => undefined }),
};

// Settings deps whose value `change` replaces, calling every listener.
function liveSettings(initial: Record<string, object>) {
  let current = initial;
  const listeners = new Set<(settings: Record<string, object>) => void>();
  return {
    deps: {
      pluginSettings: () => current,
      onPluginSettingsChanged: (
        listener: (settings: Record<string, object>) => void,
      ) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    change(next: Record<string, object>) {
      current = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
  };
}

// Main's commands over `state`, sending remote runs to `remote`.
function mainCommandsOver(
  state: SlotStore,
  remote: RuntimeCommandsDeps<MainCommandContext<any>>['remote'] = async () =>
    'ran',
) {
  return createRuntimeCommands<MainCommandContext<any>>({
    process: 'main',
    registry: new CommandRegistry(() => {}),
    writer: state.publish(coreRuntimeMainSlot),
    other: state.read(coreRuntimePageSlot, 'core'),
    served: () => ({}),
    leader: () => '<Space>',
    remote,
  });
}

function apiOver(
  settings: ReturnType<typeof liveSettings>,
  layouts = {} as LayoutService,
  dependency: MainApiDeps['dependency'] = () => undefined,
  overrides: Partial<MainApiDeps> = {},
  pluginManifest: PluginManifest = manifest,
) {
  const registrations = createRegistrations();
  const deps: MainApiDeps = {
    channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
    ...settings.deps,
    services: { paths: posixPaths } as MainApiServices,
    selfTestFor: () => null,
    driveFor: () => null,
    dependency,
    registrations,
    bus: createEventBus(),
    dataRoot: '/d',
    layouts,
    state: createSlotStore(() => {}),
    commands: mainCommandsOver(createSlotStore(() => {})),
    ...overrides,
  };
  return { api: createMainApi(pluginManifest, deps), registrations };
}

// An api over `services`, with `paths` filled in.
function apiWithServices(services: Partial<MainApiServices>) {
  return apiOver(liveSettings({ p: {} }), undefined, undefined, {
    services: { paths: posixPaths, ...services } as MainApiServices,
  });
}

// Timers a test fires by hand; `clear` drops the timer and records its handle.
function fakeTimers() {
  const cleared: number[] = [];
  const scheduled = new Map<number, () => void>();
  let last = 0;
  const timers: Timers = {
    set: (run) => {
      last += 1;
      scheduled.set(last, run);
      return last;
    },
    clear: (handle) => {
      cleared.push(handle);
      scheduled.delete(handle);
    },
  };
  const fireAll = () => {
    for (const run of Array.from(scheduled.values())) {
      run();
    }
  };
  return { timers, cleared, fireAll };
}

const F: AlertNoun = {
  singular: 'open agent form',
  plural: 'open agent forms',
};
const P: AlertNoun = {
  singular: 'open feature primer',
  plural: 'open feature primers',
};

// Alerts recording each `setOpenCount` call.
function fakeAlerts() {
  const counts: [string, number, AlertNoun][] = [];
  const alerts: Alerts = {
    setOpenCount: (source, count, noun) => counts.push([source, count, noun]),
  };
  return { alerts, counts };
}

// Memory files recording each watch's dispose count.
function countingWatchFiles() {
  const memory = createMemoryFiles();
  const disposes: number[] = [];
  const files: Files = {
    ...memory,
    watch: (folder, onChange, options) => {
      const watch = memory.watch(folder, onChange, options);
      const index = disposes.push(0) - 1;
      return {
        dispose: () => {
          disposes[index] += 1;
          watch.dispose();
        },
      };
    },
  };
  return { files, disposes };
}

const PENDING_RUN = new Promise<never>(() => {});

function processesHoldingIndexRun() {
  const processes = new FakeProcesses();
  processes.script('python3', ['index.py'], PENDING_RUN);
  return processes;
}

type TestApi = ReturnType<typeof apiOver>['api'];

// One registration through `api`, and the dep that returns `handle` for it.
const RETURNED_HANDLE_ROWS: {
  member: string;
  deps(handle: Disposable): Partial<MainApiDeps>;
  register(api: TestApi): void;
}[] = [
  {
    member: 'channel.handle',
    deps: (handle) => ({
      channels: {
        forPlugin: () =>
          ({ handle: () => handle }) as unknown as MainChannel<ChannelShape>,
      },
    }),
    register: (api) => api.channel.handle('save', () => undefined),
  },
  {
    member: 'layouts.register',
    deps: (handle) => ({
      layouts: { register: () => handle } as unknown as LayoutService,
    }),
    register: (api) => api.layouts.register({ layoutTypes: '' }),
  },
  {
    member: 'drive.add',
    deps: (handle) => ({ driveFor: () => ({ add: () => handle }) }),
    register: (api) =>
      api.drive?.add('open', {
        description: '',
        args: '',
        run: async () => undefined,
      }),
  },
  {
    member: 'services.userConfig.onChanged',
    deps: (handle) => ({
      services: {
        paths: posixPaths,
        userConfig: { onChanged: () => handle } as unknown as UserConfig,
      } as MainApiServices,
    }),
    register: (api) => api.services.userConfig.onChanged(() => undefined),
  },
  {
    member: 'services.agentHarnesses.register',
    deps: (handle) => ({
      services: {
        paths: posixPaths,
        agentHarnesses: {
          register: () => handle,
        } as unknown as AgentHarnessRegistry,
      } as MainApiServices,
    }),
    register: (api) =>
      api.services.agentHarnesses.register({
        id: 'h',
      } as unknown as AgentHarness),
  },
  {
    member: 'state.publish',
    deps: (handle) => ({
      state: { publish: () => handle } as unknown as SlotStore,
    }),
    register: (api) => api.state.publish(ownSlot),
  },
];

// One listener registered through `api`, and what makes the source speak: the
// registrations are disposed in between, so `heard` stays empty.
type HearingWorld = {
  api: TestApi;
  bus: EventBus;
  settings: ReturnType<typeof liveSettings>;
  state: SlotStore;
};

const HEARING_ROWS: {
  member: string;
  listen(world: HearingWorld, heard: (data: unknown) => void): void;
  speak(world: HearingWorld): void;
}[] = [
  {
    member: "events.on('q.done')",
    listen: ({ api }, heard) => api.events.on('q.done', heard),
    speak: ({ bus }) => bus.emit('q.done', 1),
  },
  {
    member: 'onSettingsChanged',
    listen: ({ api }, heard) => api.onSettingsChanged(heard),
    speak: ({ settings }) => settings.change({ p: { a: 2 } }),
  },
  {
    member: 'state.read().on',
    listen: ({ api }, heard) => api.state.read(ownSlot).on(heard),
    speak: ({ state }) =>
      state.applyRemote({ id: 'p.v', kind: 'value', value: 1 }),
  },
];

// A call made after the registrations are disposed, and what shows it undone.
const AFTER_DISPOSE_ROWS: {
  member: string;
  callAndCheck(): void | Promise<void>;
}[] = [
  {
    member: 'watch',
    callAndCheck: async () => {
      const { files, disposes } = countingWatchFiles();
      const { api, registrations } = apiWithServices({ files });
      registrations.dispose();
      const heard: string[] = [];

      api.services.files.watch('/h', (path) => heard.push(path));
      await files.write('/h/a.md', 'text');

      expect(disposes).toEqual([1]);
      expect(heard).toEqual([]);
    },
  },
  {
    member: 'timer',
    callAndCheck: () => {
      const { timers, cleared, fireAll } = fakeTimers();
      const { api, registrations } = apiWithServices({ timers });
      registrations.dispose();
      let fired = false;

      api.services.timers.set(() => {
        fired = true;
      }, 10);
      fireAll();

      expect(fired).toBe(false);
      expect(cleared).toEqual([1]);
    },
  },
  {
    member: 'run',
    callAndCheck: async () => {
      const processes = processesHoldingIndexRun();
      const { api, registrations } = apiWithServices({ processes });
      registrations.dispose();

      await expect(
        api.services.processes.run('python3', ['index.py']),
      ).rejects.toThrow('Stopped python3');
    },
  },
  {
    member: 'alert count',
    callAndCheck: () => {
      const { alerts, counts } = fakeAlerts();
      const { api, registrations } = apiWithServices({ alerts });
      registrations.dispose();

      api.services.alerts.setOpenCount('p', 2, F);

      expect(counts).toEqual([]);
    },
  },
];

describe('createMainApi', () => {
  it("settings() reads the plugin's current settings", () => {
    const settings = liveSettings({ p: { size: 1 }, q: { size: 2 } });
    const { api } = apiOver(settings);

    settings.change({ p: { size: 3 }, q: { size: 2 } });

    expect(api.settings()).toEqual({ size: 3 });
  });

  it("onSettingsChanged fires only when that plugin's settings change", () => {
    const settings = liveSettings({ p: { size: 1 }, q: { size: 2 } });
    const heard: object[] = [];
    apiOver(settings).api.onSettingsChanged((next) => heard.push(next));

    settings.change({ p: { size: 1 }, q: { size: 5 } });
    settings.change({ p: { size: 4 }, q: { size: 5 } });

    expect(heard).toEqual([{ size: 4 }]);
  });

  it('gives the plugin events under its id', () => {
    const bus = createEventBus();
    const heard: unknown[] = [];
    bus.on('p.x', (data) => heard.push(data));
    const api = createMainApi(manifest, {
      channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
      ...fixedSettings,
      services: { paths: posixPaths } as MainApiServices,
      selfTestFor: () => null,
      driveFor: () => null,
      dependency: () => undefined,
      registrations: createRegistrations(),
      bus,
      dataRoot: '/d',
      layouts: {} as LayoutService,
      state: createSlotStore(() => {}),
      commands: mainCommandsOver(createSlotStore(() => {})),
    });

    api.events.emit('x', 3);

    expect(heard).toEqual([3]);
  });

  it("scopes the plugin's data to its own folder", async () => {
    const files = createMemoryFiles();
    const api = createMainApi(
      { ...manifest, id: 'forms' },
      {
        channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
        ...fixedSettings,
        services: { files, paths: posixPaths } as unknown as MainApiServices,
        selfTestFor: () => null,
        driveFor: () => null,
        dependency: () => undefined,
        registrations: createRegistrations(),
        bus: createEventBus(),
        dataRoot: '/d',
        layouts: {} as LayoutService,
        state: createSlotStore(() => {}),
        commands: mainCommandsOver(createSlotStore(() => {})),
      },
    );

    await api.data.write('x.txt', 'text');

    expect(await files.read('/d/forms/x.txt')).toBe('text');
    await expect(api.data.write('../x.txt', 'text')).rejects.toThrow(
      '../x.txt',
    );
  });

  it('hands the plugin the self-test host', () => {
    const host: SelfTestHost = { run: () => undefined };
    const clock = { now: () => 0 };
    const api = createMainApi(
      { ...manifest, id: 'forms' },
      {
        channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
        ...fixedSettings,
        services: {
          files: createMemoryFiles(),
          clock,
          paths: posixPaths,
        } as unknown as MainApiServices,
        selfTestFor: (pluginId) => (pluginId === 'forms' ? host : null),
        driveFor: () => null,
        dependency: () => undefined,
        registrations: createRegistrations(),
        bus: createEventBus(),
        dataRoot: '/d',
        layouts: {} as LayoutService,
        state: createSlotStore(() => {}),
        commands: mainCommandsOver(createSlotStore(() => {})),
      },
    );

    expect(api.services.selfTest).toBe(host);
    expect(api.services.clock).toBe(clock);
  });

  it('hands each plugin its own drive host', () => {
    const added: string[] = [];
    const formsHost: DriveHost = {
      add: (name) => {
        added.push(name);
        return { dispose: () => undefined };
      },
    };
    const action = {
      description: '',
      args: '',
      run: async () => undefined,
    };
    const elsewhere = apiOver(liveSettings({ p: {} })).api;
    const api = createMainApi(
      { ...manifest, id: 'forms' },
      {
        channels: { forPlugin: () => ({}) as MainChannel<ChannelShape> },
        ...fixedSettings,
        services: {
          files: createMemoryFiles(),
          paths: posixPaths,
        } as unknown as MainApiServices,
        selfTestFor: () => null,
        driveFor: (pluginId) => (pluginId === 'forms' ? formsHost : null),
        dependency: () => undefined,
        registrations: createRegistrations(),
        bus: createEventBus(),
        dataRoot: '/d',
        layouts: {} as LayoutService,
        state: createSlotStore(() => {}),
        commands: mainCommandsOver(createSlotStore(() => {})),
      },
    );

    api.drive?.add('open', action);

    expect(added).toEqual(['open']);
    expect(elsewhere.drive).toBeNull();
  });

  it("registers the plugin's layouts under its id", () => {
    const calls: unknown[][] = [];
    const layouts = {
      register: (owner: string, layoutTypes: string, defaultFolder: string) => {
        calls.push(['register', owner, layoutTypes, defaultFolder]);
        return { dispose: () => undefined };
      },
      names: (owner: string) => {
        calls.push(['names', owner]);
        return ['default', 'mine'];
      },
    } as LayoutService;
    const { api } = apiOver(liveSettings({ p: {} }), layouts);

    api.layouts.register({ layoutTypes: 'types' });
    const names = api.layouts.names();

    expect(calls).toEqual([
      ['register', 'p', 'types', 'src/plugins/p/layouts/default'],
      ['names', 'p'],
    ]);
    expect(names).toEqual(['default', 'mine']);
  });

  it('dependency asks the host for the plugin a key names', () => {
    const asked: string[] = [];
    const { api } = apiOver(liveSettings({ p: {} }), undefined, (pluginId) => {
      asked.push(pluginId);
      return { n: 1 };
    });

    const received = api.dependency({ id: 'a', process: 'main' } as const);

    expect(received).toEqual({ n: 1 });
    expect(asked).toEqual(['a']);
  });

  it("services.log logs a one-argument line under the plugin's id", () => {
    const logged: string[][] = [];
    const { api } = apiWithServices({
      log: (source, message) => logged.push([source, message]),
    });

    api.services.log('hello');

    expect(logged).toEqual([['p', 'hello']]);
  });

  const notDeclared = 'Plugin "p" does not declare readsEverySlot';
  it.each<{
    case: string;
    pluginManifest: PluginManifest;
    check(state: TestApi['state']): void;
  }>([
    {
      case: 'declared',
      pluginManifest: { ...manifest, readsEverySlot: true },
      check(state) {
        expect(state.readAny('core.mode')).toEqual({
          kind: 'value',
          value: 'chat',
        });
        expect(state.slotIds()).toEqual(['core.mode', 'q.k']);
      },
    },
    {
      case: 'not declared',
      pluginManifest: manifest,
      check(state) {
        expect(() => state.readAny('core.mode')).toThrow(notDeclared);
        expect(() => state.slotIds()).toThrow(notDeclared);
      },
    },
  ])(
    'readAny and slotIds read every slot only for a manifest that declares readsEverySlot: $case',
    ({ pluginManifest, check }) => {
      const state = createSlotStore(() => {});
      state.publish({ id: 'q.k', process: 'page', kind: 'keyed' }).set('a', 1);
      state
        .publish({ id: 'core.mode', process: 'main', kind: 'value' })
        .set('chat');
      const { api } = apiOver(
        liveSettings({ p: {} }),
        undefined,
        undefined,
        { state },
        pluginManifest,
      );

      check(api.state);
    },
  );
});

describe('createMainApi recording', () => {
  it.each(RETURNED_HANDLE_ROWS)(
    "disposes what $member returned when the plugin's registrations are disposed",
    ({ member, deps, register }) => {
      const disposed: string[] = [];
      const { api, registrations } = apiOver(
        liveSettings({ p: {} }),
        undefined,
        undefined,
        deps({ dispose: () => disposed.push(member) }),
      );

      register(api);
      expect(disposed).toEqual([]);

      registrations.dispose();
      expect(disposed).toEqual([member]);
    },
  );

  it.each(HEARING_ROWS)(
    "stops $member hearing once the plugin's registrations are disposed",
    ({ listen, speak }) => {
      const bus = createEventBus();
      const settings = liveSettings({ p: { a: 1 } });
      const state = createSlotStore(() => {});
      const { api, registrations } = apiOver(settings, undefined, undefined, {
        bus,
        state,
      });
      const world = { api, bus, settings, state };
      const heard: unknown[] = [];
      listen(world, (data) => heard.push(data));

      registrations.dispose();
      speak(world);

      expect(heard).toEqual([]);
    },
  );

  it("disposes the plugin's file watches, its data watches included, when its registrations are disposed", async () => {
    const files = createMemoryFiles();
    const { api, registrations } = apiWithServices({ files });
    const heard: string[] = [];
    api.services.files.watch('/h', (path) => heard.push(path));
    api.data.watch('x', (path) => heard.push(path));
    await files.write('/h/before.md', 'text');
    await files.write('/d/p/x/before.md', 'text');
    expect(heard).toEqual(['before.md', 'before.md']);

    registrations.dispose();
    await files.write('/h/a.md', 'text');
    await files.write('/d/p/x/b.md', 'text');

    expect(heard).toEqual(['before.md', 'before.md']);
  });

  it("stops the plugin's running programs when its registrations are disposed", async () => {
    const processes = processesHoldingIndexRun();
    const { api, registrations } = apiWithServices({ processes });

    const run = api.services.processes.run('python3', ['index.py']);
    registrations.dispose();

    await expect(run).rejects.toThrow('Stopped python3');
  });

  it("kills the plugin's spawned programs when its registrations are disposed", () => {
    const processes = new FakeProcesses();
    const { api, registrations } = apiWithServices({ processes });
    const events = { stdout() {}, stderr() {}, closed() {} };
    api.services.processes.spawn('claude', [], { cwd: '/', env: {}, events });
    api.services.processes.spawn('claude', ['-p'], {
      cwd: '/',
      env: {},
      events,
    });
    const [live, closed] = processes.spawns;
    closed.close({ code: 0, signal: null, startError: null });

    registrations.dispose();

    expect(live.kills).toEqual(['SIGKILL']);
    expect(closed.kills).toEqual([]);
  });

  it('refuses a spawn once its registrations are disposed', async () => {
    const processes = new FakeProcesses();
    const { api, registrations } = apiWithServices({ processes });
    const heard: SpawnExit[] = [];
    registrations.dispose();

    api.services.processes.spawn('claude', [], {
      cwd: '/',
      env: {},
      events: {
        stdout() {},
        stderr() {},
        closed: (exit) => heard.push(exit),
      },
    });
    expect(heard).toEqual([]);
    await Promise.resolve();

    expect(processes.spawns).toEqual([]);
    expect(heard).toEqual([
      {
        code: null,
        signal: null,
        startError: { message: 'Stopped claude', notFound: false },
      },
    ]);
  });

  it("stops a run when the caller's own signal aborts", async () => {
    const processes = processesHoldingIndexRun();
    const { api } = apiWithServices({ processes });
    const controller = new AbortController();

    const run = api.services.processes.run('python3', ['index.py'], {
      signal: controller.signal,
    });
    controller.abort();

    await expect(run).rejects.toThrow('Stopped python3');
  });

  it('zeroes the open counts the plugin set when its registrations are disposed', () => {
    const { alerts, counts } = fakeAlerts();
    const { api, registrations } = apiWithServices({ alerts });
    api.services.alerts.setOpenCount('p', 2, F);
    api.services.alerts.setOpenCount('p.other', 0, P);
    counts.length = 0;

    registrations.dispose();

    expect(counts).toEqual([['p', 0, F]]);
  });

  it("clears the plugin's pending timer when its registrations are disposed", () => {
    const { timers, cleared } = fakeTimers();
    const { api, registrations } = apiWithServices({ timers });

    api.services.timers.set(() => undefined, 10);
    registrations.dispose();

    expect(cleared).toEqual([1]);
  });

  it.each(AFTER_DISPOSE_ROWS)(
    'undoes a $member made after the registrations are disposed at once',
    async ({ callAndCheck }) => {
      await callAndCheck();
    },
  );
});

describe('createMainApi commands', () => {
  const DECL = { label: 'Go', group: 'g', runsIn: 'main' } as const;
  const PAGE_CATALOG: RuntimeCatalog = {
    ...EMPTY_RUNTIME_CATALOG,
    commands: [
      {
        id: 'q.go',
        plugin: 'q',
        label: 'Page go',
        group: 'g',
        runsIn: 'page',
        runtime: true,
      },
    ],
    binds: {
      binds: [],
      app: [{ accelerator: 'Alt+Z', command: 'q.go' }],
      intercept: [],
    },
  };

  function commandsSetup() {
    const state = createSlotStore(() => {});
    const remoteRuns: [string, unknown][] = [];
    const commands = mainCommandsOver(state, async (id, arg) => {
      remoteRuns.push([id, arg]);
      return 'ran';
    });
    const { api, registrations } = apiOver(
      liveSettings({ p: {} }),
      undefined,
      undefined,
      { state, commands },
    );
    const catalog = () => state.read(coreRuntimeMainSlot, 'core').get();
    const writePage = () =>
      state.applyRemote({
        id: coreRuntimePageSlot.id,
        kind: 'value',
        value: PAGE_CATALOG,
      });
    return { api, commands, registrations, catalog, writePage, remoteRuns };
  }

  it("a registered command and its bind leave the registry and the catalog when the part's registrations are disposed", () => {
    const { api, commands, registrations, catalog } = commandsSetup();
    api.commands.register('go', DECL, () => {});
    api.keys.bind({
      kind: 'app',
      bind: { accelerator: 'Alt+G', command: 'p.go' },
    });

    registrations.dispose();

    expect(commands.registry.has('p.go')).toBe(false);
    expect(catalog()?.commands).toEqual([]);
    expect(catalog()?.binds.app).toEqual([]);
  });

  it('register throws for a command that runs in the other process', () => {
    const { api } = commandsSetup();

    expect(() =>
      api.commands.register('go', { ...DECL, runsIn: 'page' }, () => {}),
    ).toThrow('p.go runs in page');
  });

  it('bind throws at the call when its key clashes with a runtime bind of either process', () => {
    const { api, writePage } = commandsSetup();
    writePage();
    api.commands.register('go', DECL, () => {});
    const bindOn = (accelerator: string) => ({
      kind: 'app' as const,
      bind: { accelerator, command: 'p.go' },
    });
    api.keys.bind(bindOn('Alt+G'));

    expect(() => api.keys.bind(bindOn('Alt+G'))).toThrow();
    expect(() => api.keys.bind(bindOn('Alt+Z'))).toThrow();
  });

  it('bind accepts a key a default or user bind holds', () => {
    const { api, catalog } = commandsSetup();
    api.commands.register('go', DECL, () => {});

    api.keys.bind({
      kind: 'intercept',
      bind: { key: 'Tab', control: true, command: 'p.go' },
    });

    expect(catalog()?.binds.intercept).toHaveLength(1);
  });

  it("runs another process's runtime command from its slot before the served config has it", async () => {
    const { api, writePage, remoteRuns } = commandsSetup();
    writePage();

    await api.commands.run('q.go');

    expect(remoteRuns).toEqual([['q.go', undefined]]);
  });

  it("an intercept's wrap is gone once the part stops", async () => {
    const { api, commands, registrations } = commandsSetup();
    const ran: string[] = [];
    commands.registry.register('p.go', () => void ran.push('handler'), 'p');
    api.commands.intercept('p.go', () => void ran.push('wrap'));

    registrations.dispose();
    await commands.registry.run('p.go', { arg: undefined });

    expect(ran).toEqual(['handler']);
  });

  it('an onDidRun listener is gone once the part stops', async () => {
    const { api, commands, registrations } = commandsSetup();
    const heard: string[] = [];
    commands.registry.register('p.go', () => {}, 'p');
    api.commands.onDidRun((id) => heard.push(id));

    registrations.dispose();
    await commands.registry.run('p.go', { arg: undefined });

    expect(heard).toEqual([]);
  });

  it('a bind leaves the catalog once the part stops', () => {
    const { api, registrations, catalog } = commandsSetup();
    api.commands.register('go', DECL, () => {});
    api.keys.bind({
      kind: 'app',
      bind: { accelerator: 'Alt+G', command: 'p.go' },
    });

    registrations.dispose();

    expect(catalog()?.binds.app).toEqual([]);
  });
});
