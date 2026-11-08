import { describe, expect, it, vi } from 'vitest';
import { type Bridge, BRIDGE_CHANNELS } from '../contracts/bridge';
import type { SlotChange } from '../contracts/state';
import { gateExternalLinks } from '../shared/external-links';
import './preload';

const electron = vi.hoisted(() => {
  const exposed: { wigley?: unknown } = {};
  const onCalls: [string, (...args: unknown[]) => void][] = [];
  const sends: unknown[][] = [];
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  return {
    exposed,
    onCalls,
    sends,
    handlers,
    contextBridge: {
      exposeInMainWorld: (name: 'wigley', api: unknown) => {
        exposed[name] = api;
      },
    },
    ipcRenderer: {
      send: (channel: string, ...args: unknown[]) => {
        sends.push([channel, ...args]);
      },
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        onCalls.push([channel, listener]);
      },
      // Rejects as Electron does: main's error under the channel's prefix.
      invoke: async (channel: string, ...args: unknown[]) => {
        try {
          return await handlers[channel](...args);
        } catch (error) {
          throw new Error(
            `Error invoking remote method '${channel}': ${String(error)}`,
          );
        }
      },
    },
    webUtils: {},
  };
});
vi.mock('electron', () => electron);

const bridge = (electron.exposed.wigley as { claim(): Bridge }).claim();

function sendFromMain(toPlugin: string, message: string, data: unknown) {
  for (const [channel, listener] of electron.onCalls) {
    if (channel === BRIDGE_CHANNELS.pluginMessage) {
      listener({}, toPlugin, message, data);
    }
  }
}

function pushFromMain(seq: number, change: SlotChange) {
  for (const [channel, listener] of electron.onCalls) {
    if (channel === BRIDGE_CHANNELS.stateChanged) {
      listener({}, seq, change);
    }
  }
}

describe('preload onStateChange', () => {
  it('delivers each push on one ipcRenderer listener until dispose', () => {
    const change: SlotChange = { id: 'p.v', kind: 'value', value: 1 };
    const first: [number, SlotChange][] = [];
    const second: [number, SlotChange][] = [];
    const firstHandle = bridge.onStateChange((seq, pushed) =>
      first.push([seq, pushed]),
    );
    bridge.onStateChange((seq, pushed) => second.push([seq, pushed]));

    pushFromMain(3, change);
    firstHandle.dispose();
    pushFromMain(5, change);

    expect(first).toEqual([[3, change]]);
    expect(second).toEqual([
      [3, change],
      [5, change],
    ]);
    expect(
      electron.onCalls.filter(
        ([channel]) => channel === BRIDGE_CHANNELS.stateChanged,
      ),
    ).toHaveLength(1);
  });
});

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

describe('preload chooseFolder and openExternal', () => {
  it.each([
    {
      case: 'chooseFolder',
      channel: BRIDGE_CHANNELS.chooseFolder,
      call: () => bridge.chooseFolder(),
    },
    {
      case: 'openExternal',
      channel: BRIDGE_CHANNELS.openExternal,
      call: () => bridge.openExternal('https://example.invalid'),
    },
  ])(
    'chooseFolder_And_openExternal_MainRejects_CarryMainsText: $case',
    async ({ channel, call }) => {
      electron.handlers[channel] = () => {
        throw new Error('main said no');
      };

      await expect(call()).rejects.toThrow(/^main said no$/);
    },
  );

  it('openExternal_FileUrl_RejectsWithTheGateText', async () => {
    const open = gateExternalLinks(async () => undefined);
    electron.handlers[BRIDGE_CHANNELS.openExternal] = (url) =>
      open(url as string);

    await expect(bridge.openExternal('file:///x')).rejects.toThrow(
      /^Refused to open file:\/\/\/x: /,
    );
  });
});

describe('preload onRunCommand', () => {
  function runFromMain(request: number, id: string, arg: unknown) {
    const added = electron.onCalls.filter(
      ([channel]) => channel === BRIDGE_CHANNELS.commandRunInPage,
    );
    added.at(-1)?.[1]({}, request, id, arg);
  }

  it.each([
    { case: 'resolves', settle: () => Promise.resolve() },
    { case: 'rejects', settle: () => Promise.reject(new Error('boom')) },
  ])('onRunCommand_ListenerSettles_SendsDone: $case', async ({ settle }) => {
    electron.sends.length = 0;
    const heard: unknown[][] = [];
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    bridge.onRunCommand(async (id, arg) => {
      heard.push([id, arg]);
      await held;
      await settle();
    });

    runFromMain(7, 'p.go', 3);
    await vi.waitFor(() => {
      expect(heard).toEqual([['p.go', 3]]);
    });
    expect(electron.sends).toEqual([]);

    release();

    await vi.waitFor(() => {
      expect(electron.sends).toEqual([[BRIDGE_CHANNELS.commandRunDone, 7]]);
    });
  });
});
