import { MAIN_AGENT_ID, type UsageAgentEvent } from '../contracts/agent';

// Whether `event` takes the place of the main-agent `usage` kept for a session:
// only the main agent's does, an older `at` loses, and an equal `at` replaces.
export function replacesUsage(
  kept: UsageAgentEvent | null,
  event: UsageAgentEvent,
): boolean {
  const isOlderThanKept = kept !== null && event.at < kept.at;
  return event.agentId === MAIN_AGENT_ID && !isOlderThanKept;
}
