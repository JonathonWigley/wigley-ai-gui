import { contextBridge, ipcRenderer } from 'electron';
import { type Bridge, BRIDGE_CHANNELS } from '../contracts/bridge';

const bridge: Bridge = {
  config: () => ipcRenderer.invoke(BRIDGE_CHANNELS.config),
  onLog: (listener) => {
    ipcRenderer.on(
      BRIDGE_CHANNELS.log,
      (_event, source: string, message: string) => listener(source, message),
    );
  },
  promptAgent: (text) => ipcRenderer.invoke(BRIDGE_CHANNELS.prompt, text),
};

contextBridge.exposeInMainWorld('wigley', bridge);
