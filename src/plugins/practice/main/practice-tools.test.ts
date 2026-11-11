import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { AgentSession } from '../../sessions/contract';
import type {
  Attempt,
  CaseResult,
  JudgeResult,
  SubmissionRecord,
  Verdict,
} from '../contract';
import { stubSource } from '../driver';
import { expectedAnswer, type FunctionCase, problemJson } from '../problem';
import type { JudgeCase, JudgeOptions } from './judge';
import type { LastResult } from './practice-runs';
import {
  PRACTICE_FOLDER,
  TWO_SUM,
  writeProblem,
} from './practice-fixtures.test-support';
import {
  ADD_PRACTICE_PROBLEM_TOOL,
  READ_PRACTICE_STATE_TOOL,
  startPracticeTools,
} from './practice-tools';
import { createProblemStore } from './problem-store';
import { createProgress } from './progress';

const PROBLEM_FOLDER = `${PRACTICE_FOLDER}/problems/two-sum`;
const REFERENCE = 'class Solution { /* REFERENCE_TEXT */ };';
const CASES_FILE = '/scratch/two-sum.cases.json';
const SESSION = {
  id: 'row-1',
  info: { sessionId: 'host-1', projectDir: PRACTICE_FOLDER, harness: null },
} as AgentSession;

function caseResult(
  testCase: JudgeCase,
  index: number,
  verdict: Verdict,
  stderr = '',
): CaseResult {
  return {
    index,
    source: testCase.source,
    input: (testCase as FunctionCase).input,
    expected: expectedAnswer(testCase),
    output: verdict === 'wrongAnswer' ? [9, 9] : expectedAnswer(testCase),
    stdout: '',
    stderr,
    verdict,
    ms: 3,
  };
}

// A judge result over `cases`, each case Accepted unless `verdicts` names its
// index.
function judged(
  cases: JudgeCase[],
  verdicts: Record<number, { verdict: Verdict; stderr?: string }> = {},
): JudgeResult {
  const results = cases.map((testCase, index) =>
    caseResult(
      testCase,
      index,
      verdicts[index]?.verdict ?? 'accepted',
      verdicts[index]?.stderr,
    ),
  );
  const failing = results.filter((result) => result.verdict !== 'accepted');
  return {
    verdict: failing[0]?.verdict ?? 'accepted',
    passed: results.length - failing.length,
    total: results.length,
    ms: 10,
    compileOutput: null,
    failing: failing[0] ?? null,
    cases: results,
  };
}

function setUp(options: {
  judge?: (cases: JudgeCase[]) => JudgeResult;
  interviewerSlug?: string | null;
  lastResult?: LastResult | null;
}) {
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
    randomHex: () => 'a1',
    steps: () => [1, 3],
  });
  const judgeCalls: {
    codePath: string;
    cases: JudgeCase[];
    options: JudgeOptions;
  }[] = [];
  const tools = startPracticeTools({
    files,
    paths: posixPaths,
    store,
    progress,
    judge: {
      judge: async (_problem, codePath, cases, judgeOptions) => {
        judgeCalls.push({ codePath, cases, options: judgeOptions });
        return (options.judge ?? judged)(cases);
      },
    },
    lastResult: () => options.lastResult ?? null,
    interviewerSlug: async () => options.interviewerSlug ?? null,
  })(SESSION);
  const call = (name: string, args: unknown) =>
    tools.call(name, args, {
      toolUseId: null,
      signal: new AbortController().signal,
    });
  return { files, store, call, judgeCalls };
}

function addArgs(overrides: Record<string, unknown> = {}) {
  return {
    slug: TWO_SUM.slug,
    title: TWO_SUM.title,
    difficulty: TWO_SUM.difficulty,
    tags: TWO_SUM.tags,
    lists: TWO_SUM.lists,
    compare: TWO_SUM.compare,
    signature: TWO_SUM.signature,
    cases: TWO_SUM.cases,
    statement: 'Find two numbers.',
    reference: REFERENCE,
    approach: 'Hash each number.',
    ...overrides,
  };
}

// Eight cases, the first one visible.
const EIGHT_CASES = Array.from({ length: 8 }, (_, index) => ({
  input: [[index, 1], index + 1],
  expected: [0, 1],
  visible: index === 0,
}));

