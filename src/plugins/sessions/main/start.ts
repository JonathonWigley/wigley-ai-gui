import os from 'node:os';
import path from 'node:path';
import type { Disposable } from '../../../contracts/disposable';
import type { DriveHost, MainApi, MainPart } from '../../../contracts/plugin';
import {
  type ConnectedSession,
  HARNESSES,
  type Harness,
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
  launchCommand,
  writeEndpointFiles,
} from './relay/endpoint';
import { startRelayServer } from './relay/relay-server';
import { createSessionList, type SessionList } from './session-list';

type SessionsApi = MainApi<
  typeof sessionsManifest,
  SessionsChannel,
  SessionsMainEvents
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
// served the tools contributed so far.
function openRelay(api: SessionsApi, list: SessionList) {
  const channel = channelPath(
    process.platform,
    api.services.homeDir,
    os.userInfo().username,
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
    launch: launchCommand(process.env, process.execPath, process.cwd()),
  };
  return { relay, endpoint };
}

// Connects a drive run's sessions as a relay would, each with no round, and
// ends or selects them. A session's id is `drive-session-<n>` unless the
// caller names one; `rowId` is the app's own id, which `activate` takes.
function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>,
): Disposable[] {
  const connected = new Map<string, ConnectedSession>();
  let defaultIds = 0;
  return [
    host.add('connect', {
      description:
        'Connects an agent session with no round, as a relay would, and adds its row.',
      args: '{ sessionId?: string, projectDir?: string | null, harness?: "claude" | "codex", deadlineSeconds?: number | null }',
      async run(args) {
        const {
          sessionId = `drive-session-${++defaultIds}`,
          projectDir = 'drive',
          harness = 'claude',
          deadlineSeconds = null,
        } = (args ?? {}) as {
          sessionId?: string;
          projectDir?: string | null;
          harness?: Harness;
          deadlineSeconds?: number | null;
        };
        if (!HARNESSES.includes(harness)) {
          throw new Error(
            `harness ${JSON.stringify(harness)} is none of ${HARNESSES.join(', ')}`,
          );
        }
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
      async run(args) {
        const { sessionId } = args as { sessionId: string };
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
      async run(args) {
        const { rowId } = args as { rowId: string };
        sessions.activate(rowId);
        return { rowId };
      },
    }),
  ];
}

// Owns agent sessions: the relay they connect through, the tools other plugins
// contribute for them, and their sidebar rows. Each contribution rewrites the
// endpoint files, so a relay that starts the app finds every tool listed. In
// the self-test it opens no relay and writes no file; a drive run opens it in
// its temp home and gets the drive actions.
export const sessionsMainPart: MainPart<typeof sessionsManifest> = {
  manifest: sessionsManifest,
  start(api: SessionsApi) {
    const list = createList(api);
    const opened =
      api.services.runMode === 'selfTest' ? null : openRelay(api, list);
    const endpointDir = path.join(
      api.services.homeDir,
      '.agents',
      'wigley-ai-gui',
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
      api.drive !== null ? addDriveActions(api.drive, exports) : [];
    return {
      commands: {},
      exports,
      dispose: () => {
        for (const action of driveActions) {
          action.dispose();
        }
        opened?.relay.close();
      },
    };
  },
};
