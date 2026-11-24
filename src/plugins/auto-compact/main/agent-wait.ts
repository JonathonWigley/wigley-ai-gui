import type { AgentEvent, UsageAgentEvent } from '../../../contracts/agent';
import { formatTokens } from '../../../shared/format-tokens';
import { isClaimed, type SessionFlow } from '../../workflow/contract';

// Where a session's agent wait stands, by chat row id. A session absent is
// armed: its next wait may compact. `compacting` runs from the `compact` call
// to that compaction's end, so the compaction's own turn and a subagent ending
// during it re-arm nothing; `spent` holds until a main turn starts or the
// subagents all finish.
export type WaitPhase = 'compacting' | 'spent';
export type AgentWaits = ReadonlyMap<string, WaitPhase>;

export interface AgentWaitInput {
  flow: SessionFlow | undefined;
  usage: UsageAgentEvent | null;
  minTokens: number;
  phase: WaitPhase | undefined;
}

// The `compact` reason for a session whose main turn ended while a subagent it
// spawned still runs, its workflow at a level and its last main context above
// `minTokens`; null otherwise, or once this wait compacted. Chat's `compact`
// checks the session is idle, with no compaction or hold up.
export function agentWaitReason({
  flow,
  usage,
  minTokens,
  phase,
}: AgentWaitInput): string | null {
  if (minTokens === 0 || phase !== undefined || flow === undefined) {
    return null;
  }
  const hasLevel = isClaimed(flow);
  const waitsOnSubagents =
    !flow.turnRunning && flow.runningSubagents.length > 0;
  if (!hasLevel || !waitsOnSubagents || usage === null) {
    return null;
  }
  if (usage.contextTokens <= minTokens) {
    return null;
  }
  return `auto · agents running · ${formatTokens(usage.contextTokens)}`;
}

// The waits once `compact` started a compaction in `sessionId`.
export function withCompactStarted(
  waits: AgentWaits,
  sessionId: string,
): AgentWaits {
  return new Map(waits).set(sessionId, 'compacting');
}

// The same map when `event` changes nothing, else a new one. A compaction's end
// spends the wait, a main turn's start re-arms a spent one, and a process's end
// re-arms any.
export function withWaitEvent(
  waits: AgentWaits,
  sessionId: string,
  event: AgentEvent,
): AgentWaits {
  const phase = waits.get(sessionId);
  if (phase === undefined) {
    return waits;
  }
  const isCompactionOver =
    phase === 'compacting' && event.type === 'compactionEnded';
  if (isCompactionOver) {
    return new Map(waits).set(sessionId, 'spent');
  }
  const isRearmed =
    (phase === 'spent' && event.type === 'turnStarted') ||
    event.type === 'sessionEnded';
  return isRearmed ? withoutWait(waits, sessionId) : waits;
}

// The same map when `flow` changes nothing, else a new one: a spent wait re-arms
// once no subagent runs or the flow is gone.
export function withFlow(
  waits: AgentWaits,
  sessionId: string,
  flow: SessionFlow | undefined,
): AgentWaits {
  const isWaitOver = flow === undefined || flow.runningSubagents.length === 0;
  return waits.get(sessionId) === 'spent' && isWaitOver
    ? withoutWait(waits, sessionId)
    : waits;
}

function withoutWait(waits: AgentWaits, sessionId: string): AgentWaits {
  const next = new Map(waits);
  next.delete(sessionId);
  return next;
}
