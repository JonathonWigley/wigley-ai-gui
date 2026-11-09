import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { parseProblem } from '../problem';
import {
  PRACTICE_FIXTURE_SLUGS,
  writePracticeFixture,
} from './selftest-fixture';

const FOLDER = '/home/leetcode';
const PROBLEMS = `${FOLDER}/problems`;

async function fixtureDeps() {
  const files = createMemoryFiles();
  await files.makeFolder('/home');
  return { files, paths: posixPaths };
}

describe('writePracticeFixture', () => {
  it.each([
    { slug: 'two-sum', kind: 'function', compare: 'anyOrder', cases: 3 },
    { slug: 'lru-cache', kind: 'design', compare: 'exact', cases: 1 },
  ])(
    'every fixture problem parses: $slug',
    async ({ slug, kind, compare, cases }) => {
      const deps = await fixtureDeps();
      await writePracticeFixture(deps, FOLDER);

      const problem = parseProblem(
        JSON.parse(await deps.files.read(`${PROBLEMS}/${slug}/problem.json`)),
        slug,
      );

      expect(problem.signature.kind).toBe(kind);
      expect(problem.compare).toBe(compare);
      expect(problem.cases).toHaveLength(cases);
    },
  );

  it('GIVEN an empty home WHEN the fixture is written THEN each problem folder holds its five files and nothing else', async () => {
    const deps = await fixtureDeps();

    await writePracticeFixture(deps, FOLDER);

    expect(
      (await deps.files.list(PROBLEMS, { recursive: true }))
        .map((entry) => entry.path)
        .sort(),
    ).toEqual(
      PRACTICE_FIXTURE_SLUGS.flatMap((slug) => [
        slug,
        ...[
          'approach.md',
          'problem.json',
          'problem.md',
          'reference.cpp',
          'solution.cpp',
        ].map((name) => `${slug}/${name}`),
      ]).sort(),
    );
  });

  it('GIVEN a submission and a stray problem from an earlier run WHEN the fixture is written again THEN both are gone and problems/ remains', async () => {
    const deps = await fixtureDeps();
    await deps.files.write(`${PROBLEMS}/lru-cache/submissions/1.json`, '{}');
    await deps.files.write(`${PROBLEMS}/old/problem.json`, '{}');

    await writePracticeFixture(deps, FOLDER);

    expect(
      await deps.files.stat(`${PROBLEMS}/lru-cache/submissions/1.json`),
    ).toBeNull();
    expect(await deps.files.stat(`${PROBLEMS}/old/problem.json`)).toBeNull();
    expect((await deps.files.stat(PROBLEMS))?.isFolder).toBe(true);
  });
});
