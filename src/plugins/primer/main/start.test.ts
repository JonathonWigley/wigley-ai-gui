import { describe, expect, it } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import type {
  ConnectedSession,
  SessionInfo,
  ToolResult,
} from '../../sessions/contract';
import { SAMPLE_PRIMER_ARGS } from './fixtures';
import { addDriveActions } from './start';

// Sessions whose `open_primer` calls wait until the test answers them; each
// call's tool name and args are kept in `calls`.
function fakeSessions() {
  const connectedInfo: SessionInfo[] = [];
  const ended: string[] = [];
  const answers: ((result: ToolResult) => void)[] = [];
  const calls: [string, unknown][] = [];
  return {
    connectedInfo,
    ended,
    answers,
    calls,
    connect(info: SessionInfo): ConnectedSession {
      connectedInfo.push(info);
      const id = `row-${String(info.sessionId)}`;
      return {
        session: { id, info },
        call: (tool, args) =>
          new Promise<ToolResult>((resolve) => {
            calls.push([tool, args]);
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

describe('primer drive actions', () => {
  it('openPrimer connects a session with the fixture defaults', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    expect(await drive.run('openPrimer')).toEqual({
      sessionId: 'drive-primer-1',
      rowId: 'row-drive-primer-1',
    });
    expect(sessions.connectedInfo).toEqual([
      {
        sessionId: 'drive-primer-1',
        projectDir: 'drive',
        harness: 'claude',
        deadlineSeconds: null,
      },
    ]);
    expect(sessions.calls).toEqual([['open_primer', SAMPLE_PRIMER_ARGS]]);
  });

  it('openPrimer keeps an explicit null projectDir', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    await drive.run('openPrimer', { projectDir: null });

    expect(sessions.connectedInfo[0]?.projectDir).toBeNull();
  });

  it('openPrimer reuses a live session and connects a fresh one once it ended', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const ended = fakeEndedEvent();
    const actions = addDriveActions(drive.host, sessions, ended.on);
    await drive.run('openPrimer', { sessionId: 's' });
    await drive.run('openPrimer', { sessionId: 's' });
    expect(sessions.connectedInfo).toHaveLength(1);

    ended.emit('row-s');
    await drive.run('openPrimer', { sessionId: 's' });

    expect(sessions.connectedInfo).toHaveLength(2);
    actions.dispose();
    expect(sessions.ended).toEqual(['row-s']);
  });

  it('openPrimer rejects a field of the wrong type', async () => {
    const drive = fakeDriveHost();
    addDriveActions(drive.host, fakeSessions(), fakeEndedEvent().on);

    await expect(drive.run('openPrimer', { sessionId: 1 })).rejects.toThrow(
      'sessionId',
    );
    await expect(drive.run('openPrimer', 'x')).rejects.toThrow('args');
  });

  it('answers is pending until the primer resolves, then its result', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);
    await drive.run('openPrimer', { sessionId: 's' });

    expect(await drive.run('answers', { sessionId: 's' })).toEqual({
      pending: true,
    });
    sessions.answers[0]?.(SUBMITTED);
    await Promise.resolve();

    expect(await drive.run('answers', { sessionId: 's' })).toEqual(SUBMITTED);
    await expect(drive.run('answers', {})).rejects.toThrow('sessionId');
  });

  it('dispose removes the actions and ends each session primer opened', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const actions = addDriveActions(drive.host, sessions, fakeEndedEvent().on);
    await drive.run('openPrimer', { sessionId: 'a' });
    await drive.run('openPrimer', { sessionId: 'b' });

    actions.dispose();

    expect(sessions.ended).toEqual(['row-a', 'row-b']);
    expect([...drive.actions.keys()]).toEqual([]);
  });
});
