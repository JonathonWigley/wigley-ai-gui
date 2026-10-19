import { describe, expect, it } from 'vitest';
import type { Bridge } from '../../contracts/bridge';
import type {
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
  messages: { shown: string };
}

// A Bridge recording the plugin calls it receives; the rest is unused here.
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
  return { bridge, invoked, listeners };
}

function deps(overrides: Partial<PageApiDeps>): PageApiDeps {
  return {
    areas: {} as PageApiDeps['areas'],
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
    const { bridge, invoked, listeners } = fakeBridge();
    const channel: PageChannel<TestChannel> = createPageApi(
      manifest,
      deps({ bridge }),
    ).channel;
    const shown = () => {};

    const result = await channel.invoke('save', 1, 2);
    channel.on('shown', shown);

    expect(invoked).toEqual([['p', 'save', [1, 2]]]);
    expect(result).toBe('done');
    expect(listeners).toEqual([['p', 'shown', shown]]);
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
});
