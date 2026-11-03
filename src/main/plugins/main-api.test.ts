import { describe, expect, it } from 'vitest';
import type { Alerts } from '../../contracts/alerts';
import type { Timers } from '../../contracts/ambient';
import type { Disposable } from '../../contracts/disposable';
import type { Files } from '../../contracts/files';
import type {
  ChannelShape,
  DriveHost,
  MainChannel,
  PluginManifest,
  SelfTestHost,
} from '../../contracts/plugin';
import type { UserConfig } from '../../contracts/user-config';
import { createEventBus, type EventBus } from '../../shared/event-bus';
import { FakeProcesses } from '../../shared/fake-processes';
import { createMemoryFiles } from '../../shared/memory-files';
import { posixPaths } from '../../shared/paths/posix-paths';
import { createRegistrations } from '../../shared/registrations';
import type { LayoutService } from '../layouts/layout-service';
import {
  createMainApi,
  type MainApiDeps,
  type MainApiServices,
} from './main-api';

const manifest: PluginManifest = {
  id: 'p',
  dependsOn: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
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

function apiOver(
  settings: ReturnType<typeof liveSettings>,
  layouts = {} as LayoutService,
  dependency: MainApiDeps['dependency'] = () => undefined,
  overrides: Partial<MainApiDeps> = {},
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
    ...overrides,
  };
  return { api: createMainApi(manifest, deps), registrations };
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

// Alerts recording each `setOpenCount` call.
function fakeAlerts() {
  const counts: [string, number][] = [];
  const alerts: Alerts = {
    announce: () => undefined,
    setOpenCount: (source, count) => counts.push([source, count]),
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
];

// One listener registered through `api`, and what makes the source speak: the
// registrations are disposed in between, so `heard` stays empty.
type HearingWorld = {
  api: TestApi;
  bus: EventBus;
  settings: ReturnType<typeof liveSettings>;
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

      api.services.alerts.setOpenCount('p', 2);

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
    });

    api.events.emit('x', 3);

    expect(heard).toEqual([3]);
  });

  it('createMainApi_Data_IsScopedToThePluginFolder', async () => {
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
      },
    );

    await api.data.write('x.txt', 'text');

    expect(await files.read('/d/forms/x.txt')).toBe('text');
    await expect(api.data.write('../x.txt', 'text')).rejects.toThrow(
      '../x.txt',
    );
  });

  it('createMainApi_SelfTest_IsTheHostForThePlugin', () => {
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
      },
    );

    api.drive?.add('open', action);

    expect(added).toEqual(['open']);
    expect(elsewhere.drive).toBeNull();
  });

  it('createMainApi_Layouts_RunUnderThePluginId', () => {
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

  it.each([
    { name: 'a key', arg: { id: 'a', process: 'main' } },
    { name: 'an id', arg: 'a' },
  ])('dependency asks the host for the plugin $name names', ({ arg }) => {
    const asked: string[] = [];
    const { api } = apiOver(liveSettings({ p: {} }), undefined, (pluginId) => {
      asked.push(pluginId);
      return { n: 1 };
    });

    const received = (api.dependency as (keyOrId: unknown) => unknown)(arg);

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
      const { api, registrations } = apiOver(settings, undefined, undefined, {
        bus,
      });
      const world = { api, bus, settings };
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
    api.services.alerts.setOpenCount('p', 2);
    api.services.alerts.setOpenCount('p.other', 0);
    counts.length = 0;

    registrations.dispose();

    expect(counts).toEqual([['p', 0]]);
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
