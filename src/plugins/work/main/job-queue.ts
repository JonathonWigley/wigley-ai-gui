import { isJsonObject } from '../../../shared/json';
import type { WorkJob } from '../contract';

export interface QueuedJob {
  job: WorkJob;
  queuedAt: string;
}

// `hostSessionId` and `rowId` are null while its launch has not resolved; `result` is the worker's last
// `report_work_job`, null before one.
export interface RunningJob {
  job: WorkJob;
  queuedAt: string;
  startedAt: string;
  hostSessionId: string | null;
  rowId: string | null;
  result: JobResult | null;
}

export interface JobResult {
  ok: boolean;
  note: string | null;
}

// `queued` is in run order. One job runs at a time.
export interface JobQueue {
  queued: QueuedJob[];
  running: RunningJob | null;
}

export const EMPTY_JOB_QUEUE: JobQueue = { queued: [], running: null };

export type JobQueueEvent =
  | { kind: 'enqueued'; job: WorkJob; at: string }
  | { kind: 'launching'; at: string }
  | { kind: 'launched'; hostSessionId: string; rowId: string }
  | { kind: 'launchFailed' }
  | { kind: 'reported'; result: JobResult }
  | { kind: 'closed'; hostSessionId: string }
  | { kind: 'started' }
  | { kind: 'restoreMissed'; hostSessionId: string }
  | { kind: 'rowRestored'; hostSessionId: string; rowId: string };

// The queue after `event`: a new object, `queue` left as it was.
export function nextJobQueue(queue: JobQueue, event: JobQueueEvent): JobQueue {
  switch (event.kind) {
    case 'enqueued':
      return afterEnqueued(queue, event.job, event.at);
    case 'launching':
      return afterLaunching(queue, event.at);
    case 'launched':
      return afterLaunched(queue, event.hostSessionId, event.rowId);
    case 'launchFailed':
      return { ...queue, running: null };
    case 'reported':
      return queue.running === null
        ? { ...queue }
        : { ...queue, running: { ...queue.running, result: event.result } };
    case 'closed':
    case 'restoreMissed':
      return queue.running?.hostSessionId === event.hostSessionId
        ? { ...queue, running: null }
        : { ...queue };
    case 'started':
      return afterStarted(queue);
    case 'rowRestored':
      return afterRowRestored(queue, event.hostSessionId, event.rowId);
  }
}

function afterRowRestored(
  queue: JobQueue,
  hostSessionId: string,
  rowId: string,
): JobQueue {
  const { running } = queue;
  if (running === null || running.hostSessionId !== hostSessionId) {
    return { ...queue };
  }
  return { ...queue, running: { ...running, rowId } };
}

// The item a send or nudge posts on; null for any other job.
function postedItemId(job: WorkJob): string | null {
  return job.kind === 'send' || job.kind === 'nudge' ? job.itemId : null;
}

// The ticket a move moves; null for any other job.
function movedKey(job: WorkJob): string | null {
  return job.kind === 'move' ? job.key : null;
}

// Whether `queued` is the same press as `job` on the same target, which `job` replaces: a send or nudge on the same
// item, or a move of the same ticket.
function isSamePressTarget(queued: WorkJob, job: WorkJob): boolean {
  const itemId = postedItemId(job);
  if (itemId !== null) {
    return postedItemId(queued) === itemId;
  }
  const key = movedKey(job);
  return key !== null && movedKey(queued) === key;
}

function afterEnqueued(queue: JobQueue, job: WorkJob, at: string): JobQueue {
  const isSweep = job.kind === 'sweep';
  const firstSweep = queue.queued.findIndex(
    (queued) => queued.job.kind === 'sweep',
  );
  if (isSweep) {
    return firstSweep === -1
      ? { ...queue, queued: [...queue.queued, { job, queuedAt: at }] }
      : { ...queue };
  }
  const itemId = postedItemId(job);
  const isRunningItemsPost =
    itemId !== null &&
    queue.running !== null &&
    postedItemId(queue.running.job) === itemId;
  if (isRunningItemsPost) {
    return { ...queue };
  }
  const replaced = queue.queued.findIndex((queued) =>
    isSamePressTarget(queued.job, job),
  );
  if (replaced !== -1) {
    return {
      ...queue,
      queued: queue.queued.map((queued, index) =>
        index === replaced ? { ...queued, job } : queued,
      ),
    };
  }
  const position = firstSweep === -1 ? queue.queued.length : firstSweep;
  return {
    ...queue,
    queued: [
      ...queue.queued.slice(0, position),
      { job, queuedAt: at },
      ...queue.queued.slice(position),
    ],
  };
}

