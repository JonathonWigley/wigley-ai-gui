import { describe, expect, it, vi } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import type { ConnectedSession, OwnedSession, SessionInfo } from '../contract';
import { addDriveActions } from './start';

function fakeSessions() {
  const connectedInfo: SessionInfo[] = [];
  const openedInfo: SessionInfo[] = [];
  const ended: string[] = [];
  return {
    connectedInfo,
    openedInfo,
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
    open(info: SessionInfo): OwnedSession {
      openedInfo.push(info);
      const id = `owned-${String(info.sessionId)}`;
      return { session: { id, info }, end: () => ended.push(id) };
    },
  };
}

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

describe('sessions drive actions', () => {
  it('connect fills the fixture defaults for every field left out', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

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

  it('open opens an owned session with the fixture defaults, which end ends', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    expect(await drive.run('open', { sessionId: 's' })).toEqual({
      sessionId: 's',
      rowId: 'owned-s',
    });
    await drive.run('end', { sessionId: 's' });

    expect(sessions.openedInfo).toEqual([
      {
        sessionId: 's',
        projectDir: 'drive',
        harness: 'claude',
        deadlineSeconds: null,
      },
    ]);
    expect(sessions.connectedInfo).toEqual([]);
    expect(sessions.ended).toEqual(['owned-s']);
  });

  it('connect keeps an explicit null projectDir', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    await drive.run('connect', { projectDir: null });

    expect(sessions.connectedInfo[0]?.projectDir).toBeNull();
  });

  it('connect rejects a field of the wrong type and an unknown harness', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

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
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

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
    const actions = addDriveActions(drive.host, sessions, fakeEndedEvent().on);
    await drive.run('connect', { sessionId: 'a' });
    await drive.run('connect', { sessionId: 'b' });
    await drive.run('end', { sessionId: 'a' });

    actions.dispose();

    expect(sessions.ended).toEqual(['row-a', 'row-b']);
    expect([...drive.actions.keys()]).toEqual([]);
  });

  it('a session that ends outside end leaves the map, so its id connects again', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const ended = fakeEndedEvent();
    const actions = addDriveActions(drive.host, sessions, ended.on);
    await drive.run('connect', { sessionId: 'a' });

    ended.emit('row-a');

    expect(await drive.run('connect', { sessionId: 'a' })).toEqual({
      sessionId: 'a',
      rowId: 'row-a',
    });
    actions.dispose();
    expect(sessions.ended).toEqual(['row-a']);
  });
});
