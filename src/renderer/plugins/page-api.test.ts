import { describe, expect, it } from 'vitest';
import type { Timers } from '../../contracts/ambient';
import type { Bridge } from '../../contracts/bridge';
import type { Disposable } from '../../contracts/disposable';
import type {
  DocumentEditor,
  DocumentEditorEvents,
  DocumentOptions,
  EditorEvents,
  EditorHost,
  TextEditor,
} from '../../contracts/editor';
import type {
  FenceContribution,
  MarkdownRenderer,
} from '../../contracts/markdown';
import type { Keymap } from '../../contracts/keymap';
import type {
  FocusTarget,
  OuterPanes,
  ResizeTarget,
} from '../../contracts/panes';
import type {
  Area,
  Mode,
  ModeHandle,
  Modes,
  PageChannel,
  PageTransparency,
  PluginManifest,
  ShellLayout,
} from '../../contracts/plugin';
import type { AppConfig } from '../../contracts/settings';
import type { PageLayouts } from '../../shared/page/layout-host/show-layouts';
import { createEventBus, type EventBus } from '../../shared/event-bus';
import { createRegistrations } from '../../shared/registrations';
import { createScopeStack, type ScopeStack } from '../key-scope';
import { createLiveConfig } from '../live-config';
import { createPageUiState } from '../ui-state';
import {
  createPageApi,
  type PageApiDeps,
  type PageApiServices,
} from './page-api';

const manifest: PluginManifest = {
  id: 'p',
  dependsOn: { main: [], page: [] },
  commands: {},
  scopes: { review: 'In review' },
  settings: {},
  settingInfo: {},
  themeTokens: {},
};

interface TestChannel {
  invoke: { save(a: number, b: number): string };
  messages: { shown: string; other: string };
}

// A Bridge recording the plugin calls it receives, whose `send` delivers a
// message as main would; the rest is unused here.
function fakeBridge() {
  const invoked: [string, string, unknown[]][] = [];
  const listeners: [string, string, (data: unknown) => void][] = [];
  const bridge = {
    invoke: (pluginId, method, args) => {
      invoked.push([pluginId, method, args]);
      return Promise.resolve('done');
    },
    onMessage: (pluginId, message, listener) => {
      const entry: (typeof listeners)[number] = [pluginId, message, listener];
      listeners.push(entry);
      return { dispose: () => listeners.splice(listeners.indexOf(entry), 1) };
    },
  } as Pick<Bridge, 'invoke' | 'onMessage'> as Bridge;
  const send = (pluginId: string, message: string, data: unknown) => {
    for (const [toPlugin, sent, listener] of listeners) {
      if (toPlugin === pluginId && sent === message) {
        listener(data);
      }
    }
  };
  return { bridge, invoked, listeners, send };
}

function testChannel(bridge: Bridge): PageChannel<TestChannel> {
  return createPageApi(manifest, deps({ bridge })).channel;
}

function keymap(command: string): Keymap {
  return {
    page: [{ keys: ['j'], scope: 'any', command }],
    editor: { leader: '<Space>', remaps: [], binds: [] },
    app: [],
    intercept: [],
    global: [],
    groups: {},
  };
}

// A served config carrying what the page API reads; the rest is unused here.
function appConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    settings: { keySequenceTimeoutMs: 1000 },
    keymap: keymap('p.down'),
    commands: {},
    scopes: [],
    pluginSettings: { p: { delayMs: 1 }, q: { delayMs: 1 } },
    platform: 'macos',
    problems: [],
    ...overrides,
  } as AppConfig;
}

function liveConfig(initial: AppConfig = appConfig()) {
  return createLiveConfig(initial, () => {});
}

function deps(overrides: Partial<PageApiDeps>): PageApiDeps {
  return {
    areas: {} as PageApiDeps['areas'],
    modes: {} as Modes,
    setLayout: () => ({ dispose: () => {} }),
    transparency: { override: () => {}, overridden: () => null },
    bridge: fakeBridge().bridge,
    scopeStack: createScopeStack('any'),
    pendingKeys: {
      onPending: () => ({ dispose: () => {} }),
      hold: () => {},
      cancel: () => {},
    },
    config: liveConfig(),
    services: {} as PageApiServices,
    uiState: createPageUiState({}, () => {}),
    run: () => {},
    dependency: () => undefined,
    registrations: createRegistrations(),
    bus: createEventBus(),
    layouts: {} as PageLayouts,
    paneTargets: {
      setResizeTarget: () => {},
      setFocusTarget: () => {},
      setOuterPanes: () => {},
      release: () => {},
    },
    drops: {
      addTarget: () => ({ dispose: () => {} }),
      savePasted: async () => '',
    },
    ...overrides,
  };
}

