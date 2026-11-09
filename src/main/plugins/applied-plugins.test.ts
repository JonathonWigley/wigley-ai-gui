import { describe, expect, it } from 'vitest';
import { createAppliedPlugins } from './applied-plugins';

describe('createAppliedPlugins', () => {
  it('createAppliedPlugins_Set_KeepsItsOwnCopy', () => {
    const applied = createAppliedPlugins([]);
    const list = ['a', 'b'];

    applied.set(list);
    list.push('x');

    expect(applied.disabled()).toEqual(['a', 'b']);
  });
});
