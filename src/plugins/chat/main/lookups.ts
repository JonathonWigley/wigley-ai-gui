import type {
  AgentHarness,
  AgentHarnessInfo,
  AgentHarnessRegistry,
  HarnessProfile,
} from '../../../contracts/agent';
import type { KeyedSlotReader } from '../../../contracts/state';

// The harness a saved session or recent folder written without a harness ran
// on: the Claude adapter wrote every one of them.
export const UNRECORDED_HARNESS_ID = 'claude';

// The registered harnesses as chat main reads them: `list` and `get` are the
// registry's, and `profilesOf` is the profiles the registry publishes for a
// harness in `core.agentHarnesses`, which leave out each profile whose name an
// earlier harness holds; none when it publishes no entry for the harness.
export interface ChatHarnesses extends Pick<
  AgentHarnessRegistry,
  'list' | 'get'
> {
  profilesOf(harnessId: string): readonly HarnessProfile[];
}

export function chatHarnessesOf(
  registry: Pick<AgentHarnessRegistry, 'list' | 'get'>,
  published: Pick<KeyedSlotReader<AgentHarnessInfo>, 'get'>,
): ChatHarnesses {
  return {
    list: () => registry.list(),
    get: (id) => registry.get(id),
    profilesOf: (harnessId) => published.get(harnessId)?.profiles ?? [],
  };
}

// The profile named `name`; throws naming it when chat has none.
export function requireProfile(
  profiles: readonly HarnessProfile[],
  name: string,
): HarnessProfile {
  const profile = profiles.find((held) => held.name === name);
  if (!profile) {
    throw new Error(`chat has no profile "${name}"`);
  }
  return profile;
}

// The harness registered under `id`, as the registry holds it now.
export function requireHarness(
  harnesses: Pick<AgentHarnessRegistry, 'get'>,
  id: string,
): AgentHarness {
  const harness = harnesses.get(id);
  if (harness === null) {
    throw new Error(`no agent harness "${id}"`);
  }
  return harness;
}

// The registered harness that publishes a profile named `profile`; null when
// none does. The registry publishes each name for one harness alone.
export function harnessOfProfile(
  harnesses: ChatHarnesses,
  profile: string,
): AgentHarness | null {
  return (
    harnesses
      .list()
      .find((harness) =>
        harnesses.profilesOf(harness.id).some((held) => held.name === profile),
      ) ?? null
  );
}

// `harnessOfProfile`, throwing as `requireProfile` does when no registered
// harness publishes the profile.
export function requireHarnessOfProfile(
  harnesses: ChatHarnesses,
  profile: string,
): AgentHarness {
  const harness = harnessOfProfile(harnesses, profile);
  if (harness === null) {
    throw new Error(`chat has no profile "${profile}"`);
  }
  return harness;
}
