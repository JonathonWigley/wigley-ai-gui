import { describe, expect, it, vi } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import type {
  ConnectedSession,
  OwnedSession,
  SessionInfo,
  SessionsMainExports,
} from '../contract';
import { addDriveActions, sessionsMainPart } from './start';
import { SET_SESSION_TITLE_TOOL, startTitleTool } from './title-tool';

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
      return {
        session: { id, info },
        end: () => ended.push(id),
        setHostSessionId: () => undefined,
      };
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
      /sessionId/,
    );
    await expect(drive.run('connect', { harness: 'gpt' })).rejects.toThrow(
      /"gpt"/,
    );
    expect(sessions.connectedInfo).toEqual([]);
  });

  it('activate and end reject missing args instead of passing undefined on', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    addDriveActions(drive.host, sessions, fakeEndedEvent().on);

    await expect(drive.run('activate', {})).rejects.toThrow(/rowId/);
    await expect(drive.run('end', null)).rejects.toThrow(/sessionId/);
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

// Sessions' main part started over a fake `MainApi` with no relay, no drive
// and no self-test script, its titles limited to `titleMaxLength`.
function startSessionsPart(
  titleMaxLength: number,
  send: (message: string, payload: unknown) => void = () => undefined,
  originRepoName: (projectDir: string) => Promise<string | null> = () =>
    Promise.resolve(null),
) {
  let hex = 0;
  const api = {
    channel: { handle: () => undefined, send },
    events: { emit: () => undefined, on: () => undefined },
    settings: () => ({ layout: 'default', titleMaxLength }),
    services: {
      randomHex: () => (++hex).toString(16),
      log: () => undefined,
      runMode: 'selfTest',
      paths: { join: (...parts: string[]) => parts.join('/') },
      homeDir: '/home',
      appInstance: { id: 'app', isDev: false },
      selfTest: null,
      git: { originRepoName },
    },
    drive: null,
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof sessionsMainPart.start>[0];
  const part = sessionsMainPart.start(api);
  return { part, exports: part.exports as SessionsMainExports };
}

describe('sessions main part', () => {
  it.each([
    { case: 'running', disposed: false, messages: ['stateChanged'] },
    { case: 'disposed', disposed: true, messages: [] },
  ])(
    'a project lookup landing while the part is $case sends $messages',
    async ({ disposed, messages }) => {
      const lookup = Promise.withResolvers<string | null>();
      const sent: string[] = [];
      const { part, exports } = startSessionsPart(
        10,
        (message) => sent.push(message),
        () => lookup.promise,
      );
      const { session } = exports.connect({
        sessionId: 'host-1',
        projectDir: '/work/folder',
        deadlineSeconds: null,
        harness: 'claude',
      });
      exports.mark(session.id);
      sent.length = 0;
      if (disposed) {
        part.dispose?.();
      }

      lookup.resolve('repo');
      await new Promise((settle) => setImmediate(settle));

      expect(sent).toEqual(messages);
    },
  );

  it('contributes set_session_title once, titling the calling session at the setting limit', async () => {
    const { exports } = startSessionsPart(10);
    const connected = exports.connect({
      sessionId: 'host-1',
      projectDir: null,
      deadlineSeconds: null,
      harness: 'claude',
    });
    const context = { toolUseId: null, signal: new AbortController().signal };

    const overLimit = await connected.call(
      SET_SESSION_TITLE_TOOL.name,
      { title: 'Session titles' },
      context,
    );
    const stored = await connected.call(
      SET_SESSION_TITLE_TOOL.name,
      { title: 'Titles' },
      context,
    );

    expect(overLimit.content[0]?.text).toContain('the limit is 10');
    expect(stored.isError ?? false).toBe(false);
    expect(exports.titles(connected.session.id)?.agent).toBe('Titles');
    expect(() =>
      exports.contributeTools(
        [SET_SESSION_TITLE_TOOL],
        startTitleTool({
          setTitle: exports.setTitle,
          titles: exports.titles,
          maxLength: () => 10,
        }),
      ),
    ).toThrow('Two tool contributions both name the tool "set_session_title"');
  });
});
