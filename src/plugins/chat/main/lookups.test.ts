import { describe, expect, it } from 'vitest';
import type { AgentHarness, HarnessProfile } from '../../../contracts/agent';
import {
  harnessInfo,
  harnessRegistryOf,
} from '../../../shared/agent-harness-registry.test-support';
import { harnessOfProfile, requireHarness } from './lookups';

// A harness double that answers only `id` and `info()`, all a lookup reads.
function harnessWith(id: string, profileNames: string[]): AgentHarness {
  const profiles: HarnessProfile[] = profileNames.map((name) => ({
    name,
    configDir: `~/.${name}`,
  }));
  return {
    id,
    info: () => harnessInfo({ profiles }),
  } as unknown as AgentHarness;
}

describe('lookups', () => {
  it('requireHarness_Registered_ReturnsIt', () => {
    const claude = harnessWith('claude', ['work']);

    expect(requireHarness(harnessRegistryOf([claude]), 'claude')).toBe(claude);
  });

  it('requireHarness_Unregistered_ThrowsNamingTheId', () => {
    const registry = harnessRegistryOf([harnessWith('claude', ['work'])]);

    expect(() => requireHarness(registry, 'codex')).toThrow(
      'no agent harness "codex"',
    );
  });

  it('harnessOfProfile_ProfileOfTheSecondHarness_ReturnsTheSecond', () => {
    const fake = harnessWith('fake', ['spare']);
    const registry = harnessRegistryOf([harnessWith('claude', ['work']), fake]);

    expect(harnessOfProfile(registry, 'spare')).toBe(fake);
  });

  it('harnessOfProfile_NoHarnessDeclaresIt_Null', () => {
    const registry = harnessRegistryOf([harnessWith('claude', ['work'])]);

    expect(harnessOfProfile(registry, 'spare')).toBeNull();
  });
});
