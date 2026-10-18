import { contextBridge, ipcRenderer } from 'electron';
import { type Bridge, BRIDGE_CHANNELS } from '../contracts/bridge';
import type { PresentedRound } from '../contracts/forms';

// Electron prefixes a handler's error with the channel and the error's name.
const REMOTE_ERROR_PREFIX =
  /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

function mainErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(REMOTE_ERROR_PREFIX, '');
}

const bridge: Bridge = {
  config: () => ipcRenderer.invoke(BRIDGE_CHANNELS.config),
  onLog: (listener) => {
    ipcRenderer.on(
      BRIDGE_CHANNELS.log,
      (_event, source: string, message: string) => listener(source, message),
    );
  },
  openRounds: () => ipcRenderer.invoke(BRIDGE_CHANNELS.openRounds),
  onRoundShown: (listener) => {
    ipcRenderer.on(
      BRIDGE_CHANNELS.roundShown,
      (_event, round: PresentedRound) => listener(round),
    );
  },
  onRoundClosed: (listener) => {
    ipcRenderer.on(BRIDGE_CHANNELS.roundClosed, (_event, roundId: string) =>
      listener(roundId),
    );
  },
  onFocusRound: (listener) => {
    ipcRenderer.on(BRIDGE_CHANNELS.focusRound, (_event, roundId: string) =>
      listener(roundId),
    );
  },
  saveDraft: async (roundId, body) => {
    try {
      await ipcRenderer.invoke(BRIDGE_CHANNELS.draft, roundId, body);
    } catch (error) {
      throw new Error(mainErrorText(error));
    }
  },
  finishRound: (roundId, end) =>
    ipcRenderer.send(BRIDGE_CHANNELS.finish, roundId, end),
};

contextBridge.exposeInMainWorld('wigley', bridge);
