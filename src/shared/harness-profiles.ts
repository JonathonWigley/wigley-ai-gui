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
