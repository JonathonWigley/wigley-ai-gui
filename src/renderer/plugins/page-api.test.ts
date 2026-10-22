import { describe, expect, it } from 'vitest';
import type { Bridge } from '../../contracts/bridge';
import type { Keymap } from '../../contracts/keymap';
import type {
  Area,
  Mode,
  ModeHandle,
  Modes,
  PageChannel,
  PageServices,
  PluginManifest,
  ShellLayout,
} from '../../contracts/plugin';
import type { AppConfig } from '../../contracts/settings';
import { createEventBus } from '../../shared/event-bus';
import { createScopeStack } from '../key-scope';
import { createLiveConfig } from '../live-config';
import { createPageApi, type PageApiDeps } from './page-api';

const manifest: PluginManifest = {
  id: 'p',
  dependsOn: [],
  commands: {},
  scopes: { review: 'In review' },
  keys: { page: [], editor: [], app: [], global: [], intercept: [] },
  settings: {},
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
      listeners.push([pluginId, message, listener]);
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
    bridge: fakeBridge().bridge,
    scopeStack: createScopeStack('any'),
    pendingKeys: { onPending: () => {}, hold: () => {}, cancel: () => {} },
    config: liveConfig(),
    services: {} as PageServices,
    run: () => {},
    dependency: <E>() => undefined as E,
    bus: createEventBus(),
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

  it('stops a listener once its registration is removed, leaving the others', () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    const first = channel.on('shown', (data) => heard.push(`first ${data}`));
    channel.on('shown', (data) => heard.push(`second ${data}`));

    send('p', 'shown', 'a');
    first.remove();
    first.remove();
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

    first.remove();
    send('p', 'shown', 'a');

    expect(heard).toEqual(['a']);
  });

  it('skips a listener removed by an earlier listener of the same message', () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    channel.on('shown', () => second.remove());
    const second = channel.on('shown', (data) => heard.push(data));

    send('p', 'shown', 'a');

    expect(heard).toEqual([]);
  });

  it('takes one bridge listener per message name however many listen', () => {
    const { bridge, listeners } = fakeBridge();
    const channel = testChannel(bridge);

    channel.on('shown', () => {});
    channel.on('shown', () => {}).remove();
    channel.on('shown', () => {});

    expect(listeners.map(([pluginId, message]) => [pluginId, message])).toEqual(
      [['p', 'shown']],
    );
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

  it('hands the plugin the title bar, panel, status bar and overlay areas', () => {
    const area = (): Area => ({ contribute: () => ({ dispose: () => {} }) });
    const areas: PageApiDeps['areas'] = {
      titleBar: area(),
      activityBar: area(),
      sideBar: area(),
      main: area(),
      panel: area(),
      statusBar: area(),
      overlay: area(),
    };

    const api = createPageApi(manifest, deps({ areas }));

    expect(api.areas).toEqual({
      titleBar: areas.titleBar,
      panel: areas.panel,
      statusBar: areas.statusBar,
      overlay: areas.overlay,
    });
    expect(api.areas).not.toHaveProperty('main');
    expect(api.areas).not.toHaveProperty('activityBar');
    expect(api.areas).not.toHaveProperty('sideBar');
  });

  it('shell.setLayout hands the layout to the shell and returns its Disposable', () => {
    const layouts: ShellLayout[] = [];
    const restore = { dispose: () => {} };
    const api = createPageApi(
      manifest,
      deps({
        setLayout: (layout) => {
          layouts.push(layout);
          return restore;
        },
      }),
    );
    const layout: ShellLayout = { mount: () => ({}) as never };

    const returned = api.shell.setLayout(layout);

    expect(layouts).toEqual([layout]);
    expect(returned).toBe(restore);
  });

  it("qualifies a mode's id by the plugin", () => {
    const added: Mode[] = [];
    const modes = {
      add: (mode) => {
        added.push(mode);
        return {} as ModeHandle;
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

  it('platform is the served platform', () => {
    const config = liveConfig(appConfig({ platform: 'windows' }));

    const api = createPageApi(manifest, deps({ config }));

    expect(api.platform).toBe('windows');
  });
});
