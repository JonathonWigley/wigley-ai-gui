import { isJsonObject } from '../../../shared/json';
import { isUserClose, type SessionCloseReason } from '../../chat/contract';
import { editableTitle, type SessionTitles } from '../../sessions/contract';

// One retro to run: the host ids of the conversation a close or a `/clear` ended, the profile it ran under and the
// title its retro row takes, null for none.
export interface RetroItem {
  hostIds: string[];
  profile: string;
  title: string | null;
}

// Every row is keyed by its host session id, which a restored row keeps. `running.hostSessionId` is null while
// its launch has not resolved.
export interface RetroQueue {
  queued: RetroItem[]; // oldest first
  running: { item: RetroItem; hostSessionId: string | null } | null;
  launched: string[]; // host ids of every open retro row
}

// The command a retro row's first message opens with, before its host ids.
export const RETRO_COMMAND = '/wigley:retro auto';

export const EMPTY_QUEUE: RetroQueue = {
  queued: [],
  running: null,
  launched: [],
};

// `started` carries the names of chat's profiles at the part's start; `restoreMissed` is a running retro whose row
// did not come back after a start.
export type QueueEvent =
  | {
      kind: 'closed';
      hostSessionId: string;
      profile: string;
      titles: SessionTitles;
      sent: boolean;
      reason: SessionCloseReason;
    }
  | {
      kind: 'cleared';
      oldHostSessionId: string;
      newHostSessionId: string;
      profile: string;
      titles: SessionTitles;
      sent: boolean;
    }
  | { kind: 'launching' }
  | { kind: 'launched'; hostSessionId: string }
  | { kind: 'launchFailed' }
  | { kind: 'started'; profiles: readonly string[] }
  | { kind: 'restoreMissed' };

// The queue after `event`: a new object, `queue` left as it was. A user close or a `/clear` whose conversation sent a
// message queues a retro of that conversation, unless the row is a retro row: one in `launched`, or one whose first
// message is a `RETRO_COMMAND`, which covers a retro row `launched` lost. One retro runs at a time.
export function nextQueue(queue: RetroQueue, event: QueueEvent): RetroQueue {
  switch (event.kind) {
    case 'closed':
      return afterClose(queue, event);
    case 'cleared':
      return afterClear(queue, event);
    case 'launching':
      return afterLaunching(queue);
    case 'launched':
      return afterLaunched(queue, event.hostSessionId);
    case 'launchFailed':
      return { ...queue, running: null };
    case 'started':
      return afterStart(queue, event.profiles);
    case 'restoreMissed':
      return afterRestoreMissed(queue);
  }
}

function afterClose(
  queue: RetroQueue,
  closed: Extract<QueueEvent, { kind: 'closed' }>,
): RetroQueue {
  const host = closed.hostSessionId;
  if (queue.launched.includes(host)) {
    const isRunning = queue.running?.hostSessionId === host;
    return {
      ...queue,
      running: isRunning ? null : queue.running,
      launched: queue.launched.filter((id) => id !== host),
    };
  }
  const queuesRetro =
    isUserClose(closed.reason) &&
    closed.sent &&
    !opensWithRetroCommand(closed.titles);
  return queuesRetro
    ? withRetroQueued(queue, host, closed.profile, closed.titles)
    : { ...queue };
}

function afterClear(
  queue: RetroQueue,
  cleared: Extract<QueueEvent, { kind: 'cleared' }>,
): RetroQueue {
  const oldHost = cleared.oldHostSessionId;
  const newHost = cleared.newHostSessionId;
  if (queue.launched.includes(oldHost)) {
    const { running } = queue;
    return {
      ...queue,
      running:
        running !== null && running.hostSessionId === oldHost
          ? { ...running, hostSessionId: newHost }
          : running,
      launched: queue.launched.map((id) => (id === oldHost ? newHost : id)),
    };
  }
  const queuesRetro = cleared.sent && !opensWithRetroCommand(cleared.titles);
  return queuesRetro
    ? withRetroQueued(queue, oldHost, cleared.profile, cleared.titles)
    : { ...queue };
}

// A retro row `launched` lost still opens with its `RETRO_COMMAND`.
function opensWithRetroCommand(titles: SessionTitles): boolean {
  return titles.firstMessage?.startsWith(`${RETRO_COMMAND} `) ?? false;
}

function withRetroQueued(
  queue: RetroQueue,
  host: string,
  profile: string,
  titles: SessionTitles,
): RetroQueue {
  const title = editableTitle(titles);
  const item: RetroItem = {
    hostIds: [host],
    profile,
    title: title === '' ? null : title,
  };
  return { ...queue, queued: [...queue.queued, item] };
}

function afterLaunching(queue: RetroQueue): RetroQueue {
  const [head, ...rest] = queue.queued;
  if (queue.running !== null || head === undefined) {
    return { ...queue };
  }
  return {
    ...queue,
    running: { item: head, hostSessionId: null },
    queued: rest,
  };
}

function afterLaunched(queue: RetroQueue, hostSessionId: string): RetroQueue {
  if (queue.running === null) {
    throw new Error(`retro ${hostSessionId} launched with none running`);
  }
  return {
    ...queue,
    running: { ...queue.running, hostSessionId },
    launched: [...queue.launched, hostSessionId],
  };
}

// A launch a quit cut short goes back to the head of the queue; a run whose profile is gone is dropped.
function afterStart(
  queue: RetroQueue,
  profiles: readonly string[],
): RetroQueue {
  const { running } = queue;
  if (running === null) {
    return { ...queue };
  }
  if (running.hostSessionId === null) {
    return { ...queue, running: null, queued: [running.item, ...queue.queued] };
  }
  if (!profiles.includes(running.item.profile)) {
    return withoutRun(queue, running.hostSessionId);
  }
  return { ...queue };
}

function afterRestoreMissed(queue: RetroQueue): RetroQueue {
  const host = queue.running?.hostSessionId ?? null;
  return host === null ? { ...queue } : withoutRun(queue, host);
}

function withoutRun(queue: RetroQueue, host: string): RetroQueue {
  return {
    ...queue,
    running: null,
    launched: queue.launched.filter((id) => id !== host),
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isRetroItem(value: unknown): value is RetroItem {
  return (
    isJsonObject(value) &&
    isStringArray(value.hostIds) &&
    typeof value.profile === 'string' &&
    (value.title === null || typeof value.title === 'string')
  );
}

function isRunning(value: unknown): value is RetroQueue['running'] {
  if (value === null) {
    return true;
  }
  return (
    isJsonObject(value) &&
    isRetroItem(value.item) &&
    (value.hostSessionId === null || typeof value.hostSessionId === 'string')
  );
}

function isRetroQueue(value: unknown): value is RetroQueue {
  return (
    isJsonObject(value) &&
    Array.isArray(value.queued) &&
    value.queued.every(isRetroItem) &&
    isRunning(value.running) &&
    isStringArray(value.launched)
  );
}

// The queue `queue.json` holds, without the top-level keys it does not read; throws `queue.json is not a queue` for text that is
// not JSON or not that shape.
export function parseQueue(text: string): RetroQueue {
  const notAQueue = new Error('queue.json is not a queue');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw notAQueue;
  }
  if (!isRetroQueue(parsed)) {
    throw notAQueue;
  }
  const { queued, running, launched } = parsed;
  return { queued, running, launched };
}
