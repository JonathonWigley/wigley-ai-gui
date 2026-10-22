import os from 'node:os';
import path from 'node:path';
import type { MainApi, MainPart } from '../../../contracts/plugin';
import {
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

// Owns agent sessions: the relay they connect through, the tools other plugins
// contribute for them, and their sidebar rows. Each contribution rewrites the
// endpoint files, so a relay that starts the app finds every tool listed. In
// the self-test it opens no relay and writes no file; a drive run opens it in
// its temp home.
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
    return {
      commands: {},
      exports,
      dispose: () => opened?.relay.close(),
    };
  },
};
