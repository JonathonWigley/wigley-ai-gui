import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { CaseResult, JudgeResult, Verdict } from '../contract';
import { expectedAnswer, type JsonValue, type Problem } from '../problem';
import type { Judge, JudgeCase, JudgeOptions } from './judge';
import { createPracticeRuns } from './practice-runs';
import {
  COUNTER,
  PRACTICE_FOLDER,
  TWO_SUM,
  writeProblem,
} from './practice-fixtures.test-support';
import { createProblemStore } from './problem-store';
import { createProgress } from './progress';

interface JudgeCall {
  codePath: string;
  cases: JudgeCase[];
  options: JudgeOptions;
}

// A judge that records each call and answers with `answer`'s result for it.
function recordingJudge(answer: (call: JudgeCall) => JudgeResult) {
  const calls: JudgeCall[] = [];
  const judge: Judge = {
    judge: async (_problem, codePath, cases, options) => {
      const call = { codePath, cases, options };
      calls.push(call);
      return answer(call);
    },
  };
  return { calls, judge };
}

// A result whose case k has `verdicts[k]` and `outputs[k]`.
function judged(
  cases: JudgeCase[],
  verdicts: Verdict[],
  outputs: JsonValue[] = [],
): JudgeResult {
  const results: CaseResult[] = verdicts.map((verdict, index) => ({
    index,
    source: cases[index].source,
    input: null,
    expected: expectedAnswer(cases[index]),
    output: outputs[index] ?? null,
    stdout: '',
    stderr: '',
    verdict,
    ms: 5,
  }));
  const failing = results.find((each) => each.verdict !== 'accepted') ?? null;
  return {
    verdict: failing?.verdict ?? 'accepted',
    passed: results.filter((each) => each.verdict === 'accepted').length,
    total: cases.length,
    ms: 5 * results.length,
    compileOutput: null,
    failing,
    cases: results,
  };
}

const TWICE: Problem = {
  ...TWO_SUM,
  slug: 'twice',
  title: 'Twice',
  signature: {
    kind: 'function',
    method: 'twice',
    params: [{ name: 'x', type: 'long long' }],
    returns: 'long long',
  },
  compare: 'exact',
  cases: [{ input: [2], expected: 4, visible: true }],
};

const COMPILE_ERROR: JudgeResult = {
  verdict: 'compileError',
  passed: 0,
  total: 1,
  ms: 0,
  compileOutput: 'reference.cpp:2:1: error: x\n1 error generated.',
  failing: null,
  cases: [],
};

async function setUp(problem: Problem, judge: Judge, customText?: string) {
  const files = createMemoryFiles();
  const store = createProblemStore({
    files,
    paths: posixPaths,
    log: () => undefined,
    folder: () => PRACTICE_FOLDER,
  });
  const progress = createProgress({
    store,
    clock: { now: () => Date.UTC(2026, 10, 9, 12) },
    randomHex: () => 'a1b2c3d4',
    steps: () => [1, 3],
  });
  await writeProblem(files, problem);
  await store.writeText(problem.slug, 'solution.cpp', 'class Solution {};');
  if (customText !== undefined) {
    await store.writeText(problem.slug, 'custom-cases.json', customText);
  }
  return { store, runs: createPracticeRuns({ store, progress, judge }) };
}

const isReference = (call: JudgeCall) =>
  call.codePath.endsWith('reference.cpp');

