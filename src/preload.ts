import { contextBridge, ipcRenderer } from 'electron';
import {
  LOG_CHANNEL,
  PROMPT_CHANNEL,
  type LogSource,
  type ProofApi,
} from './proof-api';

const proof: ProofApi = {
  onLog: (listener) => {
    ipcRenderer.on(LOG_CHANNEL, (_event, source: LogSource, message: string) =>
      listener(source, message),
    );
  },
  promptAgent: (text) => ipcRenderer.invoke(PROMPT_CHANNEL, text),
};

contextBridge.exposeInMainWorld('proof', proof);
