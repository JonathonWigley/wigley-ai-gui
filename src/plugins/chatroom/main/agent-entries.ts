import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { ChatAgentEvent } from '../../chat/contract';
import type { EntryKind, Participant } from '../contract';
import type { TouchTracker } from './board';
import type { RoomService } from './room-service';
import type { Roster } from './roster';

export interface AgentEntriesDeps {
  readonly room: Pick<RoomService, 'addEntry'>;
  readonly roster: Pick<
    Roster,
    'participant' | 'roomOf' | 'subagentSpawned' | 'subagentFinished'
  >;
  readonly touches: Pick<TouchTracker, 'fromAgentEvent'>;
  readonly log: PluginLog;
}

// Turns chat's agent events into the board's touches and the room's
// `dispatch` and `hand-back` entries, in the session's own thread.
export function createAgentEntries(deps: AgentEntriesDeps): {
  heard(event: ChatAgentEvent): void;
} {
  const { room, roster } = deps;

  const addEntry = (
    rowId: string,
    from: Participant,
    kind: EntryKind,
    body: string,
  ): void => {
    const roomName = roster.roomOf(rowId);
    if (roomName === null) {
      return;
    }
    room
      .addEntry({
        room: roomName,
        thread: `session:${rowId}`,
        from,
        kind,
        body,
        refs: [],
      })
      .catch((error: unknown) => {
        deps.log(`entry not saved: ${errorText(error)}`);
      });
  };

  return {
    heard(agentEvent) {
      deps.touches.fromAgentEvent(agentEvent);
      const { sessionId, event, replayed } = agentEvent;
      if (replayed) {
        return;
      }
      if (event.type === 'agentSpawned') {
        roster.subagentSpawned(sessionId, event.agentId, event.agentType);
        const parentId =
          event.parentAgentId === MAIN_AGENT_ID ? null : event.parentAgentId;
        addEntry(
          sessionId,
          roster.participant(sessionId, parentId),
          'dispatch',
          `dispatched ${event.name} (${event.agentType}): ${event.description}`,
        );
      } else if (event.type === 'agentFinished') {
        addEntry(
          sessionId,
          roster.participant(sessionId, event.agentId),
          'hand-back',
          `handed back (${event.outcome})`,
        );
        roster.subagentFinished(sessionId, event.agentId);
      }
    },
  };
}
