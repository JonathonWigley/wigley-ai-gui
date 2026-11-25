import { describe, expect, it } from 'vitest';
import type { ModePlace } from '../../contracts/plugin';
import type { ActivityBarSetting } from '../../contracts/settings';
import {
  arrangeActivityItems,
  type ActivityGroups,
  type ActivityModeEntry,
} from './activity-order';

function mode(
  id: string,
  firstAdd: number,
  place?: ModePlace,
): ActivityModeEntry {
  return { id, place, firstAdd };
}

const NO_SETTING: ActivityBarSetting = { groups: [], hidden: [] };

// Added out of id order; `m.alpha` and `m.eps` share a group.
const MODES = [
  mode('m.beta', 0, { group: 2, order: 1 }),
  mode('m.delta', 1),
  mode('m.eps', 2, { group: 1, order: 9 }),
  mode('m.alpha', 3, { group: 1, order: 4 }),
  mode('m.gamma', 4, { group: 6, order: 2, at: 'bottom' }),
];

describe('arrangeActivityItems', () => {
  it.each<{
    row: string;
    modes: ActivityModeEntry[];
    setting: ActivityBarSetting;
    groups: ActivityGroups;
  }>([
    {
      row: 'suggestions across both edges, ties by first add',
      modes: [
        mode('s.one', 4, { group: 2, order: 5 }),
        mode('s.two', 1, { group: 7, order: 3 }),
        mode('s.three', 3, { group: 2, order: 1 }),
        mode('s.four', 0, { group: 7, order: 8, at: 'bottom' }),
        mode('s.five', 2, { group: 2, order: 5 }),
        mode('s.six', 5, { group: 9, order: 2, at: 'bottom' }),
      ],
      setting: NO_SETTING,
      groups: {
        top: [['s.three', 's.five', 's.one'], ['s.two']],
        bottom: [['s.four'], ['s.six']],
      },
    },
    {
      row: 'modes with no place form a last top group',
      modes: [
        mode('p.a', 3),
        mode('p.b', 0, { group: 4, order: 6 }),
        mode('p.c', 1),
        mode('p.d', 2, { group: 1, order: 2, at: 'bottom' }),
      ],
      setting: NO_SETTING,
      groups: { top: [['p.b'], ['p.c', 'p.a']], bottom: [['p.d']] },
    },
    {
      row: 'setting groups with a bottom group',
      modes: MODES,
      setting: {
        groups: [
          { modes: ['m.beta', 'm.alpha'] },
          { modes: ['m.gamma', 'm.delta'], at: 'bottom' },
          { modes: ['m.eps'] },
        ],
        hidden: [],
      },
      groups: {
        top: [['m.beta', 'm.alpha'], ['m.eps']],
        bottom: [['m.gamma', 'm.delta']],
      },
    },
    {
      row: 'unlisted modes, a bottom suggestion included, after the last top group',
      modes: MODES,
      setting: {
        groups: [{ modes: ['m.alpha'] }, { modes: ['m.delta'], at: 'bottom' }],
        hidden: [],
      },
      groups: {
        top: [['m.alpha'], ['m.eps', 'm.beta', 'm.gamma']],
        bottom: [['m.delta']],
      },
    },
    {
      row: 'an unknown id is skipped',
      modes: MODES,
      setting: {
        groups: [{ modes: ['gone.mode', 'm.gamma', 'm.alpha'] }],
        hidden: [],
      },
      groups: {
        top: [
          ['m.gamma', 'm.alpha'],
          ['m.eps', 'm.beta', 'm.delta'],
        ],
        bottom: [],
      },
    },
    {
      row: 'an id listed twice keeps its first place',
      modes: MODES,
      setting: {
        groups: [
          { modes: ['m.beta', 'm.alpha', 'm.beta'] },
          { modes: ['m.alpha', 'm.gamma'], at: 'bottom' },
        ],
        hidden: [],
      },
      groups: {
        top: [
          ['m.beta', 'm.alpha'],
          ['m.eps', 'm.delta'],
        ],
        bottom: [['m.gamma']],
      },
    },
    {
      row: 'hidden without groups',
      modes: MODES,
      setting: { groups: [], hidden: ['m.alpha', 'm.delta'] },
      groups: { top: [['m.eps'], ['m.beta']], bottom: [['m.gamma']] },
    },
    {
      row: 'hidden with groups',
      modes: MODES,
      setting: {
        groups: [{ modes: ['m.gamma', 'm.beta'] }],
        hidden: ['m.beta', 'm.eps'],
      },
      groups: { top: [['m.gamma'], ['m.alpha', 'm.delta']], bottom: [] },
    },
    {
      row: 'a group emptied by hidden is dropped',
      modes: MODES,
      setting: {
        groups: [
          { modes: ['m.alpha'] },
          { modes: ['m.beta'], at: 'bottom' },
          { modes: ['m.gamma', 'm.delta', 'm.eps'] },
        ],
        hidden: ['m.beta'],
      },
      groups: {
        top: [['m.alpha'], ['m.gamma', 'm.delta', 'm.eps']],
        bottom: [],
      },
    },
    {
      row: 'a group of only unknown ids is dropped',
      modes: MODES,
      setting: {
        groups: [
          { modes: ['gone.one', 'gone.two'], at: 'bottom' },
          { modes: ['m.delta'] },
        ],
        hidden: [],
      },
      groups: {
        top: [['m.delta'], ['m.alpha', 'm.eps', 'm.beta', 'm.gamma']],
        bottom: [],
      },
    },
    {
      row: 'every setting group at the bottom, the unlisted modes first on top',
      modes: MODES,
      setting: {
        groups: [
          { modes: ['m.gamma'], at: 'bottom' },
          { modes: ['m.alpha', 'm.eps'], at: 'bottom' },
        ],
        hidden: [],
      },
      groups: {
        top: [['m.beta', 'm.delta']],
        bottom: [['m.gamma'], ['m.alpha', 'm.eps']],
      },
    },
    {
      row: 'malformed groups, ids, at and hidden are skipped or read as top',
      modes: MODES,
      setting: {
        groups: [
          'm.alpha',
          { at: 'bottom' },
          { modes: ['m.beta', 7, 'm.gamma'], at: 'left' },
        ],
        hidden: 'm.eps',
      } as unknown as ActivityBarSetting,
      groups: {
        top: [
          ['m.beta', 'm.gamma'],
          ['m.alpha', 'm.eps', 'm.delta'],
        ],
        bottom: [],
      },
    },
    {
      row: 'groups holding no well-formed group keep the suggestions',
      modes: MODES,
      setting: {
        groups: ['m.alpha'],
        hidden: [],
      } as unknown as ActivityBarSetting,
      groups: {
        top: [['m.alpha', 'm.eps'], ['m.beta'], ['m.delta']],
        bottom: [['m.gamma']],
      },
    },
  ])(
    'arrangeActivityItems_SortsAndGroupsModes: $row',
    ({ modes, setting, groups }) => {
      expect(arrangeActivityItems(modes, setting)).toEqual(groups);
    },
  );
});
