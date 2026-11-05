import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../contracts/ambient';
import type { PipeDirection, PipeLine } from '../contracts/session-host';
import { jsonLine } from '../shared/local-channel/line-framing';
import {
  type PipeLogRecord,
  pipeLogFile,
} from '../contracts/session-host-protocol';

export interface PipeLog {
  // The log's absolute path.
  readonly file: string;
  // False once an append has failed: the file then lacks lines, so it cannot rebuild the process's state.
  readonly isComplete: boolean;
  // Gives the line the next `seq` and the clock's time, and has it on disk before returning while the log is complete.
  // Never throws: the first failure is reported, and no later line is written.
  append(dir: PipeDirection, text: string): PipeLine;
  // Never throws: a failure is reported, and the next host's sweep takes the file.
  remove(): void;
}

// Creates process `id`'s log empty in `logsFolder`, emptying a leftover of that name. Throws when it cannot.
export function createPipeLog(
  logsFolder: string,
  id: string,
  clock: Clock,
  reportFailure: (message: string) => void,
): PipeLog {
  const file = path.resolve(logsFolder, pipeLogFile(id));
  writeFileSync(file, '');
  let lastSeq = 0;
  let isComplete = true;
  return {
    file,
    get isComplete() {
      return isComplete;
    },
    append(dir, text) {
      lastSeq += 1;
      const record: PipeLogRecord = {
        seq: lastSeq,
        dir,
        at: clock.now(),
        text,
      };
      if (isComplete) {
        try {
          appendFileSync(file, jsonLine(record));
        } catch (error) {
          isComplete = false;
          reportFailure(`${id} pipe log append: ${(error as Error).message}`);
        }
      }
      return record;
    },
    remove() {
      try {
        rmSync(file, { force: true });
      } catch (error) {
        reportFailure(`${id} pipe log remove: ${(error as Error).message}`);
      }
    },
  };
}
