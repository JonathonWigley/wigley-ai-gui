import { describe, expect, it } from 'vitest';
import type {
  AgentHarness,
  AgentHarnessRegistration,
  HarnessProfile,
} from '../contracts/agent';
import { coreAgentHarnessesSlot } from '../contracts/core-state';
import { harnessInfo } from '../shared/agent-harness-registry.test-support';
import { createSlotStore } from '../shared/state/slot-store';
import { createAgentHarnessRegistry } from './agent-harness-registry';

// A harness double whose `info()` reports `label` and `profiles` as they stand
// at the call.
function harnessDouble(
  id: string,
  label: string,
  profiles: readonly HarnessProfile[] = [],
) {
  const double = { label, profiles };
  const harness = {
    id,
    info: () => harnessInfo({ label: double.label, profiles: double.profiles }),
  } as unknown as AgentHarness;
  return { harness, double };
}

function registryOverStore() {
  const store = createSlotStore(() => undefined);
  const logged: string[] = [];
  const registry = createAgentHarnessRegistry(
    store.publish(coreAgentHarnessesSlot),
    (message) => logged.push(message),
  );
  const slot = store.read(coreAgentHarnessesSlot, 'test');
  return { registry, slot, logged };
}

// Harness `a` declares `work`; `b` declares `work` and `home`.
const A_PROFILES: HarnessProfile[] = [{ name: 'work', configDir: '/a' }];
const B_PROFILES: HarnessProfile[] = [
  { name: 'work', configDir: '/b' },
  { name: 'home', configDir: '/h' },
];
const CLASH_LINE =
  'agent harness "b": profile "work" left out, agent harness "a" has that name';

const idsOf = (harnesses: readonly AgentHarness[]) =>
  harnesses.map((harness) => harness.id);

describe('createAgentHarnessRegistry', () => {
  it('register_Harness_ListedGotAndInSlot', () => {
    const { registry, slot } = registryOverStore();
    const { harness } = harnessDouble('a', 'A');

    registry.register(harness);

    expect(registry.list()).toEqual([harness]);
    expect(registry.get('a')).toBe(harness);
    expect(slot.get('a')).toEqual(harnessInfo({ label: 'A' }));
  });

  it('register_TakenId_ThrowsAndChangesNothing', () => {
    const { registry, slot } = registryOverStore();
    const first = harnessDouble('a', 'First').harness;
    registry.register(first);

    const second = harnessDouble('a', 'Second').harness;

    expect(() => registry.register(second)).toThrow(
      'agent harness "a" is already registered',
    );

    expect(registry.list()).toEqual([first]);
    expect(slot.get('a')).toEqual(harnessInfo({ label: 'First' }));
  });

  it('list_TwoHarnesses_InRegistrationOrder', () => {
    const { registry } = registryOverStore();

    registry.register(harnessDouble('b', 'B').harness);
    registry.register(harnessDouble('a', 'A').harness);

    expect(idsOf(registry.list())).toEqual(['b', 'a']);
  });

  it('get_UnknownId_Null', () => {
    const { registry } = registryOverStore();
    registry.register(harnessDouble('a', 'A').harness);

    expect(registry.get('b')).toBeNull();
  });

  it('slotListener_RegisterAndDispose_RegistryAlreadyUpdated', () => {
    const { registry, slot } = registryOverStore();
    const { harness } = harnessDouble('a', 'A');
    const heard: { set: boolean; got: AgentHarness | null; ids: string[] }[] =
      [];
    slot.on((_key, value) =>
      heard.push({
        set: value !== undefined,
        got: registry.get('a'),
        ids: idsOf(registry.list()),
      }),
    );

    registry.register(harness).dispose();

    expect(heard).toEqual([
      { set: true, got: harness, ids: ['a'] },
      { set: false, got: null, ids: [] },
    ]);
  });

  it('dispose_Registration_LeavesListGetAndSlot', () => {
    const { registry, slot } = registryOverStore();
    const registration = registry.register(harnessDouble('a', 'A').harness);
    const deletes: string[] = [];
    slot.on((key, value) => {
      if (value === undefined) {
        deletes.push(key);
      }
    });

    registration.dispose();
    expect(() => registration.dispose()).not.toThrow();

    expect(registry.list()).toEqual([]);
    expect(registry.get('a')).toBeNull();
    expect(slot.get('a')).toBeUndefined();
    expect(deletes).toEqual(['a']);
  });

  it('register_AfterDispose_SameIdGoesLast', () => {
    const { registry } = registryOverStore();
    const registration = registry.register(harnessDouble('a', 'A').harness);
    registry.register(harnessDouble('b', 'B').harness);

    registration.dispose();
    registry.register(harnessDouble('a', 'A').harness);

    expect(idsOf(registry.list())).toEqual(['b', 'a']);
  });

  it('refresh_InfoChanged_SlotRewritten', () => {
    const { registry, slot } = registryOverStore();
    const { harness, double } = harnessDouble('a', 'A');
    const registration = registry.register(harness);

    double.label = 'B';
    registration.refresh();

    expect(slot.get('a')).toEqual(harnessInfo({ label: 'B' }));
  });

  it('refresh_AfterDispose_WritesNothing', () => {
    const { registry, slot } = registryOverStore();
    const registration = registry.register(harnessDouble('a', 'A').harness);
    registration.dispose();

    registration.refresh();

    expect(slot.get('a')).toBeUndefined();
  });

  // Registers `a` then `b`; each row acts on their registrations after, and
  // the slot keys heard count only from the act on.
  it.each<{
    given: string;
    act: (a: AgentHarnessRegistration, b: AgentHarnessRegistration) => void;
    bProfiles: HarnessProfile[];
    heardKeys: string[];
  }>([
    {
      given: 'a then b both declare work',
      act: () => undefined,
      bProfiles: [{ name: 'home', configDir: '/h' }],
      heardKeys: [],
    },
    {
      given: 'a disposed',
      act: (a) => a.dispose(),
      bProfiles: B_PROFILES,
      heardKeys: ['a', 'b'],
    },
    {
      given: 'b refreshed with no change',
      act: (_a, b) => b.refresh(),
      bProfiles: [{ name: 'home', configDir: '/h' }],
      heardKeys: [],
    },
  ])(
    'registry_ProfileNameClash_given $given',
    ({ act, bProfiles, heardKeys }) => {
      const { registry, slot, logged } = registryOverStore();
      const a = registry.register(harnessDouble('a', 'A', A_PROFILES).harness);
      const b = registry.register(harnessDouble('b', 'B', B_PROFILES).harness);
      const heard: string[] = [];
      slot.on((key) => heard.push(key));

      act(a, b);

      expect(slot.get('b')?.profiles).toEqual(bProfiles);
      expect(logged).toEqual([CLASH_LINE]);
      expect(heard).toEqual(heardKeys);
    },
  );

  it('dispose_ClashHolder_DeletesThenRewritesTheNext', () => {
    const { registry, slot } = registryOverStore();
    const a = registry.register(harnessDouble('a', 'A', A_PROFILES).harness);
    registry.register(harnessDouble('b', 'B', B_PROFILES).harness);
    const heard: {
      key: string;
      set: boolean;
      ids: string[];
      gotA: AgentHarness | null;
    }[] = [];
    slot.on((key, value) =>
      heard.push({
        key,
        set: value !== undefined,
        ids: idsOf(registry.list()),
        gotA: registry.get('a'),
      }),
    );

    a.dispose();

    expect(heard).toEqual([
      { key: 'a', set: false, ids: ['b'], gotA: null },
      { key: 'b', set: true, ids: ['b'], gotA: null },
    ]);
  });
});
