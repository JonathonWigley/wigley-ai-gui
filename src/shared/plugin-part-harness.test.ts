import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../contracts/disposable';
import type { Keymap } from '../contracts/keymap';
import type {
  DependencyKey,
  LayoutShow,
  MainPart,
  PagePart,
} from '../contracts/plugin';
import { definePlugin } from './define-plugin';
import {
  fakeDependency,
  startMainPart,
  startPagePart,
} from './plugin-part-harness.test-support';

const depMainKey: DependencyKey<{ add(): Disposable }, 'main', 'dep'> = {
  id: 'dep',
  process: 'main',
};
const otherKey: DependencyKey<{ ping(): string }, 'main', 'other'> = {
  id: 'other',
  process: 'main',
};
const noCounts = {
  registrations: 0,
  timers: 0,
  listeners: 0,
  observers: 0,
  frames: 0,
};

const mainManifest = definePlugin({
  id: 'sample',
  dependsOn: { main: ['dep', 'other'], page: [] },
  commands: { run: { label: 'Run', group: 'Sample', runsIn: 'main' } },
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const pageManifest = definePlugin({
  id: 'sample',
  dependsOn: { main: [], page: [] },
  commands: { run: { label: 'Run', group: 'Sample', runsIn: 'page' } },
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const depFake = fakeDependency(depMainKey, (consumer) => ({
  add: () => consumer.track({ dispose() {} }),
}));

const element = {} as HTMLElement;

const mainSample: MainPart<typeof mainManifest> = {
  manifest: mainManifest,
  start(api) {
    api.channel.handle('ping', () => 'pong');
    api.events.on('dep.changed', () => {});
    api.layouts.register({ layoutTypes: '' });
    api.onSettingsChanged(() => {});
    api.services.files.watch('/home/notes', () => {});
    api.dependency(depMainKey).add();
    api.services.timers.set(() => {}, 1000);
    return { commands: { run() {} } };
  },
};

function pageSample(kind: 'tidy' | 'leaky'): PagePart<typeof pageManifest> {
  return {
    manifest: pageManifest,
    start(api) {
      const onResize = () => {};
      const onKeydown = () => {};
      window.addEventListener('resize', onResize);
      document.addEventListener('keydown', onKeydown);
      const observer = new ResizeObserver(() => {});
      observer.observe(element);
      const frame = requestAnimationFrame(() => {});
      api.areas.statusBar.contribute(element);
      api.keys.onScopeChanged(() => {});
      api.channel.on('changed', () => {});
      return {
        commands: { run() {} },
        dispose() {
          if (kind === 'tidy') {
            window.removeEventListener('resize', onResize);
          }
          document.removeEventListener('keydown', onKeydown);
          observer.disconnect();
          cancelAnimationFrame(frame);
        },
      };
    },
  };
}

function pagePart(
  start: PagePart<typeof pageManifest>['start'],
): PagePart<typeof pageManifest> {
  return { manifest: pageManifest, start };
}

describe('plugin part harness', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('counts what a main part registers and reports none after it stops', async () => {
    const harness = startMainPart(mainSample, { dependencies: [depFake] });

    expect(harness.counts()).toEqual({
      ...noCounts,
      registrations: 7,
      timers: 1,
    });

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it.each([
    { kind: 'tidy', listeners: 0 },
    { kind: 'leaky', listeners: 1 },
  ] as const)(
    'reports $listeners live listeners after a page part whose dispose is $kind stops',
    async ({ kind, listeners }) => {
      const harness = startPagePart(pageSample(kind));

      expect(harness.counts()).toEqual({
        registrations: 4,
        timers: 0,
        listeners: 2,
        observers: 1,
        frames: 1,
      });

      await harness.stop();

      expect(harness.counts()).toEqual({ ...noCounts, listeners });
    },
  );

  it('starts a stopped part again with the same counts', async () => {
    const harness = startMainPart(mainSample, { dependencies: [depFake] });
    const firstStart = harness.started();
    const firstCounts = harness.counts();

    await harness.stop();
    await harness.restart();

    expect(harness.started()).not.toBe(firstStart);
    expect(harness.counts()).toEqual(firstCounts);
  });

  it('keeps counting a listener a leaky dispose left across a restart', async () => {
    const harness = startPagePart(pageSample('leaky'));

    await harness.stop();
    await harness.restart();
    expect(harness.counts().listeners).toBe(3);

    await harness.stop();
    expect(harness.counts().listeners).toBe(2);
  });

  it('returns undefined for a listed dependency with no fake', () => {
    let other: unknown = 'unread';
    const part: MainPart<typeof mainManifest> = {
      manifest: mainManifest,
      start(api) {
        other = api.dependency(otherKey);
        return { commands: { run() {} } };
      },
    };

    startMainPart(part, { dependencies: [depFake] });

    expect(other).toBeUndefined();
  });

  it('starts a real provider part before the part and stops it after', async () => {
    const stopped: string[] = [];
    const provider: MainPart = {
      manifest: definePlugin({
        id: 'dep',
        dependsOn: { main: [], page: [] },
        commands: {},
        scopes: {},
        settings: {},
        settingInfo: {},
        themeTokens: {},
      }),
      start: () => ({
        commands: {},
        exports: (consumer) => ({
          add: () => consumer.track({ dispose() {} }),
        }),
        dispose() {
          stopped.push('dep');
        },
      }),
    };
    const part: MainPart<typeof mainManifest> = {
      manifest: mainManifest,
      start(api) {
        api.dependency(depMainKey).add();
        return {
          commands: { run() {} },
          dispose() {
            stopped.push('sample');
          },
        };
      },
    };

    const harness = startMainPart(part, { parts: [provider] });

    // The filed handle and the command.
    expect(harness.counts().registrations).toBe(2);

    await harness.stop();

    expect(stopped).toEqual(['sample', 'dep']);
    expect(harness.counts()).toEqual(noCounts);
    expect(() =>
      startMainPart(part, { parts: [provider], dependencies: [depFake] }),
    ).toThrow('part harness: "dep" is both a fake dependency and a real part');
  });

  it('fires a window listener and shows its frame', async () => {
    const part = pagePart(() => {
      let frame = 0;
      const onResize = () => {
        frame = requestAnimationFrame(() => {});
      };
      window.addEventListener('resize', onResize);
      return {
        commands: { run() {} },
        dispose() {
          window.removeEventListener('resize', onResize);
          cancelAnimationFrame(frame);
        },
      };
    });
    const harness = startPagePart(part);

    harness.fireWindow('resize');
    expect(harness.counts().frames).toBe(1);

    await harness.stop();
    expect(harness.counts().frames).toBe(0);

    harness.fireWindow('resize');
    expect(harness.counts().frames).toBe(0);
  });

  it('delivers a layout set to a live show only', () => {
    const setLayouts = vi.fn();
    let show: LayoutShow | undefined;
    const part = pagePart((api) => {
      show = api.layouts.show({
        defaultLayout: {},
        defaultStylesheet: null,
        read: () => ({}),
        userLayout: () => 'default',
        setLayouts,
      });
      return { commands: { run() {} } };
    });
    const harness = startPagePart(part);
    const shown = { layouts: new Map(), user: 'default' };

    harness.showLayouts(shown);
    expect(setLayouts.mock.calls).toEqual([[shown]]);

    show?.dispose();
    harness.showLayouts(shown);
    expect(setLayouts).toHaveBeenCalledTimes(1);
  });

  it('pushes a keymap to a live listener only', () => {
    const listener = vi.fn();
    let handle: Disposable | undefined;
    const part = pagePart((api) => {
      handle = api.keys.onKeymapChanged(listener);
      return { commands: { run() {} } };
    });
    const harness = startPagePart(part);
    const keymap: Keymap = {
      editor: { leader: ',', remaps: [], binds: [] },
      page: [],
      app: [],
      intercept: [],
      global: [],
      groups: {},
    };

    harness.pushKeymap(keymap);
    expect(listener.mock.calls).toEqual([[keymap]]);

    handle?.dispose();
    harness.pushKeymap(keymap);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('counts the markdown fence a page part adds', async () => {
    const fence = {
      language: 'sample',
      live: false,
      mount: () => ({ element, dispose() {} }),
    };
    const part = pagePart((api) => {
      api.services.markdown.addFence(fence);
      return { commands: { run() {} } };
    });
    const harness = startPagePart(part);

    // The fence and the command.
    expect(harness.counts().registrations).toBe(2);
    expect(harness.fences).toEqual([fence]);

    await harness.stop();

    expect(harness.counts().registrations).toBe(0);
    expect(harness.fences).toEqual([]);
  });

  it('knows only the commands of the part that asks', () => {
    let own: unknown;
    let another: unknown;
    const part = pagePart((api) => {
      own = api.keys.command('sample.run');
      another = api.keys.command('chat.newSession');
      return { commands: { run() {} } };
    });

    startPagePart(part);

    expect(own).toEqual({
      id: 'sample.run',
      plugin: 'sample',
      label: 'Run',
      group: 'Sample',
      runsIn: 'page',
    });
    expect(another).toBeUndefined();
  });

  it('rejects a fake dependency the manifest does not list', () => {
    const started = vi.fn();
    const part: MainPart = {
      manifest: { ...mainManifest, dependsOn: { main: [], page: [] } },
      start() {
        started();
        return { commands: {} };
      },
    };

    expect(() => startMainPart(part, { dependencies: [depFake] })).toThrow(
      `part harness: fake dependency "dep" is not in sample's dependsOn.main`,
    );
    expect(started).not.toHaveBeenCalled();
  });

  it('runs due timers in due order and moves the clock', async () => {
    const ran: [string, number][] = [];
    const part: MainPart<typeof mainManifest> = {
      manifest: mainManifest,
      start(api) {
        const { timers, clock } = api.services;
        timers.set(() => ran.push(['late', clock.now()]), 300);
        timers.set(() => ran.push(['early', clock.now()]), 100);
        timers.set(() => ran.push(['never', clock.now()]), 900);
        return { commands: { run() {} } };
      },
    };
    const harness = startMainPart(part);

    harness.advance(500);

    expect(ran).toEqual([
      ['early', 100],
      ['late', 300],
    ]);
    expect(harness.counts().timers).toBe(1);

    await harness.stop();
    expect(harness.counts().timers).toBe(0);
  });

  it('throws from started while the part is stopped', async () => {
    const harness = startMainPart(mainSample, { dependencies: [depFake] });

    await harness.stop();

    expect(() => harness.started()).toThrow('part harness: sample is stopped');
  });

  it('throws when a part calls a service that is not faked', () => {
    const part: MainPart<typeof mainManifest> = {
      manifest: mainManifest,
      start(api) {
        void api.services.git.topLevel('/home');
        return { commands: { run() {} } };
      },
    };

    expect(() => startMainPart(part)).toThrow(
      'part harness: services.git.topLevel is not faked; pass it in options.services',
    );
  });
});
