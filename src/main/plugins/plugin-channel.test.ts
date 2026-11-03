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

  it('rejects an unknown plugin or method', () => {
    const ipc = fakeIpc();
    createPluginChannels(ipc, () => null)
      .forPlugin('p')
      .handle('save', () => undefined);

    expect(() => ipc.invoke('q', 'save', [])).toThrow(/"q".*"save"/);
    expect(() => ipc.invoke('p', 'load', [])).toThrow(/"p".*"load"/);
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

  it('drops a disposed handler, so an invoke rejects and the method registers again', () => {
    const ipc = fakeIpc();
    const channel = createPluginChannels(ipc, () => null).forPlugin('p');
    const handle = channel.handle('save', () => 'first');

    handle.dispose();
    handle.dispose();

    expect(() => ipc.invoke('p', 'save', [])).toThrow(
      'Plugin "p" has no main handler for "save"',
    );
    channel.handle('save', () => 'second');
    handle.dispose();
    expect(ipc.invoke('p', 'save', [])).toBe('second');
  });
});