describe('createPageApi', () => {
  it('qualifies the scope a plugin sets', () => {
    const scopeStack = createScopeStack('any');
    const api = createPageApi(manifest, deps({ scopeStack }));

    api.keys.setScope('review');

    expect(scopeStack.current()).toBe('p.review');
  });

  it('qualifies the scope a plugin pushes, until its pop', () => {
    const scopeStack = createScopeStack('any');
    const api = createPageApi(manifest, deps({ scopeStack }));

    const pushed = api.keys.pushScope('review');
    expect(api.keys.scope()).toBe('p.review');

    pushed.pop();
    expect(api.keys.scope()).toBe('any');
  });

  it('tells a pushed scope when the set scope under it changes', () => {
    const api = createPageApi(manifest, deps({}));
    const heard: string[] = [];
    const pushed = api.keys.pushScope('review');
    pushed.onBaseChanged((base) => heard.push(base));

    api.keys.setScope('review');

    expect(heard).toEqual(['p.review']);
  });

  it('hands the resize and focus targets and the outer panes to the pane targets', () => {
    const handed: [string, ResizeTarget | FocusTarget | OuterPanes | null][] =
      [];
    const api = createPageApi(
      manifest,
      deps({
        paneTargets: {
          setResizeTarget: (target) => handed.push(['resize', target]),
          setFocusTarget: (target) => handed.push(['focus', target]),
          setOuterPanes: (panes) => handed.push(['outer', panes]),
          release: () => {},
        },
      }),
    );
    const resize: ResizeTarget = { nudge: () => true };
    const focus: FocusTarget = { move: () => true };
    const outer: OuterPanes = { focus, resize };

    api.panes.setResizeTarget(resize);
    api.panes.setFocusTarget(focus);
    api.panes.setOuterPanes(outer);
    api.panes.setOuterPanes(null);

    expect(handed).toEqual([
      ['resize', resize],
      ['focus', focus],
      ['outer', outer],
      ['outer', null],
    ]);
  });

  it("routes channel calls under the plugin's id", async () => {
    const { bridge, invoked } = fakeBridge();
    const channel = testChannel(bridge);

    const result = await channel.invoke('save', 1, 2);

    expect(invoked).toEqual([['p', 'save', [1, 2]]]);
    expect(result).toBe('done');
  });

  it("hands a listener the plugin's own messages of its name", () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    channel.on('shown', (data) => heard.push(data));

    send('p', 'shown', 'a');
    send('p', 'other', 'b');
    send('q', 'shown', 'c');

    expect(heard).toEqual(['a']);
  });

  it('stops a listener once its registration is disposed, leaving the others', () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    const first = channel.on('shown', (data) => heard.push(`first ${data}`));
    channel.on('shown', (data) => heard.push(`second ${data}`));

    send('p', 'shown', 'a');
    first.dispose();
    first.dispose();
    send('p', 'shown', 'b');

    expect(heard).toEqual(['first a', 'second a', 'second b']);
  });

  it('keeps one registration of a listener listened with twice when the other is removed', () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    const listener = (data: string) => heard.push(data);
    const first = channel.on('shown', listener);
    channel.on('shown', listener);

    first.dispose();
    send('p', 'shown', 'a');

    expect(heard).toEqual(['a']);
  });

  it('skips a listener removed by an earlier listener of the same message', () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    channel.on('shown', () => second.dispose());
    const second = channel.on('shown', (data) => heard.push(data));

    send('p', 'shown', 'a');

    expect(heard).toEqual([]);
  });

  it('takes one bridge listener per message name however many listen', () => {
    const { bridge, listeners } = fakeBridge();
    const channel = testChannel(bridge);

    channel.on('shown', () => {});
    channel.on('shown', () => {}).dispose();
    channel.on('shown', () => {});

    expect(listeners.map(([pluginId, message]) => [pluginId, message])).toEqual(
      [['p', 'shown']],
    );
  });

  it("services.log logs a one-argument line under the plugin's id", () => {
    const logged: string[][] = [];
    const api = createPageApi(
      manifest,
      deps({
        services: {
          log: (source: string, message: string) =>
            logged.push([source, message]),
        } as unknown as PageApiServices,
      }),
    );

    api.services.log('hello');

    expect(logged).toEqual([['p', 'hello']]);
  });

  it('gives the plugin events under its id', () => {
    const bus = createEventBus();
    const emitted: unknown[] = [];
    const heard: unknown[] = [];
    bus.on('p.x', (data) => emitted.push(data));
    const api = createPageApi(manifest, deps({ bus }));
    api.events.on('q.y', (data) => heard.push(data));

    api.events.emit('x', 3);
    bus.emit('q.y', 4);

    expect(emitted).toEqual([3]);
    expect(heard).toEqual([4]);
  });

  it('hands the plugin the title bar, panel, status bar, right bar and overlay areas', () => {
    const area = (): Area => ({ contribute: () => ({ dispose: () => {} }) });
    const areas: PageApiDeps['areas'] = {
      titleBar: area(),
      activityBar: area(),
      sideBar: area(),
      main: area(),
      rightBar: area(),
      panel: area(),
      statusBar: area(),
      overlay: area(),
    };

    const api = createPageApi(manifest, deps({ areas }));

    expect(Object.keys(api.areas).sort()).toEqual([
      'overlay',
      'panel',
      'rightBar',
      'statusBar',
      'titleBar',
    ]);
  });

  it("qualifies a mode's id by the plugin", () => {
    const added: Mode[] = [];
    const modes = {
      add: (mode) => {
        added.push(mode);
        return { dispose: () => {} } as ModeHandle;
      },
    } as Pick<Modes, 'add'> as Modes;
    const api = createPageApi(manifest, deps({ modes }));
    const element = {} as HTMLElement;
    const shown = () => {};
    const hidden = () => {};

    api.modes.add({
      id: 'browse',
      title: 'Browse',
      icon: 'x',
      element,
      shown,
      hidden,
    });

    expect(added).toEqual([
      { id: 'p.browse', title: 'Browse', icon: 'x', element, shown, hidden },
    ]);
  });

  it('settings() reads the current config', () => {
    const config = liveConfig();
    const api = createPageApi(manifest, deps({ config }));

    config.replace(
      appConfig({ pluginSettings: { p: { delayMs: 5 }, q: { delayMs: 1 } } }),
    );

    expect(api.settings()).toEqual({ delayMs: 5 });
  });

  it('onSettingsChanged fires only for the plugin whose settings changed', () => {
    const config = liveConfig();
    const heard: [string, object][] = [];
    const p = createPageApi(manifest, deps({ config }));
    const q = createPageApi({ ...manifest, id: 'q' }, deps({ config }));
    p.onSettingsChanged((settings) => heard.push(['p', settings]));
    q.onSettingsChanged((settings) => heard.push(['q', settings]));

    config.replace(
      appConfig({ pluginSettings: { p: { delayMs: 1 }, q: { delayMs: 9 } } }),
    );

    expect(heard).toEqual([['q', { delayMs: 9 }]]);
  });

  it('onKeymapChanged fires when the keymap changes and not for a settings-only change', () => {
    const config = liveConfig();
    const heard: Keymap[] = [];
    const api = createPageApi(manifest, deps({ config }));
    api.keys.onKeymapChanged((changed) => heard.push(changed));

    config.replace(
      appConfig({ pluginSettings: { p: { delayMs: 3 }, q: { delayMs: 1 } } }),
    );
    config.replace(appConfig({ keymap: keymap('p.up') }));

    expect(heard).toEqual([keymap('p.up')]);
    expect(api.keys.keymap()).toEqual(keymap('p.up'));
  });

  it('hands each plugin uiState scoped to its id', () => {
    const writes: [string, unknown][] = [];
    const uiState = createPageUiState({}, (key, value) =>
      writes.push([key, value]),
    );
    const api = createPageApi({ ...manifest, id: 'forms' }, deps({ uiState }));

    api.services.uiState.set('rail', 300);

    expect(writes).toEqual([['forms.rail', 300]]);
  });

  it('createPageApi_LayoutsShow_RunsUnderThePluginId', () => {
    const calls: string[] = [];
    const layouts: PageLayouts = {
      show: (owner) => {
        calls.push(`show ${owner}`);
        return {
          refresh: () => calls.push('refresh'),
          dispose: () => calls.push('dispose'),
        };
      },
    };
    const api = createPageApi(manifest, deps({ layouts }));

    const show = api.layouts.show({
      defaultLayout: {},
      defaultStylesheet: null,
      read: () => ({}),
      userLayout: () => 'default',
      setLayouts: () => undefined,
    });
    show.dispose();

    expect(calls).toEqual(['show p', 'dispose']);
  });

  it('dependency asks the host for the plugin a key names', () => {
    const asked: string[] = [];
    const api = createPageApi(
      manifest,
      deps({
        dependency: (pluginId) => {
          asked.push(pluginId);
          return { n: 1 };
        },
      }),
    );

    const received = api.dependency({ id: 'a', process: 'page' } as const);

    expect(received).toEqual({ n: 1 });
    expect(asked).toEqual(['a']);
  });
});