function afterLaunching(queue: JobQueue, at: string): JobQueue {
  const [head, ...rest] = queue.queued;
  if (queue.running !== null || head === undefined) {
    return { ...queue };
  }
  return {
    queued: rest,
    running: {
      job: head.job,
      queuedAt: head.queuedAt,
      startedAt: at,
      hostSessionId: null,
      rowId: null,
      result: null,
    },
  };
}

function afterLaunched(
  queue: JobQueue,
  hostSessionId: string,
  rowId: string,
): JobQueue {
  if (queue.running === null) {
    throw new Error('work job launched with none running');
  }
  return { ...queue, running: { ...queue.running, hostSessionId, rowId } };
}

// A running job that never launched goes back to the very head, since it was pressed before every queued job; an
// unlaunched sweep is dropped instead when a sweep is already queued. A launched one is kept for its row's return.
function afterStarted(queue: JobQueue): JobQueue {
  const { running } = queue;
  if (running === null || running.hostSessionId !== null) {
    return { ...queue };
  }
  const isSweepAlreadyQueued =
    running.job.kind === 'sweep' &&
    queue.queued.some((queued) => queued.job.kind === 'sweep');
  if (isSweepAlreadyQueued) {
    return { ...queue, running: null };
  }
  return {
    running: null,
    queued: [{ job: running.job, queuedAt: running.queuedAt }, ...queue.queued],
  };
}

const isNullableString = (value: unknown) =>
  value === null || typeof value === 'string';

function isWorkJob(value: unknown): value is WorkJob {
  if (!isJsonObject(value)) {
    return false;
  }
  switch (value.kind) {
    case 'sweep':
      return true;
    case 'send':
    case 'nudge':
      return typeof value.itemId === 'string' && typeof value.text === 'string';
    case 'move':
      return typeof value.key === 'string' && typeof value.column === 'string';
    default:
      return false;
  }
}

function isQueuedJob(value: unknown): value is QueuedJob {
  return (
    isJsonObject(value) &&
    isWorkJob(value.job) &&
    typeof value.queuedAt === 'string'
  );
}

function isJobResultOrNull(value: unknown): value is JobResult | null {
  if (value === null) {
    return true;
  }
  return (
    isJsonObject(value) &&
    typeof value.ok === 'boolean' &&
    isNullableString(value.note)
  );
}

function isRunningJobOrNull(value: unknown): value is RunningJob | null {
  if (value === null) {
    return true;
  }
  return (
    isJsonObject(value) &&
    isWorkJob(value.job) &&
    typeof value.queuedAt === 'string' &&
    typeof value.startedAt === 'string' &&
    isNullableString(value.hostSessionId) &&
    isNullableString(value.rowId) &&
    isJobResultOrNull(value.result)
  );
}

function isJobQueue(value: unknown): value is JobQueue {
  return (
    isJsonObject(value) &&
    Array.isArray(value.queued) &&
    value.queued.every(isQueuedJob) &&
    isRunningJobOrNull(value.running)
  );
}

// The queue `queue.json` holds, without the top-level keys it does not read; throws `queue.json is not a job queue`
// for text that is not JSON or not that shape.
export function parseJobQueue(text: string): JobQueue {
  const notAJobQueue = new Error('queue.json is not a job queue');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw notAJobQueue;
  }
  if (!isJobQueue(parsed)) {
    throw notAJobQueue;
  }
  const { queued, running } = parsed;
  return { queued, running };
}
