import type { Clock, RandomHex } from '../../../contracts/ambient';
import {
  type Attempt,
  type JudgeResult,
  PROBLEM_STATUSES,
  type ProblemStatus,
  type ProblemSummary,
  type SubmissionRecord,
} from '../contract';
import { errorText } from '../../../shared/error-text';
import { stubSource } from '../driver';
import { dayOf, isDue, nextReview, type ReviewState } from '../ladder';
import type { Problem } from '../problem';
import type { ProblemStore } from './problem-store';

// What `progress.json` holds; the current attempt is the last in `attempts`.
export interface ProgressFile {
  status: ProblemStatus;
  review: ReviewState;
  attempts: Attempt[];
}

// `steps` is the review ladder in days, read at each call.
export interface ProgressDeps {
  store: ProblemStore;
  clock: Clock;
  randomHex: RandomHex;
  steps(): readonly number[];
}

// A problem's status, attempts and review ladder, kept in its `progress.json`.
// `read` resolves a new problem for a missing file and rejects with
// `problems/<slug>/progress.json: <reason>` for one that does not parse. `open`
// starts an attempt only when the problem has none, or is due and its current
// attempt started before the due day, writing the stub to `solution.cpp`
// then; a due problem's `solution.cpp` that is not the stub is kept first as
// `solution.<previous attempt id>.cpp`. Otherwise it writes nothing. `peek`
// marks the current attempt peeked and drops the ladder to its first step. `recordSubmission` writes the
// submission and moves the status, and the ladder one step on the attempt's
// first clean Accepted. Every write runs one at a time, in call order.
export interface Progress {
  read(slug: string): Promise<ProgressFile>;
  summary(slug: string, problem: Problem): Promise<ProblemSummary>;
  open(slug: string, problem: Problem): Promise<Attempt>;
  peek(slug: string): Promise<void>;
  recordSubmission(
    slug: string,
    result: JudgeResult,
    code: string,
  ): Promise<SubmissionRecord>;
  setInterviewer(
    slug: string,
    attemptId: string,
    interviewer: Attempt['interviewer'],
  ): Promise<void>;
}

export function createProgress(deps: ProgressDeps): Progress {
  const { store, clock, randomHex } = deps;
  let writes: Promise<unknown> = Promise.resolve();
  // Runs `work` after every earlier write has settled.
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = writes.then(work);
    writes = turn.catch(() => undefined);
    return turn;
  };
  const read = (slug: string) => readProgress(store, slug);
  const write = (slug: string, file: ProgressFile) =>
    store.writeText(
      slug,
      'progress.json',
      `${JSON.stringify(file, null, 2)}\n`,
    );
  const today = () => dayOf(clock.now());
  const newAttempt = (): Attempt => ({
    id: randomHex(),
    started: new Date(clock.now()).toISOString(),
    peeked: false,
    interviewer: null,
  });
  // The file's current attempt, appending a new one when it has none.
  const currentAttempt = (file: ProgressFile): Attempt => {
    if (file.attempts.length === 0) {
      file.attempts.push(newAttempt());
    }
    return file.attempts[file.attempts.length - 1];
  };

  return {
    read,
    async summary(slug, problem) {
      const file = await read(slug);
      return {
        slug: problem.slug,
        title: problem.title,
        difficulty: problem.difficulty,
        tags: problem.tags,
        lists: problem.lists,
        status: file.status,
        due: isDue(file.review, today()),
      };
    },
    open: (slug, problem) =>
      inTurn(async () => {
        const file = await read(slug);
        const current = file.attempts.at(-1);
        if (current === undefined) {
          const attempt = newAttempt();
          if ((await store.readText(slug, 'solution.cpp')) === null) {
            await store.writeText(slug, 'solution.cpp', stubSource(problem));
          }
          await write(slug, { ...file, attempts: [attempt] });
          return attempt;
        }
        const startedBeforeDue =
          file.review.due !== null &&
          dayOf(Date.parse(current.started)) < file.review.due;
        if (!isDue(file.review, today()) || !startedBeforeDue) {
          return current;
        }
        const attempt = newAttempt();
        const stub = stubSource(problem);
        const code = await store.readText(slug, 'solution.cpp');
        if (code !== null && code !== stub) {
          await store.writeText(slug, `solution.${current.id}.cpp`, code);
        }
        await store.writeText(slug, 'solution.cpp', stub);
        await write(slug, { ...file, attempts: [...file.attempts, attempt] });
        return attempt;
      }),
    peek: (slug) =>
      inTurn(async () => {
        const file = await read(slug);
        currentAttempt(file).peeked = true;
        file.review = nextReview(file.review, 'peeked', today(), deps.steps());
        await write(slug, file);
      }),
    recordSubmission: (slug, result, code) =>
      inTurn(async () => {
        const earlier = await store.submissions(slug);
        const record: SubmissionRecord = {
          time: new Date(clock.now()).toISOString(),
          verdict: result.verdict,
          passed: result.passed,
          total: result.total,
          ms: result.ms,
          failing: result.failing,
          code,
        };
        await store.writeSubmission(slug, record);
        const file = await read(slug);
        const attempt = currentAttempt(file);
        const isAccepted = result.verdict === 'accepted';
        const acceptedEarlierInAttempt = earlier.some(
          (submission) =>
            submission.time >= attempt.started &&
            submission.verdict === 'accepted',
        );
        const isCleanSolve =
          isAccepted && !attempt.peeked && !acceptedEarlierInAttempt;
        file.status =
          isAccepted || file.status === 'solved' ? 'solved' : 'attempted';
        if (isCleanSolve) {
          file.review = nextReview(file.review, 'clean', today(), deps.steps());
        }
        await write(slug, file);
        return record;
      }),
    setInterviewer: (slug, attemptId, interviewer) =>
      inTurn(async () => {
        const file = await read(slug);
        const attempt = file.attempts.find(
          (candidate) => candidate.id === attemptId,
        );
        if (attempt === undefined) {
          throw new Error(
            `problems/${slug}/progress.json: no attempt ${attemptId}`,
          );
        }
        attempt.interviewer = interviewer;
        await write(slug, file);
      }),
  };
}

