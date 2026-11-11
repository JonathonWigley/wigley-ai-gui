import type { Clock } from '../../../contracts/ambient';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  ProcessResult,
  ProcessRunner,
} from '../../../contracts/processes';
import { answersMatch } from '../compare';
import { mapCompileErrors } from '../compile-errors';
import type { CaseResult, JudgeResult, Verdict } from '../contract';
import { driverSource, preludeSource } from '../driver';
import type { DesignCase, FunctionCase, JsonValue, Problem } from '../problem';

// A case with where it came from: a visible example, the user's own, or hidden.
export type JudgeCase = (FunctionCase | DesignCase) & {
  source: 'example' | 'custom' | 'hidden';
};

// Submit stops at the first failure; Run and the import check do not. `code`
// is the text of `codePath` the caller read, compiled in place of the file's
// current text. A `signal` that aborts rejects the call with the runner's
// `Stopped <command>`.
export interface JudgeOptions {
  stopAtFirstFailure: boolean;
  code?: string;
  signal?: AbortSignal;
}

// `flags` are separated by spaces; `timeLimitMs` bounds each case's run.
export interface JudgeSettings {
  buildFolder: string;
  compiler: string;
  flags: string;
  timeLimitMs: number;
}

export interface JudgeDeps {
  files: Files;
  processes: Pick<ProcessRunner, 'run'>;
  paths: Paths;
  clock: Clock;
  settings(): JudgeSettings;
}

// Compiles a copy of the code at `codePath` with the problem's generated
// driver under `<buildFolder>/<slug>/<code name>/` and runs each case as its
// own process, one judge call at a time in call order. Each run keeps at most
// `PROGRAM_OUTPUT_BYTES` of its stdout and of its stderr. Rejects with the
// runner's `Could not run <compiler>: <reason>` when the compiler cannot start.
export interface Judge {
  judge(
    problem: Problem,
    codePath: string,
    cases: JudgeCase[],
    options: JudgeOptions,
  ): Promise<JudgeResult>;
}

const COMPILE_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 10_000;
const PROGRAM_OUTPUT_BYTES = 1_000_000;
const SANITIZER_REPORTS = [
  '==ERROR: AddressSanitizer',
  '==ERROR: LeakSanitizer',
  ': runtime error: ',
];
const NO_ANSWER = 'The program ended before writing its answer.';

export function createJudge(deps: JudgeDeps): Judge {
  let turns: Promise<unknown> = Promise.resolve();
  return {
    judge(problem, codePath, cases, options) {
      const turn = turns.then(() =>
        judgeInTurn(deps, problem, codePath, cases, options),
      );
      turns = turn.catch(() => undefined);
      return turn;
    },
  };
}

async function judgeInTurn(
  deps: JudgeDeps,
  problem: Problem,
  codePath: string,
  cases: JudgeCase[],
  options: JudgeOptions,
): Promise<JudgeResult> {
  const { files, paths } = deps;
  const settings = deps.settings();
  const build = settings.buildFolder;
  await Promise.all([
    files.write(paths.join(build, '.gitignore'), '*\n'),
    files.write(paths.join(build, 'prelude.h'), preludeSource()),
    files.write(
      paths.join(build, 'bits', 'stdc++.h'),
      '#pragma once\n#include "../prelude.h"\n',
    ),
  ]);
  const codeName = paths.base(codePath).replace(/\.cpp$/, '');
  const runFolder = paths.join(build, problem.slug, codeName);
  const driverPath = paths.join(runFolder, 'driver.cpp');
  const casesPath = paths.join(runFolder, 'cases.json');
  const program = paths.join(runFolder, 'program');
  const snapshotPath = paths.join(runFolder, paths.base(codePath));
  const code = options.code ?? (await files.read(codePath));
  await Promise.all([
    files.write(snapshotPath, code),
    files.write(driverPath, driverSource(problem, snapshotPath)),
    files.write(casesPath, JSON.stringify(cases.map(driverInput))),
  ]);
  const compileFailure = await compile(deps, settings, {
    codePath: snapshotPath,
    runFolder,
    driverPath,
    program,
    signal: options.signal,
  });
  if (compileFailure !== null) {
    return {
      verdict: 'compileError',
      passed: 0,
      total: cases.length,
      ms: 0,
      compileOutput: compileFailure,
      failing: null,
      cases: [],
    };
  }
  const results: CaseResult[] = [];
  for (const [index, judgeCase] of cases.entries()) {
    const resultPath = paths.join(runFolder, `result-${index}.json`);
    await files.write(resultPath, '');
    const before = deps.clock.now();
    const run = await deps.processes.run(
      program,
      [casesPath, String(index), resultPath],
      {
        cwd: runFolder,
        timeoutMs: settings.timeLimitMs,
        signal: options.signal,
        maxOutputBytes: PROGRAM_OUTPUT_BYTES,
      },
    );
    const ms = deps.clock.now() - before;
    const resultText = (await readIfPresent(files, resultPath)) ?? '';
    const result = caseResult(problem, judgeCase, index, run, resultText, ms);
    results.push(result);
    if (options.stopAtFirstFailure && result.verdict !== 'accepted') {
      break;
    }
  }
  const failing = results.find((result) => result.verdict !== 'accepted');
  return {
    verdict: failing?.verdict ?? 'accepted',
    passed: results.filter((result) => result.verdict === 'accepted').length,
    total: cases.length,
    ms: results.reduce((sum, result) => sum + result.ms, 0),
    compileOutput: null,
    failing: failing ?? null,
    cases: results,
  };
}

