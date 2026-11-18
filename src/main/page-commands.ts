import type { IpcMain, WebContents } from 'electron';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type {
  CommandHop,
  CommandId,
  CommandOutcome,
} from '../contracts/commands';
import type { Log } from '../contracts/log';

// Runs page commands from main, sending `hop` with each run. `run` resolves the
// outcome the page sends once the command settled. While no started page can
// take it, a run that reports rejects with `<id> not run: no page`, and any other
// logs that line and resolves `skipped`. A run that reports rejects with the
// error text the page sends, or `<id> failed with no error text from the page`
// when the page sends a non-null error that is not a string. An outcome other
// than `ran` resolves `skipped`.
export interface PageCommands {
  run(id: CommandId, arg: unknown, hop?: CommandHop): Promise<CommandOutcome>;
  // Settles every waiting run, logging `<id> ended with the page` for each: a run
  // that reports rejects with that text, and any other resolves `skipped`. Called
  // when the page slot's `started` goes from true to false.
  pageGone(): void;
}

interface WaitingRun {
  id: CommandId;
  reportsErrors: boolean;
  resolve(outcome: CommandOutcome): void;
  reject(error: Error): void;
}

export function createPageCommands(deps: {
  page(): WebContents | null;
  isStarted(): boolean;
  ipc: Pick<IpcMain, 'on'>;
  log: Log;
}): PageCommands {
  const waiting = new Map<number, WaitingRun>();
  let lastRequest = 0;
  // The reply comes from the page, so only its typed values are read.
  deps.ipc.on(
    BRIDGE_CHANNELS.commandRunDone,
    (_event, request: unknown, outcome: unknown, errorText: unknown) => {
      if (typeof request !== 'number') {
        return;
      }
      const run = waiting.get(request);
      waiting.delete(request);
      if (run === undefined) {
        return;
      }
      if (run.reportsErrors && errorText !== null) {
        run.reject(
          new Error(
            typeof errorText === 'string'
              ? errorText
              : `${run.id} failed with no error text from the page`,
          ),
        );
      } else {
        run.resolve(outcome === 'ran' ? 'ran' : 'skipped');
      }
    },
  );
  return {
    run(id, arg, hop = {}) {
      const page = deps.page();
      if (page === null || !deps.isStarted()) {
        const notRun = `${id} not run: no page`;
        if (hop.reportErrors === true) {
          return Promise.reject(new Error(notRun));
        }
        deps.log('commands', notRun);
        return Promise.resolve<CommandOutcome>('skipped');
      }
      lastRequest += 1;
      const request = lastRequest;
      const reportsErrors = hop.reportErrors === true;
      return new Promise((resolve, reject) => {
        waiting.set(request, { id, reportsErrors, resolve, reject });
        page.send(BRIDGE_CHANNELS.commandRunInPage, request, id, arg, hop);
      });
    },
    pageGone() {
      for (const run of waiting.values()) {
        const ended = `${run.id} ended with the page`;
        deps.log('commands', ended);
        if (run.reportsErrors) {
          run.reject(new Error(ended));
        } else {
          run.resolve('skipped');
        }
      }
      waiting.clear();
    },
  };
}
