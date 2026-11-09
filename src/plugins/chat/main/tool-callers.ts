import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import type { ToolCallGuard } from '../../sessions/contract';

// How long a read waits for the stream to name a call's agent.
export const CALLER_WAIT_MS = 2_000;
export const SUBAGENT_CALL_TEXT =
  "Only the main agent's call changes this session, so this call changed nothing.";

// Which agent made each tool call, per row (the app's session id), by the
// stream's `toolStarted` events.
export interface ToolCallers {
  // Records the call's agent for the row's life, and wakes every read waiting
  // for that row and tool-use id.
  noteToolStarted(sessionId: string, toolUseId: string, agentId: string): void;
  // The agent noted for the call; for a call not noted yet, waits up to
  // CALLER_WAIT_MS for its note, then resolves null.
  agentOf(sessionId: string, toolUseId: string): Promise<string | null>;
  // Drops the row's notes and resolves its waiting reads with null.
  forget(sessionId: string): void;
  // `forget` for every row.
  stop(): void;
}

interface WaitingRead {
  readonly toolUseId: string;
  readonly timer: number;
  readonly resolve: (agentId: string | null) => void;
}

export function createToolCallers(timers: Timers): ToolCallers {
  // Row id → tool-use id → agent id.
  const noted = new Map<string, Map<string, string>>();
  const waiting = new Map<string, Set<WaitingRead>>();

  function settle(
    sessionId: string,
    read: WaitingRead,
    agentId: string | null,
  ) {
    timers.clear(read.timer);
    waiting.get(sessionId)?.delete(read);
    read.resolve(agentId);
  }

  function forget(sessionId: string) {
    noted.delete(sessionId);
    for (const read of waiting.get(sessionId) ?? []) {
      settle(sessionId, read, null);
    }
    waiting.delete(sessionId);
  }

  return {
    noteToolStarted(sessionId, toolUseId, agentId) {
      let calls = noted.get(sessionId);
      if (calls === undefined) {
        calls = new Map();
        noted.set(sessionId, calls);
      }
      calls.set(toolUseId, agentId);
      for (const read of waiting.get(sessionId) ?? []) {
        if (read.toolUseId === toolUseId) {
          settle(sessionId, read, agentId);
        }
      }
    },
    agentOf(sessionId, toolUseId) {
      const agentId = noted.get(sessionId)?.get(toolUseId);
      if (agentId !== undefined) {
        return Promise.resolve(agentId);
      }
      return new Promise((resolve) => {
        let reads = waiting.get(sessionId);
        if (reads === undefined) {
          reads = new Set();
          waiting.set(sessionId, reads);
        }
        const read: WaitingRead = {
          toolUseId,
          resolve,
          timer: timers.set(
            () => settle(sessionId, read, null),
            CALLER_WAIT_MS,
          ),
        };
        reads.add(read);
      });
    },
    forget,
    stop() {
      for (const sessionId of new Set([...noted.keys(), ...waiting.keys()])) {
        forget(sessionId);
      }
    },
  };
}

export interface CallerGuardDeps {
  readonly callers: Pick<ToolCallers, 'agentOf'>;
  // True for a row chat holds.
  owns(sessionId: string): boolean;
}

// Answers a subagent's call of a main-agent-only tool with SUBAGENT_CALL_TEXT,
// and runs every other call. A call whose agent the stream never names in
// CALLER_WAIT_MS runs.
export function callerGuard(deps: CallerGuardDeps): ToolCallGuard {
  return async ({ sessionId, toolUseId, mainAgentOnly }) => {
    // A session chat does not hold has no stream to name the agent.
    if (!mainAgentOnly || toolUseId === null || !deps.owns(sessionId)) {
      return { kind: 'run' };
    }
    const agentId = await deps.callers.agentOf(sessionId, toolUseId);
    if (agentId === null || agentId === MAIN_AGENT_ID) {
      return { kind: 'run' };
    }
    return { kind: 'skip', text: SUBAGENT_CALL_TEXT };
  };
}
