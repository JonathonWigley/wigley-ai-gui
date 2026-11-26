import { describe, expect, it } from 'vitest';
import type { StartTarget } from '../../chat/contract';
import type { Files, WatchOptions } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { ScheduledTask, TaskDraft } from '../contract';
import { taskFileText } from '../task-file';
import { createTaskStore, type TaskStore } from './task-store';

const CONFIG_FOLDER = '/home/.config/wigley-ai-gui';
const TASK_PATH = `${CONFIG_FOLDER}/scheduled-tasks.json`;
const NOW = 1794300000000;

const TASK_A: ScheduledTask = {
  id: '3f9a01bc',
  name: 'Morning triage',
  target: { projectDir: '~/dev/a' },
  profile: 'work',
  prompt: 'Triage the follow-ups.',
  schedule: { kind: 'weekdays', time: '09:00' },
  controls: { mode: 'plan' },
  paused: false,
  attended: false,
  updatedAt: 1794297600000,
};

const TASK_B: ScheduledTask = {
  id: '0c7e2d95',
  name: 'Nightly check',
  target: { project: 'games' },
  profile: 'personal',
  prompt: 'Run the checks.',
  schedule: { kind: 'cron', line: '30 2 * * 1-5' },
  controls: {},
  paused: true,
  attended: false,
  updatedAt: 1794200000000,
};

const BROKEN_TEXT = '{"tasks": [';

function fileText(...tasks: ScheduledTask[]): string {
  return taskFileText({ tasks });
}

function draftOf(task: ScheduledTask): TaskDraft {
  const { updatedAt: _updatedAt, ...draft } = task;
  return draft;
}

// A store over memory files wrapped so a test can hold back the watch's
// reports, fail the next read, and call the watch's `onMissed`.
function setUp(randomIds: string[] = ['aaaaaaaa']) {
  const memory = createMemoryFiles();
  let watchOptions: WatchOptions | undefined;
  let isReportHeld = false;
  let isNextReadFailing = false;
  const files: Files = {
    ...memory,
    read: (path) => {
      if (isNextReadFailing) {
        isNextReadFailing = false;
        return Promise.reject(new Error('disk busy'));
      }
      return memory.read(path);
    },
    watch: (folder, onChange, options) => {
      watchOptions = options;
      return memory.watch(
        folder,
        (path) => {
          if (!isReportHeld) {
            onChange(path);
          }
        },
        options,
      );
    },
  };
  const ids = [...randomIds];
  const logs: string[] = [];
  const store = createTaskStore({
    files,
    paths: posixPaths,
    configFolder: CONFIG_FOLDER,
    clock: { now: () => NOW },
    randomHex: () => ids.shift() ?? 'ffffffff',
    log: (line) => logs.push(line),
  });
  let emits = 0;
  store.onChanged(() => emits++);
  return {
    memory,
    store,
    logs,
    emitCount: () => emits,
    resetEmits: () => {
      emits = 0;
    },
    holdReports: (isHeld: boolean) => {
      isReportHeld = isHeld;
    },
    failNextRead: () => {
      isNextReadFailing = true;
    },
    callMissed: () => watchOptions?.onMissed?.(),
  };
}

// Writes `text` from outside the app and waits for the store's read of it.
async function writeOutside(
  memory: Files,
  store: TaskStore,
  text: string,
): Promise<void> {
  await memory.write(TASK_PATH, text);
  await store.settled();
}

