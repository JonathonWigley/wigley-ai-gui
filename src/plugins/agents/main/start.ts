import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { CHAT_PREVIEW_HOST_ID, type ChatMainEvents } from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import type { AgentsChannel, Roster } from '../contract';
import { agentsManifest } from '../manifest';
import { foldAgentEvent } from '../roster';
import { createAgentLog } from './agent-log';
import { createAgentsPreview } from './preview';

type AgentsApi = MainApi<
  typeof agentsManifest,
  AgentsChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

const NONE: Roster = { agents: [], tasks: [] };

// A row's roster as the page sees it: each host session id's subagents, and
// each one's tasks, in the order each host id's roster began.
function rowRoster(hosts: ReadonlyMap<string, Roster>): Roster {
  const rosters = [...hosts.values()];
  return {
    agents: rosters.flatMap((roster) => roster.agents),
    tasks: rosters.flatMap((roster) => roster.tasks),
  };
}

// Hears chat's agent events: logs each in plugin data (all but the chat
// layout preview's sample events) and folds it into the roster of its
// process's host session id, a `userMessage` into every host id's roster of
// its row, sending the page each row's roster that changed:
// every host id's subagents and tasks in the row, each list in fold order. A
// host id's roster is dropped once its last item ends done or a message drops
// its last failed one, and a row's rosters when it closes or ends. Holds agents' sample session,
// whose roster `rosters` lists beside the live ones; a stop sends an open
// preview's roster empty. Registers no layout and hands the self-test no script:
// agent-lines and agent-strip draw the rosters.
export const agentsMainPart: MainPart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
    const sessions = api.dependency(sessionsMainKey);
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
    // old process ending under the same row, so its `sessionEnded` must end
    // only its own subagents and tasks.
    const rosters = new Map<string, Map<string, Roster>>();

    api.events.on('chat.agentEvent', ({ sessionId, hostSessionId, event }) => {
      if (hostSessionId !== CHAT_PREVIEW_HOST_ID) {
        void agentLog.append(hostSessionId, event);
      }
      const hosts = rosters.get(sessionId) ?? new Map<string, Roster>();
      // A message drops every host's finished items: after a clear only the
      // new process sends one, and the old one's must go too.
      const foldedHosts =
        event.type === 'userMessage' ? [...hosts.keys()] : [hostSessionId];
      let changed = false;
      for (const host of foldedHosts) {
        const before = hosts.get(host) ?? NONE;
        const after = foldAgentEvent(before, event);
        if (after === before) {
          continue;
        }
        changed = true;
        if (after.agents.length === 0 && after.tasks.length === 0) {
          hosts.delete(host);
        } else {
          hosts.set(host, after);
        }
      }
      if (!changed) {
        return;
      }
      if (hosts.size === 0) {
        rosters.delete(sessionId);
      } else {
        rosters.set(sessionId, hosts);
      }
      api.channel.send('rosterChanged', {
        sessionId,
        roster: rowRoster(hosts),
      });
    });

    const dropRoster = ({ sessionId }: { sessionId: string }) => {
      if (rosters.delete(sessionId)) {
        api.channel.send('rosterChanged', {
          sessionId,
          roster: { agents: [], tasks: [] },
        });
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

    return { commands: {}, dispose: () => preview.close() };
  },
};
