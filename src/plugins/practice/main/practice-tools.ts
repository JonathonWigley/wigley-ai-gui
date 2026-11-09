import {
  type AgentSession,
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import { errorText } from '../../../shared/error-text';
import { type CaseResult, type JudgeResult, VERDICT_NAMES } from '../contract';
import { stubSource } from '../driver';
import {
  parseProblem,
  type Problem,
  ProblemError,
  problemJson,
} from '../problem';
import type { Judge, JudgeCase } from './judge';
import type { LastResult } from './practice-runs';
import type { ProblemStore } from './problem-store';
import type { Progress } from './progress';

export const ADD_PRACTICE_PROBLEM_TOOL: ToolDefinition = {
  name: 'add_practice_problem',
  description:
    "Add one problem to Practice, or rewrite one with `replace`. The tool compiles `reference` and runs it on every case, and refuses, writing nothing, when a field is invalid or the reference fails a case. A replace keeps the user's code, notes, test cases, progress and submissions.",
  inputSchema: {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: "LeetCode's slug: lowercase words joined by '-'.",
      },
      title: { type: 'string', description: "The problem's title." },
      difficulty: {
        type: 'string',
        enum: ['easy', 'medium', 'hard'],
        description: "LeetCode's difficulty.",
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: "LeetCode's topic tags, lowercase. Defaults to none.",
      },
      lists: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Each list the user named that holds the problem. Defaults to none.',
      },
      compare: {
        type: 'string',
        enum: ['exact', 'anyOrder', 'anyOrderDeep', 'float'],
        description: "How the user's answer is checked. Defaults to exact.",
      },
      signature: {
        type: 'object',
        description:
          'The C++ signature: a function signature or a design signature.',
      },
      cases: {
        type: 'array',
        items: { type: 'object' },
        description:
          "The cases in LeetCode's JSON form; visible ones are the examples.",
      },
      statement: {
        type: 'string',
        description:
          'Markdown: the description, the examples and the constraints.',
      },
      reference: {
        type: 'string',
        description: 'A correct, complete C++ solution with the signature.',
      },
      approach: {
        type: 'string',
        description:
          'Markdown: the idea, the steps, and the time and space complexity.',
      },
      replace: {
        type: 'boolean',
        description:
          'True to rewrite an existing problem the user asked to fix. Defaults to false.',
      },
    },
    required: [
      'slug',
      'title',
      'difficulty',
      'signature',
      'cases',
      'statement',
      'reference',
      'approach',
    ],
    additionalProperties: false,
  },
};