// One member of the page API that returns a handle: `register` makes the
// registration through `api`, over deps whose handle-returning member is
// `dep`'s, which hands back `handle`.
type RecordedRow = {
  member: string;
  dep(handle: Disposable): Partial<PageApiDeps>;
  register(api: ReturnType<typeof createPageApi>): unknown;
};

function areaRow(
  name: 'titleBar' | 'panel' | 'statusBar' | 'rightBar' | 'overlay',
): RecordedRow {
  return {
    member: `areas.${name}.contribute`,
    dep: (handle) => ({
      areas: {
        [name]: { contribute: () => handle },
      } as unknown as PageApiDeps['areas'],
    }),
    register: (api) => api.areas[name].contribute({} as HTMLElement),
  };
}

const RECORDED_ROWS: RecordedRow[] = [
  areaRow('titleBar'),
  areaRow('panel'),
  areaRow('statusBar'),
  areaRow('rightBar'),
  areaRow('overlay'),
  {
    member: 'shell.setLayout',
    dep: (handle) => ({ setLayout: () => handle }),
    register: (api) => api.shell.setLayout({} as ShellLayout),
  },
  {
    member: 'drops.addTarget',
    dep: (handle) => ({
      drops: { addTarget: () => handle, savePasted: async () => '' },
    }),
    register: (api) =>
      api.drops.addTarget({ element: {} as HTMLElement, take: () => {} }),
  },
  {
    member: 'layouts.show',
    dep: (handle) => ({
      layouts: {
        show: () => ({ refresh: () => {}, dispose: () => handle.dispose() }),
      },
    }),
    register: (api) =>
      api.layouts.show({
        defaultLayout: {},
        defaultStylesheet: null,
        read: () => ({}),
        userLayout: () => 'default',
        setLayouts: () => undefined,
      }),
  },
  {
    member: 'modes.add',
    dep: (handle) => ({
      modes: { add: () => handle } as unknown as Modes,
    }),
    register: (api) => api.modes.add({ id: 'browse' } as Mode),
  },
  {
    member: 'modes.onChanged',
    dep: (handle) => ({
      modes: { onChanged: () => handle } as unknown as Modes,
    }),
    register: (api) => api.modes.onChanged(() => {}),
  },
  {
    member: 'keys.onPending',
    dep: (handle) => ({
      pendingKeys: {
        onPending: () => handle,
        hold: () => {},
        cancel: () => {},
      },
    }),
    register: (api) => api.keys.onPending(() => {}),
  },
  {
    member: 'services.markdown.addFence',
    dep: (handle) => ({
      services: {
        markdown: { addFence: () => handle } as unknown as MarkdownRenderer,
      } as PageApiDeps['services'],
    }),
    register: (api) => api.services.markdown.addFence({} as FenceContribution),
  },
  {
    member: 'services.editor.onPendingKeys',
    dep: (handle) => ({
      services: {
        editor: { onPendingKeys: () => handle } as unknown as EditorHost,
      } as PageApiDeps['services'],
    }),
    register: (api) => api.services.editor.onPendingKeys(() => {}),
  },
];

