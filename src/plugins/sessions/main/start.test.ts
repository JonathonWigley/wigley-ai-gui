import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect as connectSocket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it, vi } from 'vitest';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import {
  dataEmitted,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { channelPath } from '../../../shared/local-channel/channel-path';
import { osPlatform } from '../../../shared/os-platform';
import { fakePlatform } from '../../../shared/platform.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  createSlotStore,
  type SlotStore,
} from '../../../shared/state/slot-store';
import {
  type ConnectedSession,
  type OwnedSession,
  RELAY_PROTOCOL,
  type RelayHello,
  type SessionInfo,
  type SessionsMainExports,
  sessionsRowsSlot,
  sessionsSelectionSlot,
  type ToolResult,
  type ToolSession,
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

  it('a session that ends outside end leaves the map, so its id connects again', async () => {
    const drive = fakeDriveHost();
    const sessions = fakeSessions();
    const ended = fakeEndedEvent();
    addDriveActions(drive.host, sessions, ended.on);
    await drive.run('connect', { sessionId: 'a' });

    ended.emit('row-a');

    expect(await drive.run('connect', { sessionId: 'a' })).toEqual({
      sessionId: 'a',
      rowId: 'row-a',
    });
  });
});

const CONTEXT = { toolUseId: null, signal: new AbortController().signal };

const ASK_TOOL = { name: 'ask', description: 'Ask.', inputSchema: {} };

const ASK_RESULT: ToolResult = { content: [{ type: 'text', text: 'asked' }] };

function hostInfo(sessionId: string): SessionInfo {
  return {
    sessionId,
    projectDir: null,
    deadlineSeconds: null,
    harness: 'claude',
  };
}

// A contribution's start whose tool sessions answer and count their ends.
function fakeAskStart() {
  let ends = 0;
  const start = (): ToolSession => ({
    call: async () => ASK_RESULT,
    end: () => {
      ends++;
    },
  });
  return { start, ends: () => ends };
}

// Sessions' main part started over a fake `MainApi` with no drive and no
// self-test script, its titles limited to `titleMaxLength`. It opens no relay
// unless `runMode` says so, with its files under `homeDir`.
function startSessionsPart(
  titleMaxLength: number,
  {
    runMode = 'selfTest',
    homeDir = '/home',
    log = () => undefined,
    send = () => undefined,
    originRepoName = () => Promise.resolve(null),
    agentHarnesses = [],
    state = createSlotStore(() => undefined),
  }: {
    runMode?: 'selfTest' | 'live';
    homeDir?: string;
    log?: (message: string) => void;
    send?: (message: string, payload: unknown) => void;
    originRepoName?: (projectDir: string) => Promise<string | null>;
    agentHarnesses?: { id: string; sessionName: unknown }[];
    state?: SlotStore;
  } = {},
) {
  let hex = 0;
  const api = {
    channel: { handle: () => undefined, send },
    events: { emit: () => undefined, on: () => undefined },
    state,
    settings: () => ({ layout: 'default', titleMaxLength }),
    services: {
      randomHex: () => (++hex).toString(16),
      log,
      runMode,
      paths: { join: (...parts: string[]) => parts.join('/') },
      homeDir,
      appInstance: { id: 'app', isDev: false },
      selfTest: null,
      git: { originRepoName },
      platform,
      agentHarnesses,
    },
    drive: null,
    layouts: { register: () => ({ dispose: () => undefined }) },
  } as unknown as Parameters<typeof sessionsMainPart.start>[0];
  return sessionsMainPart.start(api);
}

function viewOf(
  started: ReturnType<typeof startSessionsPart>,
  consumer = createRegistrations(),
): SessionsMainExports {
  return started.exports?.(consumer) as SessionsMainExports;
}

// The app instance id the harness's fake services carry.
const HARNESS_APP_ID = 'wigley-ai-gui-dev';

// The record of the OS the tests run on, so a test's relay opens the channel this OS's relays use.
const platform = fakePlatform(osPlatform(process.platform));

const RELAY_HELLO: RelayHello = {
  protocol: RELAY_PROTOCOL,
  session_id: 'host-relay',
  project_dir: null,
  deadline_seconds: null,
  harness: 'claude',
};

