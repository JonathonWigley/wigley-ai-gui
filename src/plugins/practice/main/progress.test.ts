import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  Attempt,
  JudgeResult,
  SubmissionRecord,
  Verdict,
} from '../contract';
import { stubSource } from '../driver';
import { PRACTICE_FOLDER, TWO_SUM } from './practice-fixtures.test-support';
import { createProblemStore } from './problem-store';
import { createProgress, type ProgressFile } from './progress';

// Local noon of 2026-11-<date>, so the day `dayOf` reads holds in every zone.
function noon(date: number): number {
  return new Date(2026, 10, date, 12).getTime();
}

function iso(date: number): string {
  return new Date(noon(date)).toISOString();
}

const TODAY = 9;
const SOLUTION = `${PRACTICE_FOLDER}/problems/two-sum/solution.cpp`;
const PROGRESS = `${PRACTICE_FOLDER}/problems/two-sum/progress.json`;

function attempt(started: number, peeked = false): Attempt {
  return {
    id: `a${started}`,
    started: iso(started),
    peeked,
    interviewer: null,
  };
}

function setUp() {
  const files = createMemoryFiles();
  const store = createProblemStore({
    files,
    paths: posixPaths,
    log: () => undefined,
    folder: () => PRACTICE_FOLDER,
  });
  let ids = 0;
  const progress = createProgress({
    store,
    clock: { now: () => noon(TODAY) },
    randomHex: () => `new${++ids}`,
    steps: () => [2, 5],
  });
  const given = async (file: ProgressFile | null) => {
    if (file !== null) {
      await files.write(PROGRESS, JSON.stringify(file));
    }
  };
  return { files, store, progress, given };
}

function result(verdict: Verdict): JudgeResult {
  return {
    verdict,
    passed: verdict === 'accepted' ? 3 : 1,
    total: 3,
    ms: 20,
    compileOutput: null,
    failing: null,
    cases: [],
  };
}

function submission(date: number, verdict: Verdict): SubmissionRecord {
  return { ...result(verdict), time: iso(date), code: '' };
}