// One listener registered through `api`, and what makes the source speak:
// the registration is disposed in between, so `heard` stays empty.
type HearingWorld = {
  api: ReturnType<typeof createPageApi>;
  send: ReturnType<typeof fakeBridge>['send'];
  bus: EventBus;
  scopeStack: ScopeStack;
  config: ReturnType<typeof liveConfig>;
};

const HEARING_ROWS: {
  member: string;
  listen(world: HearingWorld, heard: (data: unknown) => void): void;
  speak(world: HearingWorld): void;
}[] = [
  {
    member: 'channel.on',
    listen: ({ api }, heard) => api.channel.on('shown', heard),
    speak: ({ send }) => send('p', 'shown', 'a'),
  },
  {
    member: 'events.on',
    listen: ({ api }, heard) => api.events.on('q.done', heard),
    speak: ({ bus }) => bus.emit('q.done', 1),
  },
  {
    member: 'keys.onScopeChanged',
    listen: ({ api }, heard) => api.keys.onScopeChanged(heard),
    speak: ({ scopeStack }) => scopeStack.setBase('q.view'),
  },
  {
    member: 'keys.onKeymapChanged',
    listen: ({ api }, heard) => api.keys.onKeymapChanged(heard),
    speak: ({ config }) =>
      config.replace(appConfig({ keymap: keymap('p.up') })),
  },
  {
    member: 'onSettingsChanged',
    listen: ({ api }, heard) => api.onSettingsChanged(heard),
    speak: ({ config }) =>
      config.replace(
        appConfig({ pluginSettings: { p: { delayMs: 2 }, q: { delayMs: 1 } } }),
      ),
  },
];