// The compiler's output when the code does not compile, null when it does;
// rejects when the compiler cannot start.
async function compile(
  deps: JudgeDeps,
  settings: JudgeSettings,
  build: {
    codePath: string;
    runFolder: string;
    driverPath: string;
    program: string;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  const args = [
    ...settings.flags.split(/\s+/).filter(Boolean),
    '-I',
    settings.buildFolder,
    '-o',
    build.program,
    build.driverPath,
  ];
  const result = await deps.processes.run(settings.compiler, args, {
    cwd: build.runFolder,
    timeoutMs: COMPILE_TIMEOUT_MS,
    signal: build.signal,
    maxOutputBytes: PROGRAM_OUTPUT_BYTES,
  });
  if (result.timedOut) {
    return `Compilation took longer than ${COMPILE_TIMEOUT_MS / 1000} s.`;
  }
  if (result.code !== 0) {
    return mapCompileErrors(result.stderr || result.stdout, build.codePath);
  }
  return null;
}

// What the driver reads for one case: a function case's input array, or a
// design case's `[ops, args]`.
function driverInput(judgeCase: JudgeCase): JsonValue {
  return 'input' in judgeCase
    ? judgeCase.input
    : [judgeCase.ops, judgeCase.args];
}

function caseResult(
  problem: Problem,
  judgeCase: JudgeCase,
  index: number,
  run: ProcessResult,
  resultText: string,
  ms: number,
): CaseResult {
  const output = parseAnswer(resultText);
  const hasSanitizerReport = SANITIZER_REPORTS.some((report) =>
    run.stderr.includes(report),
  );
  let stderr = cut(run.stderr);
  let verdict: Verdict;
  // A sanitizer's symbolized report can take the run past the time limit.
  if (hasSanitizerReport) {
    verdict = 'runtimeError';
  } else if (run.timedOut) {
    verdict = 'timeLimit';
  } else if (run.code !== 0) {
    verdict = 'runtimeError';
  } else if (output === undefined) {
    verdict = 'runtimeError';
    stderr = stderr === '' || stderr.endsWith('\n') ? stderr : `${stderr}\n`;
    stderr += NO_ANSWER;
  } else if (answersMatch(judgeCase.expected, output, problem.compare)) {
    verdict = 'accepted';
  } else {
    verdict = 'wrongAnswer';
  }
  return {
    index,
    source: judgeCase.source,
    input:
      'input' in judgeCase
        ? judgeCase.input
        : { ops: judgeCase.ops, args: judgeCase.args },
    expected: judgeCase.expected,
    output: output ?? null,
    stdout: cut(run.stdout),
    stderr,
    verdict,
    ms,
  };
}

// The answer the driver wrote; undefined when the file is empty or no JSON.
function parseAnswer(text: string): JsonValue | undefined {
  if (text.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

function cut(text: string): string {
  return text.length > OUTPUT_LIMIT
    ? `${text.slice(0, OUTPUT_LIMIT)}\n… (cut)`
    : text;
}
