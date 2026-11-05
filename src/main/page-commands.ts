import type { IpcMain, WebContents } from 'electron';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type { CommandId } from '../contracts/commands';
import type { Log } from '../contracts/log';

// Runs page commands from main. `run` resolves once the page says the command
// settled, or at once with a log line while no started page can take it.
export interface PageCommands {
  run(id: CommandId, arg: unknown): Promise<void>;
  // Resolves every waiting run; called when the page slot's `started` goes from true
  // to false.
  pageGone(): void;
}

export function createPageCommands(deps: {
  page(): WebContents | null;
  isStarted(): boolean;
  ipc: Pick<IpcMain, 'on'>;
  log: Log;
}): PageCommands {
  const waiting = new Map<number, { id: CommandId; resolve(): void }>();
  let lastRequest = 0;
  deps.ipc.on(BRIDGE_CHANNELS.commandRunDone, (_event, request: number) => {
    waiting.get(request)?.resolve();
    waiting.delete(request);
  });
  return {
    run(id, arg) {
      const page = deps.page();
      if (page === null || !deps.isStarted()) {
        deps.log('commands', `${id} not run: no page`);
        return Promise.resolve();
      }
      lastRequest += 1;
      const request = lastRequest;
      return new Promise((resolve) => {
        waiting.set(request, { id, resolve });
        page.send(BRIDGE_CHANNELS.commandRunInPage, request, id, arg);
      });
    },
    pageGone() {
      for (const { id, resolve } of waiting.values()) {
        deps.log('commands', `${id} ended with the page`);
        resolve();
      }
      waiting.clear();
    },
  };
}
