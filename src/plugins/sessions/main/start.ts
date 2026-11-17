import type {
  DriveHost,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { appEndpointDir } from '../../../shared/app-endpoint-dir';
import { createOriginRepoNames } from '../../../shared/origin-repo-names';
import {
  argsObject,
  nullableStringOr,
  optionalOneOf,
  optionalString,
  requiredString,
} from '../../../shared/drive-args';
import { isJsonObject, type JsonObject } from '../../../shared/json';
import { channelPath } from '../../../shared/local-channel/channel-path';
import {
  DRIVE_SESSION_DEFAULTS,
  type OwnedSession,
  RELAY_PROTOCOL,
  type RelayEndpoint,
  type SessionInfo,
  type SessionsChannel,
  type SessionsMainEvents,
  type SessionsMainExports,
  sessionsRowsSlot,
  sessionsSelectionSlot,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { sessionsManifest } from '../manifest';
import { titleLimit } from '../session-title';
import { sessionsMainView } from './consumer-view';
import { serveMcp } from './mcp/mcp-server';
import {
  OFFLINE_CALLS_FOLDER,
  OFFLINE_ENV,
  replayOfflineCalls,
} from './offline-calls';
import { createEndpointWriter, endedDriveRunLaunch } from './relay/endpoint';
import { type ConnectHold, createConnectHold } from './relay/connect-hold';
import { startRelayServer } from './relay/relay-server';
import { sessionsSelfTestScript } from './selftest-script';
import { createSessionList, type SessionList } from './session-list';
import { SET_SESSION_TITLE_TOOL, startTitleTool } from './title-tool';

type SessionsApi = MainApi<
  typeof sessionsManifest,
  SessionsChannel,
  SessionsMainEvents,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// The name the session's harness shows for it; null when the app runs no such
// harness or the session does not say which saved session it is.
async function hostSessionName(
  api: SessionsApi,
  info: SessionInfo,
): Promise<string | null> {
  const { sessionId, projectDir } = info;
  const harness = api.services.agentHarnesses.find(
    (candidate) => candidate.id === info.harness,
  );
  if (harness === undefined || sessionId === null || projectDir === null) {
    return null;
  }
  return harness.sessionName(sessionId, projectDir, info.profileDir ?? null);
}

// The session's config folder as its harness resolves it; null when the app
// runs no such harness.
function configFolder(api: SessionsApi, info: SessionInfo): string | null {
  const harness = api.services.agentHarnesses.find(
    (candidate) => candidate.id === info.harness,
  );
  return harness?.configFolder(info.profileDir ?? null) ?? null;
}

function createList(api: SessionsApi): SessionList {
  const list = createSessionList({
    randomHex: api.services.randomHex,
    clock: api.services.clock,
    timers: api.services.timers,
    log: api.services.log,
    emit: (event, data) => api.events.emit(event, data),
    rows: api.state.publish(sessionsRowsSlot),
    selection: api.state.publish(sessionsSelectionSlot),
    activated: (sessionId) => api.channel.send('activated', { sessionId }),
    projectName: createOriginRepoNames(api.services.git),
    hostSessionName: (info) => hostSessionName(api, info),
    configFolder: (info) => configFolder(api, info),
  });
  api.channel.handle('activate', (sessionId) => list.activate(sessionId));
  api.channel.handle('closeSession', (sessionId, atOnce) =>
    list.closeSession(sessionId, atOnce),
  );
  api.channel.handle('setUserTitle', (sessionId, title) =>
    list.setUserTitle(
      sessionId,
      title,
      titleLimit(api.settings().titleMaxLength),
    ),
  );
  return list;
}

// Opens the channel relay.py connects to, each relay connecting one session
// served the live tool list. A relay that finds the app gone starts
// it again, except a drive run's, which stays ended and names the run's home.
function openRelay(api: SessionsApi, list: SessionList, hold: ConnectHold) {
  const channel = channelPath(
    api.services.platform.os,
    api.services.homeDir,
    api.services.platform.relay.username,
    api.services.appInstance.id,
    '',
  );
  const relay = startRelayServer({
    channel,
    ready: () => hold.ready(),
    connect: (info) => list.connect(info),
    serve: (streams, session) => serveMcp(streams, session, list),
    log: api.services.log,
  });
  const endpoint: RelayEndpoint = {
    protocol: RELAY_PROTOCOL,
    channel,
    launch:
      api.services.runMode === 'drive'
        ? endedDriveRunLaunch(api.services.platform.os, api.services.homeDir)
        : api.services.platform.relay.launch,
    pid: api.services.platform.relay.pid,
  };
  return { relay, endpoint };
}

// A drive action's session info: the args' fields, each the fixture default
// when left out, under `sessionId`; `host` is the relay hello's host fields,
// absent when left out.
function driveSessionInfo(args: JsonObject, sessionId: string): SessionInfo {
  const info: SessionInfo = {
    sessionId,
    projectDir: nullableStringOr(
      args,
      'projectDir',
      DRIVE_SESSION_DEFAULTS.projectDir,
    ),
    harness:
      optionalOneOf(args, 'harness', DRIVE_SESSION_DEFAULTS.harnesses) ??
      DRIVE_SESSION_DEFAULTS.harness,
  };
  const { host } = args;
  if (host === undefined) {
    return info;
  }
  if (!isJsonObject(host)) {
    throw new Error('host must be an object');
  }
  return { ...info, host };
}

// What the drive keeps of a session it connected or opened.
type StartedSession = Pick<OwnedSession, 'session' | 'end'>;

// Starts a drive run's sessions, each with no form, and ends or selects them:
// `connect` connects one as a relay would, with no row until a form shows or
// `activate` adds it; `open` opens an owned one, selected, which forms' and
// the primer's open actions join when they name its id, so a round and a
// primer share its row. A session's id is
// `drive-session-<n>` unless the caller names one; `rowId` is the app's own
// id, which `activate` takes. A session that ends leaves the map, so its id
// starts again. `onSessionEnded` hears each session that ends, by its row id.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect' | 'open' | 'activate'>,
  onSessionEnded: (listener: (rowId: string) => void) => void,
): void {
  const started = new Map<string, StartedSession>();
  let defaultIds = 0;
  onSessionEnded((rowId) => {
    for (const [sessionId, session] of started) {
      if (session.session.id === rowId) {
        started.delete(sessionId);
      }
    }
  });
  const sessionArgs =
    '{ sessionId?: string, projectDir?: string | null, harness?: "claude" | "codex", host?: object }';
  // Reads the args, then starts the session `start` makes from them.
  const startSession = (
    rawArgs: unknown,
    start: (info: SessionInfo) => StartedSession,
  ) => {
    const args = argsObject(rawArgs);
    const sessionId =
      optionalString(args, 'sessionId') ?? `drive-session-${++defaultIds}`;
    const info = driveSessionInfo(args, sessionId);
    if (started.has(sessionId)) {
      throw new Error(`session ${sessionId} is already started`);
    }
    const session = start(info);
    started.set(sessionId, session);
    return { sessionId, rowId: session.session.id };
  };
  host.add('connect', {
    description:
      'Connects an agent session with no form, as a relay would; it gets no row until a form shows.',
    args: sessionArgs,
    run: async (rawArgs) =>
      startSession(rawArgs, (info) => sessions.connect(info)),
  });
  host.add('open', {
    description:
      'Opens an owned agent session with no form and selects its row; forms.openRound and primer.openPrimer join it under its sessionId, so a round and a primer share the row.',
    args: sessionArgs,
    run: async (rawArgs) =>
      startSession(rawArgs, (info) => sessions.open(info)),
  });
  host.add('end', {
    description: 'Ends a session sessions.connect or sessions.open started.',
    args: '{ sessionId: string }',
    async run(rawArgs) {
      const sessionId = requiredString(argsObject(rawArgs), 'sessionId');
      const session = started.get(sessionId);
      if (session === undefined) {
        throw new Error(
          `no session ${sessionId} from sessions.connect or sessions.open`,
        );
      }
      started.delete(sessionId);
      session.end();
      return { sessionId };
    },
  });
  host.add('activate', {
    description: "Selects a session's row and shows it.",
    args: '{ rowId: string }',
    async run(rawArgs) {
      const rowId = requiredString(argsObject(rawArgs), 'rowId');
      sessions.activate(rowId);
      return { rowId };
    },
  });
}

// Owns agent sessions: the relay they connect through, the tools other
// plugins contribute for them and its own `set_session_title`, their sidebar
// rows and the project each row groups under, from the namers other plugins
// register, and the sessions layouts.
// A contribution reaches every live session, and each one added queues a
// rewrite of the endpoint files, the offline table among them, so a relay that
// starts the app, or answers while it is closed, finds every tool listed. A
// disposal and a stop leave the files, which a relay serves while the app is
// away; a stop waits for the queued writes. A failed write is logged and keeps
// the contribution. `replayCalls` routes a calls file the relay wrote while the
// app was closed through the session list's normal call path. Each dependent gets
// its own view of the exports, which files its registrations under it. In the
// self-test it opens no relay and writes
// no file, and hands its pane keys' script; a drive run opens it in the run's
// own home and gets the drive actions. A stop ends every session, then closes
// the relay, which finds nothing left to end, even when an end threw.
export const sessionsMainPart: MainPart<typeof sessionsManifest> = {
  manifest: sessionsManifest,
  start(api: SessionsApi) {
    const list = createList(api);
    const hold = createConnectHold(api.services.timers, api.services.log);
    const opened =
      api.services.runMode === 'selfTest' ? null : openRelay(api, list, hold);
    const { files, paths, log } = api.services;
    const endpointDir = appEndpointDir(
      paths,
      api.services.homeDir,
      api.services.appInstance.id,
    );
    const offlineCallsFolder = paths.join(endpointDir, OFFLINE_CALLS_FOLDER);
    const endpointWriter = createEndpointWriter(files, paths, endpointDir, log);
    const exports: SessionsMainExports = {
      contributeTools(tools, start, options) {
        const contribution = list.contributeTools(tools, start, options);
        if (opened !== null) {
          endpointWriter.write(
            opened.endpoint,
            list.tools(),
            list.offlineTable(),
          );
        }
        return contribution;
      },
      connect: (info) => list.connect(info),
      open: (info, options) => list.open(info, options),
      mark: (sessionId, options) => list.mark(sessionId, options),
      activate: (sessionId) => list.activate(sessionId),
      release: (sessionId) => list.release(sessionId),
      label: (sessionId) => list.label(sessionId),
      addCloseGuard: (mayClose, cancelHold) =>
        list.addCloseGuard(mayClose, cancelHold),
      addToolCallGuard: (guard) => list.addToolCallGuard(guard),
      setTitle: (sessionId, source, title) =>
        list.setTitle(sessionId, source, title),
      titles: (sessionId) => list.titles(sessionId),
      addProjectNamer: (namer) => list.addProjectNamer(namer),
      holdConnects: (until) => hold.hold(until),
      offlineEnv: (): Readonly<Record<string, string>> =>
        opened === null ? {} : { [OFFLINE_ENV]: offlineCallsFolder },
      replayCalls: (hostSessionId) =>
        replayOfflineCalls(
          {
            files,
            paths,
            folder: offlineCallsFolder,
            route: (call) => list.replayCall(hostSessionId, call),
            log,
          },
          hostSessionId,
        ),
    };
    exports.contributeTools(
      [SET_SESSION_TITLE_TOOL],
      startTitleTool({
        setTitle: exports.setTitle,
        titles: exports.titles,
        maxLength: () => titleLimit(api.settings().titleMaxLength),
      }),
      { mainAgentOnly: true },
    );
    if (api.drive !== null) {
      addDriveActions(api.drive, exports, (listener) =>
        api.events.on('sessions.ended', ({ sessionId }) => listener(sessionId)),
      );
    }
    api.layouts.register({ layoutTypes });
    api.services.selfTest?.run(
      sessionsSelfTestScript(exports, () => list.state()),
    );
    return {
      commands: {},
      exports: (consumer) => sessionsMainView(exports, consumer),
      dispose: async () => {
        list.stop();
        try {
          list.endAll();
        } finally {
          await opened?.relay.close();
          await endpointWriter.flushed();
        }
      },
    };
  },
};
