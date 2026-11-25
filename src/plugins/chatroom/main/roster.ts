import {
  type AgentSession,
  editableTitle,
  type SessionsMainExports,
} from '../../sessions/contract';
import type { Participant } from '../contract';
import type { RoomMember } from './room-service';

// A live session in the roster. `rowId` is the app's id for the session
// (`AgentSession.id`), with or without a sessions row; `harness` the harness
// id; `hostSessionId` the host's session id, null until the harness reports
// one.
export interface RosterSession {
  readonly rowId: string;
  readonly harness: string | null;
  readonly folder: string | null;
  readonly hostSessionId: string | null;
}

export interface RosterDeps {
  readonly sessions: Pick<SessionsMainExports, 'project' | 'titles' | 'label'>;
}

// The live sessions the chatroom knows, in the order they joined. Names and
// rooms are read from sessions at each call, so a retitle or a project
// lookup landing shows at the next one.
export interface Roster {
  // Adds the session; a session already in the roster is left as it is.
  connected(session: AgentSession): void;
  // Sets the session's host id from its info again.
  hostSessionChanged(session: AgentSession): void;
  has(rowId: string): boolean;
  sessions(): RosterSession[];
  // The main agent for `agentId` null, else the subagent: named
  // `<main name> ▸ <type>` by its last spawn, `▸ subagent` when none is known.
  participant(rowId: string, agentId: string | null): Participant;
  // The session's project, null for none.
  roomOf(rowId: string): string | null;
  // The main agent of each roster session with a room, in roster order.
  directory(): RoomMember[];
  subagentSpawned(rowId: string, agentId: string, agentType: string): void;
  subagentFinished(rowId: string, agentId: string): void;
  // Drops the session and its subagents' types.
  ended(rowId: string): void;
}

const UNKNOWN_SUBAGENT_TYPE = 'subagent';

interface RosterEntry {
  session: RosterSession;
  // Subagent id → the type of its last spawn.
  readonly subagentTypes: Map<string, string>;
}

export function createRoster(deps: RosterDeps): Roster {
  const { sessions } = deps;
  const entries = new Map<string, RosterEntry>();

  const mainName = (rowId: string): string => {
    const titles = sessions.titles(rowId);
    const title = titles === null ? '' : editableTitle(titles);
    return title !== '' ? title : (sessions.label(rowId) ?? `session ${rowId}`);
  };

  const participant = (rowId: string, agentId: string | null): Participant => {
    const main = mainName(rowId);
    const type =
      agentId === null
        ? null
        : (entries.get(rowId)?.subagentTypes.get(agentId) ??
          UNKNOWN_SUBAGENT_TYPE);
    return {
      kind: 'agent',
      rowId,
      agentId,
      mirrorId: null,
      name: type === null ? main : `${main} ▸ ${type}`,
    };
  };

  return {
    connected(session) {
      if (entries.has(session.id)) {
        return;
      }
      entries.set(session.id, {
        session: {
          rowId: session.id,
          harness: session.info.harness,
          folder: session.info.projectDir,
          hostSessionId: session.info.sessionId,
        },
        subagentTypes: new Map(),
      });
    },
    hostSessionChanged(session) {
      const entry = entries.get(session.id);
      if (entry !== undefined) {
        entry.session = {
          ...entry.session,
          hostSessionId: session.info.sessionId,
        };
      }
    },
    has: (rowId) => entries.has(rowId),
    sessions: () => [...entries.values()].map((entry) => entry.session),
    participant,
    roomOf: (rowId) => sessions.project(rowId),
    directory() {
      return [...entries.keys()].flatMap((rowId) => {
        const room = sessions.project(rowId);
        return room === null
          ? []
          : [{ room, participant: participant(rowId, null) }];
      });
    },
    subagentSpawned(rowId, agentId, agentType) {
      entries.get(rowId)?.subagentTypes.set(agentId, agentType);
    },
    subagentFinished(rowId, agentId) {
      entries.get(rowId)?.subagentTypes.delete(agentId);
    },
    ended(rowId) {
      entries.delete(rowId);
    },
  };
}
