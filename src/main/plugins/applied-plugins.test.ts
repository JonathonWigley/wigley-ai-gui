import { describe, expect, it } from 'vitest';
import { createAppliedPlugins } from './applied-plugins';

describe('createAppliedPlugins', () => {
  it('createAppliedPlugins_Set_KeepsItsOwnCopy', () => {
    const applied = createAppliedPlugins([]);
    const list = ['a', 'b'];
    const pausedAtCreation = applied.paused();
    const pausedList = ['c'];

    applied.set(list);
    applied.setPaused(pausedList);
    list.push('x');
    pausedList.push('y');

    expect(applied.disabled()).toEqual(['a', 'b']);
    expect(pausedAtCreation).toEqual([]);
    expect(applied.paused()).toEqual(['c']);
  });
});
