import { describe, expect, it } from 'vitest';
import type { BackendKind } from '../contract';
import { createBackendRegistry } from './backend-registry';

function kindOf(kind: string): BackendKind {
  return {
    kind,
    label: kind,
    create: async () => ({ problem: 'unused' }),
  };
}

describe('createBackendRegistry', () => {
  it('gets an added kind until its dispose', () => {
    const registry = createBackendRegistry();
    const local = kindOf('local');

    const added = registry.add(local);
    expect(registry.get('local')).toBe(local);
    added.dispose();

    expect(registry.get('local')).toBeNull();
  });

  it('throws on a second add of one kind', () => {
    const registry = createBackendRegistry();
    registry.add(kindOf('local'));

    expect(() => registry.add(kindOf('local'))).toThrow(
      'backend kind "local" is already added',
    );
  });

  it('tells listeners once per add and per first dispose', () => {
    const registry = createBackendRegistry();
    let calls = 0;
    registry.onChanged(() => {
      calls += 1;
    });

    const added = registry.add(kindOf('local'));
    added.dispose();
    added.dispose();

    expect(calls).toBe(2);
  });

  it('lists the live kinds sorted, without a disposed one', () => {
    const registry = createBackendRegistry();
    registry.add(kindOf('teamcity'));
    const local = registry.add(kindOf('local'));
    registry.add(kindOf('fixture'));
    expect(registry.kinds()).toEqual(['fixture', 'local', 'teamcity']);

    local.dispose();

    expect(registry.kinds()).toEqual(['fixture', 'teamcity']);
  });
});
