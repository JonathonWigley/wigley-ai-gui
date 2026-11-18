import { describe, expect, it, vi } from 'vitest';
import type { FindingOriginSpec } from './contract';
import {
  actionLabel,
  createFindingOriginRegistry,
  FINDING_ORIGIN_SPECS,
} from './finding-origins';
import {
  SECURITY_ORIGIN,
  useBuiltInFindingOrigins,
} from './finding-origins.test-support';

// A registry holding the built-ins, apart from the process's own.
function builtInRegistry() {
  const registry = createFindingOriginRegistry();
  for (const spec of FINDING_ORIGIN_SPECS) {
    registry.register(spec);
  }
  return registry;
}

describe('findingOrigins registry', () => {
  it('register_TakenId_Throws', () => {
    const registry = builtInRegistry();

    expect(() =>
      registry.register({ ...SECURITY_ORIGIN, id: 'caused' }),
    ).toThrow('finding origin caused is already registered');
  });

  it('register_SharedCardDifferentWords_Throws', () => {
    const registry = builtInRegistry();
    const before = registry.list();

    expect(() =>
      registry.register({
        ...SECURITY_ORIGIN,
        card: 'defect',
        words: { kind: 'Bug', finding: 'Finding', proof: 'Proof' },
      }),
    ).toThrow('finding origin security draws as card defect');
    expect(registry.list()).toEqual(before);
  });

  it.each<{ name: string; spec: FindingOriginSpec; error: string }>([
    {
      name: 'no fix_now',
      spec: { ...SECURITY_ORIGIN, actions: { leave_it: 'Accept' } },
      error: 'offers no fix_now action',
    },
    {
      name: 'zero fewest choices',
      spec: { ...SECURITY_ORIGIN, minChoices: 0 },
      error: 'takes 0 to 3 choices',
    },
    {
      name: 'more choices than number keys',
      spec: { ...SECURITY_ORIGIN, maxChoices: 10 },
      error: 'takes 1 to 10 choices',
    },
    {
      name: 'fewest past most',
      spec: { ...SECURITY_ORIGIN, minChoices: 3, maxChoices: 2 },
      error: 'takes 3 to 2 choices',
    },
    {
      name: 'a blank action word',
      spec: {
        ...SECURITY_ORIGIN,
        actions: { fix_now: 'Patch', leave_it: ' ' },
      },
      error: 'has a blank word for leave_it',
    },
  ])('register_NoFixNowOrBoundsPastKeys_Throws: $name', ({ spec, error }) => {
    const registry = builtInRegistry();

    expect(() => registry.register(spec)).toThrow(error);
    expect(registry.spec('security')).toBeUndefined();
  });

  it('dispose_LeavesListKeepsSpecLookup', () => {
    const registry = builtInRegistry();
    const handle = registry.register(SECURITY_ORIGIN);

    handle.dispose();

    expect(registry.list().map((spec) => spec.id)).toEqual([
      'caused',
      'pre_existing',
      'design',
      'nit',
    ]);
    expect(registry.spec('security')).toBe(SECURITY_ORIGIN);
  });

  it('register_SameIdAfterDispose_ReplacesRetired', () => {
    const registry = builtInRegistry();
    registry.register(SECURITY_ORIGIN).dispose();
    const replacement = { ...SECURITY_ORIGIN, chip: 'Security risk' };

    registry.register(replacement);

    expect(registry.spec('security')).toBe(replacement);
    expect(registry.list().at(-1)).toBe(replacement);
  });

  it('register_ListenerThrows_RegistersNothingKeepsRetired', () => {
    const registry = builtInRegistry();
    registry.register(SECURITY_ORIGIN).dispose();
    const before = registry.list();
    registry.onChanged(() => {
      throw new Error('listener broke');
    });

    expect(() =>
      registry.register({ ...SECURITY_ORIGIN, chip: 'Security risk' }),
    ).toThrow('listener broke');
    expect(registry.list()).toBe(before);
    expect(registry.spec('security')).toBe(SECURITY_ORIGIN);
  });

  it('onChanged_FiresOnRegisterAndDispose_OnceEach', () => {
    const registry = builtInRegistry();
    const listener = vi.fn();
    registry.onChanged(listener);

    const handle = registry.register(SECURITY_ORIGIN);
    expect(listener).toHaveBeenCalledTimes(1);
    handle.dispose();
    handle.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('actionLabel', () => {
  useBuiltInFindingOrigins();

  it('labels an action the origin does not offer as null', () => {
    expect(actionLabel('nit', 'follow_up')).toBeNull();
  });
});
