import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../contracts/disposable';
import type { EditorEvents } from '../contracts/editor';
import type { Keymap } from '../contracts/keymap';
import type { MarkdownRenderer } from '../contracts/markdown';
import type {
  DependencyKey,
  LayoutShow,
  MainPart,
  PagePart,
} from '../contracts/plugin';
import type { SlotKey } from '../contracts/state';
import { definePlugin } from './define-plugin';
import {
  countingEditors,
  fakeDependency,
  noCounts,
  startMainPart,
  startPagePart,
} from './plugin-part-harness.test-support';
import { createSlotStore } from './state/slot-store';

const sampleSlot: SlotKey<number, 'main', 'sample'> = {
  id: 'sample.v',
  process: 'main',
  kind: 'value',
};

const depMainKey: DependencyKey<{ add(): Disposable }, 'main', 'dep'> = {
  id: 'dep',
  process: 'main',
};
const otherKey: DependencyKey<{ ping(): string }, 'main', 'other'> = {
  id: 'other',
  process: 'main',
};

const mainManifest = definePlugin({
  id: 'sample',
  dependsOn: { main: ['dep', 'other'], page: [] },
  reads: { main: [], page: [] },
  commands: { run: { label: 'Run', group: 'Sample', runsIn: 'main' } },
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const pageManifest = definePlugin({
  id: 'sample',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: { run: { label: 'Run', group: 'Sample', runsIn: 'page' } },
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const depManifest = definePlugin({
  id: 'dep',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});

const depFake = fakeDependency(depMainKey, (consumer) => ({
  add: () => consumer.track({ dispose() {} }),
}));

const element = {} as HTMLElement;

const browseMode = {
  id: 'browse',
  title: 'Browse',
  icon: 'book',
  element,
  shown() {},
  hidden() {},
};

const sampleFence = {
  language: 'sample',
  live: false,
  mount: () => ({ element, dispose() {} }),
};

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

type MainSampleApi = Parameters<MainPart<typeof mainManifest>['start']>[0];
type PageSampleApi = Parameters<PagePart<typeof pageManifest>['start']>[0];

function mainPart(
  start: MainPart<typeof mainManifest>['start'],
): MainPart<typeof mainManifest> {
  return { manifest: mainManifest, start };
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
      manifest: depManifest,
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
    const part = pagePart((api) => {
      api.services.markdown.addFence(sampleFence);
      return { commands: { run() {} } };
    });
    const harness = startPagePart(part);

    // The fence and the command.
    expect(harness.counts().registrations).toBe(2);
    expect(harness.fences).toEqual([sampleFence]);

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

  it.each<{
    member: string;
    registerTwice(api: MainSampleApi): void;
    message: string;
  }>([
    {
      member: 'channel.handle',
      registerTwice(api) {
        api.channel.handle('ping', () => 'first');
        api.channel.handle('ping', () => 'second');
      },
      message: 'Plugin "sample" registered a main handler for "ping" twice',
    },
    {
      member: 'layouts.register',
      registerTwice(api) {
        api.layouts.register({ layoutTypes: '' });
        api.layouts.register({ layoutTypes: '' });
      },
      message: 'layouts of sample already registered',
    },
  ])(
    'throws as $member does on a second registration',
    ({ registerTwice, message }) => {
      const part = mainPart((api) => {
        registerTwice(api);
        return { commands: { run() {} } };
      });

      expect(() => startMainPart(part)).toThrow(message);
    },
  );

  it.each<{
    member: string;
    misuse(api: PageSampleApi): void;
    message: string;
  }>([
    {
      member: 'markdown.addFence',
      misuse({ services: { markdown } }) {
        markdown.addFence(sampleFence);
        markdown.addFence({ ...sampleFence, language: 'other' });
        markdown.addFence({ ...sampleFence, language: ' Sample ' });
      },
      message: 'fence sample is already registered',
    },
    {
      member: 'ModeHandle.toggleSideBar',
      misuse({ modes }) {
        const gone = modes.add({ ...browseMode, id: 'gone' });
        gone.dispose();
        gone.toggleSideBar();
        modes
          .add({ ...browseMode, id: 'beside', sideBar: element })
          .toggleSideBar();
        modes.add(browseMode).toggleSideBar();
      },
      message: 'Mode "sample.browse" has no side bar',
    },
  ])('throws as $member does on a misuse only', ({ misuse, message }) => {
    const part = pagePart((api) => {
      misuse(api);
      return { commands: { run() {} } };
    });

    expect(() => startPagePart(part)).toThrow(message);
  });

  it('rejects as services.openExternal does on anything but a web link', async () => {
    const harness = startMainPart(
      mainPart((api) => {
        api.channel.handle('open', (url: string) =>
          api.services.openExternal(url),
        );
        return { commands: { run() {} } };
      }),
    );

    await expect(
      harness.invoke('open', 'https://a.test/'),
    ).resolves.toBeUndefined();
    await expect(harness.invoke('open', 'file:///a')).rejects.toThrow(
      'Refused to open file:///a',
    );
    await expect(harness.invoke('open', 'not a url')).rejects.toThrow(
      'Refused to open not a url',
    );
  });

  it('throws as modes.add does on an id still live, and takes it again once disposed', async () => {
    expect(() =>
      startPagePart(
        pagePart((api) => {
          api.modes.add(browseMode);
          api.modes.add(browseMode);
          return { commands: { run() {} } };
        }),
      ),
    ).toThrow('Mode "sample.browse" is added twice');

    const harness = startPagePart(
      pagePart((api) => {
        api.modes.add(browseMode);
        return { commands: { run() {} } };
      }),
    );
    await expect(harness.restart()).resolves.toBeUndefined();
  });

  it.each([
    { firstModeTaken: false, shownCalls: 1 },
    { firstModeTaken: true, shownCalls: 0 },
  ])(
    'calls a first added mode $shownCalls times when firstModeTaken is $firstModeTaken',
    ({ firstModeTaken, shownCalls }) => {
      const shown = vi.fn();
      startPagePart(
        pagePart((api) => {
          api.modes.add({ ...browseMode, shown });
          return { commands: { run() {} } };
        }),
        { firstModeTaken },
      );

      expect(shown).toHaveBeenCalledTimes(shownCalls);
    },
  );

  it('ends what a part left of a replaced editor and markdown at its stop', async () => {
    const editors = countingEditors();
    const fenceDisposed = vi.fn();
    const part = pagePart((api) => {
      api.services.editor.create(element, 'text', {} as EditorEvents);
      api.services.markdown.addFence(sampleFence);
      return { commands: { run() {} } };
    });
    const harness = startPagePart(part, {
      services: {
        editor: editors.host,
        markdown: {
          addFence: () => ({ dispose: fenceDisposed }),
        } as unknown as MarkdownRenderer,
      },
    });
    expect(editors.live()).toBe(1);
    expect(fenceDisposed).not.toHaveBeenCalled();

    await harness.stop();

    expect(editors.live()).toBe(0);
    expect(fenceDisposed).toHaveBeenCalledTimes(1);
  });

  it('throws from invoke once the part stopped', async () => {
    const harness = startMainPart(mainSample, { dependencies: [depFake] });
    expect(harness.invoke('ping')).toBe('pong');

    await harness.stop();

    expect(() => harness.invoke('ping')).toThrow(
      'part harness: no handler for ping',
    );
  });

  it('tells a channel listener a send only while the part is live', async () => {
    const listener = vi.fn();
    const harness = startPagePart(
      pagePart((api) => {
        api.channel.on('changed', listener);
        return { commands: { run() {} } };
      }),
    );

    harness.send('changed', 1);
    expect(listener.mock.calls).toEqual([[1]]);

    await harness.stop();
    harness.send('changed', 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tells a listener an emit only while live, and keeps what the part emitted past its stop', async () => {
    const listener = vi.fn();
    let emitSaved: (data: number) => void = () => undefined;
    const harness = startMainPart(
      mainPart((api) => {
        api.events.on('dep.changed', listener);
        emitSaved = (data) => api.events.emit('saved', data);
        return { commands: { run() {} } };
      }),
    );

    harness.emit('dep.changed', 1);
    expect(listener.mock.calls).toEqual([[1]]);
    emitSaved(2);

    await harness.stop();
    harness.emit('dep.changed', 3);
    emitSaved(4);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(harness.emitted).toEqual([
      { event: 'sample.saved', data: 2 },
      { event: 'sample.saved', data: 4 },
    ]);
  });

  it('harness_Restart_KeepsSlotValueAndReleasesClaim', async () => {
    const lastRead: (number | undefined)[] = [];
    const harness = startMainPart(
      mainPart((api) => {
        const writer = api.state.publish(sampleSlot);
        lastRead.push(writer.get());
        api.channel.handle('save', (value: number) => writer.set(value));
        return { commands: { run() {} } };
      }),
    );

    harness.invoke('save', 7);
    await harness.restart();

    expect(lastRead).toEqual([undefined, 7]);
  });

  it('counts a writer and an on until stop', async () => {
    const harness = startMainPart(
      mainPart((api) => {
        api.state.publish(sampleSlot);
        api.state.read(sampleSlot).on(() => {});
        return { commands: { run() {} } };
      }),
    );

    // The part's command, its writer and its listener.
    expect(harness.counts().registrations).toBe(3);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('shows the part a store it was given, and the test a write through it', () => {
    const state = createSlotStore(() => {});
    const seeding = state.publish(sampleSlot);
    seeding.set(3);
    seeding.dispose();
    const heard: (number | undefined)[] = [];
    const otherSlot: SlotKey<number, 'main', 'other'> = {
      id: 'other.v',
      process: 'main',
      kind: 'value',
    };
    const harness = startMainPart(
      mainPart((api) => {
        heard.push(api.state.publish(sampleSlot).get());
        api.state.read(otherSlot).on((value) => heard.push(value));
        return { commands: { run() {} } };
      }),
      { state },
    );

    harness.state.publish(otherSlot).set(4);

    expect(heard).toEqual([3, 4]);
  });

  it("keeps a real provider's own handles out of the counts", () => {
    const provider: MainPart = {
      manifest: depManifest,
      start(api) {
        api.channel.handle('own', () => undefined);
        api.services.files.watch('/home/own', () => {});
        api.services.timers.set(() => {}, 1000);
        return { commands: {} };
      },
    };

    const harness = startMainPart(
      mainPart(() => ({ commands: { run() {} } })),
      { parts: [provider] },
    );

    // The part's command alone.
    expect(harness.counts()).toEqual({ ...noCounts, registrations: 1 });
  });

  it('shows a spy set on the files after the start what the part calls', async () => {
    const harness = startMainPart(
      mainPart((api) => {
        api.channel.handle('save', async () => {
          await api.services.files.write('/home/a.txt', 'a');
          await api.data.write('b.txt', 'b');
        });
        return { commands: { run() {} } };
      }),
    );
    const write = vi.spyOn(harness.files, 'write');

    await harness.invoke('save');

    expect(write.mock.calls).toEqual([
      ['/home/a.txt', 'a'],
      ['/data/sample/b.txt', 'b'],
    ]);
  });
});
