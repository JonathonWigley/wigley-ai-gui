import { describe, expect, it } from 'vitest';
import type { SessionCloseReason } from '../../chat/contract';
import type { SessionTitles } from '../../sessions/contract';
import {
  EMPTY_QUEUE,
  nextQueue,
  parseQueue,
  type QueueEvent,
  type RetroItem,
  type RetroQueue,
} from './retro-queue';

const TITLES: SessionTitles = {
  user: 'Fix login',
  agent: null,
  firstMessage: 'hi',
};

const A: RetroItem = { hostIds: ['a1'], profile: 'work', title: 'Alpha' };
const B: RetroItem = { hostIds: ['b0', 'b1'], profile: 'work', title: null };
const OLD_A: RetroItem = { ...A, profile: 'old' };

function closed(
  hostSessionId: string,
  reason: SessionCloseReason = 'user',
  sent = true,
  titles: SessionTitles = TITLES,
): QueueEvent {
  return {
    kind: 'closed',
    hostSessionId,
    profile: 'work',
    titles,
    sent,
    reason,
  };
}

function cleared(
  oldHostSessionId: string,
  newHostSessionId: string,
  sent = true,
  titles: SessionTitles = TITLES,
): QueueEvent {
  return {
    kind: 'cleared',
    oldHostSessionId,
    newHostSessionId,
    profile: 'work',
    titles,
    sent,
  };
}

const RETRO_TITLES: SessionTitles = {
  user: 'Fix login',
  agent: null,
  firstMessage: '/wigley:retro auto h1',
};

const queueOf = (fields: Partial<RetroQueue>): RetroQueue => ({
  ...EMPTY_QUEUE,
  ...fields,
});

