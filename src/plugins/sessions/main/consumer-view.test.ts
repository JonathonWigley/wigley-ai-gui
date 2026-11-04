import { describe, expect, it } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionInfo, SessionsMainExports } from '../contract';
import { sessionsMainView } from './consumer-view';

const INFO: SessionInfo = {
  sessionId: 'host',
  projectDir: null,
  deadlineSeconds: null,
  harness: 'claude',
};

// Exports whose sessions count their ends.
function fakeExports() {
  let ends = 0;
  const session = {
    session: { id: 'row', info: INFO },
    end: () => {
      ends++;
    },
  };
  const exports = {
    connect: () => ({ ...session, call: () => Promise.reject(new Error()) }),
    open: () => ({ ...session, setHostSessionId: () => undefined }),
  } as unknown as SessionsMainExports;
  return { exports, ends: () => ends };
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
});
