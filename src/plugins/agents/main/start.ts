import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { CHAT_PREVIEW_HOST_ID, type ChatMainEvents } from '../../chat/contract';
import type {
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import type { AgentsChannel, Roster } from '../contract';
import { agentsManifest } from '../manifest';
import { foldAgentEvent, isSameSkillRow } from '../roster';
import { createAgentLog } from './agent-log';
import { createAgentsPreview } from './preview';

type AgentsApi = MainApi<
  typeof agentsManifest,
  AgentsChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

const NONE: Roster = { agents: [], tasks: [], skills: [] };

// A row's roster as the page sees it: each host session id's running subagents,
// running tasks and skills, in the order each host id's roster began, a skill
// row two hosts share kept once, at its first place.
function rowRoster(hosts: ReadonlyMap<string, Roster>): Roster {
  const rosters = [...hosts.values()];
  const skills = rosters.flatMap((roster) => roster.skills);
  return {
    agents: rosters.flatMap((roster) => roster.agents),
    tasks: rosters.flatMap((roster) => roster.tasks),
    skills: skills.filter(
      (row, index) =>
        skills.findIndex((other) => isSameSkillRow(other, row)) === index,
    ),
  };
}

// Hears chat's agent events: logs each in plugin data (all but replayed events
// and the chat layout preview's sample events) and folds it, replayed or not,
// into the roster of its process's host session id, sending the page each row's
// roster that changed: every host id's subagents, tasks and skills in the row,
// each list in fold order. A host id's roster is dropped once it lists no agent,
// task or skill, and a row's rosters when it closes or ends. Holds agents' sample
// session, whose roster `rosters` lists beside the live ones. Registers no layout
// and hands the self-test no script: agent-lines, agent-strip and agent-skills
// draw the rosters.
export const agentsMainPart: MainPart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
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
    // old process ending under the same row, so its `sessionEnded` must end
    // only its own subagents and tasks; its skills stay listed until the row
    // ends. An app restart empties the map, and the replayed log of the process
    // that re-attaches lists that process's skills again.
    const rosters = new Map<string, Map<string, Roster>>();

    api.events.on(
      'chat.agentEvent',
      ({ sessionId, hostSessionId, event, replayed }) => {
        const isPreviewHost = hostSessionId === CHAT_PREVIEW_HOST_ID;
        if (!replayed && !isPreviewHost) {
          void agentLog.append(hostSessionId, event);
        }
        const hosts = rosters.get(sessionId) ?? new Map<string, Roster>();
        const before = hosts.get(hostSessionId) ?? NONE;
        const after = foldAgentEvent(before, event);
        if (after === before) {
          return;
        }
        const listsNothing =
          after.agents.length === 0 &&
          after.tasks.length === 0 &&
          after.skills.length === 0;
        if (listsNothing) {
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
          roster: rowRoster(hosts),
        });
      },
    );

    const dropRoster = ({ sessionId }: { sessionId: string }) => {
      if (rosters.delete(sessionId)) {
        api.channel.send('rosterChanged', {
          sessionId,
          roster: { agents: [], tasks: [], skills: [] },
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

    return { commands: {} };
  },
};
