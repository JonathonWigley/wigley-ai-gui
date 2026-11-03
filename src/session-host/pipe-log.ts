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
  // Gives the line the next `seq` and the clock's time, and has it on disk before returning.
  append(dir: PipeDirection, text: string): PipeLine;
  remove(): void;
}

// Creates process `id`'s log empty in `logsFolder`, emptying a leftover of that name.
export function createPipeLog(
  logsFolder: string,
  id: string,
  clock: Clock,
): PipeLog {
  const file = path.resolve(logsFolder, pipeLogFile(id));
  writeFileSync(file, '');
  let lastSeq = 0;
  return {
    file,
    append(dir, text) {
      lastSeq += 1;
      const record: PipeLogRecord = {
        seq: lastSeq,
        dir,
        at: clock.now(),
        text,
      };
      appendFileSync(file, jsonLine(record));
      return record;
    },
    remove() {
      rmSync(file, { force: true });
    },
  };
}
