import { BRIDGE_CHANNELS } from '../../contracts/bridge';
import type { ChannelShape, MainChannel } from '../../contracts/plugin';

// The member of Electron's `ipcMain` the router uses.
export interface IpcLike {
  handle(
    channel: string,
    listener: (
      event: unknown,
      pluginId: string,
      method: string,
      args: unknown[],
    ) => unknown,
  ): void;
}

// The member of Electron's `WebContents` the router uses.
export interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void;
}

export interface PluginChannels {
  forPlugin(pluginId: string): MainChannel<ChannelShape>;
  // Empties `pluginId`'s parked invokes, leaving their promises unsettled: the
  // page part that made them has stopped.
  dropParked(pluginId: string): void;
}

type Handler = (...args: unknown[]) => unknown;

interface ParkedInvoke {
  method: string;
  args: unknown[];
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

// Routes every plugin's invokes from the page to the handler that plugin
// registered, and sends each plugin's messages to `page()` under its id;
// `page()` yields null while no page can receive one, as once it is destroyed
// or the quit has begun. An invoke with no handler:
// - resolves to undefined while `page()` is null: a page tearing down can
//   still invoke a part already stopped, and no page awaits the reply. Such an
//   invoke drops every parked invoke first.
// - parks while the plugin's main part has stopped (its handlers all
//   disposed), and is answered in arrival order once that method registers
//   again, as a restart does. Undefined would throw in a caller that reads the
//   typed reply, and a rejection would log a line at every caller.
// - rejects for a plugin that never registered a handler, or a method missing
//   while others are registered.
export function createPluginChannels(
  ipc: IpcLike,
  page: () => WebContentsLike | null,
): PluginChannels {
  const handlers = new Map<string, Map<string, Handler>>();
  const parked = new Map<string, ParkedInvoke[]>();

  const park = (pluginId: string, method: string, args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const waiting = parked.get(pluginId) ?? [];
      waiting.push({ method, args, resolve, reject });
      parked.set(pluginId, waiting);
    });

  // Answers `pluginId`'s invokes parked for `method` with `handler`, in
  // arrival order, once the registering start has returned.
  const answerParked = (pluginId: string, method: string, handler: Handler) => {
    const waiting = parked.get(pluginId) ?? [];
    const answered = waiting.filter((each) => each.method === method);
    if (answered.length === 0) {
      return;
    }
    const rest = waiting.filter((each) => each.method !== method);
    if (rest.length === 0) {
      parked.delete(pluginId);
    } else {
      parked.set(pluginId, rest);
    }
    for (const each of answered) {
      void Promise.resolve()
        .then(() => handler(...each.args))
        .then(each.resolve, each.reject);
    }
  };

  ipc.handle(BRIDGE_CHANNELS.pluginInvoke, (_event, pluginId, method, args) => {
    const isPageGone = page() === null;
    if (isPageGone) {
      parked.clear();
    }
    const methods = handlers.get(pluginId);
    const handler = methods?.get(method);
    if (handler) {
      return handler(...args);
    }
    if (isPageGone) {
      return undefined;
    }
    const hasMainPartStopped = methods !== undefined && methods.size === 0;
    if (hasMainPartStopped) {
      return park(pluginId, method, args);
    }
    throw new Error(`Plugin "${pluginId}" has no main handler for "${method}"`);
  });

  return {
    forPlugin: (pluginId) => ({
      handle: (method, handler) => {
        const methods = handlers.get(pluginId) ?? new Map<string, Handler>();
        if (methods.has(method)) {
          throw new Error(
            `Plugin "${pluginId}" registered a main handler for "${method}" twice`,
          );
        }
        const registered = handler as Handler;
        methods.set(method, registered);
        handlers.set(pluginId, methods);
        answerParked(pluginId, method, registered);
        return {
          dispose() {
            if (methods.get(method) === registered) {
              methods.delete(method);
            }
          },
        };
      },
      // With no page to receive it the message is dropped.
      send: (message, data) => {
        page()?.send(BRIDGE_CHANNELS.pluginMessage, pluginId, message, data);
      },
    }),
    dropParked: (pluginId) => {
      parked.delete(pluginId);
    },
  };
}