// Timers numbering their handles from 1, recording each clear.
function fakeTimers() {
  const cleared: number[] = [];
  let last = 0;
  const timers: Timers = {
    set: () => {
      last += 1;
      return last;
    },
    clear: (handle) => cleared.push(handle),
  };
  return { timers, cleared };
}

// An editor host whose editors count their `destroy`, in creation order.
function countingEditors() {
  const destroys: number[] = [];
  const counted = <E>(): E => {
    const index = destroys.push(0) - 1;
    return {
      destroy: () => {
        destroys[index] += 1;
      },
    } as E;
  };
  const editor = {
    create: () => counted<TextEditor>(),
    createDocument: () => counted<DocumentEditor>(),
  } as unknown as EditorHost;
  return { editor, destroys };
}

describe('createPageApi recording', () => {
  it.each(RECORDED_ROWS)(
    "disposes what $member returned when the plugin's registrations are disposed",
    ({ member, dep, register }) => {
      const disposed: string[] = [];
      const registrations = createRegistrations();
      const api = createPageApi(
        manifest,
        deps({
          registrations,
          ...dep({ dispose: () => disposed.push(member) }),
        }),
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
      const { bridge, send } = fakeBridge();
      const bus = createEventBus();
      const scopeStack = createScopeStack('any');
      const config = liveConfig();
      const registrations = createRegistrations();
      const api = createPageApi(
        manifest,
        deps({ bridge, bus, scopeStack, config, registrations }),
      );
      const world = { api, send, bus, scopeStack, config };
      const heard: unknown[] = [];
      listen(world, (data) => heard.push(data));

      registrations.dispose();
      speak(world);

      expect(heard).toEqual([]);
    },
  );

  it('pops the scopes the plugin pushed when its registrations are disposed', () => {
    const scopeStack = createScopeStack('any');
    const registrations = createRegistrations();
    const api = createPageApi(manifest, deps({ scopeStack, registrations }));

    api.keys.pushScope('review');
    registrations.dispose();

    expect(scopeStack.current()).toBe('any');
  });

  it('forgets a pushed scope the plugin popped', () => {
    const real = createScopeStack('any');
    const handled: string[] = [];
    const scopeStack: ScopeStack = {
      ...real,
      push(scope) {
        const pushed = real.push(scope);
        return {
          ...pushed,
          pop() {
            handled.push('pop');
            pushed.pop();
          },
          dispose() {
            handled.push('dispose');
            pushed.dispose();
          },
        };
      },
    };
    const registrations = createRegistrations();
    const api = createPageApi(manifest, deps({ scopeStack, registrations }));

    const pushed = api.keys.pushScope('review');
    pushed.pop();
    const handledByThePop = [...handled];
    registrations.dispose();

    expect(scopeStack.current()).toBe('any');
    expect(handled.filter((call) => call === 'pop')).toEqual(['pop']);
    expect(handled).toEqual(handledByThePop);
    expect(() => pushed.pop()).toThrow('Scope p.review was already popped');
  });

  it("clears the plugin's pending timer when its registrations are disposed", () => {
    const { timers, cleared } = fakeTimers();
    const registrations = createRegistrations();
    const api = createPageApi(
      manifest,
      deps({
        registrations,
        services: { timers } as PageApiDeps['services'],
      }),
    );

    api.services.timers.set(() => {}, 10);
    registrations.dispose();

    expect(cleared).toEqual([1]);
  });

  it('destroys the editors the plugin created and has not destroyed when its registrations are disposed', () => {
    const { editor, destroys } = countingEditors();
    const registrations = createRegistrations();
    const api = createPageApi(
      manifest,
      deps({
        registrations,
        services: { editor } as PageApiDeps['services'],
      }),
    );
    const parent = {} as HTMLElement;

    const first = api.services.editor.create(parent, '', {} as EditorEvents);
    api.services.editor.create(parent, '', {} as EditorEvents);
    api.services.editor.createDocument(
      parent,
      '',
      {} as DocumentOptions,
      {} as DocumentEditorEvents,
    );
    first.destroy();
    registrations.dispose();
    expect(destroys).toEqual([1, 1, 1]);

    api.services.editor.create(parent, '', {} as EditorEvents);
    expect(destroys).toEqual([1, 1, 1, 1]);
  });

  it('releases each pane target the plugin set when its registrations are disposed', () => {
    const released: unknown[] = [];
    const registrations = createRegistrations();
    const api = createPageApi(
      manifest,
      deps({
        registrations,
        paneTargets: {
          setResizeTarget: () => {},
          setFocusTarget: () => {},
          setOuterPanes: () => {},
          release: (target) => released.push(target),
        },
      }),
    );
    const resize: ResizeTarget = { nudge: () => true };
    const focus: FocusTarget = { move: () => true };
    const outer: OuterPanes = { focus, resize };

    api.panes.setResizeTarget(resize);
    api.panes.setFocusTarget(focus);
    api.panes.setOuterPanes(outer);
    api.panes.setFocusTarget(null);
    registrations.dispose();

    expect(released).toEqual([resize, outer]);
  });

  it.each<{
    case: string;
    act(p: PageTransparency, q: PageTransparency): void;
    calls: ('full' | 'reduced' | null)[];
  }>([
    {
      case: 'still holds',
      act: (p) => p.override('full'),
      calls: [null],
    },
    {
      case: 'another plugin replaced it',
      act(p, q) {
        p.override('full');
        q.override('reduced');
      },
      calls: [],
    },
    {
      case: 'the plugin handed it back',
      act(p) {
        p.override('full');
        p.override(null);
      },
      calls: [],
    },
  ])(
    "clears the transparency override at dispose only while it holds the plugin's value ($case)",
    ({ act, calls: expected }) => {
      let value: 'full' | 'reduced' | null = null;
      const calls: ('full' | 'reduced' | null)[] = [];
      const transparency: PageTransparency = {
        override(next) {
          value = next;
          calls.push(next);
        },
        overridden: () => value,
      };
      const registrations = createRegistrations();
      const p = createPageApi(manifest, deps({ transparency, registrations }));
      const q = createPageApi({ ...manifest, id: 'q' }, deps({ transparency }));
      act(p.transparency, q.transparency);
      calls.length = 0;

      registrations.dispose();

      expect(calls).toEqual(expected);
    },
  );

  it('drops the bridge listener of a message once its last registration is disposed, and takes a new one when listened again', () => {
    const { bridge, listeners } = fakeBridge();
    const channel = testChannel(bridge);
    const a = channel.on('shown', () => {});
    const b = channel.on('shown', () => {});

    a.dispose();
    expect(listeners.length).toBe(1);

    b.dispose();
    expect(listeners.length).toBe(0);

    channel.on('shown', () => {});
    expect(listeners.length).toBe(1);
  });
});