export const READ_PRACTICE_STATE_TOOL: ToolDefinition = {
  name: 'read_practice_state',
  description:
    "Read what the user sees in Practice: the problem's statement and signature, the user's current code, the last Run or Submit result and the attempt. Only a Practice interviewer session may call it.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

// `interviewerSlug` names the problem whose current attempt's interviewer is
// the session, null for any other session.
export interface PracticeToolsDeps {
  store: ProblemStore;
  progress: Progress;
  judge: Judge;
  lastResult(slug: string): LastResult | null;
  interviewerSlug(session: AgentSession): Promise<string | null>;
}

interface AddProblemArgs {
  slug?: unknown;
  title?: unknown;
  difficulty?: unknown;
  tags?: unknown;
  lists?: unknown;
  compare?: unknown;
  signature?: unknown;
  cases?: unknown;
  statement?: unknown;
  reference?: unknown;
  approach?: unknown;
  replace?: unknown;
}

const PROBLEM_FIELDS = [
  'title',
  'difficulty',
  'tags',
  'lists',
  'compare',
  'signature',
  'cases',
] as const;
const TEXT_FIELDS = ['slug', 'statement', 'reference', 'approach'] as const;
const SHOWN_JSON_LENGTH = 200;

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

// JSON of `value`, cut to SHOWN_JSON_LENGTH characters with `…`.
function shownJson(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return json.length > SHOWN_JSON_LENGTH
    ? `${json.slice(0, SHOWN_JSON_LENGTH)}…`
    : json;
}

function firstStderrLine(stderr: string): string {
  return stderr.split('\n').find((line) => line.trim() !== '') ?? '';
}

function caseLine(result: CaseResult): string {
  const label = `- case ${result.index + 1} (${result.source === 'example' ? 'visible' : 'hidden'})`;
  switch (result.verdict) {
    case 'timeLimit':
      return `${label}: Time Limit Exceeded`;
    case 'runtimeError':
      return `${label}: Runtime Error: ${firstStderrLine(result.stderr)}`;
    default:
      return `${label}: input ${shownJson(result.input)}, expected ${shownJson(result.expected)}, got ${shownJson(result.output)}`;
  }
}

// The refusal for a reference the judge did not accept on every case; null
// when it passed them all.
function referenceRefusal(result: JudgeResult): string | null {
  if (result.verdict === 'compileError') {
    return `Refused: reference.cpp does not compile:\n${result.compileOutput ?? ''}`;
  }
  const failing = result.cases.filter((one) => one.verdict !== 'accepted');
  if (failing.length === 0) {
    return null;
  }
  return [
    `Refused: reference.cpp disagrees with ${failing.length} of ${result.total} cases. Fix each case or the reference, then call again.`,
    ...failing.map(caseLine),
  ].join('\n');
}

// Checks the problem and its reference, then writes its folder; every refusal
// writes nothing under `problems/<slug>/`.
async function addProblem(
  deps: PracticeToolsDeps,
  args: unknown,
): Promise<ToolResult> {
  const named = (args ?? {}) as AddProblemArgs;
  for (const field of TEXT_FIELDS) {
    if (!isNonBlankString(named[field])) {
      return errorResult(`Refused: ${field} must be a non-empty string.`);
    }
  }
  const slug = named.slug as string;
  const fields = Object.fromEntries(
    PROBLEM_FIELDS.filter((field) => named[field] !== undefined).map(
      (field) => [field, named[field]],
    ),
  );
  let problem: Problem;
  try {
    problem = parseProblem(fields, slug);
  } catch (error) {
    if (error instanceof ProblemError) {
      return errorResult(`Refused: ${error.message}`);
    }
    throw error;
  }
  const exists = await deps.store.hasProblem(slug);
  const isReplace = named.replace === true;
  if (exists && !isReplace) {
    return errorResult(
      `Refused: ${slug} exists. Set replace: true to rewrite its problem.json, problem.md, reference.cpp and approach.md.`,
    );
  }
  const reference = named.reference as string;
  const path = await deps.store.writeBuildFile(
    `${slug}/import/reference.cpp`,
    reference,
  );
  const cases: JudgeCase[] = problem.cases.map((testCase) => ({
    ...testCase,
    source: testCase.visible ? 'example' : 'hidden',
  }));
  let result: JudgeResult;
  try {
    result = await deps.judge.judge(problem, path, cases, {
      stopAtFirstFailure: false,
      code: reference,
    });
  } catch (error) {
    return errorResult(`reference.cpp was not judged: ${errorText(error)}`);
  }
  const refusal = referenceRefusal(result);
  if (refusal !== null) {
    return errorResult(refusal);
  }
  const keepsSolution =
    isReplace && (await deps.store.readText(slug, 'solution.cpp')) !== null;
  await deps.store.writeText(slug, 'problem.md', named.statement as string);
  await deps.store.writeText(slug, 'reference.cpp', reference);
  await deps.store.writeText(slug, 'approach.md', named.approach as string);
  if (!keepsSolution) {
    await deps.store.writeText(slug, 'solution.cpp', stubSource(problem));
  }
  // Last, so a list read on the first change sees every file.
  await deps.store.writeText(slug, 'problem.json', problemJson(problem));
  return textResult(
    `${exists ? 'Replaced' : 'Added'} ${slug} (${problem.title}): ${problem.cases.length} cases; reference.cpp passes every one.`,
  );
}

function fenced(language: string, text: string): string {
  return `\`\`\`${language}\n${text.endsWith('\n') ? text : `${text}\n`}\`\`\``;
}

// The `## Last result` section's body.
function lastResultText(last: LastResult | null): string {
  if (last === null) {
    return 'None since the app started.';
  }
  const { result } = last;
  const lines = [
    `${last.kind === 'run' ? 'Run' : 'Submit'}: ${VERDICT_NAMES[result.verdict]}, ${result.passed}/${result.total} passed, ${result.ms} ms`,
  ];
  if (result.verdict === 'compileError') {
    lines.push(fenced('', result.compileOutput ?? ''));
  } else if (result.failing !== null) {
    const failing = result.failing;
    lines.push(
      `Input: ${JSON.stringify(failing.input)}`,
      `Expected: ${JSON.stringify(failing.expected)}`,
      `Output: ${JSON.stringify(failing.output)}`,
      `Stdout: ${JSON.stringify(failing.stdout)}`,
    );
    if (failing.verdict === 'runtimeError') {
      lines.push(`Stderr: ${JSON.stringify(failing.stderr)}`);
    }
  }
  return lines.join('\n');
}

// What the interviewer's user sees, in Markdown; never the reference or the
// approach.
async function readPracticeState(
  deps: PracticeToolsDeps,
  session: AgentSession,
): Promise<ToolResult> {
  const slug = await deps.interviewerSlug(session);
  if (slug === null) {
    return errorResult(
      'read_practice_state answers only a Practice interviewer session.',
    );
  }
  const [problem, statement, code, file, submissions] = await Promise.all([
    deps.store.readProblem(slug),
    deps.store.readText(slug, 'problem.md'),
    deps.store.readText(slug, 'solution.cpp'),
    deps.progress.read(slug),
    deps.store.submissions(slug),
  ]);
  const attempt = file.attempts.at(-1);
  const attemptText =
    attempt === undefined
      ? 'None.'
      : `Started ${attempt.started}. Solution tab opened: ${attempt.peeked ? 'yes' : 'no'}. Submissions in this attempt: ${submissions.filter((submission) => submission.time >= attempt.started).length}.`;
  const sections = [
    `# ${problem.title} (${problem.difficulty})`,
    `## Statement\n\n${statement ?? ''}`,
    `## Signature\n\n${fenced('cpp', stubSource(problem))}`,
    `## Current code\n\n${code === null ? '(empty)' : fenced('cpp', code)}`,
    `## Last result\n\n${lastResultText(deps.lastResult(slug))}`,
    `## Attempt\n\n${attemptText}`,
  ];
  return textResult(sections.join('\n\n'));
}

// The `start` practice hands sessions' `contributeTools` with
// ADD_PRACTICE_PROBLEM_TOOL and READ_PRACTICE_STATE_TOOL.
export function startPracticeTools(
  deps: PracticeToolsDeps,
): (session: AgentSession) => ToolSession {
  return (session) => ({
    call(name, args) {
      switch (name) {
        case ADD_PRACTICE_PROBLEM_TOOL.name:
          return addProblem(deps, args);
        case READ_PRACTICE_STATE_TOOL.name:
          return readPracticeState(deps, session);
        default:
          return Promise.reject(new Error(`no practice tool "${name}"`));
      }
    },
    end: () => undefined,
  });
}
