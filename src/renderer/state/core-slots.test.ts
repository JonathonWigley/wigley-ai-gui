import { describe, expect, it } from 'vitest';
import {
  coreModeSlot,
  coreScopeSlot,
  coreThemeSlot,
} from '../../contracts/core-state';
import { createListeners } from '../../shared/listeners';
import { createSlotStore } from '../../shared/state/slot-store';
import { createScopeStack } from '../key-scope';
import { startPageCoreSlots } from './core-slots';

function startSlots() {
  const store = createSlotStore(() => {});
  store.load({
    'core.mode': { kind: 'value', value: 'old.mode' },
    'core.scope': { kind: 'value', value: 'old.scope' },
    'core.theme': { kind: 'value', value: 'old-theme' },
  });
  const scope = createScopeStack('p.view');
  const modeChanges = createListeners<string>();
  const slots = startPageCoreSlots(store, {
    scope,
    modes: { onChanged: (listener) => modeChanges.add(listener) },
    theme: 'dusk',
  });
  const read = {
    mode: () => store.read(coreModeSlot, 'test').get(),
    scope: () => store.read(coreScopeSlot, 'test').get(),
    theme: () => store.read(coreThemeSlot, 'test').get(),
  };
  return { store, scope, modeChanges, slots, read };
}

describe('startPageCoreSlots', () => {
  it('startPageCoreSlots_SnapshotHoldsOldValues_WritesCurrentOnes', () => {
    const { read } = startSlots();

    expect([read.mode(), read.scope(), read.theme()]).toEqual([
      '',
      'p.view',
      'dusk',
    ]);
  });

  it.each([
    {
      change: 'a pushed scope',
      act: ({ scope }: ReturnType<typeof startSlots>) => scope.push('p.modal'),
      slot: 'scope' as const,
      expected: 'p.modal',
    },
    {
      change: 'a new base scope',
      act: ({ scope }: ReturnType<typeof startSlots>) => scope.setBase('p.tab'),
      slot: 'scope' as const,
      expected: 'p.tab',
    },
    {
      change: 'a mode change',
      act: ({ modeChanges }: ReturnType<typeof startSlots>) =>
        modeChanges.tell('p.browse'),
      slot: 'mode' as const,
      expected: 'p.browse',
    },
  ])('changeAfterStart_WritesItsSlot: $change', ({ act, slot, expected }) => {
    const started = startSlots();

    act(started);

    expect(started.read[slot]()).toBe(expected);
  });

  it.each([
    { row: 'same name', name: 'dusk', writes: [] },
    {
      row: 'new name',
      name: 'dawn',
      writes: [{ id: 'core.theme', kind: 'value', value: 'dawn' }],
    },
  ])('themeApplied_WritesOnlyANewName: $row', ({ name, writes }) => {
    const { store, slots } = startSlots();
    const written: unknown[] = [];
    store.onWrite((change) => written.push(change));

    slots.themeApplied(name);

    expect(written).toEqual(writes);
  });
});
