import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { ChatMainEvents, ChatMainExports } from '../../chat/contract';
import type {
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import type { AgentsChannel, RunningAgent } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentsManifest } from '../manifest';
import { foldAgentEvent } from '../roster';
import { createAgentLog } from './agent-log';
import { createAgentsPreview } from './preview';
import { agentsSelfTestScript } from './selftest-script';

type AgentsApi = MainApi<
  typeof agentsManifest,
  AgentsChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

const NONE: readonly RunningAgent[] = [];

// A row's roster as the page sees it: each host session id's subagents, in
// the order each host id's roster began.
function rowRoster(
  hosts: ReadonlyMap<string, readonly RunningAgent[]>,
): RunningAgent[] {
  return [...hosts.values()].flat();
}

// Hears chat's agent events: logs each in plugin data and folds it into the
// roster of its process's host session id, sending the page each row's roster
// that changed: every host id's subagents in the row, in fold order. A row's
// rosters are dropped when it closes or ends. Registers the agents layouts,
// and holds the layout preview, whose roster `rosters` lists beside the live
// ones, and hands the self-test its script.
export const agentsMainPart: MainPart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
    const layouts = api.layouts.register({ layoutTypes });
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const preview = createAgentsPreview({
      sessions,
      clock: api.services.clock,
      send: (message, data) => api.channel.send(message, data),
      log: api.services.log,
    });
    const agentLog = createAgentLog({
      files: api.data,
      log: api.services.log,
    });
    // Row id → host session id → that process's roster. A clear leaves the
    // old process ending under the same row, so its `sessionEnded` must drop
    // only its own subagents.
    const rosters = new Map<string, Map<string, readonly RunningAgent[]>>();

    api.events.on('chat.agentEvent', ({ sessionId, hostSessionId, event }) => {
      void agentLog.append(hostSessionId, event);
      const hosts = rosters.get(sessionId) ?? new Map();
      const before = hosts.get(hostSessionId) ?? NONE;
      const after = foldAgentEvent(before, event);
      if (after === before) {
        return;
      }
      if (after.length === 0) {
        hosts.delete(hostSessionId);
      } else {
        hosts.set(hostSessionId, after);
      }
      if (hosts.size === 0) {
        rosters.delete(sessionId);
      } else {
        rosters.set(sessionId, hosts);
      }
      api.channel.send('rosterChanged', {
        sessionId,
        running: rowRoster(hosts),
      });
    });

    const dropRoster = ({ sessionId }: { sessionId: string }) => {
      if (rosters.delete(sessionId)) {
        api.channel.send('rosterChanged', { sessionId, running: [] });
      }
    };
    api.events.on('sessions.closed', (closed) => {
      dropRoster(closed);
      preview.closed(closed.sessionId);
    });
    api.events.on('sessions.ended', dropRoster);

    api.channel.handle('rosters', () => ({
      ...Object.fromEntries(
        [...rosters].map(([sessionId, hosts]) => [sessionId, rowRoster(hosts)]),
      ),
      ...preview.rosters(),
    }));
    api.channel.handle('openPreview', () => preview.toggle());

    api.services.selfTest?.run(
      agentsSelfTestScript({
        homeDir: api.services.homeDir,
        files: api.services.files,
        paths: api.services.paths,
        chat: api.dependency<ChatMainExports>('chat'),
        sessions,
      }),
    );

    return { commands: {}, dispose: () => layouts.dispose() };
  },
};
