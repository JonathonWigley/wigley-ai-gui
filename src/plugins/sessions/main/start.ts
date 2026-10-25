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
import {
  type ConnectedSession,
  DRIVE_SESSION_DEFAULTS,
  HARNESSES,
  RELAY_PROTOCOL,
  type RelayEndpoint,
  type SessionsChannel,
  type SessionsMainEvents,
  type SessionsMainExports,
} from '../contract';
import { sessionsManifest } from '../manifest';
import { serveMcp } from './mcp/mcp-server';
import {
  channelPath,
  endedDriveRunLaunch,
  launchCommand,
  writeEndpointFiles,
} from './relay/endpoint';
import { startRelayServer } from './relay/relay-server';
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

// Connects a drive run's sessions as a relay would, each with no round, and
// ends or selects them. A session's id is `drive-session-<n>` unless the
// caller names one; `rowId` is the app's own id, which `activate` takes. A
// session that ends leaves the map, so its id connects again.
// `onSessionEnded` hears each session that ends, by its row id. Disposing
// removes the actions and ends every session still connected.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>,
  onSessionEnded: (listener: (rowId: string) => void) => void,
): Disposable {
  const connected = new Map<string, ConnectedSession>();
  let defaultIds = 0;
  onSessionEnded((rowId) => {
    for (const [sessionId, session] of connected) {
      if (session.session.id === rowId) {
        connected.delete(sessionId);
      }
    }
  });
  const actions = [
    host.add('connect', {
      description:
        'Connects an agent session with no round, as a relay would, and adds its row.',
      args: '{ sessionId?: string, projectDir?: string | null, harness?: "claude" | "codex", deadlineSeconds?: number | null }',
      async run(rawArgs) {
        const args = argsObject(rawArgs);
        const sessionId =
          optionalString(args, 'sessionId') ?? `drive-session-${++defaultIds}`;
        const projectDir = nullableStringOr(
          args,
          'projectDir',
          DRIVE_SESSION_DEFAULTS.projectDir,
        );
        const harness =
          optionalOneOf(args, 'harness', HARNESSES) ??
          DRIVE_SESSION_DEFAULTS.harness;
        const deadlineSeconds = nullableNumberOr(
          args,
          'deadlineSeconds',
          DRIVE_SESSION_DEFAULTS.deadlineSeconds,
        );
        if (connected.has(sessionId)) {
          throw new Error(`session ${sessionId} is already connected`);
        }
        const session = sessions.connect({
          sessionId,
          projectDir,
          deadlineSeconds,
          harness,
        });
        connected.set(sessionId, session);
        return { sessionId, rowId: session.session.id };
      },
    }),
    host.add('end', {
      description: 'Ends a session sessions.connect connected.',
      args: '{ sessionId: string }',
      async run(rawArgs) {
        const sessionId = requiredString(argsObject(rawArgs), 'sessionId');
        const session = connected.get(sessionId);
        if (session === undefined) {
          throw new Error(`no session ${sessionId} from sessions.connect`);
        }
        connected.delete(sessionId);
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
      for (const session of connected.values()) {
        session.end();
      }
      connected.clear();
    },
  };
}

// Owns agent sessions: the relay they connect through, the tools other plugins
// contribute for them, and their sidebar rows. Each contribution rewrites the
// endpoint files, so a relay that starts the app finds every tool listed. In
// the self-test it opens no relay and writes no file; a drive run opens it in
// the run's own home and gets the drive actions.
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
      open: (info) => list.open(info),
      mark: (sessionId) => list.mark(sessionId),
      activate: (sessionId) => list.activate(sessionId),
      selectedSessionId: () => list.selectedSessionId(),
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
    return {
      commands: {},
      exports,
      dispose: () => {
        driveActions?.dispose();
        opened?.relay.close();
      },
    };
  },
};
