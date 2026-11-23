import { describe, expect, it, vi } from 'vitest';
import type { Files } from '../../../contracts/files';
import {
  createMemoryFiles,
  type MemoryFiles,
} from '../../../shared/memory-files';
import type { WorkColumnSetting, WorkState } from '../contract';
import { jiraCard, localCard, workItem } from '../contract.test-support';
import {
  buildWorkState,
  createWorkStore,
  EMPTY_WORK_FILE,
  parseWorkFile,
  WORK_FILE,
  type WorkFile,
} from './store';

const COLUMNS: WorkColumnSetting[] = [
  { name: 'Todo', jiraStatuses: ['To Do'] },
  { name: 'Review', jiraStatuses: ['In Review'] },
];

// A store over memory files whose writes are recorded, with the methods `overrides` makes over them laid on top,
// and its log lines.
function storeOver(
  overrides: (memory: MemoryFiles) => Partial<Files> = () => ({}),
) {
  const memory = createMemoryFiles();
  const writes: string[] = [];
  const files: Files = {
    ...memory,
    write: async (path, text) => {
      writes.push(path);
      await memory.write(path, text);
    },
    ...overrides(memory),
  };
  const logs: string[] = [];
  const store = createWorkStore(files, (line) => logs.push(line));
  return { memory, writes, logs, store };
}

// A change that adds item `id`.
function withItem(id: string): (file: WorkFile) => WorkFile {
  return (file) => ({ ...file, items: [...file.items, workItem(id)] });
}

