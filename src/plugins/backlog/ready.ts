// The tag that marks a follow-up ready for an agent, the same in main and the
// page.
export const AGENT_READY = 'agent-ready';

export function isReady(tags: readonly string[]): boolean {
  return tags.includes(AGENT_READY);
}