describe('nextQueue', () => {
  it.each<{
    case: string;
    start: RetroQueue;
    events: QueueEvent[];
    expected: RetroQueue;
  }>([
    {
      case: 'a user close that sent queues its host id',
      start: EMPTY_QUEUE,
      events: [closed('h1')],
      expected: queueOf({
        queued: [{ hostIds: ['h1'], profile: 'work', title: 'Fix login' }],
      }),
    },
    {
      case: 'a user close that sent nothing queues nothing',
      start: EMPTY_QUEUE,
      events: [closed('h1', 'user', false)],
      expected: EMPTY_QUEUE,
    },
    {
      case: 'a start-failed close queues nothing',
      start: EMPTY_QUEUE,
      events: [closed('h1', 'start-failed')],
      expected: EMPTY_QUEUE,
    },
    {
      case: 'a project-closed close queues nothing',
      start: EMPTY_QUEUE,
      events: [closed('h1', 'project-closed')],
      expected: EMPTY_QUEUE,
    },
    {
      case: 'a finished close queues nothing',
      start: EMPTY_QUEUE,
      events: [closed('h1', 'finished')],
      expected: EMPTY_QUEUE,
    },
    {
      case: "the title falls back to the agent's, else none",
      start: EMPTY_QUEUE,
      events: [
        closed('h1', 'user', true, {
          user: null,
          agent: 'Agent title',
          firstMessage: null,
        }),
        closed('h2', 'user', true, {
          user: null,
          agent: null,
          firstMessage: null,
        }),
      ],
      expected: queueOf({
        queued: [
          { hostIds: ['h1'], profile: 'work', title: 'Agent title' },
          { hostIds: ['h2'], profile: 'work', title: null },
        ],
      }),
    },
    {
      case: 'a clear that sent queues the id it ended',
      start: EMPTY_QUEUE,
      events: [cleared('h0', 'h1')],
      expected: queueOf({
        queued: [{ hostIds: ['h0'], profile: 'work', title: 'Fix login' }],
      }),
    },
    {
      case: 'a clear that sent nothing queues nothing',
      start: EMPTY_QUEUE,
      events: [cleared('h0', 'h1', false)],
      expected: EMPTY_QUEUE,
    },
    {
      case: 'a clear of a retro row the queue lost queues nothing',
      start: EMPTY_QUEUE,
      events: [cleared('r0', 'r1', true, RETRO_TITLES)],
      expected: EMPTY_QUEUE,
    },
    {
      case: 'two clears and a close queue each conversation, oldest first',
      start: EMPTY_QUEUE,
      events: [cleared('h0', 'h1'), cleared('h1', 'h2'), closed('h2')],
      expected: queueOf({
        queued: [
          { hostIds: ['h0'], profile: 'work', title: 'Fix login' },
          { hostIds: ['h1'], profile: 'work', title: 'Fix login' },
          { hostIds: ['h2'], profile: 'work', title: 'Fix login' },
        ],
      }),
    },
    {
      case: 'a close of a retro row queues nothing and frees the run',
      start: queueOf({
        running: { item: A, hostSessionId: 'r1' },
        launched: ['r1'],
      }),
      events: [closed('r1')],
      expected: queueOf({ running: null, launched: [], queued: [] }),
    },
    {
      case: 'a close of a retro row the queue lost queues nothing',
      start: EMPTY_QUEUE,
      events: [closed('r1', 'user', true, RETRO_TITLES)],
      expected: EMPTY_QUEUE,
    },
    {
      case: 'launching moves the head to running',
      start: queueOf({ queued: [A, B] }),
      events: [{ kind: 'launching' }],
      expected: queueOf({
        running: { item: A, hostSessionId: null },
        queued: [B],
      }),
    },
    {
      case: 'launching while one runs changes nothing',
      start: queueOf({
        running: { item: A, hostSessionId: 'r1' },
        launched: ['r1'],
        queued: [B],
      }),
      events: [{ kind: 'launching' }],
      expected: queueOf({
        running: { item: A, hostSessionId: 'r1' },
        launched: ['r1'],
        queued: [B],
      }),
    },
    {
      case: "launched records the row's host id",
      start: queueOf({ running: { item: A, hostSessionId: null } }),
      events: [{ kind: 'launched', hostSessionId: 'r1' }],
      expected: queueOf({
        running: { item: A, hostSessionId: 'r1' },
        launched: ['r1'],
      }),
    },
    {
      case: 'a failed launch frees the run and keeps the rest',
      start: queueOf({
        running: { item: A, hostSessionId: null },
        queued: [B],
      }),
      events: [{ kind: 'launchFailed' }],
      expected: queueOf({ running: null, queued: [B] }),
    },
    {
      case: 'a re-closed row queues again',
      start: EMPTY_QUEUE,
      events: [closed('h1'), closed('h1')],
      expected: queueOf({
        queued: [
          { hostIds: ['h1'], profile: 'work', title: 'Fix login' },
          { hostIds: ['h1'], profile: 'work', title: 'Fix login' },
        ],
      }),
    },
    {
      case: 'a cleared retro row keeps its run and queues nothing',
      start: queueOf({
        running: { item: A, hostSessionId: 'r1' },
        launched: ['r1'],
        queued: [B],
      }),
      events: [cleared('r1', 'r2')],
      expected: queueOf({
        running: { item: A, hostSessionId: 'r2' },
        launched: ['r2'],
        queued: [B],
      }),
    },
    {
      case: 'a start returns a launch the quit cut short',
      start: queueOf({
        running: { item: A, hostSessionId: null },
        queued: [B],
      }),
      events: [{ kind: 'started', profiles: ['work'] }],
      expected: queueOf({ running: null, queued: [A, B] }),
    },
    {
      case: 'a start drops a run whose profile is gone',
      start: queueOf({
        running: { item: OLD_A, hostSessionId: 'r1' },
        launched: ['r1'],
      }),
      events: [{ kind: 'started', profiles: ['work'] }],
      expected: queueOf({ running: null, launched: [] }),
    },
    {
      case: 'a start keeps a run whose profile is there',
      start: queueOf({
        running: { item: OLD_A, hostSessionId: 'r1' },
        launched: ['r1'],
      }),
      events: [{ kind: 'started', profiles: ['old', 'work'] }],
      expected: queueOf({
        running: { item: OLD_A, hostSessionId: 'r1' },
        launched: ['r1'],
      }),
    },
    {
      case: 'a missed restore frees the run',
      start: queueOf({
        running: { item: A, hostSessionId: 'r1' },
        launched: ['r1'],
        queued: [B],
      }),
      events: [{ kind: 'restoreMissed' }],
      expected: queueOf({ running: null, launched: [], queued: [B] }),
    },
  ])('nextQueue_AppliesEachRule: $case', ({ start, events, expected }) => {
    const startCopy = structuredClone(start);

    const result = events.reduce(nextQueue, start);

    expect(result).toEqual(expected);
    expect(start).toEqual(startCopy);
  });
});

describe('parseQueue', () => {
  const FULL: RetroQueue = {
    queued: [A, B],
    running: { item: OLD_A, hostSessionId: 'r1' },
    launched: ['r1', 'r0'],
  };
  const { launched: _launched, ...withoutLaunched } = FULL;

  it.each([
    { case: 'not json', text: '{' },
    { case: 'an array', text: '[]' },
    { case: 'no launched', text: JSON.stringify(withoutLaunched) },
    {
      case: 'an item with no hostIds',
      text: JSON.stringify({
        ...FULL,
        queued: [{ profile: 'work', title: null }],
      }),
    },
  ])('parseQueue_BadText_Throws: $case', ({ text }) => {
    expect(() => parseQueue(text)).toThrow('queue.json is not a queue');
  });

  it.each([
    { case: 'the queue', text: JSON.stringify(FULL) },
    {
      case: 'the old shape with a cleared map',
      text: JSON.stringify({ ...FULL, cleared: { h2: ['h0', 'h1'] } }),
    },
  ])('parseQueue_GoodText_ReturnsTheQueue: $case', ({ text }) => {
    expect(parseQueue(text)).toEqual(FULL);
  });
});
