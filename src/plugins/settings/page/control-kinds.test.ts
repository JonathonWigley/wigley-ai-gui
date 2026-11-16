import { describe, expect, it } from 'vitest';
import type { SettingControlKind } from '../contract';
import { createControlKinds } from './control-kinds';

const KIND: SettingControlKind = {
  id: 'p-list',
  text: () => 'drawn',
  edit: { type: 'picker', items: () => [], label: String },
};

describe('createControlKinds', () => {
  it('add_HeldId_Throws', () => {
    const kinds = createControlKinds();
    kinds.add(KIND);

    expect(() => kinds.add({ ...KIND })).toThrow(
      'control kind p-list is already registered',
    );
  });

  it('addThenDispose_TellsEachOnce_SecondDisposeDoesNothing', () => {
    const kinds = createControlKinds();
    const heard: (SettingControlKind | undefined)[] = [];
    kinds.onChanged(() => heard.push(kinds.get(KIND.id)));

    const registration = kinds.add(KIND);
    registration.dispose();
    kinds.add(KIND);
    registration.dispose();

    expect(heard).toEqual([KIND, undefined, KIND]);
    expect(kinds.get(KIND.id)).toBe(KIND);
  });

  it('get_UnknownId_IsUndefined', () => {
    expect(createControlKinds().get('nope')).toBeUndefined();
  });
});
