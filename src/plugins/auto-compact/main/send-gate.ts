import type { AgentEvent, UsageAgentEvent } from '../../../contracts/agent';
import { formatTokens } from '../../../shared/format-tokens';
import { replacesUsage } from '../../../shared/replaces-usage';
import type { SendGateVerdict } from '../../chat/contract';

// Each host session's last main-agent usage, by host session id: chat's `clear`
// keeps the row's session id but starts a new host session, whose first send
// must not read the old conversation's usage.
export type LatestUsage = ReadonlyMap<string, UsageAgentEvent>;

// The same map when `event` changes nothing, else a new one. An ended session
// keeps its usage, since its next send is the one the gate is for; a finished
// compaction drops it, until the `usage` carrying the after-size refills it.
export function withAgentEvent(
  latest: LatestUsage,
  hostSessionId: string,
  event: AgentEvent,
): LatestUsage {
  if (event.type === 'usage') {
    return replacesUsage(latest.get(hostSessionId) ?? null, event)
      ? new Map(latest).set(hostSessionId, event)
      : latest;
  }
  const compactionDone =
    event.type === 'compactionEnded' && event.outcome === 'done';
  if (!compactionDone || !latest.has(hostSessionId)) {
    return latest;
  }
  const dropped = new Map(latest);
  dropped.delete(hostSessionId);
  return dropped;
}

// Chat asks gates only for an idle session, so idleness is not checked here. A
// slash command passes: `/compact` is the user's own instruction and would
// compact twice.
export function sendGateVerdict(
  usage: UsageAgentEvent | null,
  minTokens: number,
  text: string,
  now: number,
): SendGateVerdict | null {
  const isSlashCommand = text.trimStart().startsWith('/');
  if (minTokens === 0 || isSlashCommand || usage === null) {
    return null;
  }
  const isCacheCold =
    usage.cacheExpiresAt !== null && usage.cacheExpiresAt <= now;
  if (!isCacheCold || usage.contextTokens <= minTokens) {
    return null;
  }
  return {
    action: 'compact',
    reason: `auto · cache cold · ${formatTokens(usage.contextTokens)}`,
  };
}
