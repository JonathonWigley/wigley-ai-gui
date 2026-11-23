import { describe, expect, it } from 'vitest';
import { readIfPresent } from '../../../contracts/files';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { WorkJobStatus } from '../contract';
import {
  createJobRows,
  JOB_ROWS_FILE,
  type JobRowRecord,
  withKeptLastRow,
} from './job-rows';
import { EMPTY_WORK_FILE, type WorkFile } from './store';

const record = (rowId: string): JobRowRecord => ({
  rowId,
  hostSessionId: `host-${rowId}`,
  projectDir: '/home',
  profile: 'p1',
  title: `Job ${rowId}`,
});

// Job rows over memory files holding `saved` (none when undefined), loaded.
async function rowsOver(saved?: string) {
  const files = createMemoryFiles();
  if (saved !== undefined) {
    await files.write(JOB_ROWS_FILE, saved);
  }
  const logs: string[] = [];
  const rows = createJobRows(files, (line) => logs.push(line));
  return { files, logs, rows };
}

const savedIds = async (files: ReturnType<typeof createMemoryFiles>) =>
  (
    JSON.parse((await readIfPresent(files, JOB_ROWS_FILE)) ?? '[]') as {
      rowId: string;
    }[]
  ).map(({ rowId }) => rowId);

describe('createJobRows', () => {
  it('keep_newestFirst_cutAt20_repeatReplaces', async () => {
    const { files, rows } = await rowsOver();
    await rows.load();

    for (let index = 0; index <= 20; index += 1) {
      rows.keep(record(`row-${index}`));
    }
    rows.keep(record('row-5'));
    await rows.settled();

    const newerThanRepeat = [
      20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6,
    ];
    const olderThanRepeat = [4, 3, 2, 1];
    expect(await savedIds(files)).toEqual([
      'row-5',
      ...[...newerThanRepeat, ...olderThanRepeat].map((n) => `row-${n}`),
    ]);
    expect(rows.find('row-0')).toBeUndefined();
    expect(rows.find('row-5')).toEqual(record('row-5'));
  });

  it('load_keptBeforeReadEnds_staysAheadOfSaved', async () => {
    const saved = JSON.stringify([record('row-a'), record('row-b')]);
    const { files, rows } = await rowsOver(saved);

    const loading = rows.load();
    rows.keep(record('row-b'));
    rows.keep(record('row-c'));
    await loading;
    await rows.settled();

    expect(await savedIds(files)).toEqual(['row-c', 'row-b', 'row-a']);
  });

  it.each<{ case: string; saved: string }>([
    { case: 'not JSON', saved: 'not json' },
    { case: 'a record missing a field', saved: '[{"rowId":"row-1"}]' },
  ])(
    'load_unreadable_logsStartsEmptyNeverWritten: $case',
    async ({ saved }) => {
      const { files, logs, rows } = await rowsOver(saved);
      await rows.load();

      rows.keep(record('row-1'));
      await rows.settled();

      expect(
        logs.some((line) => line.startsWith('job-rows.json not read: ')),
      ).toBe(true);
      expect(await readIfPresent(files, JOB_ROWS_FILE)).toBe(saved);
      expect(rows.find('row-1')).toEqual(record('row-1'));
    },
  );
});

describe('withKeptLastRow', () => {
  const last = (rowId: string | null): WorkJobStatus => ({
    kind: 'sweep',
    state: 'done',
    rowId,
    at: '2026-11-23T09:00:00.000Z',
    note: null,
  });
  const fileWith = (status: WorkJobStatus | null): WorkFile => ({
    ...EMPTY_WORK_FILE,
    job: { running: null, last: status },
  });

  it.each<{
    case: string;
    file: WorkFile;
    rowId: string | null;
    same: boolean;
  }>([
    { case: 'no last job', file: fileWith(null), rowId: null, same: true },
    {
      case: 'last without a row',
      file: fileWith(last(null)),
      rowId: null,
      same: true,
    },
    {
      case: 'last row kept',
      file: fileWith(last('row-1')),
      rowId: 'row-1',
      same: true,
    },
    {
      case: 'last row not kept',
      file: fileWith(last('row-9')),
      rowId: null,
      same: false,
    },
  ])('$case → rowId $rowId', async ({ file, rowId, same }) => {
    const { rows } = await rowsOver();
    await rows.load();
    rows.keep(record('row-1'));

    const kept = withKeptLastRow(file, rows);

    expect(kept.job.last?.rowId ?? null).toBe(rowId);
    expect(kept === file).toBe(same);
  });
});
