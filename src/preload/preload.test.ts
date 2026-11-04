import { describe, expect, it, vi } from 'vitest';
import { type Bridge, BRIDGE_CHANNELS } from '../contracts/bridge';
import './preload';

const electron = vi.hoisted(() => {
  const exposed: { wigley?: unknown } = {};
  const onCalls: [string, (...args: unknown[]) => void][] = [];
  return {
    exposed,
    onCalls,
    contextBridge: {
      exposeInMainWorld: (name: 'wigley', api: unknown) => {
        exposed[name] = api;
      },
    },
    ipcRenderer: {
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        onCalls.push([channel, listener]);
      },
    },
    webUtils: {},
  };
});
vi.mock('electron', () => electron);

const bridge = electron.exposed.wigley as Bridge;

function sendFromMain(toPlugin: string, message: string, data: unknown) {
  for (const [channel, listener] of electron.onCalls) {
    if (channel === BRIDGE_CHANNELS.pluginMessage) {
      listener({}, toPlugin, message, data);
    }
  }
}

describe('preload onMessage', () => {
  it('hands a message only to its plugin and message name, in registration order', () => {
    const heard: string[] = [];
    const hearer = (name: string) => (data: unknown) => {
      heard.push(`${name} ${String(data)}`);
    };
    bridge.onMessage('routed', 'shown', hearer('first'));
    bridge.onMessage('routed', 'hidden', hearer('other message'));
    bridge.onMessage('routed-other', 'shown', hearer('other plugin'));
    bridge.onMessage('routed', 'shown', hearer('second'));

    sendFromMain('routed', 'shown', 1);

    expect(heard).toEqual(['first 1', 'second 1']);
  });

  it('keeps one ipcRenderer listener however many registrations it holds', () => {
    for (let count = 0; count < 20; count++) {
      bridge.onMessage(`counted-${count}`, 'shown', () => {});
    }

    const pluginMessageCalls = electron.onCalls.filter(
      ([channel]) => channel === BRIDGE_CHANNELS.pluginMessage,
    );
    expect(pluginMessageCalls).toHaveLength(1);
  });

  it('holds a listener added during a delivery until the next message', () => {
    const late: unknown[] = [];
    let added = false;
    bridge.onMessage('reentrant', 'shown', () => {
      if (!added) {
        added = true;
        bridge.onMessage('reentrant', 'shown', (data) => late.push(data));
      }
    });

    sendFromMain('reentrant', 'shown', 1);
    sendFromMain('reentrant', 'shown', 2);

    expect(late).toEqual([2]);
  });
});
