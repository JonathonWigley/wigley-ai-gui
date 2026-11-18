import { describe, expect, it } from 'vitest';
import type { PluginStatus } from '../../../contracts/core-state';
import type { PluginOrigin } from '../../../contracts/plugin-catalog';
import { missingCoverage } from './coverage';

function plugin(
  id: string,
  origin: PluginOrigin = 'built-in',
  demoSkip: string | null = null,
): PluginStatus {
  return {
    id,
    label: id,
    description: '',
    on: true,
    neededBy: [],
    origin,
    problem: null,
    demoSkip,
  };
}

describe('missingCoverage', () => {
  it.each<{
    name: string;
    plugins: PluginStatus[];
    stepIds: string[];
    expected: string[];
  }>([
    {
      name: 'a step under the prefix covers it',
      plugins: [plugin('a'), plugin('c')],
      stepIds: ['a.one'],
      expected: ['c'],
    },
    {
      name: 'a demoSkip covers it',
      plugins: [plugin('b', 'built-in', 'Draws nothing.')],
      stepIds: [],
      expected: [],
    },
    {
      name: 'a step that only shares a prefix does not cover it',
      plugins: [plugin('a')],
      stepIds: ['ab.two'],
      expected: ['a'],
    },
    {
      name: 'user and replacing plugins are never listed',
      plugins: [plugin('u', 'user'), plugin('r', 'replaces-built-in')],
      stepIds: [],
      expected: [],
    },
    {
      name: 'order follows the slot',
      plugins: [
        plugin('z'),
        plugin('a'),
        plugin('b', 'built-in', 'Draws nothing.'),
        plugin('m'),
        plugin('u', 'user'),
      ],
      stepIds: ['a.one', 'ab.two'],
      expected: ['z', 'm'],
    },
  ])('$name', ({ plugins, stepIds, expected }) => {
    expect(missingCoverage(plugins, stepIds)).toEqual(expected);
  });
});