describe('createPracticeRuns', () => {
  it.each([
    {
      name: 'a function problem',
      problem: TWO_SUM,
      custom: '[[[3,3],6]]',
      placeholder: null,
      referenceOutput: [0, 1],
    },
    {
      name: 'a design problem',
      problem: COUNTER,
      custom: '[{"ops":["Counter","get"],"args":[[1],[]]}]',
      placeholder: [],
      referenceOutput: [null, 1],
    },
  ])(
    'run takes custom expected answers from the reference: $name',
    async (row) => {
      const double = recordingJudge((call) =>
        isReference(call)
          ? judged(call.cases, ['wrongAnswer'], [row.referenceOutput])
          : judged(call.cases, ['accepted', 'accepted']),
      );
      const { runs } = await setUp(row.problem, double.judge, row.custom);

      await runs.run(row.problem.slug);

      const [reference, solution] = double.calls;
      expect(reference.codePath).toBe(
        `${PRACTICE_FOLDER}/problems/${row.problem.slug}/reference.cpp`,
      );
      expect(reference.cases.map((each) => expectedAnswer(each))).toEqual([
        row.placeholder,
      ]);
      expect(solution.codePath).toBe(
        `${PRACTICE_FOLDER}/problems/${row.problem.slug}/solution.cpp`,
      );
      expect(solution.options.stopAtFirstFailure).toBe(false);
      expect(
        solution.cases.map((each) => ({
          source: each.source,
          expected: expectedAnswer(each),
        })),
      ).toEqual([
        { source: 'example', expected: expectedAnswer(row.problem.cases[0]) },
        { source: 'custom', expected: row.referenceOutput },
      ]);
      expect(runs.lastResult(row.problem.slug)?.kind).toBe('run');
    },
  );

  it.each([
    {
      name: 'a runtime error',
      problem: TWO_SUM,
      custom: '[[[1,2],3],[[3,3],6]]',
      answer: (call: JudgeCall) =>
        judged(call.cases, ['wrongAnswer', 'runtimeError'], [[0, 1]]),
      message: 'reference.cpp fails on custom case 2: runtimeError',
    },
    {
      name: 'a compile error',
      problem: TWO_SUM,
      custom: '[[[3,3],6]]',
      answer: () => COMPILE_ERROR,
      message: 'reference.cpp does not compile: reference.cpp:2:1: error: x',
    },
    {
      name: 'a design answer that is no array',
      problem: COUNTER,
      custom: '[{"ops":["Counter","get"],"args":[[1],[]]}]',
      answer: (call: JudgeCall) => judged(call.cases, ['wrongAnswer'], [7]),
      message:
        "reference.cpp's answer to custom case 1 does not fit the signature: expected: expected an array, got 7",
    },
    {
      name: 'a long long answer past the safe range',
      problem: TWICE,
      custom: '[[4503599627370497]]',
      answer: (call: JudgeCall) =>
        judged(call.cases, ['wrongAnswer'], [9007199254740994]),
      message:
        "reference.cpp's answer to custom case 1 does not fit the signature: expected: expected long long, got 9007199254740994",
    },
  ])(
    'run refuses when the reference fails a custom case: $name',
    async (row) => {
      const double = recordingJudge(row.answer);
      const { runs } = await setUp(row.problem, double.judge, row.custom);

      await expect(runs.run(row.problem.slug)).rejects.toThrow(row.message);
      expect(double.calls.filter((call) => !isReference(call))).toEqual([]);
    },
  );

  it('run with no custom cases judges the examples only', async () => {
    const double = recordingJudge((call) => judged(call.cases, ['accepted']));
    const { runs } = await setUp(TWO_SUM, double.judge);

    await runs.run('two-sum');

    expect(double.calls).toHaveLength(1);
    expect(double.calls[0].cases.map((each) => each.source)).toEqual([
      'example',
    ]);
  });

  it('run refuses custom cases that do not parse', async () => {
    const double = recordingJudge((call) => judged(call.cases, ['accepted']));
    const { runs } = await setUp(TWO_SUM, double.judge, '[[1]]');

    await expect(runs.run('two-sum')).rejects.toThrow(/^custom-cases\.json: /);
    expect(double.calls).toEqual([]);
  });

  it('submit runs every case, stops at the first failure, and records it', async () => {
    const double = recordingJudge((call) =>
      judged(call.cases, ['accepted', 'wrongAnswer']),
    );
    const { store, runs } = await setUp(TWO_SUM, double.judge);

    const result = await runs.submit('two-sum');

    expect(double.calls).toHaveLength(1);
    expect(double.calls[0].options).toEqual({
      stopAtFirstFailure: true,
      code: 'class Solution {};',
    });
    expect(double.calls[0].cases.map((each) => each.source)).toEqual([
      'example',
      'hidden',
      'hidden',
    ]);
    const submissions = await store.submissions('two-sum');
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      verdict: 'wrongAnswer',
      passed: 1,
      total: 3,
      code: 'class Solution {};',
    });
    expect(runs.lastResult('two-sum')).toEqual({ kind: 'submit', result });
    expect(runs.lastResult('counter')).toBeNull();
  });

  it('submit records nothing when the judge rejects', async () => {
    const judge: Judge = {
      judge: async () => {
        throw new Error('clang++ not found');
      },
    };
    const { store, runs } = await setUp(TWO_SUM, judge);

    await expect(runs.submit('two-sum')).rejects.toThrow('clang++ not found');
    expect(await store.submissions('two-sum')).toEqual([]);
    expect(runs.lastResult('two-sum')).toBeNull();
  });
});
