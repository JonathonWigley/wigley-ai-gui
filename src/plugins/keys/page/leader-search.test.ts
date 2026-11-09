import { describe, expect, it } from 'vitest';
import type { Keymap, PageBind } from '../../../contracts/keymap';
import { type LeaderAction, leaderActions } from './leader-search';

function keymap(page: PageBind[], leader = '<Space>'): Keymap {
  return {
    editor: { leader, remaps: [], binds: [] },
    page,
    app: [],
    intercept: [],
    global: [],
    groups: {},
  };
}

const label = (id: string) => `label of ${id}`;

describe('leaderActions', () => {
  it.each([
    {
      case: 'a leader bind in the scope in force',
      page: [{ keys: [' ', 'b', 'n'], scope: 's', command: 'p.newSession' }],
      rows: [
        {
          command: 'p.newSession',
          label: 'label of p.newSession',
          keys: 'Space b n',
        },
      ],
    },
    {
      case: 'a leader bind in any scope',
      page: [{ keys: [' ', '?'], scope: 'any', command: 'p.help' }],
      rows: [{ command: 'p.help', label: 'label of p.help', keys: 'Space ?' }],
    },
    {
      case: 'a leader bind in another scope',
      page: [{ keys: [' ', 'x'], scope: 'other', command: 'p.other' }],
      rows: [],
    },
    {
      case: 'a page bind not under the leader',
      page: [{ keys: ['g', 'g'], scope: 's', command: 'p.top' }],
      rows: [],
    },
    {
      case: 'the search itself',
      page: [{ keys: [' ', '/'], scope: 'any', command: 'keys.searchLeader' }],
      rows: [],
    },
    {
      case: 'one command on two leader keys',
      page: [
        { keys: [' ', ';'], scope: 'any', command: 'p.close' },
        { keys: [' ', 'b', 'd'], scope: 'any', command: 'p.close' },
      ],
      rows: [
        {
          command: 'p.close',
          label: 'label of p.close',
          keys: 'Space ; / Space b d',
        },
      ],
    },
    {
      case: 'one command on two leader keys with their own args',
      page: [
        { keys: [' ', 'a', '1'], scope: 's', command: 'p.choose', arg: 1 },
        { keys: [' ', 'a', '2'], scope: 's', command: 'p.choose', arg: 2 },
      ],
      rows: [
        {
          command: 'p.choose',
          arg: 1,
          label: 'label of p.choose',
          keys: 'Space a 1',
        },
        {
          command: 'p.choose',
          arg: 2,
          label: 'label of p.choose',
          keys: 'Space a 2',
        },
      ],
    },
    {
      case: 'one command on two leader keys with one record arg',
      page: [
        {
          keys: [' ', 'm', 'a'],
          scope: 's',
          command: 'p.move',
          arg: { to: 'a' },
        },
        {
          keys: [' ', 'm', 'b'],
          scope: 's',
          command: 'p.move',
          arg: { to: 'a' },
        },
      ],
      rows: [
        {
          command: 'p.move',
          arg: { to: 'a' },
          label: 'label of p.move',
          keys: 'Space m a / Space m b',
        },
      ],
    },
    {
      case: 'one command on three leader keys with differing record args',
      page: [
        {
          keys: [' ', 'm', 'a'],
          scope: 's',
          command: 'p.move',
          arg: { to: 'a' },
        },
        {
          keys: [' ', 'm', 'b'],
          scope: 's',
          command: 'p.move',
          arg: { to: 'b' },
        },
        {
          keys: [' ', 'm', 'c'],
          scope: 's',
          command: 'p.move',
          arg: { to: 'a', by: 2 },
        },
      ],
      rows: [
        {
          command: 'p.move',
          arg: { to: 'a' },
          label: 'label of p.move',
          keys: 'Space m a',
        },
        {
          command: 'p.move',
          arg: { to: 'b' },
          label: 'label of p.move',
          keys: 'Space m b',
        },
        {
          command: 'p.move',
          arg: { to: 'a', by: 2 },
          label: 'label of p.move',
          keys: 'Space m c',
        },
      ],
    },
    {
      case: 'a comma leader',
      leader: ',',
      page: [
        { keys: [',', 'b', 'd'], scope: 's', command: 'p.close' },
        { keys: [' ', 'b', 'd'], scope: 's', command: 'p.other' },
      ],
      rows: [{ command: 'p.close', label: 'label of p.close', keys: ', b d' }],
    },
  ] as {
    case: string;
    leader?: string;
    page: PageBind[];
    rows: LeaderAction[];
  }[])(
    'leaderActions_Keymap_ListsTheLeaderPageBindsInForce $case',
    ({ leader, page, rows }) => {
      expect(leaderActions(keymap(page, leader), 's', label, 'macos')).toEqual(
        rows,
      );
    },
  );
});