describe('createWorkStore', () => {
  it('load_missingFile_readsEmpty', async () => {
    const { store } = storeOver();

    await store.load();

    expect(store.file()).toEqual(EMPTY_WORK_FILE);
    expect(store.problem()).toBeNull();
  });

  it('load_unreadableFile_setsProblemAndNeverWrites', async () => {
    const { store, writes, logs } = storeOver(() => ({
      read: () => Promise.reject(new Error('EACCES: permission denied')),
    }));

    await store.load();
    const updated = await store.update(withItem('a'));

    expect(store.problem()).toBe(
      'work.json could not be read, so nothing is saved this run: EACCES: permission denied',
    );
    expect(logs).toContain('work.json not read: EACCES: permission denied');
    expect(writes).toEqual([]);
    expect(store.file()).toBe(updated);
    expect(updated.items.map((item) => item.id)).toEqual(['a']);
  });

  it.each(['{}', '{"items":[{"id":1}]}', '[]', 'not json'])(
    'load_badShape_setsProblem (%s)',
    async (text) => {
      const { memory, store, writes } = storeOver();
      await memory.write(WORK_FILE, text);

      await store.load();
      await store.update(withItem('a'));

      expect(store.problem()).toContain('work.json is not a work file');
      expect(writes).toEqual([]);
      expect(await memory.read(WORK_FILE)).toBe(text);
    },
  );

  it('update_backToBack_appliesInOrder', async () => {
    // The first write takes longer than the second, so only the chain keeps the second's file last on disk.
    let writeCount = 0;
    const { memory, store } = storeOver((files) => ({
      write: async (path, text) => {
        writeCount += 1;
        if (writeCount === 1) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        await files.write(path, text);
      },
    }));
    const seenBySecond: string[] = [];

    const first = store.update(withItem('a'));
    const second = store.update((file) => {
      seenBySecond.push(...file.items.map((item) => item.id));
      return withItem('b')(file);
    });
    await Promise.all([first, second]);

    expect(seenBySecond).toEqual(['a']);
    const saved = parseWorkFile(await memory.read(WORK_FILE));
    expect(saved.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('update_changeThrows_rejectsAndKeepsFile', async () => {
    const { store, writes } = storeOver();
    const listener = vi.fn();
    store.onChange(listener);
    await store.update(withItem('a'));
    const before = store.file();
    listener.mockClear();
    writes.length = 0;

    const failed = store.update(() => {
      throw new Error('no such card');
    });

    await expect(failed).rejects.toThrow('no such card');
    expect(store.file()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    const later = await store.update(withItem('b'));
    expect(later.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('update_writeFails_resolvesAndLogs', async () => {
    const { store, logs } = storeOver(() => ({
      write: () => Promise.reject(new Error('disk full')),
    }));

    const updated = await store.update(withItem('a'));

    expect(updated.items.map((item) => item.id)).toEqual(['a']);
    expect(store.file()).toBe(updated);
    expect(logs).toContain('work.json not written: disk full');
  });

  it('update_listenerThrows_stillResolvesAndCallsOthers', async () => {
    const { store, logs } = storeOver();
    store.onChange(() => {
      throw new Error('slot gone');
    });
    const second = vi.fn();
    store.onChange(second);

    const updated = await store.update(withItem('a'));

    expect(second).toHaveBeenCalledWith(updated);
    expect(updated.items.map((item) => item.id)).toEqual(['a']);
    expect(logs).toContain('work listener failed: slot gone');
  });

  it('roundTrip_savedFile_parsesEqual', async () => {
    const { memory, store } = storeOver();
    const full: WorkFile = {
      items: [
        workItem('a', {
          ticketKeys: ['WS-1'],
          linkReason: 'Names the board',
          draft: 'On it',
          state: 'snoozed',
          snoozedUntil: '2026-11-24T10:00:00.000Z',
          sending: 'On it',
        }),
      ],
      cards: [
        jiraCard('WS-1', 'In Review', {
          priority: 'High',
          reachableStatuses: ['Done'],
          linkedSessionIds: ['row-1'],
          movingTo: 'Done',
        }),
        localCard('local-1', 'Todo', { sourceItemId: 'a', note: 'failed' }),
      ],
      suggestions: [
        {
          cardId: 'WS-1',
          signal: 'pr_merged',
          column: 'Done',
          reason: 'PR #4 merged',
          at: '2026-11-23T11:00:00.000Z',
          state: 'suggested',
          rowId: null,
        },
      ],
      notYet: [
        {
          cardId: 'WS-1',
          signal: 'session',
          at: '2026-11-23T09:00:00.000Z',
          rowId: 'row-1',
        },
      ],
      job: {
        running: {
          kind: 'sweep',
          state: 'running',
          rowId: null,
          at: '2026-11-23T11:30:00.000Z',
          note: null,
        },
        last: {
          kind: 'move',
          state: 'failed',
          rowId: 'row-9',
          at: '2026-11-23T11:00:00.000Z',
          note: 'No such status',
        },
      },
      lastSweepAt: '2026-11-23T11:00:00.000Z',
    };

    await store.update(() => full);

    expect(parseWorkFile(await memory.read(WORK_FILE))).toEqual(full);
  });

  it('parse_savedWithoutRowIds_readsNullRowIds', () => {
    const entry = {
      cardId: 'WS-1',
      signal: 'branch',
      column: 'Review',
      reason: 'Branch ws-1',
      at: '2026-11-23T11:00:00.000Z',
      state: 'suggested',
    } as const;
    const mark = {
      cardId: 'WS-2',
      signal: 'session',
      at: '2026-11-23T09:00:00.000Z',
    } as const;
    const text = JSON.stringify({
      ...EMPTY_WORK_FILE,
      suggestions: [entry],
      notYet: [mark],
    });

    const parsed = parseWorkFile(text);

    expect(parsed.suggestions).toEqual([{ ...entry, rowId: null }]);
    expect(parsed.notYet).toEqual([{ ...mark, rowId: null }]);
  });
});

describe('buildWorkState', () => {
  it.each<{
    case: string;
    file: WorkFile;
    problem: string | null;
    expected: Partial<WorkState>;
  }>([
    {
      case: "a Jira card's column comes from its status",
      file: {
        ...EMPTY_WORK_FILE,
        cards: [jiraCard('WS-1', 'in review', { column: 'Todo' })],
      },
      problem: null,
      expected: {
        cards: [jiraCard('WS-1', 'in review', { column: 'Review' })],
      },
    },
    {
      case: 'a suggestion shows without its row id',
      file: {
        ...EMPTY_WORK_FILE,
        suggestions: [
          {
            cardId: 'local-1',
            signal: 'session',
            column: 'Review',
            reason: 'Session "Fix"',
            at: '2026-11-23T11:00:00.000Z',
            state: 'suggested',
            rowId: 'row-1',
          },
        ],
      },
      problem: null,
      expected: {
        suggestions: [
          {
            cardId: 'local-1',
            signal: 'session',
            column: 'Review',
            reason: 'Session "Fix"',
            at: '2026-11-23T11:00:00.000Z',
            state: 'suggested',
          },
        ],
      },
    },
    {
      case: 'a local task in a column work.columns lacks shows in Other',
      file: { ...EMPTY_WORK_FILE, cards: [localCard('local-1', 'Gone')] },
      problem: null,
      expected: { cards: [localCard('local-1', 'Other')] },
    },
    {
      case: 'the columns end in Other, and the problem passes through',
      file: EMPTY_WORK_FILE,
      problem: 'work.json could not be read',
      expected: {
        columns: ['Todo', 'Review', 'Other'],
        problem: 'work.json could not be read',
      },
    },
  ])('$case', ({ file, problem, expected }) => {
    expect(buildWorkState(file, COLUMNS, problem)).toMatchObject(expected);
  });

  it('leaves the stored column of a local task it shows in Other', () => {
    const file = { ...EMPTY_WORK_FILE, cards: [localCard('local-1', 'Gone')] };

    buildWorkState(file, COLUMNS, null);

    expect(file.cards[0]?.column).toBe('Gone');
  });
});