describe('practice tools', () => {
  it.each<{
    case: string;
    args: Record<string, unknown>;
    existing?: boolean;
    written?: Record<string, string>;
    judge?: (cases: JudgeCase[]) => JudgeResult;
    text: string[];
  }>([
    {
      case: 'both cases and casesFile',
      args: addArgs({ casesFile: CASES_FILE }),
      text: ['give exactly one of cases and casesFile'],
    },
    {
      case: 'neither cases nor casesFile',
      args: addArgs({ cases: undefined }),
      text: ['give exactly one of cases and casesFile'],
    },
    {
      case: 'a relative casesFile',
      args: addArgs({ cases: undefined, casesFile: 'cases.json' }),
      text: ['casesFile must be an absolute path, got "cases.json"'],
    },
    {
      case: 'a missing casesFile',
      args: addArgs({ cases: undefined, casesFile: CASES_FILE }),
      text: ['casesFile could not be read', CASES_FILE],
    },
    {
      case: 'a casesFile that is not JSON',
      args: addArgs({ cases: undefined, casesFile: CASES_FILE }),
      written: { [CASES_FILE]: '[{' },
      text: [`casesFile ${CASES_FILE} is not JSON`],
    },
    {
      case: 'a casesFile case that does not fit the signature',
      args: addArgs({ cases: undefined, casesFile: CASES_FILE }),
      written: {
        [CASES_FILE]: JSON.stringify([
          { input: [[1, 2], 'x'], expected: [0, 1], visible: true },
        ]),
      },
      text: ['cases[0].input[1]'],
    },
    {
      case: 'a blank statement',
      args: addArgs({ statement: '' }),
      text: ['statement'],
    },
    {
      case: 'an unsupported param type',
      args: addArgs({
        signature: {
          kind: 'function',
          method: 'twoSum',
          params: [{ name: 'nums', type: 'unsigned' }],
          returns: 'int',
        },
        cases: [{ input: [1], expected: 1, visible: true }],
      }),
      text: ['signature.params[0].type'],
    },
    {
      case: 'an existing slug without replace',
      args: addArgs(),
      existing: true,
      text: ['two-sum exists', 'replace: true'],
    },
    {
      case: 'a reference that does not compile',
      args: addArgs(),
      judge: (cases) => ({
        ...judged(cases),
        verdict: 'compileError',
        compileOutput: "reference.cpp:1:7: error: expected ';'",
        cases: [],
      }),
      text: [
        "reference.cpp does not compile:\nreference.cpp:1:7: error: expected ';'",
      ],
    },
    {
      case: 'a compiler that cannot start',
      args: addArgs(),
      judge: () => {
        throw new Error('Could not run clang++: spawn clang++ ENOENT');
      },
      text: [
        'reference.cpp was not judged: Could not run clang++: spawn clang++ ENOENT',
      ],
    },
    {
      case: 'a reference failing cases 3 and 7',
      args: addArgs({ cases: EIGHT_CASES }),
      judge: (cases) =>
        judged(cases, {
          2: { verdict: 'wrongAnswer' },
          6: { verdict: 'runtimeError', stderr: '\nboom' },
        }),
      text: [
        'disagrees with 2 of 8 cases',
        '- case 3 (hidden): input [[2,1],3], expected [0,1], got [9,9]',
        '- case 7 (hidden): Runtime Error: boom',
      ],
    },
  ])(
    'add_practice_problem refuses and writes nothing: $case',
    async ({ args, existing, written, judge, text }) => {
      const { files, call } = setUp({ judge });
      if (existing === true) {
        await writeProblem(files, TWO_SUM);
      }
      for (const [path, content] of Object.entries(written ?? {})) {
        await files.write(path, content);
      }

      const result = await call(ADD_PRACTICE_PROBLEM_TOOL.name, args);

      expect(result.isError).toBe(true);
      for (const part of text) {
        expect(result.content[0].text).toContain(part);
      }
      expect(await files.stat(`${PROBLEM_FOLDER}/problem.md`)).toBeNull();
      if (existing !== true) {
        expect(await files.stat(`${PROBLEM_FOLDER}/problem.json`)).toBeNull();
      }
    },
  );

  it('add_practice_problem writes the problem and a stub', async () => {
    const { files, call, judgeCalls } = setUp({});

    const result = await call(ADD_PRACTICE_PROBLEM_TOOL.name, addArgs());

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/^Added two-sum \(Two Sum\)/);
    expect({
      problem: await files.read(`${PROBLEM_FOLDER}/problem.json`),
      statement: await files.read(`${PROBLEM_FOLDER}/problem.md`),
      reference: await files.read(`${PROBLEM_FOLDER}/reference.cpp`),
      approach: await files.read(`${PROBLEM_FOLDER}/approach.md`),
      solution: await files.read(`${PROBLEM_FOLDER}/solution.cpp`),
    }).toEqual({
      problem: problemJson(TWO_SUM),
      statement: 'Find two numbers.',
      reference: REFERENCE,
      approach: 'Hash each number.',
      solution: stubSource(TWO_SUM),
    });
    expect(judgeCalls).toEqual([
      {
        codePath: `${PRACTICE_FOLDER}/.build/two-sum/import/reference.cpp`,
        cases: [
          { ...TWO_SUM.cases[0], source: 'example' },
          { ...TWO_SUM.cases[1], source: 'hidden' },
          { ...TWO_SUM.cases[2], source: 'hidden' },
        ],
        options: { stopAtFirstFailure: false, code: REFERENCE },
      },
    ]);
  });

  it('add_practice_problem reads the cases from casesFile', async () => {
    const { files, call, judgeCalls } = setUp({});
    await files.write(CASES_FILE, JSON.stringify(TWO_SUM.cases));

    const result = await call(
      ADD_PRACTICE_PROBLEM_TOOL.name,
      addArgs({ cases: undefined, casesFile: CASES_FILE }),
    );

    expect(result.isError).toBeUndefined();
    expect(await files.read(`${PROBLEM_FOLDER}/problem.json`)).toBe(
      problemJson(TWO_SUM),
    );
    expect(judgeCalls[0].cases).toHaveLength(TWO_SUM.cases.length);
  });

  it("replace keeps the user's files", async () => {
    const { files, call } = setUp({});
    await writeProblem(files, TWO_SUM);
    const kept = {
      solution: 'mine',
      notes: 'n',
      progress: '{"status": "attempted"}',
    };
    await files.write(`${PROBLEM_FOLDER}/solution.cpp`, kept.solution);
    await files.write(`${PROBLEM_FOLDER}/notes.md`, kept.notes);
    await files.write(`${PROBLEM_FOLDER}/progress.json`, kept.progress);

    const result = await call(
      ADD_PRACTICE_PROBLEM_TOOL.name,
      addArgs({ replace: true, statement: 'New statement.' }),
    );

    expect(result.content[0].text).toMatch(/^Replaced two-sum/);
    expect({
      solution: await files.read(`${PROBLEM_FOLDER}/solution.cpp`),
      notes: await files.read(`${PROBLEM_FOLDER}/notes.md`),
      progress: await files.read(`${PROBLEM_FOLDER}/progress.json`),
    }).toEqual(kept);
    expect(await files.read(`${PROBLEM_FOLDER}/problem.md`)).toBe(
      'New statement.',
    );
  });

  const wrongAnswer = caseResult(
    { ...TWO_SUM.cases[2], source: 'hidden' } as JudgeCase,
    2,
    'wrongAnswer',
  );
  const STARTED = '2026-11-09T10:00:00.000Z';
  it.each<{
    case: string;
    interviewerSlug: string | null;
    lastResult?: LastResult;
    submissionTimes?: string[];
    contains: string[];
  }>([
    {
      case: 'not an interviewer',
      interviewerSlug: null,
      contains: [],
    },
    {
      case: 'a wrong answer run',
      interviewerSlug: 'two-sum',
      lastResult: {
        kind: 'run',
        result: {
          verdict: 'wrongAnswer',
          passed: 2,
          total: 3,
          ms: 12,
          compileOutput: null,
          failing: wrongAnswer,
          cases: [wrongAnswer],
        },
      },
      contains: ['Find two numbers.', 'mine', 'Wrong Answer', '[[3,3],6]'],
    },
    {
      case: 'a submit that does not compile',
      interviewerSlug: 'two-sum',
      lastResult: {
        kind: 'submit',
        result: {
          verdict: 'compileError',
          passed: 0,
          total: 3,
          ms: 40,
          compileOutput: "solution.cpp:2:9: error: expected ';'",
          failing: null,
          cases: [],
        },
      },
      contains: [
        'Submit: Compile Error',
        "solution.cpp:2:9: error: expected ';'",
      ],
    },
    {
      case: 'submissions before and in the attempt',
      interviewerSlug: 'two-sum',
      submissionTimes: [
        '2026-11-08T09:00:00.000Z',
        '2026-11-09T10:30:00.000Z',
        '2026-11-09T11:00:00.000Z',
      ],
      contains: ['Submissions in this attempt: 2.'],
    },
  ])(
    'read_practice_state shows an interviewer its state: $case',
    async ({ interviewerSlug, lastResult, submissionTimes, contains }) => {
      const part = setUp({ interviewerSlug, lastResult });
      await writeProblem(part.files, TWO_SUM);
      await part.files.write(
        `${PROBLEM_FOLDER}/problem.md`,
        'Find two numbers.',
      );
      await part.files.write(`${PROBLEM_FOLDER}/solution.cpp`, 'mine');
      await part.files.write(`${PROBLEM_FOLDER}/reference.cpp`, REFERENCE);
      const attempt: Attempt = {
        id: 'a1',
        started: STARTED,
        peeked: false,
        interviewer: null,
      };
      await part.files.write(
        `${PROBLEM_FOLDER}/progress.json`,
        JSON.stringify({
          status: 'attempted',
          review: { step: null, due: null },
          attempts: [attempt],
        }),
      );
      for (const time of submissionTimes ?? []) {
        const record: SubmissionRecord = {
          time,
          verdict: 'wrongAnswer',
          passed: 0,
          total: 3,
          ms: 5,
          failing: null,
          code: 'mine',
        };
        await part.store.writeSubmission('two-sum', record);
      }

      const state = await part.call(READ_PRACTICE_STATE_TOOL.name, {});

      const text = state.content[0].text;
      expect(state.isError).toBe(interviewerSlug === null ? true : undefined);
      for (const shown of contains) {
        expect(text).toContain(shown);
      }
      expect(text).not.toContain('REFERENCE_TEXT');
    },
  );
});
