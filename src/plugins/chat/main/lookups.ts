import type {
  AgentHarness,
  AgentHarnessRegistry,
} from '../../../contracts/agent';
import { CHAT_HARNESS_ID, type ChatProfile } from '../contract';

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

// The harness chat runs its sessions on, as the registry holds it now.
export function requireChatHarness(
  harnesses: AgentHarnessRegistry,
): AgentHarness {
  const harness = harnesses.get(CHAT_HARNESS_ID);
  if (harness === null) {
    throw new Error(`no agent harness "${CHAT_HARNESS_ID}"`);
  }
  return harness;
}
