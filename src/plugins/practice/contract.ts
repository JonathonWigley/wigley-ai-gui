// The practice plugin's channel between its main and page parts: the problem
// list, one problem opened with its attempt and submissions, the user's saves,
// Run and Submit through the judge, the Solution tab's peek, and the import and
// interviewer sessions.

import type { ChannelShape } from '../../contracts/plugin';
import type {
  DesignSignature,
  Difficulty,
  FunctionSignature,
  JsonValue,
} from './problem';

// LeetCode's verdicts: Accepted, Wrong Answer, Time Limit Exceeded, Runtime
// Error and Compile Error.
export type Verdict =
  | 'accepted'
  | 'wrongAnswer'
  | 'timeLimit'
  | 'runtimeError'
  | 'compileError';

// One case the judge ran. `index` is the case's place in the list judged;
// `input` is a function case's input array, or a design case's `{ ops, args }`.
// `output` is the parsed answer, null when the program wrote none. `stdout` and
// `stderr` are cut to their first 10 000 characters.
export interface CaseResult {
  index: number;
  source: 'example' | 'custom' | 'hidden';
  input: JsonValue;
  expected: JsonValue;
  output: JsonValue | null;
  stdout: string;
  stderr: string;
  verdict: Verdict;
  ms: number;
}

// One judge call. `verdict` is the first failing case's, else `accepted`;
// `total` counts every case asked for, run or not. `compileOutput` is set only
// for `compileError`, which runs no case.
export interface JudgeResult {
  verdict: Verdict;
  passed: number;
  total: number;
  ms: number;
  compileOutput: string | null;
  failing: CaseResult | null;
  cases: CaseResult[];
}

// New: never submitted; attempted: submitted, never Accepted; solved: Accepted
// at least once.
export type ProblemStatus = 'new' | 'attempted' | 'solved';

// One problem's list row; `due` is true once its review date has come.
export interface ProblemSummary {
  slug: string;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  lists: string[];
  status: ProblemStatus;
  due: boolean;
}

// One go at a problem. `started` is ISO 8601; `interviewer` names the attempt's
// interviewer session and the session it was asked from, null until launched.
export interface Attempt {
  id: string;
  started: string;
  peeked: boolean;
  interviewer: { sessionId: string; hostSessionId: string } | null;
}

// One Submit, as `submissions/<time>.json` holds it.
export interface SubmissionRecord {
  // ISO 8601.
  time: string;
  verdict: Verdict;
  passed: number;
  total: number;
  ms: number;
  failing: CaseResult | null;
  code: string;
}

// A problem as the page shows it: `statement` is `problem.md`, `code` is
// `solution.cpp`, `notes` and `customCases` the user's files ('' when
// missing), `attempt` the current one, `submissions` newest first.
export interface OpenedProblem {
  summary: ProblemSummary;
  statement: string;
  signature: FunctionSignature | DesignSignature;
  code: string;
  notes: string;
  customCases: string;
  attempt: Attempt;
  submissions: SubmissionRecord[];
}

// Every method rejects with main's own error text when its handler throws. The
// page saves `solution.cpp` before it invokes `run` or `submit`. `open` is
// idempotent: it starts a fresh attempt only when the problem is due and its
// current attempt started before the due date.
export interface PracticeChannel extends ChannelShape {
  invoke: {
    list(): Promise<ProblemSummary[]>;
    open(slug: string): Promise<OpenedProblem>;
    saveCode(slug: string, text: string): Promise<void>;
    saveNotes(slug: string, text: string): Promise<void>;
    saveCustomCases(slug: string, text: string): Promise<void>;
    // The visible and custom cases; records nothing.
    run(slug: string): Promise<JudgeResult>;
    // Every case, stopping at the first failure; records a submission.
    submit(slug: string): Promise<JudgeResult>;
    // Marks the attempt peeked and drops the ladder to its first step.
    peek(slug: string): Promise<{ approach: string; reference: string }>;
    startImport(request: string): Promise<string>;
    askInterviewer(slug: string, text: string): Promise<string>;
    interviewerOf(slug: string): Promise<string | null>;
  };
  messages: {
    // The list or an open problem changed on disk, the app's own writes
    // included; `slug` null when the change names no problem.
    changed: { slug: string | null };
  };
}
