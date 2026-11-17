import type {
  AgentHarness,
  AgentHarnessRegistry,
  HarnessProfile,
} from '../../../contracts/agent';

// The harness a saved session or recent folder written without a harness ran
// on: the Claude adapter wrote every one of them.
export const UNRECORDED_HARNESS_ID = 'claude';

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
  harnesses: AgentHarnessRegistry,
  id: string,
): AgentHarness {
  const harness = harnesses.get(id);
  if (harness === null) {
    throw new Error(`no agent harness "${id}"`);
  }
  return harness;
}

// The first registered harness that declares a profile named `profile`; null
// when none does. Profile names are unique across harnesses, so the first
// keeps a clashing name.
export function harnessOfProfile(
  harnesses: AgentHarnessRegistry,
  profile: string,
): AgentHarness | null {
  return (
    harnesses
      .list()
      .find((harness) =>
        harness.info().profiles.some((held) => held.name === profile),
      ) ?? null
  );
}

// `harnessOfProfile`, throwing as `requireProfile` does when no registered
// harness declares the profile.
export function requireHarnessOfProfile(
  harnesses: AgentHarnessRegistry,
  profile: string,
): AgentHarness {
  const harness = harnessOfProfile(harnesses, profile);
  if (harness === null) {
    throw new Error(`chat has no profile "${profile}"`);
  }
  return harness;
}