describe('createProgress', () => {
  it.each([
    {
      name: 'no progress, the import stub present',
      given: null,
      solution: 'mine',
      opens: 1,
      attempts: 1,
      code: 'mine',
    },
    {
      name: 'no progress, no solution',
      given: null,
      solution: null,
      opens: 1,
      attempts: 1,
      code: 'stub',
    },
    {
      name: 'not due',
      given: {
        status: 'solved',
        review: { step: 0, due: '2026-11-12' },
        attempts: [attempt(1)],
      },
      solution: 'mine',
      opens: 2,
      attempts: 1,
      code: 'mine',
    },
    {
      name: 'due, the attempt started before the due day',
      given: {
        status: 'solved',
        review: { step: 1, due: '2026-11-06' },
        attempts: [attempt(1)],
      },
      solution: 'mine',
      opens: 1,
      attempts: 2,
      code: 'stub',
    },
    {
      name: 'due, opened twice',
      given: {
        status: 'solved',
        review: { step: 1, due: '2026-11-06' },
        attempts: [attempt(1)],
      },
      solution: 'mine',
      opens: 2,
      attempts: 2,
      code: 'stub',
    },
  ] satisfies {
    name: string;
    given: ProgressFile | null;
    solution: string | null;
    opens: number;
    attempts: number;
    code: 'mine' | 'stub';
  }[])('open starts an attempt only when it should: $name', async (row) => {
    const { files, progress, given } = setUp();
    await given(row.given);
    if (row.solution !== null) {
      await files.write(SOLUTION, row.solution);
    }
    const before = row.given === null ? null : await files.read(PROGRESS);

    const opened: Attempt[] = [];
    for (let open = 0; open < row.opens; open++) {
      opened.push(await progress.open('two-sum', TWO_SUM));
    }

    const file = await progress.read('two-sum');
    expect(file.attempts).toHaveLength(row.attempts);
    expect(opened.every((each) => each.id === file.attempts.at(-1)?.id)).toBe(
      true,
    );
    expect(await files.read(SOLUTION)).toBe(
      row.code === 'stub' ? stubSource(TWO_SUM) : 'mine',
    );
    if (row.attempts === 1 && before !== null) {
      expect(await files.read(PROGRESS)).toBe(before);
    }
  });

  it.each([
    {
      name: 'first accepted, no peek',
      given: {
        status: 'new',
        review: { step: null, due: null },
        attempts: [attempt(8)],
      },
      earlier: [],
      verdict: 'accepted',
      status: 'solved',
      review: { step: 0, due: '2026-11-11' },
    },
    {
      name: 'wrongAnswer on a new problem',
      given: {
        status: 'new',
        review: { step: null, due: null },
        attempts: [attempt(8)],
      },
      earlier: [],
      verdict: 'wrongAnswer',
      status: 'attempted',
      review: { step: null, due: null },
    },
    {
      name: 'second accepted in the same attempt',
      given: {
        status: 'solved',
        review: { step: 0, due: '2026-11-10' },
        attempts: [attempt(8)],
      },
      earlier: [submission(8, 'accepted')],
      verdict: 'accepted',
      status: 'solved',
      review: { step: 0, due: '2026-11-10' },
    },
    {
      name: 'first accepted of a fresh attempt, an older attempt accepted',
      given: {
        status: 'solved',
        review: { step: 0, due: '2026-11-08' },
        attempts: [attempt(2), attempt(8)],
      },
      earlier: [submission(2, 'accepted'), submission(8, 'wrongAnswer')],
      verdict: 'accepted',
      status: 'solved',
      review: { step: 1, due: '2026-11-14' },
    },
    {
      name: 'accepted after a peek',
      given: {
        status: 'attempted',
        review: { step: 0, due: '2026-11-11' },
        attempts: [attempt(8, true)],
      },
      earlier: [submission(8, 'wrongAnswer')],
      verdict: 'accepted',
      status: 'solved',
      review: { step: 0, due: '2026-11-11' },
    },
    {
      name: 'wrongAnswer after solved',
      given: {
        status: 'solved',
        review: { step: 1, due: '2026-11-20' },
        attempts: [attempt(8)],
      },
      earlier: [],
      verdict: 'wrongAnswer',
      status: 'solved',
      review: { step: 1, due: '2026-11-20' },
    },
  ] satisfies {
    name: string;
    given: ProgressFile;
    earlier: SubmissionRecord[];
    verdict: Verdict;
    status: ProgressFile['status'];
    review: ProgressFile['review'];
  }[])('recordSubmission moves status and ladder: $name', async (row) => {
    const { store, progress, given } = setUp();
    await given(row.given);
    for (const earlier of row.earlier) {
      await store.writeSubmission('two-sum', earlier);
    }

    const record = await progress.recordSubmission(
      'two-sum',
      result(row.verdict),
      'class Solution {};',
    );

    const file = await progress.read('two-sum');
    expect({ status: file.status, review: file.review }).toEqual({
      status: row.status,
      review: row.review,
    });
    expect(record).toMatchObject({
      time: iso(TODAY),
      verdict: row.verdict,
      code: 'class Solution {};',
    });
    expect(await store.submissions('two-sum')).toHaveLength(
      row.earlier.length + 1,
    );
  });

  it.each([
    {
      name: 'solved on step 1',
      given: {
        status: 'solved',
        review: { step: 1, due: '2026-11-10' },
        attempts: [attempt(8)],
      },
      status: 'solved',
    },
    {
      name: 'new with no attempt',
      given: { status: 'new', review: { step: null, due: null }, attempts: [] },
      status: 'new',
    },
    {
      name: 'attempted, never on the ladder',
      given: {
        status: 'attempted',
        review: { step: null, due: null },
        attempts: [attempt(8)],
      },
      status: 'attempted',
    },
  ] satisfies {
    name: string;
    given: ProgressFile;
    status: ProgressFile['status'];
  }[])('peek drops the ladder to its first step: $name', async (row) => {
    const { progress, given } = setUp();
    await given(row.given);

    await progress.peek('two-sum');

    const file = await progress.read('two-sum');
    expect(file.status).toBe(row.status);
    expect(file.review).toEqual({ step: 0, due: '2026-11-11' });
    expect(file.attempts).toHaveLength(1);
    expect(file.attempts[0].peeked).toBe(true);
  });

  it('a malformed progress.json is an error naming it', async () => {
    const { files, progress } = setUp();
    await files.write(PROGRESS, '{"status": 3}');

    await expect(progress.read('two-sum')).rejects.toThrow(
      /^problems\/two-sum\/progress\.json: status/,
    );
    await expect(progress.open('two-sum', TWO_SUM)).rejects.toThrow(
      'problems/two-sum/progress.json:',
    );
  });

  it('runs overlapping writes in call order', async () => {
    const { progress } = setUp();

    await Promise.all([
      progress.open('two-sum', TWO_SUM),
      progress.peek('two-sum'),
      progress.recordSubmission('two-sum', result('wrongAnswer'), ''),
    ]);

    const file = await progress.read('two-sum');
    expect(file.attempts).toHaveLength(1);
    expect(file.attempts[0].peeked).toBe(true);
    expect(file.status).toBe('attempted');
  });

  it('setInterviewer writes the attempt it names', async () => {
    const { progress, given } = setUp();
    await given({
      status: 'attempted',
      review: { step: null, due: null },
      attempts: [attempt(2), attempt(8)],
    });

    await progress.setInterviewer('two-sum', 'a2', {
      sessionId: 's1',
      hostSessionId: 'h1',
    });

    const file = await progress.read('two-sum');
    expect(file.attempts.map((each) => each.interviewer)).toEqual([
      { sessionId: 's1', hostSessionId: 'h1' },
      null,
    ]);
  });
});
