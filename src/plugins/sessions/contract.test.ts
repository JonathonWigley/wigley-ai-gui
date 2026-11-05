import { describe, expect, it, vi } from 'vitest';
import type { KeyedSlotWriter } from '../../contracts/state';
import { createSlotStore } from '../../shared/state/slot-store';
import { followRows, type SessionRow, sessionsRowsSlot } from './contract';

function row(sessionId: string, hostSessionId: string | null): SessionRow {
  return {
    sessionId,
    label: sessionId,
    project: 'project',
    harness: 'claude',
    marked: false,
    projectDir: null,
    hostSessionId,
    titles: { user: null, agent: null, firstMessage: null },
  };
}

describe('followRows', () => {
  it.each<{
    name: string;
    change(rows: KeyedSlotWriter<SessionRow>): void;
    calls: string[];
  }>([
    {
      name: 'a new row',
      change: (rows) => rows.set('c', row('c', 'h-c')),
      calls: ['added c'],
    },
    {
      name: 'a title change',
      change: (rows) =>
        rows.set('a', {
          ...row('a', 'h-a'),
          titles: { user: 'New', agent: null, firstMessage: null },
        }),
      calls: [],
    },
    {
      name: 'a host change',
      change: (rows) => rows.set('a', row('a', 'h-new')),
      calls: ['hostChanged a h-new'],
    },
    {
      name: 'a delete',
      change: (rows) => rows.delete('a'),
      calls: ['removed a'],
    },
    {
      name: 'a delete and set',
      change: (rows) => {
        rows.delete('a');
        rows.set('a', row('a', 'h-a'));
      },
      calls: ['removed a', 'added a'],
    },
  ])('after the catch-up: $name', ({ change, calls }) => {
    const store = createSlotStore(() => undefined);
    const rows = store.publish(sessionsRowsSlot);
    rows.set('a', row('a', 'h-a'));
    rows.set('b', row('b', null));
    const heard: string[] = [];

    followRows(store.read(sessionsRowsSlot, 'test'), {
      added: ({ sessionId }) => heard.push(`added ${sessionId}`),
      removed: (sessionId) => heard.push(`removed ${sessionId}`),
      hostChanged: ({ sessionId, hostSessionId }) =>
        heard.push(`hostChanged ${sessionId} ${String(hostSessionId)}`),
    });

    expect(heard).toEqual(['added a', 'added b']);

    heard.length = 0;
    change(rows);

    expect(heard).toEqual(calls);
  });

  it('a throw from a catch-up added skips no row and leaves the follow live', () => {
    const store = createSlotStore(() => undefined);
    const rows = store.publish(sessionsRowsSlot);
    for (const sessionId of ['a', 'b', 'c']) {
      rows.set(sessionId, row(sessionId, `h-${sessionId}`));
    }
    const heard: string[] = [];

    expect(() =>
      followRows(store.read(sessionsRowsSlot, 'test'), {
        added({ sessionId }) {
          heard.push(sessionId);
          if (sessionId === 'b') {
            throw new Error('b failed');
          }
        },
      }),
    ).toThrow('b failed');
    rows.set('d', row('d', 'h-d'));

    expect(heard).toEqual(['a', 'b', 'c', 'd']);
  });

  it('after dispose hears nothing', () => {
    const store = createSlotStore(() => undefined);
    const rows = store.publish(sessionsRowsSlot);
    const added = vi.fn();
    const removed = vi.fn();
    rows.set('a', row('a', 'h-a'));
    const following = followRows(store.read(sessionsRowsSlot, 'test'), {
      added,
      removed,
    });
    added.mockClear();

    following.dispose();
    rows.set('b', row('b', 'h-b'));
    rows.delete('a');

    expect(added).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
  });
});
