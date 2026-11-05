import type { Bridge } from '../contracts/bridge';

export type DeliverPluginMessage = (
  toPlugin: string,
  message: string,
  data: unknown,
) => void;

// The bridge's `onMessage` over one shared channel listener, which `listen`
// adds on the first subscribe and which hands each message to its plugin and
// message name's subscribers, in subscription order. A subscriber added while
// a message is delivered waits for the next one, and one disposed during it
// still hears that one.
export function createPluginMessageSubscribe(
  listen: (deliver: DeliverPluginMessage) => void,
): Bridge['onMessage'] {
  const byPlugin = new Map<
    string,
    Map<string, readonly ((data: unknown) => void)[]>
  >();
  const deliver: DeliverPluginMessage = (toPlugin, message, data) => {
    for (const listener of byPlugin.get(toPlugin)?.get(message) ?? []) {
      listener(data);
    }
  };
  return (pluginId, message, listener) => {
    if (byPlugin.size === 0) {
      listen(deliver);
    }
    let byMessage = byPlugin.get(pluginId);
    if (byMessage === undefined) {
      byMessage = new Map();
      byPlugin.set(pluginId, byMessage);
    }
    const subscribers = byMessage;
    // A wrapper per subscribe, so each handle removes only its own.
    const subscriber = (data: unknown) => listener(data);
    subscribers.set(message, [...(subscribers.get(message) ?? []), subscriber]);
    return {
      dispose() {
        subscribers.set(
          message,
          (subscribers.get(message) ?? []).filter(
            (each) => each !== subscriber,
          ),
        );
      },
    };
  };
}
