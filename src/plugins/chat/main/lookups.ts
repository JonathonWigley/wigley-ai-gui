import type { AgentHarness } from '../../../contracts/agent';
import type { ChatProfile } from '../contract';

export const CHAT_HARNESS_ID = 'claude';

// The profile named `name`; throws naming it when chat has none.
export function requireProfile(
  profiles: readonly ChatProfile[],
  name: string,
): ChatProfile {
  const profile = profiles.find((held) => held.name === name);
  if (!profile) {
    throw new Error(`chat has no profile "${name}"`);
  }
  return profile;
}

// The harness chat runs its sessions on.
export function requireChatHarness(
  harnesses: readonly AgentHarness[],
): AgentHarness {
  const harness = harnesses.find(
    (candidate) => candidate.id === CHAT_HARNESS_ID,
  );
  if (!harness) {
    throw new Error(`no agent harness "${CHAT_HARNESS_ID}"`);
  }
  return harness;
}
