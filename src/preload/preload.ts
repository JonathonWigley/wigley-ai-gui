import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  type Bridge,
  BRIDGE_CHANNELS,
  type PluginPartsRequest,
} from '../contracts/bridge';
import type { CommandHop, CommandOutcome } from '../contracts/commands';
import type { LayoutSet } from '../contracts/layouts';
import type { AppConfig } from '../contracts/settings';
import type { SlotChange } from '../contracts/state';
import { errorText } from '../shared/error-text';
import { createListeners } from '../shared/listeners';
import { bridgeClaim } from './bridge-claim';
import { createPluginMessageSubscribe } from './plugin-message-subscribe';

// Electron prefixes a handler's error with the channel and the error's name.
const REMOTE_ERROR_PREFIX =
  /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

function mainErrorText(error: unknown): string {
  return errorText(error).replace(REMOTE_ERROR_PREFIX, '');
}

async function invokeMain<Result>(
  channel: string,
  ...args: readonly unknown[]
): Promise<Result> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as Result;
  } catch (error) {
    throw new Error(mainErrorText(error));
  }
}

const stateChanges = createListeners<{ seq: number; change: SlotChange }>();
ipcRenderer.on(
  BRIDGE_CHANNELS.stateChanged,
  (_event, seq: number, change: SlotChange) =>
    stateChanges.tell({ seq, change }),
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
  stateSnapshot: () => ipcRenderer.invoke(BRIDGE_CHANNELS.stateSnapshot),
  stateWrite: (change) => {
    ipcRenderer.send(BRIDGE_CHANNELS.stateWrite, change);
  },
  onStateChange: (listener) =>
    stateChanges.add(({ seq, change }) => listener(seq, change)),
  runCommand: (id, arg, hop) =>
    invokeMain<CommandOutcome>(BRIDGE_CHANNELS.commandRun, id, arg, hop),
  onRunCommand: (listener) => {
    ipcRenderer.on(
      BRIDGE_CHANNELS.commandRunInPage,
      (
        _event,
        request: number,
        id: string,
        arg: unknown,
        hop: CommandHop | undefined,
      ) => {
        void Promise.resolve()
          .then(() => listener(id, arg, hop ?? {}))
          .then(
            (outcome) =>
              ipcRenderer.send(
                BRIDGE_CHANNELS.commandRunDone,
                request,
                outcome,
                null,
              ),
            (error) =>
              ipcRenderer.send(
                BRIDGE_CHANNELS.commandRunDone,
                request,
                'skipped',
                errorText(error),
              ),
          );
      },
    );
  },
  // A rejecting answer sends no reply: the page's answer logs its own failure.
  onPluginParts: (answer) => {
    ipcRenderer.on(
      BRIDGE_CHANNELS.pluginParts,
      (_event, request: number, parts: PluginPartsRequest) => {
        void Promise.resolve()
          .then(() => answer(parts))
          .then(
            (reply) =>
              ipcRenderer.send(BRIDGE_CHANNELS.pluginPartsDone, request, reply),
            () => undefined,
          );
      },
    );
  },
  invoke: (pluginId, method, args) =>
    invokeMain(BRIDGE_CHANNELS.pluginInvoke, pluginId, method, args),
  onMessage: createPluginMessageSubscribe((deliver) => {
    ipcRenderer.on(
      BRIDGE_CHANNELS.pluginMessage,
      (_event, toPlugin: string, message: string, data: unknown) =>
        deliver(toPlugin, message, data),
    );
  }),
  pathForFile: (file) => webUtils.getPathForFile(file),
  savePasted: (bytes, mediaType) =>
    invokeMain(BRIDGE_CHANNELS.savePasted, bytes, mediaType),
  chooseFolder: () => invokeMain(BRIDGE_CHANNELS.chooseFolder),
  openExternal: async (url) => {
    await invokeMain(BRIDGE_CHANNELS.openExternal, url);
  },
};

contextBridge.exposeInMainWorld('wigley', bridgeClaim(bridge));
