import { describe, expect, it } from 'vitest';
import type { Bridge } from '../../contracts/bridge';
import type {
  Area,
  Mode,
  Modes,
  PageChannel,
  PageServices,
  PluginManifest,
} from '../../contracts/plugin';
import { createEventBus } from '../../shared/event-bus';
import { createScopeStack } from '../key-scope';
import { createPageApi, type PageApiDeps } from './page-api';

const manifest: PluginManifest = {
  id: 'p',
  dependsOn: [],
  commands: {},
  scopes: { review: 'In review' },
  keys: { page: [], editor: [], app: [], global: [], intercept: [] },
  settings: {},
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

function deps(overrides: Partial<PageApiDeps>): PageApiDeps {
  return {
    areas: {} as PageApiDeps['areas'],
    modes: {} as Modes,
    bridge: fakeBridge().bridge,
    scopeStack: createScopeStack('any'),
    pendingKeys: { onPending: () => {}, hold: () => {}, cancel: () => {} },
    keymap: {} as PageApiDeps['keymap'],
    label: (id) => id,
    commandInfo: {},
    scopes: [],
    settings: {},
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

  it('hands the plugin every area but main', () => {
    const area = (): Area => ({ contribute: () => ({ remove: () => {} }) });
    const areas: PageApiDeps['areas'] = {
      activityBar: area(),
      sideBar: area(),
      main: area(),
      panel: area(),
      statusBar: area(),
      overlay: area(),
    };

    const api = createPageApi(manifest, deps({ areas }));

    expect(api.areas).toEqual({
      activityBar: areas.activityBar,
      sideBar: areas.sideBar,
      panel: areas.panel,
      statusBar: areas.statusBar,
      overlay: areas.overlay,
    });
    expect(api.areas).not.toHaveProperty('main');
  });

  it("qualifies a mode's id by the plugin", () => {
    const added: Mode[] = [];
    const modes = {
      add: (mode) => {
        added.push(mode);
        return { show: () => {}, isShown: () => false };
      },
    } as Pick<Modes, 'add'> as Modes;
    const api = createPageApi(manifest, deps({ modes }));
    const element = {} as HTMLElement;
    const shown = () => {};
    const hidden = () => {};

    api.modes.add({ id: 'browse', title: 'Browse', element, shown, hidden });

    expect(added).toEqual([
      { id: 'p.browse', title: 'Browse', element, shown, hidden },
    ]);
  });
});
