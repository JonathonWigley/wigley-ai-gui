import { describe, expect, it } from 'vitest';
import type { DriveAction, DriveHost } from '../../../contracts/plugin';
import type {
  ConnectedSession,
  SessionInfo,
  ToolResult,
} from '../../sessions/contract';
import { addDriveActions } from './start';

function fakeDriveHost() {
  const actions = new Map<string, DriveAction>();
  const host: DriveHost = {
    add(name, action) {
      actions.set(name, action);
      return { dispose: () => actions.delete(name) };
    },
  };
  const run = (name: string, args?: unknown) => {
    const action = actions.get(name);
    if (action === undefined) {
      throw new Error(`no drive action ${name}`);
    }
    return action.run(args);
  };
  return { host, actions, run };
}

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

const SUBMITTED: ToolResult = { content: [{ type: 'text', text: 'done' }] };

describe('forms drive actions', () => {
  it('openRound connects a session with the fixture defaults', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions);

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

  it('openRound rejects a field of the wrong type', async () => {
    const drive = fakeDriveHost();
    addDriveActions(drive.host, fakeSessions());

    await expect(drive.run('openRound', { sessionId: 1 })).rejects.toThrow(
      'sessionId must be a string',
    );
    await expect(drive.run('openRound', 'x')).rejects.toThrow(
      'args must be an object',
    );
  });

  it('answers is pending until the round resolves, then its result', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions);
    await drive.run('openRound', { sessionId: 's' });

    expect(await drive.run('answers', { sessionId: 's' })).toEqual({
      pending: true,
    });
    sessions.answers[0]?.(SUBMITTED);
    await Promise.resolve();

    expect(await drive.run('answers', { sessionId: 's' })).toEqual(SUBMITTED);
    await expect(drive.run('answers', {})).rejects.toThrow(
      'sessionId must be a string',
    );
  });

  it('dispose removes the actions and ends each session forms opened', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const actions = addDriveActions(drive.host, sessions);
    await drive.run('openRound', { sessionId: 'a' });
    await drive.run('openRound', { sessionId: 'b' });

    actions.dispose();

    expect(sessions.ended).toEqual(['row-a', 'row-b']);
    expect([...drive.actions.keys()]).toEqual([]);
  });
});
