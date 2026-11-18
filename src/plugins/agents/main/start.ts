import { DEMO_HARNESS_ID } from '../../../contracts/demo';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { CHAT_PREVIEW_HOST_ID, type ChatMainEvents } from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
  sessionsRowsSlot,
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
import { registerDemoSteps } from './demo-steps';
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

// Hears chat's agent events: logs each in plugin data (all but replayed events,
// the chat layout preview's sample events, a demo session's events, its row's
// harness `demo` seen once at any event, and context breakdowns, each several
// KB after every turn, which context-sources keeps the last of) and folds it, replayed or not,
// into the roster of its process's host session id, writing `agents.rosters` for
// each row whose roster changed: every host id's subagents, tasks and skills in
// the row, each list in fold order. A row the roster demo step holds keeps its
// sample roster in the slot until the hold's dispose. A host id's roster is dropped once it lists no
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
    // The rows whose `agents.rosters` key a demo step holds at its sample.
    const heldSamples = new Set<string>();
    const sessionRows = api.state.read(sessionsRowsSlot);
    // Every demo session an event came from, kept for the part's life: a user
    // close removes the row before the process's last events arrive.
    const demoSessionIds = new Set<string>();
    registerDemoSteps(api.services, {
      clock: api.services.clock,
      rosters: rowRosters,
      holdSample(sessionId) {
        heldSamples.add(sessionId);
        return { dispose: () => heldSamples.delete(sessionId) };
      },
    });

    api.events.on(
      'chat.agentEvent',
      ({ sessionId, hostSessionId, event, replayed }) => {
        if (sessionRows.get(sessionId)?.harness === DEMO_HARNESS_ID) {
          demoSessionIds.add(sessionId);
        }
        const isPreviewHost = hostSessionId === CHAT_PREVIEW_HOST_ID;
        const isDemoSession = demoSessionIds.has(sessionId);
        const isBreakdown = event.type === 'contextBreakdown';
        if (!replayed && !isPreviewHost && !isDemoSession && !isBreakdown) {
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
        const isHeld = heldSamples.has(sessionId);
        if (hosts.size === 0) {
          rosters.delete(sessionId);
          if (!isHeld) {
            rowRosters.delete(sessionId);
          }
        } else {
          rosters.set(sessionId, hosts);
          if (!isHeld) {
            rowRosters.set(sessionId, rowRoster(hosts));
          }
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