async function readProgress(
  store: ProblemStore,
  slug: string,
): Promise<ProgressFile> {
  const text = await store.readText(slug, 'progress.json');
  if (text === null) {
    return { status: 'new', review: { step: null, due: null }, attempts: [] };
  }
  try {
    return parseProgress(JSON.parse(text));
  } catch (error) {
    throw new Error(`problems/${slug}/progress.json: ${errorText(error)}`);
  }
}

// Throws naming the first field whose type is wrong.
function parseProgress(json: unknown): ProgressFile {
  const file = asRecord(json, '(root)');
  const status = file.status;
  if (!PROBLEM_STATUSES.some((choice) => choice === status)) {
    throw new Error(`status: expected one of ${PROBLEM_STATUSES.join(', ')}`);
  }
  const review = asRecord(file.review, 'review');
  if (review.step !== null && !Number.isInteger(review.step)) {
    throw new Error('review.step: expected an integer or null');
  }
  if (review.due !== null && typeof review.due !== 'string') {
    throw new Error('review.due: expected a day or null');
  }
  if (!Array.isArray(file.attempts)) {
    throw new Error('attempts: expected an array');
  }
  file.attempts.forEach((attempt: unknown, index) =>
    checkAttempt(attempt, `attempts[${index}]`),
  );
  return json as ProgressFile;
}

function checkAttempt(value: unknown, path: string): void {
  const attempt = asRecord(value, path);
  if (typeof attempt.id !== 'string') {
    throw new Error(`${path}.id: expected a string`);
  }
  if (typeof attempt.started !== 'string') {
    throw new Error(`${path}.started: expected a string`);
  }
  if (typeof attempt.peeked !== 'boolean') {
    throw new Error(`${path}.peeked: expected true or false`);
  }
  if (attempt.interviewer === null) {
    return;
  }
  const interviewer = asRecord(attempt.interviewer, `${path}.interviewer`);
  const namesSessions =
    typeof interviewer.sessionId === 'string' &&
    typeof interviewer.hostSessionId === 'string';
  if (!namesSessions) {
    throw new Error(
      `${path}.interviewer: expected null or sessionId and hostSessionId`,
    );
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}
