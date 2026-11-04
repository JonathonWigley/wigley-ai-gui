import { describe, expect, it } from 'vitest';
import {
  createPluginMessageSubscribe,
  type DeliverPluginMessage,
} from './plugin-message-subscribe';

// A subscribe whose `send` delivers a message to every channel listener it
// added, as the channel would.
function channel() {
  const channelListeners: DeliverPluginMessage[] = [];
  const subscribe = createPluginMessageSubscribe((deliver) => {
    channelListeners.push(deliver);
  });
  const send: DeliverPluginMessage = (toPlugin, message, data) => {
    for (const channelListener of channelListeners) {
      channelListener(toPlugin, message, data);
    }
  };
  return { channelListeners, subscribe, send };
}

describe('createPluginMessageSubscribe', () => {
  it('adds one channel listener however many subscribe', () => {
    const { channelListeners, subscribe } = channel();
    subscribe('editor', 'saved', () => {});
    subscribe('editor', 'saved', () => {});
    subscribe('editor', 'closed', () => {});
    subscribe('tree', 'saved', () => {});
    expect(channelListeners).toHaveLength(1);
  });

  it.each([
    {
      toPlugin: 'editor',
      message: 'saved',
      heard: ['editor saved first 7', 'editor saved second 7'],
    },
    { toPlugin: 'editor', message: 'closed', heard: ['editor closed 7'] },
    { toPlugin: 'tree', message: 'saved', heard: ['tree saved 7'] },
    { toPlugin: 'tree', message: 'closed', heard: [] },
    { toPlugin: 'other', message: 'saved', heard: [] },
  ])(
    'hands $toPlugin $message to its subscribers in order',
    ({ toPlugin, message, heard }) => {
      const { subscribe, send } = channel();
      const actual: string[] = [];
      const record = (name: string) => (data: unknown) => {
        actual.push(`${name} ${String(data)}`);
      };
      subscribe('editor', 'saved', record('editor saved first'));
      subscribe('editor', 'closed', record('editor closed'));
      subscribe('tree', 'saved', record('tree saved'));
      subscribe('editor', 'saved', record('editor saved second'));
      send(toPlugin, message, 7);
      expect(actual).toEqual(heard);
    },
  );

  it('holds a subscriber added during delivery until the next message', () => {
    const { subscribe, send } = channel();
    const heard: string[] = [];
    let added = false;
    subscribe('editor', 'saved', (data) => {
      heard.push(`first ${String(data)}`);
      if (!added) {
        added = true;
        subscribe('editor', 'saved', (later) => {
          heard.push(`added ${String(later)}`);
        });
      }
    });
    send('editor', 'saved', 1);
    send('editor', 'saved', 2);
    expect(heard).toEqual(['first 1', 'first 2', 'added 2']);
  });
});
