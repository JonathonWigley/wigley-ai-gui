import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { Attempt } from '../contract';
import { INTERVIEWER_INSTRUCTIONS } from './instructions';
import {
  createInterviewerStore,
  interviewerAgentSpec,
} from './interviewer-agent';
import {
  COUNTER,
  PRACTICE_FOLDER,
  TWO_SUM,
  writeProblem,
} from './practice-fixtures.test-support';
import { createProblemStore } from './problem-store';
import { createProgress } from './progress';

const NO_ATTEMPT = 'two-sum has no attempt; open it first.';

function record(n: number): NonNullable<Attempt['interviewer']> {
  return { sessionId: `row-${String(n)}`, hostSessionId: `host-${String(n)}` };
}

function attempt(
  id: string,
  interviewer: Attempt['interviewer'] = null,
): Attempt {
  return {
    id,
    started: '2026-11-08T12:00:00.000Z',
    peeked: false,
    interviewer,
  };
}

// The interviewer's spec and store over Two Sum in the memory files;
// `given` writes a problem's `progress.json` with `attempts`.
async function setUp(options: { interviewerMd?: string } = {}) {
  const files = createMemoryFiles();
  const store = createProblemStore({
    files,
    paths: posixPaths,
    log: () => undefined,
    folder: () => PRACTICE_FOLDER,
  });
  const progress = createProgress({
    store,
    clock: { now: () => Date.parse('2026-11-09T12:00:00Z') },
    randomHex: () => 'new',
    steps: () => [1, 3],
  });
  await writeProblem(files, TWO_SUM);
  if (options.interviewerMd !== undefined) {
    await files.write(
      `${PRACTICE_FOLDER}/interviewer.md`,
      options.interviewerMd,
    );
  }
  const given = (slug: string, attempts: Attempt[]) =>
    files.write(
      `${PRACTICE_FOLDER}/problems/${slug}/progress.json`,
      JSON.stringify({
        status: 'new',
        review: { step: null, due: null },
        attempts,
      }),
    );
  const interviewers = async (slug: string) =>
    (await progress.read(slug)).attempts.map((one) => one.interviewer);
  const deps = { store, progress };
  return {
    files,
    progress,
    given,
    interviewers,
    interviewerStore: createInterviewerStore(deps),
    spec: interviewerAgentSpec(deps),
  };
}

describe('interviewer agent', () => {
  it.each<{
    case: string;
    attempts: Attempt[] | null;
    error: string | null;
    stored: Attempt['interviewer'][];
  }>([
    { case: 'no attempt', attempts: null, error: NO_ATTEMPT, stored: [] },
    {
      case: 'one attempt',
      attempts: [attempt('a1')],
      error: null,
      stored: [record(1)],
    },
    {
      case: 'two attempts',
      attempts: [attempt('a1', record(0)), attempt('a2')],
      error: null,
      stored: [record(0), record(1)],
    },
  ])(
    "read and write keep the current attempt's interviewer: $case",
    async ({ attempts, error, stored }) => {
      const part = await setUp();
      if (attempts !== null) {
        await part.given('two-sum', attempts);
      }

      const before = await part.interviewerStore.read('two-sum');
      const writing = part.interviewerStore.write('two-sum', record(1));
      if (error === null) {
        await writing;
      } else {
        await expect(writing).rejects.toThrow(error);
      }

      expect(before).toBeNull();
      expect(await part.interviewerStore.read('two-sum')).toEqual(
        error === null ? record(1) : null,
      );
      expect(await part.interviewers('two-sum')).toEqual(stored);
    },
  );

  it("entries lists each problem's current interviewer", async () => {
    const part = await setUp();
    await writeProblem(part.files, COUNTER);
    await part.given('two-sum', [attempt('a1'), attempt('a2', record(1))]);
    await part.given('counter', [attempt('a1', record(2)), attempt('a2')]);
    await part.files.write(
      `${PRACTICE_FOLDER}/problems/broken/progress.json`,
      'not json',
    );

    expect(await part.interviewerStore.entries()).toEqual([
      { scope: 'two-sum', record: record(1) },
    ]);
  });

  it.each<{
    case: string;
    attempts: Attempt[];
    superseded: Attempt['interviewer'];
  }>([
    {
      case: 'no earlier attempt',
      attempts: [attempt('a1', record(1))],
      superseded: null,
    },
    {
      case: 'an earlier one holds one',
      attempts: [
        attempt('a1', record(0)),
        attempt('a2', record(1)),
        attempt('a3', record(2)),
      ],
      superseded: record(1),
    },
    {
      case: 'the latest earlier holds none',
      attempts: [attempt('a1', record(0)), attempt('a2'), attempt('a3')],
      superseded: record(0),
    },
    {
      case: 'only the current holds one',
      attempts: [attempt('a1'), attempt('a2', record(2))],
      superseded: null,
    },
  ])(
    "superseded is the latest earlier attempt's interviewer: $case",
    async ({ attempts, superseded }) => {
      const part = await setUp();
      await part.given('two-sum', attempts);

      expect(await part.interviewerStore.superseded('two-sum')).toEqual(
        superseded,
      );
    },
  );

  it('checkAsk refuses a problem with no attempt', async () => {
    const part = await setUp();

    await expect(part.interviewerStore.checkAsk('two-sum')).rejects.toThrow(
      NO_ATTEMPT,
    );
    await part.progress.open('two-sum', TWO_SUM);
    await expect(
      part.interviewerStore.checkAsk('two-sum'),
    ).resolves.toBeUndefined();
  });

  it.each<{ case: string; interviewerMd?: string; instructions: string }>([
    { case: 'built-in', instructions: INTERVIEWER_INSTRUCTIONS },
    {
      case: 'interviewer.md',
      interviewerMd: 'Be terse.',
      instructions: 'Be terse.',
    },
    {
      case: 'blank interviewer.md',
      interviewerMd: ' \n',
      instructions: INTERVIEWER_INSTRUCTIONS,
    },
  ])('instructions: $case', async ({ interviewerMd, instructions }) => {
    const part = await setUp({ interviewerMd });

    expect(await part.spec.instructions('two-sum')).toBe(instructions);
  });

  it('the spec names the interviewer', async () => {
    const { spec } = await setUp();

    expect({
      owner: spec.owner,
      agentId: spec.agentId,
      folder: spec.folder('two-sum'),
      title: await spec.title('two-sum'),
    }).toEqual({
      owner: 'practice',
      agentId: 'interviewer',
      folder: PRACTICE_FOLDER,
      title: 'Interviewer: Two Sum',
    });
  });
});
