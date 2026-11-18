import { describe, expect, it } from 'vitest';
import type {
  AgentHarness,
  AgentHarnessInfo,
  HarnessProfile,
} from '../../../contracts/agent';
import {
  harnessInfo,
  harnessRegistryOf,
} from '../../../shared/agent-harness-registry.test-support';
import {
  chatHarnessesOf,
  harnessOfProfile,
  requireHarness,
  requireHarnessOfProfile,
} from './lookups';
import { chatHarnessesOfRegistry } from './lookups.test-support';

function profilesNamed(profileNames: string[]): HarnessProfile[] {
  return profileNames.map((name) => ({ name, configDir: `~/.${name}` }));
}

// A harness double that answers only `id` and `info()`, all a lookup reads.
function harnessWith(id: string, profileNames: string[]): AgentHarness {
  const profiles = profilesNamed(profileNames);
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
    const harnesses = chatHarnessesOfRegistry(
      harnessRegistryOf([harnessWith('claude', ['work']), fake]),
    );

    expect(harnessOfProfile(harnesses, 'spare')).toBe(fake);
  });

  it('requireHarnessOfProfile_UnlistedHarness_StillResolves', () => {
    const demo = {
      id: 'demo',
      info: () =>
        harnessInfo({ profiles: profilesNamed(['demo']), unlisted: true }),
    } as unknown as AgentHarness;
    const harnesses = chatHarnessesOfRegistry(
      harnessRegistryOf([harnessWith('claude', ['work']), demo]),
    );

    expect(requireHarnessOfProfile(harnesses, 'demo')).toBe(demo);
  });

  it('harnessOfProfile_NoHarnessDeclaresIt_Null', () => {
    const harnesses = chatHarnessesOfRegistry(
      harnessRegistryOf([harnessWith('claude', ['work'])]),
    );

    expect(harnessOfProfile(harnesses, 'spare')).toBeNull();
  });

  // Breaks if chat main reads a harness's own `info()` again, past the
  // registry's clash rule.
  it('harnessOfProfile_ClashingName_ReturnsTheHarnessThatPublishesIt', () => {
    const fake = harnessWith('fake', ['work', 'spare']);
    const claude = harnessWith('claude', ['work']);
    const published = new Map<string, AgentHarnessInfo>([
      ['claude', harnessInfo({ profiles: profilesNamed(['work']) })],
      ['fake', harnessInfo({ profiles: profilesNamed(['spare']) })],
    ]);
    const harnesses = chatHarnessesOf(
      harnessRegistryOf([fake, claude]),
      published,
    );

    expect(harnessOfProfile(harnesses, 'work')).toBe(claude);
    expect(harnesses.profilesOf('fake').map(({ name }) => name)).toEqual([
      'spare',
    ]);
  });
});
