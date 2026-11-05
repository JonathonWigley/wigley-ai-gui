import { type AgentEvent, MAIN_AGENT_ID } from '../../../contracts/agent';

// Whether the main agent did work in each session's current live turn: a tool
// call, or a reply, which only `usage` shows when the agent calls no tool. The
// first `usage` after a compaction carries the size after a `/compact`, no reply.
export interface TurnWork {
  note(sessionId: string, event: AgentEvent): void;
  worked(sessionId: string): boolean;
  forget(sessionId: string): void;
}

interface SessionTurn {
  worked: boolean;
  afterCompaction: boolean;
}

export function createTurnWork(): TurnWork {
  const turns = new Map<string, SessionTurn>();

  const turnOf = (sessionId: string): SessionTurn => {
    let turn = turns.get(sessionId);
    if (turn === undefined) {
      turn = { worked: false, afterCompaction: false };
      turns.set(sessionId, turn);
    }
    return turn;
  };

  return {
    note(sessionId, event) {
      switch (event.type) {
        case 'turnStarted':
          turns.set(sessionId, { worked: false, afterCompaction: false });
          break;
        case 'compactionEnded':
          turnOf(sessionId).afterCompaction = true;
          break;
        case 'toolStarted':
          if (event.agentId === MAIN_AGENT_ID) {
            turnOf(sessionId).worked = true;
          }
          break;
        case 'usage':
          if (event.agentId === MAIN_AGENT_ID) {
            noteMainUsage(turnOf(sessionId));
          }
          break;
        default:
          break;
      }
    },
    worked: (sessionId) => turns.get(sessionId)?.worked ?? false,
    forget: (sessionId) => {
      turns.delete(sessionId);
    },
  };
}

function noteMainUsage(turn: SessionTurn): void {
  if (turn.afterCompaction) {
    turn.afterCompaction = false;
  } else {
    turn.worked = true;
  }
}
