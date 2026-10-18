import { contextBridge, ipcRenderer } from 'electron';
import { type Bridge, BRIDGE_CHANNELS } from '../contracts/bridge';
import type { PresentedRound } from '../contracts/forms';

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
  saveDraft: (roundId, body) =>
    ipcRenderer.send(BRIDGE_CHANNELS.draft, roundId, body),
  finishRound: (roundId, end) =>
    ipcRenderer.send(BRIDGE_CHANNELS.finish, roundId, end),
};

contextBridge.exposeInMainWorld('wigley', bridge);
