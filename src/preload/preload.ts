import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { type Bridge, BRIDGE_CHANNELS } from '../contracts/bridge';
import type { LayoutSet } from '../contracts/layouts';
import type { AppConfig } from '../contracts/settings';
import { errorText } from '../shared/error-text';

// Electron prefixes a handler's error with the channel and the error's name.
const REMOTE_ERROR_PREFIX =
  /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

function mainErrorText(error: unknown): string {
  return errorText(error).replace(REMOTE_ERROR_PREFIX, '');
}

const pluginMessageListeners = new Map<
  string,
  Map<string, Array<(data: unknown) => void>>
>();

ipcRenderer.on(
  BRIDGE_CHANNELS.pluginMessage,
  (_event, toPlugin: string, sent: string, data: unknown) => {
    // A listener added during this delivery waits for the next message.
    const listeners = pluginMessageListeners.get(toPlugin)?.get(sent) ?? [];
    for (const listener of Array.from(listeners)) {
      listener(data);
    }
  },
);

const bridge: Bridge = {
  config: () => ipcRenderer.invoke(BRIDGE_CHANNELS.config),
  onConfig: (listener) => {
    ipcRenderer.on(BRIDGE_CHANNELS.configChanged, (_event, config: AppConfig) =>
      listener(config),
    );
  },
  onLog: (listener) => {
    ipcRenderer.on(
      BRIDGE_CHANNELS.log,
      (_event, source: string, message: string) => listener(source, message),
    );
  },
  layouts: (owner) => ipcRenderer.invoke(BRIDGE_CHANNELS.layoutsRead, owner),
  onLayouts: (listener) => {
    ipcRenderer.on(
      BRIDGE_CHANNELS.layoutsChanged,
      (_event, owner: string, set: LayoutSet) => listener(owner, set),
    );
  },
  serveVisual: (source) =>
    ipcRenderer.invoke(BRIDGE_CHANNELS.serveVisual, source),
  uiState: () => ipcRenderer.invoke(BRIDGE_CHANNELS.uiStateRead),
  setUiState: (key, value) => {
    ipcRenderer.send(BRIDGE_CHANNELS.uiStateWrite, key, value);
  },
  invoke: async (pluginId, method, args) => {
    try {
      return await ipcRenderer.invoke(
        BRIDGE_CHANNELS.pluginInvoke,
        pluginId,
        method,
        args,
      );
    } catch (error) {
      throw new Error(mainErrorText(error));
    }
  },
  onMessage: (pluginId, message, listener) => {
    const forPlugin = pluginMessageListeners.get(pluginId) ?? new Map();
    pluginMessageListeners.set(pluginId, forPlugin);
    const forMessage = forPlugin.get(message) ?? [];
    forPlugin.set(message, forMessage);
    forMessage.push(listener);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  savePasted: async (bytes, mediaType) => {
    try {
      return await ipcRenderer.invoke(
        BRIDGE_CHANNELS.savePasted,
        bytes,
        mediaType,
      );
    } catch (error) {
      throw new Error(mainErrorText(error));
    }
  },
};

contextBridge.exposeInMainWorld('wigley', bridge);
