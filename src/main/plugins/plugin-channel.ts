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
}

type Handler = (...args: unknown[]) => unknown;

// Routes every plugin's invokes from the page to the handler that plugin
// registered, and sends each plugin's messages to `page()` under its id.
export function createPluginChannels(
  ipc: IpcLike,
  page: () => WebContentsLike | null,
): PluginChannels {
  const handlers = new Map<string, Map<string, Handler>>();

  ipc.handle(BRIDGE_CHANNELS.pluginInvoke, (_event, pluginId, method, args) => {
    const handler = handlers.get(pluginId)?.get(method);
    if (!handler) {
      throw new Error(
        `Plugin "${pluginId}" has no main handler for "${method}"`,
      );
    }
    return handler(...args);
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
        methods.set(method, handler as Handler);
        handlers.set(pluginId, methods);
      },
      // With no page loaded the message is dropped.
      send: (message, data) => {
        page()?.send(BRIDGE_CHANNELS.pluginMessage, pluginId, message, data);
      },
    }),
  };
}
