import type { JudgeResult } from '../contract';
import {
  type CustomInput,
  parseCustomCases,
  type Problem,
  ProblemError,
} from '../problem';
import type { Judge, JudgeCase } from './judge';
import type { ProblemStore } from './problem-store';
import type { Progress } from './progress';

// The last Run or Submit result of a problem.
export interface LastResult {
  kind: 'run' | 'submit';
  result: JudgeResult;
}

export interface PracticeRunsDeps {
  store: ProblemStore;
  progress: Progress;
  judge: Judge;
}

// Run and Submit over the `solution.cpp` on disk. `run` judges the visible
// cases and the custom cases, whose expected answers come from running
// `reference.cpp` on them, and records nothing; it rejects naming the custom
// case `reference.cpp` fails on. `submit` judges every case, stopping at the
// first failure, and records a submission. `lastResult` is the last result
// either kept since the app started, null when none.
export interface PracticeRuns {
  run(slug: string): Promise<JudgeResult>;
  submit(slug: string): Promise<JudgeResult>;
  lastResult(slug: string): LastResult | null;
}

export function createPracticeRuns(deps: PracticeRunsDeps): PracticeRuns {
  const { store, progress, judge } = deps;
  const lastResults = new Map<string, LastResult>();

  return {
    async run(slug) {
      const problem = await store.readProblem(slug);
      const inputs = readCustomInputs(
        problem,
        (await store.readText(slug, 'custom-cases.json')) ?? '',
      );
      const examples: JudgeCase[] = problem.cases
        .filter((testCase) => testCase.visible)
        .map((testCase) => ({ ...testCase, source: 'example' }));
      const custom =
        inputs.length === 0
          ? []
          : await answeredByReference(store, judge, problem, inputs);
      const result = await judge.judge(
        problem,
        store.filePath(slug, 'solution.cpp'),
        [...examples, ...custom],
        { stopAtFirstFailure: false },
      );
      lastResults.set(slug, { kind: 'run', result });
      return result;
    },
    async submit(slug) {
      const problem = await store.readProblem(slug);
      const code = (await store.readText(slug, 'solution.cpp')) ?? '';
      const cases: JudgeCase[] = problem.cases.map((testCase) => ({
        ...testCase,
        source: testCase.visible ? 'example' : 'hidden',
      }));
      const result = await judge.judge(
        problem,
        store.filePath(slug, 'solution.cpp'),
        cases,
        { stopAtFirstFailure: true },
      );
      await progress.recordSubmission(slug, result, code);
      lastResults.set(slug, { kind: 'submit', result });
      return result;
    },
    lastResult: (slug) => lastResults.get(slug) ?? null,
  };
}

function readCustomInputs(problem: Problem, text: string): CustomInput[] {
  try {
    return parseCustomCases(text, problem.signature);
  } catch (error) {
    if (error instanceof ProblemError) {
      throw new Error(`custom-cases.json: ${error.message}`);
    }
    throw error;
  }
}

// The custom cases with `reference.cpp`'s outputs as their expected answers.
// The reference runs on cases holding a placeholder answer of their own type,
// so its Wrong Answer verdicts mean nothing.
async function answeredByReference(
  store: ProblemStore,
  judge: Judge,
  problem: Problem,
  inputs: CustomInput[],
): Promise<JudgeCase[]> {
  const placeholders: JudgeCase[] = inputs.map((input) =>
    'input' in input
      ? { input: input.input, expected: null, visible: true, source: 'custom' }
      : {
          ops: input.ops,
          args: input.args,
          expected: [],
          visible: true,
          source: 'custom',
        },
  );
  const reference = await judge.judge(
    problem,
    store.filePath(problem.slug, 'reference.cpp'),
    placeholders,
    { stopAtFirstFailure: false },
  );
  if (reference.verdict === 'compileError') {
    const firstLine = (reference.compileOutput ?? '').split('\n')[0];
    throw new Error(`reference.cpp does not compile: ${firstLine}`);
  }
  return placeholders.map((placeholder, index) => {
    const refusal = (verdict: string) =>
      new Error(
        `reference.cpp fails on custom case ${index + 1}: ${verdict}; check the input against the constraints.`,
      );
    const answer = reference.cases[index];
    const hasNoAnswer =
      answer.verdict === 'timeLimit' || answer.verdict === 'runtimeError';
    if (hasNoAnswer) {
      throw refusal(answer.verdict);
    }
    if ('input' in placeholder) {
      return { ...placeholder, expected: answer.output };
    }
    if (!Array.isArray(answer.output)) {
      throw refusal('runtimeError');
    }
    return { ...placeholder, expected: answer.output };
  });
}
