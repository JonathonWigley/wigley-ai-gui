import { describe, expect, it } from 'vitest';
import type { Files } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { RunHistoryEntry } from '../contract';
import {
  createHistoryStore,
  HISTORY_FILE,
  HISTORY_PER_TASK,
} from './history-store';

const BASE_AT = 1794300000000;

function entry(change: Partial<RunHistoryEntry>): RunHistoryEntry {
  return {
    taskId: '3f9a01bc',
    occurrence: BASE_AT,
    at: BASE_AT,
    outcome: 'finished',
    reason: null,
    rowId: 'row-1',
    processId: 'process-1',
    viewed: false,
    ...change,
  };
}

// The run of task `taskId` at step `step` (each step a minute later).
function runAt(taskId: string, step: number): RunHistoryEntry {
  const at = BASE_AT + step * 60000;
  return entry({ taskId, occurrence: at, at });
}

async function storedEntries(files: Files): Promise<RunHistoryEntry[]> {
  return JSON.parse(await files.read(HISTORY_FILE)) as RunHistoryEntry[];
}

function setUp() {
  const files = createMemoryFiles();
  const logs: string[] = [];
  const store = createHistoryStore(files, (line) => logs.push(line));
  return { files, logs, store };
}

describe('createHistoryStore', () => {
  it('add_PastTheCap_DropsTheOldestOfThatTaskOnly', async () => {
    const { files, store } = setUp();
    await store.load();
    const taskB = runAt('0c7e2d95', 0);
    store.add(taskB);
    for (let step = 1; step <= HISTORY_PER_TASK; step++) {
      store.add(runAt('3f9a01bc', step));
    }

    store.add(runAt('3f9a01bc', HISTORY_PER_TASK + 1));
    await store.settled();

    const taskA = store.entries().filter((kept) => kept.taskId === '3f9a01bc');
    expect(taskA).toHaveLength(HISTORY_PER_TASK);
    expect(taskA).not.toContainEqual(runAt('3f9a01bc', 1));
    expect(taskA).toContainEqual(runAt('3f9a01bc', HISTORY_PER_TASK + 1));
    expect(store.entries()).toContainEqual(taskB);
    expect(await storedEntries(files)).toEqual(store.entries());
  });

  it('update_Entry_AppliesTheChangeAndWrites', async () => {
    const { files, store } = setUp();
    await store.load();
    store.add(entry({ outcome: 'running' }));

    store.update('3f9a01bc', BASE_AT, { outcome: 'finished' });
    store.update('3f9a01bc', BASE_AT, { viewed: true });
    store.update('3f9a01bc', BASE_AT + 1, { outcome: 'failed' });
    await store.settled();

    const reloaded = createHistoryStore(files, () => undefined);
    await reloaded.load();
    expect(reloaded.entries()).toEqual([
      entry({ outcome: 'finished', viewed: true }),
    ]);
  });

  it.each([
    { case: 'not JSON', text: '[{' },
    {
      case: 'an entry missing outcome',
      text: JSON.stringify([{ ...entry({}), outcome: undefined }]),
    },
    {
      case: 'an entry missing viewed',
      text: JSON.stringify([{ ...entry({}), viewed: undefined }]),
    },
  ])('load_BadFile_RejectsAndNeverWrites ($case)', async (row) => {
    const { files, store } = setUp();
    await files.write(HISTORY_FILE, row.text);

    await expect(store.load()).rejects.toThrow(HISTORY_FILE);
    store.add(entry({}));
    await store.settled();

    expect(store.entries()).toEqual([entry({})]);
    expect(await files.read(HISTORY_FILE)).toBe(row.text);
  });

  it('entries_Order_IsNewestFirst', async () => {
    const { store } = setUp();
    await store.load();

    store.add(runAt('3f9a01bc', 2));
    store.add(runAt('0c7e2d95', 3));
    store.add(runAt('3f9a01bc', 1));

    expect(store.entries()).toEqual([
      runAt('0c7e2d95', 3),
      runAt('3f9a01bc', 2),
      runAt('3f9a01bc', 1),
    ]);
  });

  it('add_SameKey_Replaces', async () => {
    const { store } = setUp();
    await store.load();

    store.add(entry({ outcome: 'running' }));
    store.add(entry({ outcome: 'skipped', viewed: true }));

    expect(store.entries()).toEqual([
      entry({ outcome: 'skipped', viewed: true }),
    ]);
  });

  it('add_WriteRejects_LogsAndKeepsTheEntry', async () => {
    const memory = createMemoryFiles();
    let isWriteFailing = true;
    const files: Files = {
      ...memory,
      write: (path, text) =>
        isWriteFailing
          ? Promise.reject(new Error('disk full'))
          : memory.write(path, text),
    };
    const logs: string[] = [];
    const store = createHistoryStore(files, (line) => logs.push(line));
    await store.load();

    store.add(runAt('3f9a01bc', 1));
    await store.settled();

    expect(store.entries()).toEqual([runAt('3f9a01bc', 1)]);
    expect(logs).toEqual([
      expect.stringContaining('history.json not written:'),
    ]);

    isWriteFailing = false;
    store.add(runAt('3f9a01bc', 2));
    await store.settled();

    expect(await storedEntries(memory)).toEqual([
      runAt('3f9a01bc', 2),
      runAt('3f9a01bc', 1),
    ]);
  });
});
