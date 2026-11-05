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
import {
  type AgentsChannel,
  agentsRostersSlot,
  EMPTY_ROSTER,
  type Roster,
} from '../contract';
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

// A row's roster as its slot holds it: each host session id's running subagents,
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
// into the roster of its process's host session id, writing `agents.rosters` for
// each row whose roster changed: every host id's subagents, tasks and skills in
// the row, each list in fold order. A host id's roster is dropped once it lists no
// agent, task or skill, and a row's rosters and its key when it closes or ends.
// Holds agents' sample session, whose roster sits in the slot beside the live
// ones; a stop deletes an open preview's key. A start deletes every key an earlier
// stop left, since the rosters that key was folded from are gone. Registers no
// layout and hands the self-test no script:
// agent-lines, agent-strip and agent-skills draw the rosters.
export const agentsMainPart: MainPart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
    const sessions = api.dependency(sessionsMainKey);
    const rowRosters = api.state.publish(agentsRostersSlot);
    for (const sessionId of rowRosters.all().keys()) {
      rowRosters.delete(sessionId);
    }
    const preview = createAgentsPreview({
      sessions,
      clock: api.services.clock,
      rosters: rowRosters,
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
        const before = hosts.get(hostSessionId) ?? EMPTY_ROSTER;
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
          rowRosters.delete(sessionId);
        } else {
          rosters.set(sessionId, hosts);
          rowRosters.set(sessionId, rowRoster(hosts));
        }
      },
    );

    const dropRoster = ({ sessionId }: { sessionId: string }) => {
      rosters.delete(sessionId);
      rowRosters.delete(sessionId);
    };
    api.events.on('sessions.closed', (closed) => {
      dropRoster(closed);
      preview.closed(closed.sessionId);
    });
    api.events.on('sessions.ended', dropRoster);

    api.channel.handle('openPreview', () => preview.toggle());

    return { commands: {}, dispose: () => preview.close() };
  },
};
