import type { Files } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { WorkflowId } from '../contract';

export const RUNS_FILE = 'runs.jsonl';

// One finished workflow run. `costUsd` is spend through the last finished turn,
// null when no spend is known.
export interface RunLogLine {
  at: number;
  sessionId: string;
  projectDir: string;
  workflow: WorkflowId;
  movedUpFrom: WorkflowId | null;
  activeMs: number;
  costUsd: number | null;
  fixCycles: number;
}

// `append` adds one JSON line to `runs.jsonl`, one write after another in call
// order; a write that fails is logged and the next line still goes.
export interface RunLog {
  append(line: RunLogLine): void;
}

// `files` is workflow's data folder.
export function createRunLog(deps: { files: Files; log: PluginLog }): RunLog {
  const { files, log } = deps;
  let lastAppend: Promise<void> = Promise.resolve();

  return {
    append(line) {
      const text = `${JSON.stringify(line)}\n`;
      lastAppend = lastAppend
        .then(() => files.append(RUNS_FILE, text))
        .catch((error: unknown) => {
          log(`${RUNS_FILE} not written: ${errorText(error)}`);
        });
    },
  };
}
