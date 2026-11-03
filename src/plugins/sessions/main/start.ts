import os from 'node:os';
import type { Disposable } from '../../../contracts/disposable';
import type {
  DriveHost,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { appEndpointDir } from '../../../shared/app-endpoint-dir';
import {
  argsObject,
  nullableNumberOr,
  nullableStringOr,
  optionalOneOf,
  optionalString,
  requiredString,
} from '../../../shared/drive-args';
import type { JsonObject } from '../../../shared/json';
import {
  DRIVE_SESSION_DEFAULTS,
  type OwnedSession,
  RELAY_PROTOCOL,
  type RelayEndpoint,
  type SessionInfo,
  type SessionsChannel,
  type SessionsMainEvents,
  type SessionsMainExports,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { sessionsManifest } from '../manifest';
import { serveMcp } from './mcp/mcp-server';
import {
  channelPath,
  endedDriveRunLaunch,
  launchCommand,
  writeEndpointFiles,
} from './relay/endpoint';
import { startRelayServer } from './relay/relay-server';
import { sessionsSelfTestScript } from './selftest-script';
import { createSessionList, type SessionList } from './session-list';

type SessionsApi = MainApi<
  typeof sessionsManifest,
  SessionsChannel,
  SessionsMainEvents,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

function createList(api: SessionsApi): SessionList {
  const list = createSessionList({
    randomHex: api.services.randomHex,
    clock: api.services.clock,
    log: api.services.log,
    emit: (event, data) => api.events.emit(event, data),
    stateChanged: (state) => api.channel.send('stateChanged', state),
    activated: (sessionId) => api.channel.send('activated', { sessionId }),
  });
  api.channel.handle('state', () => list.state());
  api.channel.handle('activate', (sessionId) => list.activate(sessionId));
  api.channel.handle('closeSession', (sessionId) =>
    list.closeSession(sessionId),
  );
  return list;
}

// Opens the channel relay.py connects to, each relay connecting one session
// served the tools contributed so far. A relay that finds the app gone starts
// it again, except a drive run's, which stays ended and names the run's home.
function openRelay(api: SessionsApi, list: SessionList) {
  const channel = channelPath(
    process.platform,
    api.services.homeDir,
    os.userInfo().username,
    api.services.appInstance.id,
  );
  const relay = startRelayServer({
    channel,
    connect: (info) => list.connect(info),
    serve: (streams, session) => serveMcp(streams, session, list.tools()),
    log: api.services.log,
  });
  const endpoint: RelayEndpoint = {
    protocol: RELAY_PROTOCOL,
    channel,
    launch:
      api.services.runMode === 'drive'
        ? endedDriveRunLaunch(process.platform, api.services.homeDir)
        : launchCommand(
            process.env,
            process.execPath,
            process.cwd(),
            api.services.appInstance.isDev,
          ),
  };
  return { relay, endpoint };
}

// A drive action's session info: the args' fields, each the fixture default
// when left out, under `sessionId`.
function driveSessionInfo(args: JsonObject, sessionId: string): SessionInfo {
  return {
    sessionId,
    projectDir: nullableStringOr(
      args,
      'projectDir',
      DRIVE_SESSION_DEFAULTS.projectDir,
    ),
    deadlineSeconds: nullableNumberOr(
      args,
      'deadlineSeconds',
      DRIVE_SESSION_DEFAULTS.deadlineSeconds,
    ),
    harness:
      optionalOneOf(args, 'harness', DRIVE_SESSION_DEFAULTS.harnesses) ??
      DRIVE_SESSION_DEFAULTS.harness,
  };
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
// Disposing removes the actions and ends every session still started.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect' | 'open' | 'activate'>,
  onSessionEnded: (listener: (rowId: string) => void) => void,
): Disposable {
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
    '{ sessionId?: string, projectDir?: string | null, harness?: "claude" | "codex", deadlineSeconds?: number | null }';
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
  const actions = [
    host.add('connect', {
      description:
        'Connects an agent session with no form, as a relay would; it gets no row until a form shows.',
      args: sessionArgs,
      run: async (rawArgs) =>
        startSession(rawArgs, (info) => sessions.connect(info)),
    }),
    host.add('open', {
      description:
        'Opens an owned agent session with no form and selects its row; forms.openRound and primer.openPrimer join it under its sessionId, so a round and a primer share the row.',
      args: sessionArgs,
      run: async (rawArgs) =>
        startSession(rawArgs, (info) => sessions.open(info)),
    }),
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
    }),
    host.add('activate', {
      description: "Selects a session's row and shows it.",
      args: '{ rowId: string }',
      async run(rawArgs) {
        const rowId = requiredString(argsObject(rawArgs), 'rowId');
        sessions.activate(rowId);
        return { rowId };
      },
    }),
  ];
  return {
    dispose() {
      for (const action of actions) {
        action.dispose();
      }
      for (const session of started.values()) {
        session.end();
      }
      started.clear();
    },
  };
}

// Owns agent sessions: the relay they connect through, the tools other
// plugins contribute for them, their sidebar rows, and the sessions layouts.
// Each contribution rewrites the endpoint files, so a relay that starts the
// app finds every tool listed. In the self-test it opens no relay and writes
// no file, and hands its pane keys' script; a drive run opens it in the run's
// own home and gets the drive actions.
export const sessionsMainPart: MainPart<typeof sessionsManifest> = {
  manifest: sessionsManifest,
  start(api: SessionsApi) {
    const list = createList(api);
    const opened =
      api.services.runMode === 'selfTest' ? null : openRelay(api, list);
    const endpointDir = appEndpointDir(
      api.services.paths,
      api.services.homeDir,
      api.services.appInstance.id,
    );
    const exports: SessionsMainExports = {
      contributeTools(tools, start) {
        list.contributeTools(tools, start);
        if (opened !== null) {
          writeEndpointFiles(endpointDir, opened.endpoint, list.tools());
        }
      },
      connect: (info) => list.connect(info),
      open: (info, options) => list.open(info, options),
      mark: (sessionId) => list.mark(sessionId),
      activate: (sessionId) => list.activate(sessionId),
      activateExistingRow: (sessionId) => list.activateExistingRow(sessionId),
      release: (sessionId) => list.release(sessionId),
      selectedSessionId: () => list.selectedSessionId(),
      label: (sessionId) => list.label(sessionId),
      addCloseGuard: (mayClose) => list.addCloseGuard(mayClose),
    };
    const driveActions =
      api.drive !== null
        ? addDriveActions(api.drive, exports, (listener) =>
            api.events.on('sessions.ended', ({ sessionId }) =>
              listener(sessionId),
            ),
          )
        : null;
    const layouts = api.layouts.register({ layoutTypes });
    api.services.selfTest?.run(
      sessionsSelfTestScript(exports, () => list.state()),
    );
    return {
      commands: {},
      exports,
      dispose: () => {
        layouts.dispose();
        driveActions?.dispose();
        opened?.relay.close();
      },
    };
  },
};
