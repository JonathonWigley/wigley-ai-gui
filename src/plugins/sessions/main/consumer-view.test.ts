import { describe, expect, it } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
import { createRegistrations } from '../../../shared/registrations';
import type {
  OwnedSession,
  SessionInfo,
  SessionsMainExports,
} from '../contract';
import { sessionsMainView } from './consumer-view';

const INFO: SessionInfo = {
  sessionId: 'host',
  projectDir: null,
  harness: 'claude',
};

// Exports whose sessions count their ends.
function fakeExports() {
  let ends = 0;
  let keeps = 0;
  const session = {
    session: { id: 'row', info: INFO },
    end: () => {
      ends++;
    },
  };
  const exports = {
    connect: () => ({ ...session, call: () => Promise.reject(new Error()) }),
    open: () => ({
      ...session,
      setHostSessionId: () => undefined,
      keep: () => {
        keeps++;
      },
    }),
  } as unknown as SessionsMainExports;
  return { exports, ends: () => ends, keeps: () => keeps };
}

describe('sessionsMainView', () => {
  it.each<{
    case: string;
    start(view: SessionsMainExports): { end(): void };
    stop(session: { end(): void }, consumer: Disposable): void;
  }>([
    {
      case: 'connect, ended, then the consumer stops',
      start: (view) => view.connect(INFO),
      stop(session, consumer) {
        session.end();
        consumer.dispose();
      },
    },
    {
      case: 'open, ended, then the consumer stops',
      start: (view) => view.open(INFO),
      stop(session, consumer) {
        session.end();
        consumer.dispose();
      },
    },
    {
      case: 'connect, the consumer stops, then ended',
      start: (view) => view.connect(INFO),
      stop(session, consumer) {
        consumer.dispose();
        session.end();
      },
    },
    {
      case: 'open, the consumer stops, then ended',
      start: (view) => view.open(INFO),
      stop(session, consumer) {
        consumer.dispose();
        session.end();
      },
    },
  ])('a session ends once: $case', ({ start, stop }) => {
    const { exports, ends } = fakeExports();
    const consumer = createRegistrations();

    stop(start(sessionsMainView(exports, consumer)), consumer);

    expect(ends()).toBe(1);
  });

  it('a kept owned session ends nothing when the consumer stops', () => {
    const { exports, ends, keeps } = fakeExports();
    const consumer = createRegistrations();
    const owned = sessionsMainView(exports, consumer).open(INFO);

    owned.keep();
    consumer.dispose();
    owned.end();

    expect({ ends: ends(), keeps: keeps() }).toEqual({ ends: 0, keeps: 1 });
  });

  // Breaks if the view lets its dependent move a row it handed on: a kept row
  // belongs to the restarted owner's view that adopts it.
  it.each<{ case: string; stop(owned: OwnedSession): void }>([
    { case: 'ended', stop: (owned) => owned.end() },
    { case: 'kept', stop: (owned) => owned.keep() },
  ])('relocate refuses a session the view opened, once $case', ({ stop }) => {
    const relocated: string[] = [];
    const { exports } = fakeExports();
    const view = sessionsMainView(
      { ...exports, relocate: (id) => relocated.push(id) },
      createRegistrations(),
    );
    const owned = view.open(INFO);
    view.relocate('row', '/before');

    stop(owned);

    expect(() => view.relocate('row', '/after')).toThrow('row');
    expect(relocated).toEqual(['row']);
  });
});
