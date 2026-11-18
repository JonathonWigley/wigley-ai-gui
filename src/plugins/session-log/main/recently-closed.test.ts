import { describe, expect, it } from 'vitest';
import { recentlyClosed, sampleRecentlyClosed } from './recently-closed';
import type { SessionLogEntry } from './session-event-log';

const titled = (user: string) => ({ user, agent: null, firstMessage: null });

function closed(
  host: string,
  at: number,
  overrides: Partial<Extract<SessionLogEntry, { event: 'closed' }>> = {},
): SessionLogEntry {
  return {
    at,
    event: 'closed',
    sessionId: `row-${at}`,
    hostSessionId: host,
    projectDir: `/projects/${host}`,
    profile: `profile-${host}`,
    titles: titled(`${host} at ${at}`),
    sent: true,
    reason: 'user',
    ...overrides,
  };
}

function cleared(oldHost: string, at: number, sent: boolean): SessionLogEntry {
  return {
    at,
    event: 'cleared',
    sessionId: `row-${at}`,
    oldHostSessionId: oldHost,
    newHostSessionId: `${oldHost}-new`,
    projectDir: `/projects/${oldHost}`,
    profile: `profile-${oldHost}`,
    titles: titled(`${oldHost} at ${at}`),
    sent,
  };
}

const row = (host: string, at: number, title = `${host} at ${at}`) => ({
  hostSessionId: host,
  projectDir: `/projects/${host}`,
  profile: `profile-${host}`,
  title,
  at,
});

const anyResumable = () => true;

describe('recentlyClosed', () => {
  it.each([
    {
      name: 'a session closed twice lists once, under its newest close',
      entries: [closed('a', 10), closed('b', 20), closed('a', 30)],
      expected: [row('b', 20), row('a', 30)],
    },
    {
      name: 'a cleared session lists under its old host id',
      entries: [closed('a', 10), cleared('c', 20, true)],
      expected: [row('a', 10), row('c', 20)],
    },
    {
      name: 'a session with no titles lists as untitled',
      entries: [
        closed('a', 10, {
          titles: { user: null, agent: null, firstMessage: null },
        }),
      ],
      expected: [row('a', 10, 'Untitled session')],
    },
  ])('recentlyClosed_Entries_ListUserClosesOnceNewestLast: $name', (test) => {
    expect(recentlyClosed(test.entries, 10, anyResumable)).toEqual(
      test.expected,
    );
  });

  it.each<{ name: string; entry: SessionLogEntry }>([
    {
      name: 'a failed start',
      entry: closed('a', 10, { reason: 'start-failed' }),
    },
    {
      name: 'a project closing',
      entry: closed('a', 10, { reason: 'project-closed' }),
    },
    {
      name: 'a finished close',
      entry: closed('a', 10, { reason: 'finished' }),
    },
    { name: 'a close never sent to', entry: closed('a', 10, { sent: false }) },
    { name: 'a clear never sent to', entry: cleared('a', 10, false) },
    {
      name: 'an open',
      entry: {
        at: 10,
        event: 'opened',
        sessionId: 'row-10',
        hostSessionId: 'a',
        projectDir: '/projects/a',
        profile: 'profile-a',
        origin: 'new',
      },
    },
  ])('recentlyClosed_Excluded_NotListed: $name', ({ entry }) => {
    expect(recentlyClosed([entry], 10, anyResumable)).toEqual([]);
  });

  const fourCandidates = [
    closed('a', 10),
    closed('b', 20),
    closed('c', 30),
    closed('d', 40),
  ];

  it.each([
    { count: 0, isResumable: anyResumable, expected: [] },
    { count: 0.5, isResumable: anyResumable, expected: [] },
    { count: -1, isResumable: anyResumable, expected: [] },
    {
      count: 2.9,
      isResumable: anyResumable,
      expected: [row('c', 30), row('d', 40)],
    },
    {
      count: 2,
      isResumable: (host: string) => host !== 'd',
      expected: [row('b', 20), row('c', 30)],
    },
  ])(
    'recentlyClosed_Count_CapsAfterResumable: count $count',
    ({ count, isResumable, expected }) => {
      expect(recentlyClosed(fourCandidates, count, isResumable)).toEqual(
        expected,
      );
    },
  );
});

describe('sampleRecentlyClosed', () => {
  // Breaks on a cap counted before the filter, or a fraction that keeps an
  // extra row.
  it.each([
    {
      count: 2,
      isResumable: anyResumable,
      expected: ['demo-closed-2', 'demo-closed-3'],
    },
    { count: 0, isResumable: anyResumable, expected: [] },
    { count: -1, isResumable: anyResumable, expected: [] },
    {
      count: 2.7,
      isResumable: anyResumable,
      expected: ['demo-closed-2', 'demo-closed-3'],
    },
    {
      count: 2,
      isResumable: (host: string) => host !== 'demo-closed-3',
      expected: ['demo-closed-1', 'demo-closed-2'],
    },
  ])(
    'caps after the resumable filter: count $count keeps $expected',
    ({ count, isResumable, expected }) => {
      const rows = sampleRecentlyClosed(
        1_000_000_000,
        count,
        '/home/dev/sample-app',
        isResumable,
      );

      expect(rows.map((row) => row.hostSessionId)).toEqual(expected);
    },
  );
});