// The ids of the sessions `harness` saw connect and end.
function sessionEvents(harness: Parameters<typeof dataEmitted>[0]) {
  return {
    connected: (
      dataEmitted(harness, 'sessions.connected') as { id: string }[]
    ).map(({ id }) => id),
    ended: (
      dataEmitted(harness, 'sessions.ended') as { sessionId: string }[]
    ).map(({ sessionId }) => sessionId),
  };
}

describe('sessions main part', () => {
  it.each([
    {
      case: 'its own harness reads the saved session from its config folder',
      harness: 'claude',
      sessionId: 'host-1',
      projectDir: '/work/folder',
      asked: [['host-1', '/work/folder', '/home/.claude-work']],
    },
    {
      case: 'a harness the app does not run asks nothing',
      harness: 'codex',
      sessionId: 'host-1',
      projectDir: '/work/folder',
      asked: [],
    },
    {
      case: 'a session with no id asks nothing',
      harness: 'claude',
      sessionId: null,
      projectDir: '/work/folder',
      asked: [],
    },
    {
      case: 'a session with no folder asks nothing',
      harness: 'claude',
      sessionId: 'host-1',
      projectDir: null,
      asked: [],
    },
  ] as const)(
    'a marked connected session: $case',
    async ({ harness, sessionId, projectDir, asked }) => {
      const sessionName = vi.fn(async () => null);
      const exports = viewOf(
        startSessionsPart(30, {
          agentHarnesses: [{ id: 'claude', sessionName }],
        }),
      );
      const { session } = exports.connect({
        sessionId,
        projectDir,
        deadlineSeconds: null,
        harness,
        profileDir: '/home/.claude-work',
      });

      exports.mark(session.id);
      await new Promise((settle) => setImmediate(settle));

      expect(sessionName.mock.calls).toEqual(asked);
    },
  );

  it.each([
    { case: 'running', disposed: false, writes: ['sessions.rows'] },
    { case: 'disposed', disposed: true, writes: [] },
  ])(
    'a project lookup landing while the part is $case writes $writes',
    async ({ disposed, writes }) => {
      const lookup = Promise.withResolvers<string | null>();
      const written: string[] = [];
      const state = createSlotStore(() => undefined);
      state.onWrite((change) => written.push(change.id));
      const started = startSessionsPart(10, {
        state,
        originRepoName: () => lookup.promise,
      });
      const exports = viewOf(started);
      const { session } = exports.connect({
        sessionId: 'host-1',
        projectDir: '/work/folder',
        deadlineSeconds: null,
        harness: 'claude',
      });
      exports.mark(session.id);
      if (disposed) {
        await started.dispose?.();
      }
      written.length = 0;

      lookup.resolve('repo');
      await new Promise((settle) => setImmediate(settle));

      expect(written).toEqual(writes);
    },
  );

  it('dispose_EmptiesTheRowsThroughTheWriter', async () => {
    const send = vi.fn();
    const state = createSlotStore(() => undefined);
    const started = startSessionsPart(10, { state, send });
    const { session } = viewOf(started).connect({
      sessionId: 'host-1',
      projectDir: null,
      deadlineSeconds: null,
      harness: 'claude',
    });
    viewOf(started).mark(session.id);
    expect(state.read(sessionsRowsSlot, 'test').all().size).toBe(1);

    await started.dispose?.();

    expect(state.read(sessionsRowsSlot, 'test').all().size).toBe(0);
    expect(state.read(sessionsSelectionSlot, 'test').get()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('contributes set_session_title once, titling the calling session at the setting limit', async () => {
    const exports = viewOf(startSessionsPart(10));
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

  it('disposes what a dependent registered through its view when its registrations dispose', async () => {
    const started = startSessionsPart(10);
    const dependent = createRegistrations();
    const bystanderView = viewOf(started);
    const dependentView = viewOf(started, dependent);
    const ask = fakeAskStart();
    const hostOne = bystanderView.connect(hostInfo('host-1'));
    dependentView.contributeTools([ASK_TOOL], ask.start);
    const ownedId = dependentView.open(hostInfo('host-owned')).session.id;
    const connectedId = dependentView.connect(hostInfo('host-dep')).session.id;

    dependent.dispose();

    expect(ask.ends()).toBe(3);
    await expect(hostOne.call('ask', {}, CONTEXT)).rejects.toThrow(
      'Unknown tool: ask. Valid tools are set_session_title.',
    );
    expect(bystanderView.titles(ownedId)).toBeNull();
    expect(bystanderView.titles(connectedId)).toBeNull();
    expect(bystanderView.titles(hostOne.session.id)).not.toBeNull();
  });

  it('keeps a contribution live when the endpoint files cannot be written', async () => {
    const homeDir = mkdtempSync(path.join(os.tmpdir(), 'sessions-start-'));
    const logged: string[] = [];
    const started = startSessionsPart(10, {
      runMode: 'live',
      homeDir,
      log: (message) => logged.push(message),
    });
    try {
      const view = viewOf(started);
      const connected = view.connect(hostInfo('host-1'));
      const endpointDir = path.join(homeDir, '.agents', 'app');
      rmSync(endpointDir, { recursive: true });
      writeFileSync(endpointDir, 'not a folder');

      view.contributeTools([ASK_TOOL], fakeAskStart().start);

      await expect(connected.call('ask', {}, CONTEXT)).resolves.toBe(
        ASK_RESULT,
      );
      expect(logged.filter((line) => line.includes('endpoint files'))).toEqual([
        expect.stringContaining('endpoint files not written'),
      ]);
    } finally {
      await started.dispose?.();
      rmSync(homeDir, { recursive: true });
    }
  });

  it('stops with nothing live and starts again', async () => {
    const harness = startMainPart(sessionsMainPart);

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    await harness.restart();
    await harness.stop();
  });

  it('stop ends a session connected before it', async () => {
    const harness = startMainPart(sessionsMainPart);
    const view = harness
      .started()
      .exports?.(createRegistrations()) as SessionsMainExports;
    const connected = view.connect(hostInfo('host-1'));

    await harness.stop();

    expect(sessionEvents(harness).ended).toEqual([connected.session.id]);
  });

  it('stop_ToolSessionEndThrows_ClosesTheRelayAndThrows', async () => {
    const homeDir = mkdtempSync(path.join(os.tmpdir(), 'wr-'));
    const harness = startMainPart(sessionsMainPart, {
      services: { runMode: 'live', homeDir, platform },
    });
    const view = harness
      .started()
      .exports?.(createRegistrations()) as SessionsMainExports;
    view.contributeTools([ASK_TOOL], () => ({
      call: async () => ASK_RESULT,
      end: () => {
        throw new Error('end failed');
      },
    }));
    view.connect(hostInfo('host-1'));
    try {
      await expect(harness.stop()).rejects.toThrow('end failed');

      const socket = connectSocket(
        channelPath(
          platform.os,
          homeDir,
          platform.relay.username,
          HARNESS_APP_ID,
          '',
        ),
      );
      await expect(once(socket, 'connect')).rejects.toThrow();
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('stop_ConnectedThroughRelay_EndsOnce', async () => {
    // macOS caps a socket path near 104 bytes, so the folder name stays short.
    const homeDir = mkdtempSync(path.join(os.tmpdir(), 'wr-'));
    const harness = startMainPart(sessionsMainPart, {
      services: { runMode: 'live', homeDir, platform },
    });
    const socket = connectSocket(
      channelPath(
        platform.os,
        homeDir,
        platform.relay.username,
        HARNESS_APP_ID,
        '',
      ),
    );
    socket.on('error', () => undefined);
    try {
      await once(socket, 'connect');
      socket.write(`${JSON.stringify(RELAY_HELLO)}\n`);
      await once(createInterface({ input: socket }), 'line');

      await harness.stop();

      const { connected, ended } = sessionEvents(harness);
      expect(connected).toHaveLength(1);
      expect(ended).toEqual(connected);
      const endpoint: unknown = JSON.parse(
        readFileSync(
          path.join(homeDir, '.agents', HARNESS_APP_ID, 'endpoint.json'),
          'utf8',
        ),
      );
      expect(endpoint).toMatchObject({ launch: platform.relay.launch });
    } finally {
      socket.destroy();
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
