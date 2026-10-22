import { describe, expect, it, vi } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import type { ConnectedSession, SessionInfo } from '../contract';
import { addDriveActions } from './start';

function fakeSessions() {
  const connectedInfo: SessionInfo[] = [];
  const ended: string[] = [];
  return {
    connectedInfo,
    ended,
    activate: vi.fn<(sessionId: string) => void>(),
    connect(info: SessionInfo): ConnectedSession {
      connectedInfo.push(info);
      const id = `row-${String(info.sessionId)}`;
      return {
        session: { id, info },
        call: () => Promise.reject(new Error('no tools')),
        end: () => ended.push(id),
      };
    },
  };
}

describe('sessions drive actions', () => {
  it('connect fills the fixture defaults for every field left out', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions);

    expect(await drive.run('connect')).toEqual({
      sessionId: 'drive-session-1',
      rowId: 'row-drive-session-1',
    });
    expect(sessions.connectedInfo).toEqual([
      {
        sessionId: 'drive-session-1',
        projectDir: 'drive',
        harness: 'claude',
        deadlineSeconds: null,
      },
    ]);
  });

  it('connect rejects a field of the wrong type and an unknown harness', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions);

    await expect(drive.run('connect', { sessionId: 7 })).rejects.toThrow(
      'sessionId must be a string',
    );
    await expect(drive.run('connect', { harness: 'gpt' })).rejects.toThrow(
      'harness "gpt" is none of claude, codex',
    );
    expect(sessions.connectedInfo).toEqual([]);
  });

  it('activate and end reject missing args instead of passing undefined on', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions);

    await expect(drive.run('activate', {})).rejects.toThrow(
      'rowId must be a string',
    );
    await expect(drive.run('end', null)).rejects.toThrow(
      'sessionId must be a string',
    );
    expect(sessions.activate).not.toHaveBeenCalled();
  });

  it('dispose removes the actions and ends each session still connected', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const actions = addDriveActions(drive.host, sessions);
    await drive.run('connect', { sessionId: 'a' });
    await drive.run('connect', { sessionId: 'b' });
    await drive.run('end', { sessionId: 'a' });

    actions.dispose();

    expect(sessions.ended).toEqual(['row-a', 'row-b']);
    expect([...drive.actions.keys()]).toEqual([]);
  });
});
