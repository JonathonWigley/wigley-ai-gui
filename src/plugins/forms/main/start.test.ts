import { describe, expect, it } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import type {
  ConnectedSession,
  SessionInfo,
  ToolResult,
} from '../../sessions/contract';
import { addDriveActions, registerLayoutsAfter } from './start';

// Sessions whose `ask_round` calls wait until the test answers them.
function fakeSessions() {
  const connectedInfo: SessionInfo[] = [];
  const ended: string[] = [];
  const answers: ((result: ToolResult) => void)[] = [];
  return {
    connectedInfo,
    ended,
    answers,
    connect(info: SessionInfo): ConnectedSession {
      connectedInfo.push(info);
      const id = `row-${String(info.sessionId)}`;
      return {
        session: { id, info },
        call: () =>
          new Promise<ToolResult>((resolve) => {
            answers.push(resolve);
          }),
        end: () => ended.push(id),
      };
    },
  };
}

// The sessions plugin's ended event, which the test emits by row id.
function fakeEndedEvent() {
  const listeners: ((rowId: string) => void)[] = [];
  return {
    on: (listener: (rowId: string) => void) => listeners.push(listener),
    emit: (rowId: string) => {
      for (const listener of listeners) {
        listener(rowId);
      }
    },
  };
}

const SUBMITTED: ToolResult = { content: [{ type: 'text', text: 'done' }] };

describe('forms drive actions', () => {
  it('openRound connects a session with the fixture defaults', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    expect(await drive.run('openRound')).toEqual({
      sessionId: 'drive-forms-1',
      rowId: 'row-drive-forms-1',
    });
    expect(sessions.connectedInfo).toEqual([
      {
        sessionId: 'drive-forms-1',
        projectDir: 'drive',
        harness: 'claude',
        deadlineSeconds: null,
      },
    ]);
  });

  it('openRound keeps an explicit null projectDir', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    await drive.run('openRound', { projectDir: null });

    expect(sessions.connectedInfo[0]?.projectDir).toBeNull();
  });

  it('openRound reuses a live session and connects a fresh one once it ended', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const ended = fakeEndedEvent();
    const actions = addDriveActions(drive.host, sessions, ended.on);
    await drive.run('openRound', { sessionId: 's' });
    await drive.run('openRound', { sessionId: 's' });
    expect(sessions.connectedInfo).toHaveLength(1);

    ended.emit('row-s');
    await drive.run('openRound', { sessionId: 's' });

    expect(sessions.connectedInfo).toHaveLength(2);
    actions.dispose();
    expect(sessions.ended).toEqual(['row-s']);
  });

  it('openRound rejects a field of the wrong type', async () => {
    const drive = fakeDriveHost();
    addDriveActions(drive.host, fakeSessions(), fakeEndedEvent().on);

    await expect(drive.run('openRound', { sessionId: 1 })).rejects.toThrow(
      'sessionId',
    );
    await expect(drive.run('openRound', 'x')).rejects.toThrow('args');
  });

  it('answers is pending until the round resolves, then its result', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);
    await drive.run('openRound', { sessionId: 's' });

    expect(await drive.run('answers', { sessionId: 's' })).toEqual({
      pending: true,
    });
    sessions.answers[0]?.(SUBMITTED);
    await Promise.resolve();

    expect(await drive.run('answers', { sessionId: 's' })).toEqual(SUBMITTED);
    await expect(drive.run('answers', {})).rejects.toThrow('sessionId');
  });

  it('dispose removes the actions and ends each session forms opened', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const actions = addDriveActions(drive.host, sessions, fakeEndedEvent().on);
    await drive.run('openRound', { sessionId: 'a' });
    await drive.run('openRound', { sessionId: 'b' });

    actions.dispose();

    expect(sessions.ended).toEqual(['row-a', 'row-b']);
    expect([...drive.actions.keys()]).toEqual([]);
  });
});

// A write the test lands or fails, a register that records each registration
// and its dispose (or throws when `failure` is set), and the log.
function registrationSetup(failure: Error | null = null) {
  let land: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const written = new Promise<void>((resolve, reject) => {
    land = resolve;
    fail = reject;
  });
  const events: string[] = [];
  const logLines: string[] = [];
  const layouts = registerLayoutsAfter(
    written,
    () => {
      if (failure !== null) {
        throw failure;
      }
      events.push('registered');
      return { dispose: () => events.push('disposed') };
    },
    (message) => logLines.push(message),
  );
  return { land, fail, layouts, events, logLines };
}

// Lets the settled promises' handlers run.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('forms layouts registration', () => {
  it('writeLands_ThenDispose_RegistersThenDisposesIt', async () => {
    const { land, layouts, events } = registrationSetup();

    land();
    await flush();
    await layouts.dispose();

    expect(events).toEqual(['registered', 'disposed']);
  });

  it('disposeBeforeTheWriteLands_RegistersNothing', async () => {
    const { land, layouts, events } = registrationSetup();

    const disposed = layouts.dispose();
    land();
    await disposed;

    expect(events).toEqual([]);
  });

  it.each([
    {
      case: 'the register throws',
      setup: () => registrationSetup(new Error('bad types')),
      settle: (setup: ReturnType<typeof registrationSetup>) => setup.land(),
      reason: 'bad types',
    },
    {
      case: 'the write fails',
      setup: () => registrationSetup(),
      settle: (setup: ReturnType<typeof registrationSetup>) =>
        setup.fail(new Error('disk full')),
      reason: 'disk full',
    },
  ])('logsAndDisposeSettles when $case', async ({ setup, settle, reason }) => {
    const subject = setup();

    settle(subject);
    await flush();

    expect(subject.logLines).toEqual([expect.stringContaining(reason)]);
    await expect(subject.layouts.dispose()).resolves.toBeUndefined();
  });
});
