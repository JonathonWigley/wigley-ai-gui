import { describe, expect, it } from 'vitest';
import type { PluginStatus } from '../../../contracts/core-state';
import type { SettingLeaf } from '../../../contracts/user-config';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import {
  lockedText,
  matchesPlugin,
  PLUGIN_LIST_PATH,
  withPluginSwitched,
} from './plugin-rows';

function status(
  id: string,
  label: string,
  on: boolean,
  neededBy: readonly string[] = [],
  description = `Adds ${label}.`,
): PluginStatus {
  return {
    id,
    label,
    description,
    on,
    neededBy,
    origin: 'built-in',
    problem: null,
  };
}

function listLeaf(fallback: readonly string[]): SettingLeaf {
  return {
    path: PLUGIN_LIST_PATH,
    label: 'Disabled plugins',
    description: 'The plugins that do not run',
    control: { kind: 'json' },
    fallback: { value: fallback },
  };
}

describe('plugin rows', () => {
  const others = [status('b', 'B', true), status('c', 'C', true)];

  it.each([
    {
      name: 'needed by two',
      on: true,
      neededBy: ['b', 'c'],
      text: 'Needed by B, C',
    },
    {
      name: 'needed by two, listed in reverse',
      on: true,
      neededBy: ['c', 'b'],
      text: 'Needed by C, B',
    },
    {
      name: 'needed by an id with no status',
      on: true,
      neededBy: ['zzz'],
      text: 'Needed by zzz',
    },
    { name: 'needed by none', on: true, neededBy: [], text: null },
    { name: 'off', on: false, neededBy: ['b'], text: null },
  ])('lockedText_: $name', ({ on, neededBy, text }) => {
    const a = status('a', 'A', on, neededBy);

    expect(lockedText(a, [a, ...others])).toBe(text);
  });

  it('lockedText_: settings while it runs', () => {
    const settings = status('settings', 'Settings', true);

    expect(lockedText(settings, [settings])).toBe(
      'Edit settings.json to turn off',
    );
  });

  it.each([
    {
      name: 'off from no file adds to the defaults',
      layer: null,
      fallback: ['agent-lines'],
      pluginId: 'gallery',
      isOn: false,
      next: { plugins: { disabled: ['agent-lines', 'gallery'] } },
    },
    {
      name: 'on back to the default removes the key',
      layer: { plugins: { disabled: ['gallery'] } },
      fallback: [],
      pluginId: 'gallery',
      isOn: true,
      next: {},
    },
    {
      name: 'on off a list unlike the default keeps the list',
      layer: { plugins: { disabled: ['agent-lines'] } },
      fallback: ['agent-lines', 'usage-tab-line'],
      pluginId: 'agent-lines',
      isOn: true,
      next: { plugins: { disabled: [] } },
    },
    {
      name: 'off when already listed',
      layer: { plugins: { disabled: ['gallery'] } },
      fallback: [],
      pluginId: 'gallery',
      isOn: false,
      next: { plugins: { disabled: ['gallery'] } },
    },
  ])(
    'withPluginSwitched_: $name',
    ({ layer, fallback, pluginId, isOn, next }) => {
      expect(
        withPluginSwitched(layer, listLeaf(fallback), pluginId, isOn),
      ).toEqual(next);
    },
  );

  it.each([
    {
      name: 'the label',
      query: 'gal',
      plugin: status('gallery', 'Gallery', true),
      matches: true,
    },
    {
      name: 'the id',
      query: 'usage',
      plugin: status('usage-tab-line', 'Tab line', true),
      matches: true,
    },
    {
      name: 'the description alone',
      query: 'usage',
      plugin: status('notes', 'Notes', true, [], 'Shows usage notes.'),
      matches: false,
    },
  ])('matchesPlugin_: $name', ({ query, plugin, matches }) => {
    expect(matchesPlugin(plugin, query, fakeFuzzyMatcher)).toBe(matches);
  });
});
