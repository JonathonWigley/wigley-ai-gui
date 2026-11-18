import { describe, expect, it } from 'vitest';
import type { AgentHarnessInfo } from '../contracts/agent';
import { harnessInfo } from './agent-harness-registry.test-support';
import { listedHarnesses, registeredProfiles } from './harness-profiles';

describe('registeredProfiles', () => {
  it('registeredProfiles_TwoHarnesses_SlotOrderThenProfileOrder', () => {
    const infos = new Map<string, AgentHarnessInfo>([
      [
        'b',
        harnessInfo({
          profiles: [
            { name: 'x', configDir: '/x' },
            { name: 'y', configDir: '/y' },
          ],
        }),
      ],
      ['a', harnessInfo({ profiles: [{ name: 'z', configDir: '/z' }] })],
    ]);

    expect(registeredProfiles(infos)).toEqual([
      { harnessId: 'b', name: 'x', configDir: '/x' },
      { harnessId: 'b', name: 'y', configDir: '/y' },
      { harnessId: 'a', name: 'z', configDir: '/z' },
    ]);
    expect(registeredProfiles(new Map())).toEqual([]);
  });
});

describe('listedHarnesses', () => {
  const listed = (label: string) => harnessInfo({ label });
  const unlisted = (label: string) => harnessInfo({ label, unlisted: true });

  it.each<{
    given: string;
    infos: [string, AgentHarnessInfo][];
    expected: string[];
  }>([
    {
      given: 'an unlisted entry between two listed',
      infos: [
        ['c', listed('C')],
        ['demo', unlisted('Demo')],
        ['a', listed('A')],
      ],
      expected: ['c', 'a'],
    },
    {
      given: 'every entry unlisted',
      infos: [
        ['demo', unlisted('Demo')],
        ['other', unlisted('Other')],
      ],
      expected: [],
    },
    {
      given: 'no entry unlisted',
      infos: [
        ['b', listed('B')],
        ['a', listed('A')],
      ],
      expected: ['b', 'a'],
    },
  ])(
    'listedHarnesses_Infos_KeepsListedEntriesInKeyOrder given $given',
    ({ infos, expected }) => {
      const source = new Map(infos);

      const result = listedHarnesses(source);

      expect([...result.keys()]).toEqual(expected);
      for (const id of expected) {
        expect(result.get(id)).toBe(source.get(id));
      }
    },
  );
});
