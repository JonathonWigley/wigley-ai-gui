import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { SubmissionRecord } from '../contract';
import { problemJson } from '../problem';
import {
  PRACTICE_FOLDER,
  TWO_SUM,
  writeProblem,
} from './practice-fixtures.test-support';
import { createProblemStore } from './problem-store';

function setUp() {
  const files = createMemoryFiles();
  const logs: string[] = [];
  const store = createProblemStore({
    files,
    paths: posixPaths,
    log: (message) => logs.push(message),
    folder: () => PRACTICE_FOLDER,
  });
  return { files, logs, store };
}

function record(time: string): SubmissionRecord {
  return {
    time,
    verdict: 'accepted',
    passed: 3,
    total: 3,
    ms: 12,
    failing: null,
    code: 'class Solution {};',
  };
}

describe('createProblemStore', () => {
  it.each([
    {
      name: 'a bad field',
      text: problemJson(TWO_SUM).replace('"easy"', '"Easy"'),
      message: /^problems\/two-sum\/problem\.json: difficulty/,
    },
    {
      name: 'a file that is no JSON',
      text: '{',
      message: /^problems\/two-sum\/problem\.json: /,
    },
    {
      name: 'a missing file',
      text: null,
      message: /^problems\/two-sum\/problem\.json: missing$/,
    },
  ])('readProblem names the file and the field: $name', async (row) => {
    const { files, store } = setUp();
    if (row.text !== null) {
      await files.write(
        `${PRACTICE_FOLDER}/problems/two-sum/problem.json`,
        row.text,
      );
    }

    await expect(store.readProblem('two-sum')).rejects.toThrow(row.message);
  });

  it('slugs lists the problem folders only', async () => {
    const { files, store } = setUp();
    await writeProblem(files, TWO_SUM);
    await files.write(`${PRACTICE_FOLDER}/problems/stray.txt`, 'x');
    await files.makeFolder(`${PRACTICE_FOLDER}/problems/add-two-numbers`);

    expect(await store.slugs()).toEqual(['add-two-numbers', 'two-sum']);
  });

  it.each([
    { path: 'problems/two-sum/solution.cpp', slug: 'two-sum' },
    { path: 'problems/two-sum/submissions/x.json', slug: 'two-sum' },
    { path: 'problems/lru-cache/progress.json', slug: 'lru-cache' },
  ])('watch reports the slug of each change: $path', async (row) => {
    const { files, store } = setUp();
    const slugs: (string | null)[] = [];
    const watch = store.watch((slug) => slugs.push(slug));
    store.startWatching();

    await files.write(`${PRACTICE_FOLDER}/${row.path}`, 'x');
    await files.write(`${PRACTICE_FOLDER}/.build/two-sum/driver.cpp`, 'x');
    watch.dispose();

    expect(slugs).toEqual([row.slug]);
  });

  it.each([
    { name: 'made before startWatching', startsFirst: false },
    { name: 'made after it', startsFirst: true },
  ])('watch starts at startWatching: $name', async ({ startsFirst }) => {
    const { files, store } = setUp();
    await store.slugs();
    if (startsFirst) {
      store.startWatching();
    }
    const slugs: (string | null)[] = [];
    const watch = store.watch((slug) => slugs.push(slug));

    await files.write(`${PRACTICE_FOLDER}/problems/early/x`, 'x');
    await store.slugs();
    store.startWatching();
    await files.write(`${PRACTICE_FOLDER}/problems/late/x`, 'x');
    watch.dispose();

    expect(slugs).toEqual(startsFirst ? ['early', 'late'] : ['late']);
  });

  it('submissions come newest first', async () => {
    const { files, logs, store } = setUp();
    const times = [
      '2026-11-09T14:03:22.123Z',
      '2026-11-10T08:00:00.000Z',
      '2026-11-01T23:59:59.999Z',
    ];
    for (const time of times) {
      await store.writeSubmission('two-sum', record(time));
    }
    await files.write(
      `${PRACTICE_FOLDER}/problems/two-sum/submissions/broken.json`,
      '{',
    );

    const read = await store.submissions('two-sum');
    const names = await files.list(
      `${PRACTICE_FOLDER}/problems/two-sum/submissions`,
    );

    expect(read.map((submission) => submission.time)).toEqual([
      '2026-11-10T08:00:00.000Z',
      '2026-11-09T14:03:22.123Z',
      '2026-11-01T23:59:59.999Z',
    ]);
    expect(names.map((entry) => entry.path)).toContain(
      '2026-11-09T14-03-22-123Z.json',
    );
    expect(names.every((entry) => !entry.path.includes(':'))).toBe(true);
    expect(logs).toEqual([
      expect.stringMatching(/^problems\/two-sum\/submissions\/broken\.json: /),
    ]);
  });

  it('writeBuildFile writes under .build only', async () => {
    const { files, store } = setUp();

    const path = await store.writeBuildFile(
      'two-sum/import/reference.cpp',
      'int main() {}',
    );

    expect(path).toBe('/home/u/leetcode/.build/two-sum/import/reference.cpp');
    expect(await files.read(path)).toBe('int main() {}');
    expect(await files.list(`${PRACTICE_FOLDER}/problems`)).toEqual([]);
  });

  it.each(['../problems/two-sum/x', '/etc/x', 'a/../../x'])(
    'writeBuildFile refuses %s',
    async (relativePath) => {
      const { files, store } = setUp();

      await expect(store.writeBuildFile(relativePath, 'x')).rejects.toThrow(
        'is outside .build',
      );
      expect(await files.list('/', { recursive: true })).toEqual([]);
    },
  );
});
