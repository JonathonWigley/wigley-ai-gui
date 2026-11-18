import type { AgentHarnessInfo, HarnessProfile } from '../contracts/agent';

// A profile with the id of the harness that declares it.
export interface RegisteredProfile extends HarnessProfile {
  harnessId: string;
}

// Every profile in `infos` (`core.agentHarnesses`, keyed by harness id), in map
// order then each harness's profile order, tagged with its harness id.
export function registeredProfiles(
  infos: ReadonlyMap<string, AgentHarnessInfo>,
): RegisteredProfile[] {
  return [...infos].flatMap(([harnessId, info]) =>
    info.profiles.map((profile) => ({ ...profile, harnessId })),
  );
}

// `infos` without each unlisted harness, in the same key order: the harnesses
// a reader that offers or polls profiles lists.
export function listedHarnesses(
  infos: ReadonlyMap<string, AgentHarnessInfo>,
): ReadonlyMap<string, AgentHarnessInfo> {
  return new Map([...infos].filter(([, info]) => info.unlisted !== true));
}
