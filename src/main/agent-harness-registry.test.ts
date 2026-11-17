import { describe, expect, it } from 'vitest';
import type { AgentHarness } from '../contracts/agent';
import { coreAgentHarnessesSlot } from '../contracts/core-state';
import { harnessInfo } from '../shared/agent-harness-registry.test-support';
import { createSlotStore } from '../shared/state/slot-store';
import { createAgentHarnessRegistry } from './agent-harness-registry';

// A harness double whose `info()` reports `label` as it stands at the call.
function harnessDouble(id: string, label: string) {
  const double = { label };
  const harness = {
    id,
    info: () => harnessInfo({ label: double.label }),
  } as unknown as AgentHarness;
  return { harness, double };
}

function registryOverStore() {
  const store = createSlotStore(() => undefined);
  const registry = createAgentHarnessRegistry(
    store.publish(coreAgentHarnessesSlot),
  );
  const slot = store.read(coreAgentHarnessesSlot, 'test');
  return { registry, slot };
}

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
});
