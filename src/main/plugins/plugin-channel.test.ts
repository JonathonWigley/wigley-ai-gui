import { describe, expect, it } from 'vitest';
import {
  createPluginChannels,
  type IpcLike,
  type WebContentsLike,
} from './plugin-channel';

type Listener = Parameters<IpcLike['handle']>[1];

function fakeIpc(): IpcLike & { invoke(...args: unknown[]): unknown } {
  const listeners = new Map<string, Listener>();
  return {
    handle: (channel, listener) => listeners.set(channel, listener),
    invoke: (pluginId, method, args) =>
      listeners.get('plugin:invoke')?.(
        {},
        pluginId as string,
        method as string,
        args as unknown[],
      ),
  };
}

function fakePage(): WebContentsLike & { sent: unknown[][] } {
  const sent: unknown[][] = [];
  return { sent, send: (...args) => sent.push(args) };
}

describe('createPluginChannels', () => {
  it("routes an invoke to the plugin's handler", () => {
    const ipc = fakeIpc();
    const received: unknown[] = [];
    createPluginChannels(ipc, () => null)
      .forPlugin('p')
      .handle('save', (value: number) => {
        received.push(value);
        return 'saved';
      });

    expect(ipc.invoke('p', 'save', [1])).toBe('saved');
    expect(received).toEqual([1]);
  });

  it('rejects an unknown plugin or method, and drops it quietly while there is no page', () => {
    const ipc = fakeIpc();
    let page: ReturnType<typeof fakePage> | null = fakePage();
    createPluginChannels(ipc, () => page)
      .forPlugin('p')
      .handle('save', () => 'saved');

    expect(() => ipc.invoke('q', 'save', [])).toThrow(/"q".*"save"/);
    expect(() => ipc.invoke('p', 'load', [])).toThrow(/"p".*"load"/);
    page = null;
    expect(ipc.invoke('q', 'save', [])).toBeUndefined();
    expect(ipc.invoke('p', 'load', [])).toBeUndefined();
    expect(ipc.invoke('p', 'save', [])).toBe('saved');
  });

  it("sends a message under the plugin's id", () => {
    const page = fakePage();
    const data = { roundId: 'r1' };
    createPluginChannels(fakeIpc(), () => page)
      .forPlugin('p')
      .send('shown', data);

    expect(page.sent).toEqual([['plugin:message', 'p', 'shown', data]]);
  });

  it('drops a message while there is no page', () => {
    let page: ReturnType<typeof fakePage> | null = null;
    const channel = createPluginChannels(fakeIpc(), () => page).forPlugin('p');

    expect(() => channel.send('shown', 1)).not.toThrow();
    page = fakePage();
    channel.send('shown', 2);
    expect(page.sent).toEqual([['plugin:message', 'p', 'shown', 2]]);
  });

  it('rejects a method registered twice', () => {
    const channel = createPluginChannels(fakeIpc(), () => null).forPlugin('p');
    channel.handle('save', () => undefined);

    expect(() => channel.handle('save', () => undefined)).toThrow(
      /"p".*"save"/,
    );
  });

  it('parks an invoke to a disposed handler and answers it once the method registers again', async () => {
    const ipc = fakeIpc();
    const page = fakePage();
    const channel = createPluginChannels(ipc, () => page).forPlugin('p');
    const handle = channel.handle('save', () => 'first');

    handle.dispose();
    handle.dispose();

    const parked = ipc.invoke('p', 'save', []);
    expect(await settledWithin(parked)).toBe(PENDING);
    channel.handle('save', () => 'second');
    handle.dispose();
    await expect(parked).resolves.toBe('second');
    expect(ipc.invoke('p', 'save', [])).toBe('second');
  });

  it('answers a call parked while the main part was stopped with the restarted handler, once', async () => {
    const ipc = fakeIpc();
    const channels = createPluginChannels(ipc, () => fakePage());
    const channel = channels.forPlugin('p');
    channel.handle('m', () => 'stopped').dispose();
    const received: unknown[][] = [];

    const parked = ipc.invoke('p', 'm', [3, 'x']);
    channel.handle('m', (...args: unknown[]) => {
      received.push(args);
      return 'restarted';
    });

    await expect(parked).resolves.toBe('restarted');
    expect(received).toEqual([[3, 'x']]);
  });

  it('drops a parked call once its calling page part stops', async () => {
    const ipc = fakeIpc();
    const channels = createPluginChannels(ipc, () => fakePage());
    const channel = channels.forPlugin('p');
    channel.handle('m', () => 'stopped').dispose();
    let calls = 0;

    const parked = ipc.invoke('p', 'm', []);
    channels.dropParked('p');
    channel.handle('m', () => {
      calls += 1;
      return 'restarted';
    });

    expect(await settledWithin(parked)).toBe(PENDING);
    expect(calls).toBe(0);
  });
});

const PENDING = Symbol('pending');

// The value `promise` resolved to within two microtask turns, else PENDING.
async function settledWithin(promise: unknown): Promise<unknown> {
  const sentinel = (async () => {
    await Promise.resolve();
    await Promise.resolve();
    return PENDING;
  })();
  return Promise.race([promise, sentinel]);
}
