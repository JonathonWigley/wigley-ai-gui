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

  it('rejects a method registered twice', () => {
    const channel = createPluginChannels(fakeIpc(), () => null).forPlugin('p');
    channel.handle('save', () => undefined);

    expect(() => channel.handle('save', () => undefined)).toThrow(
      /"p".*"save"/,
    );
  });
});