describe('createTaskStore', () => {
  it.each<{
    case: string;
    text: string | null;
    tasks: ScheduledTask[];
    error: string | null;
  }>([
    { case: 'no file', text: null, tasks: [], error: null },
    {
      case: 'a good file',
      text: fileText(TASK_A, TASK_B),
      tasks: [TASK_A, TASK_B],
      error: null,
    },
    { case: 'not JSON', text: BROKEN_TEXT, tasks: [], error: 'not JSON' },
  ])('load_FileStates_ReadsTasksAndError ($case)', async (row) => {
    const { memory, store } = setUp();
    if (row.text !== null) {
      await memory.write(TASK_PATH, row.text);
    }

    await store.load();

    expect(store.tasks()).toEqual(row.tasks);
    if (row.error === null) {
      expect(store.error()).toBeNull();
    } else {
      expect(store.error()).toContain(row.error);
    }
  });

  it('watch_FileChanges_KeepsLastGoodAndEmitsOnce', async () => {
    const { memory, store, emitCount, resetEmits } = setUp();
    await memory.write(TASK_PATH, fileText(TASK_A));
    await store.load();
    resetEmits();

    await writeOutside(memory, store, BROKEN_TEXT);
    expect(store.tasks()).toEqual([TASK_A]);
    expect(store.error()).toContain('not JSON');
    expect(emitCount()).toBe(1);

    await writeOutside(memory, store, fileText(TASK_B));
    expect(store.tasks()).toEqual([TASK_B]);
    expect(store.error()).toBeNull();
    expect(emitCount()).toBe(2);

    await writeOutside(memory, store, fileText(TASK_B));
    expect(emitCount()).toBe(2);

    await memory.deleteFile(TASK_PATH);
    await store.settled();
    expect(store.tasks()).toEqual([]);
    expect(store.error()).toBeNull();
    expect(emitCount()).toBe(3);
  });

  it('watch_ReadFailsThenSameText_ClearsTheError', async () => {
    const { memory, store, emitCount, resetEmits, failNextRead } = setUp();
    await memory.write(TASK_PATH, fileText(TASK_A));
    await store.load();
    failNextRead();
    await writeOutside(memory, store, fileText(TASK_A));
    expect(store.error()).toContain('not read');
    expect(store.tasks()).toEqual([TASK_A]);
    resetEmits();

    await writeOutside(memory, store, fileText(TASK_A));

    expect(store.error()).toBeNull();
    expect(store.tasks()).toEqual([TASK_A]);
    expect(emitCount()).toBe(1);
  });

  it('watch_Missed_RereadsTheFile', async () => {
    const { memory, store, emitCount, resetEmits, holdReports, callMissed } =
      setUp();
    await store.load();
    resetEmits();
    holdReports(true);
    await memory.write(TASK_PATH, fileText(TASK_B));
    expect(emitCount()).toBe(0);

    callMissed();
    await store.settled();

    expect(store.tasks()).toEqual([TASK_B]);
    expect(emitCount()).toBe(1);
  });

  it('dispose_Store_DisposesTheWatch', async () => {
    const { memory, store, emitCount, resetEmits } = setUp();
    await store.load();
    resetEmits();

    store.dispose();
    await writeOutside(memory, store, fileText(TASK_A));

    expect(emitCount()).toBe(0);
    expect(store.tasks()).toEqual([]);
  });

  it('mutations_Overlapping_BothLand', async () => {
    const { memory, store } = setUp();
    await memory.write(TASK_PATH, fileText(TASK_A, TASK_B));
    await store.load();

    await Promise.all([
      store.setPaused(TASK_A.id, true),
      store.remove(TASK_B.id),
    ]);

    expect(await memory.read(TASK_PATH)).toBe(
      fileText({ ...TASK_A, paused: true, updatedAt: NOW }),
    );
  });

  it('save_NewDraft_WritesFreshIdAndUpdatedAt', async () => {
    const { memory, store, emitCount, resetEmits } = setUp([
      TASK_A.id,
      'b1c2d3e4',
    ]);
    await memory.write(TASK_PATH, fileText(TASK_A));
    await store.load();
    resetEmits();

    const id = await store.save({ ...draftOf(TASK_B), id: null });
    await store.settled();

    const added: ScheduledTask = { ...TASK_B, id: 'b1c2d3e4', updatedAt: NOW };
    expect(id).toBe('b1c2d3e4');
    expect(store.tasks()).toEqual([TASK_A, added]);
    expect(await memory.read(TASK_PATH)).toBe(fileText(TASK_A, added));
    expect(emitCount()).toBe(1);
  });

  it('save_ExistingId_ReplacesInPlaceAndStamps', async () => {
    const { memory, store } = setUp();
    await memory.write(TASK_PATH, fileText(TASK_A, TASK_B));
    await store.load();

    await store.save({ ...draftOf(TASK_A), name: 'Evening triage' });

    expect(store.tasks()).toEqual([
      { ...TASK_A, name: 'Evening triage', updatedAt: NOW },
      TASK_B,
    ]);
  });

  it.each<{
    case: string;
    isFileBroken?: boolean;
    run: (store: TaskStore) => Promise<unknown>;
    reason: string;
  }>([
    {
      case: 'save of an unknown id',
      run: (store) => store.save({ ...draftOf(TASK_A), id: '99999999' }),
      reason: 'No scheduled task',
    },
    {
      case: 'setPaused of an unknown id',
      run: (store) => store.setPaused('99999999', true),
      reason: 'No scheduled task',
    },
    {
      case: 'remove of an unknown id',
      run: (store) => store.remove('99999999'),
      reason: 'No scheduled task',
    },
    {
      case: 'a bad schedule',
      run: (store) =>
        store.save({
          ...draftOf(TASK_A),
          id: null,
          schedule: { kind: 'hourly', minute: 75 },
        }),
      reason: 'schedule.',
    },
    {
      case: 'a blank name',
      run: (store) => store.save({ ...draftOf(TASK_A), name: ' ' }),
      reason: 'name',
    },
    {
      case: 'a blank profile',
      run: (store) => store.save({ ...draftOf(TASK_A), profile: '' }),
      reason: 'profile',
    },
    {
      case: 'a target with both keys',
      run: (store) =>
        store.save({
          ...draftOf(TASK_A),
          target: {
            projectDir: '~/a',
            project: 'games',
          } as unknown as StartTarget,
        }),
      reason: 'target',
    },
    {
      case: 'a controls value that is a number',
      run: (store) =>
        store.save({
          ...draftOf(TASK_A),
          controls: { mode: 5 } as unknown as Record<string, string>,
        }),
      reason: 'controls',
    },
    {
      case: 'save while the file is broken',
      isFileBroken: true,
      run: (store) => store.save({ ...draftOf(TASK_A), id: null }),
      reason: 'fix it first',
    },
    {
      case: 'setPaused while the file is broken',
      isFileBroken: true,
      run: (store) => store.setPaused(TASK_A.id, true),
      reason: 'fix it first',
    },
    {
      case: 'remove while the file is broken',
      isFileBroken: true,
      run: (store) => store.remove(TASK_A.id),
      reason: 'fix it first',
    },
  ])('mutation_Refused_WritesNothing ($case)', async (row) => {
    const { memory, store } = setUp();
    await memory.write(TASK_PATH, fileText(TASK_A));
    await store.load();
    if (row.isFileBroken === true) {
      await writeOutside(memory, store, BROKEN_TEXT);
    }
    const before = await memory.read(TASK_PATH);

    await expect(row.run(store)).rejects.toThrow(row.reason);

    expect(await memory.read(TASK_PATH)).toBe(before);
  });

  it('setPaused_Task_SetsPausedAndUpdatedAt', async () => {
    const { memory, store } = setUp();
    await memory.write(TASK_PATH, fileText(TASK_A, TASK_B));
    await store.load();

    await store.setPaused(TASK_B.id, false);

    expect(store.tasks()).toEqual([
      TASK_A,
      { ...TASK_B, paused: false, updatedAt: NOW },
    ]);
  });
});
