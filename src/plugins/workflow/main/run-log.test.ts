import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import { createRunLog, RUNS_FILE, type RunLogLine } from './run-log';

const LINE: RunLogLine = {
  at: 10,
  sessionId: 's1',
  projectDir: '/r',
  workflow: 'wigley:small',
  movedUpFrom: null,
  activeMs: 2000,
  costUsd: 0.25,
  fixCycles: 0,
};

const settled = () => new Promise((settle) => setImmediate(settle));

describe('createRunLog', () => {
  it('Append_WritesOneJsonLine', async () => {
    const files = createMemoryFiles();
    const runLog = createRunLog({ files, log: () => undefined });

    runLog.append(LINE);
    await settled();

    expect(await files.read(RUNS_FILE)).toBe(
      '{"at":10,"sessionId":"s1","projectDir":"/r","workflow":"wigley:small","movedUpFrom":null,"activeMs":2000,"costUsd":0.25,"fixCycles":0}\n',
    );
  });

  it('Append_InOrder', async () => {
    const memory = createMemoryFiles();
    const first = Promise.withResolvers<void>();
    let appends = 0;
    const files: Files = {
      ...memory,
      append: async (path, text) => {
        appends += 1;
        if (appends === 1) {
          await first.promise;
        }
        await memory.append(path, text);
      },
    };
    const runLog = createRunLog({ files, log: () => undefined });

    runLog.append({ ...LINE, at: 1 });
    runLog.append({ ...LINE, at: 2 });
    await settled();
    expect(appends).toBe(1);
    first.resolve();
    await settled();

    const lines = (await memory.read(RUNS_FILE)).trimEnd().split('\n');
    expect(lines.map((line) => (JSON.parse(line) as RunLogLine).at)).toEqual([
      1, 2,
    ]);
  });

  it('Append_Failure_LogsAndGoesOn', async () => {
    const memory = createMemoryFiles();
    let appends = 0;
    const files: Files = {
      ...memory,
      append: async (path, text) => {
        appends += 1;
        if (appends === 1) {
          throw new Error('boom');
        }
        await memory.append(path, text);
      },
    };
    const logs: string[] = [];
    const runLog = createRunLog({ files, log: (line) => logs.push(line) });

    runLog.append({ ...LINE, at: 1 });
    runLog.append({ ...LINE, at: 2 });
    await settled();

    expect(logs).toEqual(['runs.jsonl not written: boom']);
    const lines = (await memory.read(RUNS_FILE)).trimEnd().split('\n');
    expect(lines.map((line) => (JSON.parse(line) as RunLogLine).at)).toEqual([
      2,
    ]);
  });
});
