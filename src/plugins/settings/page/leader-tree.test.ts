import { describe, expect, it } from 'vitest';
import type {
  KeyBind,
  KeyGroups,
  UserKeymap,
  ViewScope,
} from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import {
  freeKeys,
  keyTaken,
  type LeaderGroup,
  leaderTree,
} from './leader-tree';

function command(id: string, group: string): CommandInfo {
  const [plugin] = id.split('.');
  return { id, plugin, label: `${id} label`, group, runsIn: 'page' };
}

const COMMANDS = {
  'p.a': command('p.a', 'one'),
  'p.b': command('p.b', 'two'),
  'p.c': command('p.c', 'one'),
  'p.d': command('p.d', 'three'),
  'p.e': command('p.e', 'two'),
  'p.f': command('p.f', 'four'),
};

function schema(
  binds: KeyBind[],
  defaultGroups: KeyGroups = {},
): UserConfigSchema {
  return {
    sections: [],
    commands: COMMANDS,
    scopes: [
      { id: 'p.s', title: 'In s', plugin: 'p' },
      { id: 'p.t', title: 'In t', plugin: 'p' },
    ],
    defaultBindLayers: [binds],
    defaultAccelerators: { app: [], global: [], intercept: [] },
    defaultGroups,
    defaultLeader: '<Space>',
  };
}

const bind = (
  keys: string,
  cmd: string,
  scope: ViewScope = 'any',
): KeyBind => ({
  keys,
  scope,
  command: cmd,
});

function group(tree: readonly LeaderGroup[], prefix: string): LeaderGroup {
  const found = tree.find((each) => each.prefix === prefix);
  if (found === undefined) {
    throw new Error(`no group ${prefix} in ${tree.map((each) => each.prefix)}`);
  }
  return found;
}

// Each entry of `group` as `item <key> <scope>` or `group <key>`.
function entryLines(found: LeaderGroup): string[] {
  return found.entries.map((entry) =>
    entry.type === 'item'
      ? `item ${entry.item.key} ${entry.item.line.bind.scope}`
      : `group ${entry.key}`,
  );
}

describe('leaderTree', () => {
  it('leaderTree_GroupsAndOrder', () => {
    const tree = leaderTree(
      schema([
        bind('<Leader>zlo', 'p.a'),
        bind('<Leader>bd', 'p.b'),
        bind('<Leader>zg', 'p.c'),
        bind('<Leader>;', 'p.d'),
        bind('<Leader>bn', 'p.e'),
      ]),
      null,
    );

    expect(tree.map((each) => each.prefix)).toEqual([
      '<Leader>',
      '<Leader>b',
      '<Leader>z',
      '<Leader>zl',
    ]);
    expect(entryLines(group(tree, '<Leader>z'))).toEqual([
      'item g any',
      'group l',
    ]);
    expect(entryLines(group(tree, '<Leader>'))).toEqual([
      'group b',
      'group z',
      'item ; any',
    ]);
  });

  const NAMED_BINDS = [
    bind('<Leader>bxe', 'p.a'),
    bind('<Leader>bd', 'p.b'),
    bind('<Leader>bn', 'p.c'),
    bind('<Leader>be', 'p.e'),
  ];

  it.each<{
    case: string;
    layer: UserKeymap | null;
    defaults: KeyGroups;
    prefix: string;
    expected: { name: string; isNamed: boolean; isSet: boolean };
  }>([
    {
      case: "the user's entry",
      layer: { groups: { '<leader>b': 'mine' } },
      defaults: { '<Leader>b': 'theirs' },
      prefix: '<Leader>b',
      expected: { name: 'mine', isNamed: true, isSet: true },
    },
    {
      case: 'a default entry',
      layer: null,
      defaults: { '<Leader>b': 'theirs' },
      prefix: '<Leader>b',
      expected: { name: 'theirs', isNamed: true, isSet: false },
    },
    {
      case: "the user's entry spelling the leader",
      layer: { groups: { '<Space>b': 'mine' } },
      defaults: { '<Leader>b': 'theirs' },
      prefix: '<Leader>b',
      expected: { name: 'mine', isNamed: true, isSet: true },
    },
    {
      case: 'a default entry spelling the leader',
      layer: null,
      defaults: { '<Space>b': 'theirs' },
      prefix: '<Leader>b',
      expected: { name: 'theirs', isNamed: true, isSet: false },
    },
    {
      case: 'none: the manifest groups at any depth in tree order',
      layer: null,
      defaults: {},
      prefix: '<Leader>b',
      expected: { name: 'two, one', isNamed: false, isSet: false },
    },
    {
      case: 'the top level',
      layer: { groups: { '<Leader>': 'nope' } },
      defaults: {},
      prefix: '<Leader>',
      expected: { name: 'Top level', isNamed: false, isSet: false },
    },
  ])('leaderTree_GroupName: $case', ({ layer, defaults, prefix, expected }) => {
    const tree = leaderTree(schema(NAMED_BINDS, defaults), layer);

    const { name, isNamed, isSet } = group(tree, prefix);

    expect({ name, isNamed, isSet }).toEqual(expected);
  });

  it.each<{
    case: string;
    layer: UserKeymap;
    defaults: KeyGroups;
    prefix: string;
    entries: string[] | null;
  }>([
    {
      case: 'a removed default is left out',
      layer: { unbind: [{ keys: '<Leader>qa', scope: 'any' }] },
      defaults: {},
      prefix: '<Leader>q',
      entries: null,
    },
    {
      case: 'a user groups entry with no binds is listed empty',
      layer: { groups: { '<Leader>w': 'wide' } },
      defaults: {},
      prefix: '<Leader>w',
      entries: [],
    },
    {
      case: 'a user groups entry spelling the leader is listed',
      layer: { groups: { '<Space>w': 'wide' } },
      defaults: {},
      prefix: '<Leader>w',
      entries: [],
    },
    {
      case: 'a default groups entry with no binds is not listed',
      layer: {},
      defaults: { '<Leader>y': 'why' },
      prefix: '<Leader>y',
      entries: null,
    },
  ])('leaderTree_Listed: $case', ({ layer, defaults, prefix, entries }) => {
    const tree = leaderTree(
      schema([bind('<Leader>qa', 'p.a')], defaults),
      layer,
    );

    const found = tree.find((each) => each.prefix === prefix);

    expect(found === undefined ? null : entryLines(found)).toEqual(entries);
  });

  it('leaderTree_KeyOrder', () => {
    const tree = leaderTree(
      schema([
        bind('<Leader>d', 'p.a'),
        bind('<Leader>D', 'p.b'),
        bind('<Leader>a', 'p.c'),
        bind('<Leader>1', 'p.d'),
        bind('<Leader>;', 'p.e'),
        bind('<Leader><Leader>', 'p.f'),
      ]),
      null,
    );

    expect(
      group(tree, '<Leader>').entries.map((entry) =>
        entry.type === 'item' ? entry.item.key : entry.key,
      ),
    ).toEqual(['a', 'd', 'D', '1', ';', '<Leader>']);
  });

  // Each spelling of a key sorts to the one place which-key sorts it.
  it.each([
    { bar: '<Bar>', enter: '<CR>' },
    { bar: '|', enter: '<Return>' },
  ])(
    'leaderTree_KeySpellings_SortToOnePlace: $bar $enter',
    ({ bar, enter }) => {
      const tree = leaderTree(
        schema([
          bind(`<Leader>${bar}`, 'p.a'),
          bind('<Leader><Tab>', 'p.b'),
          bind(`<Leader>${enter}`, 'p.c'),
          bind('<Leader><Esc>', 'p.d'),
          bind('<Leader>;', 'p.e'),
        ]),
        null,
      );

      expect(
        group(tree, '<Leader>').entries.map((entry) =>
          entry.type === 'item' ? entry.item.key : entry.key,
        ),
      ).toEqual([';', enter, '<Esc>', '<Tab>', bar]);
    },
  );

  it('leaderTree_OneKeyInTwoScopes_TwoItemsInScopeOrder', () => {
    const tree = leaderTree(
      schema([
        bind('<Leader><Leader>', 'p.a', 'p.t'),
        bind('<Leader><Leader>', 'p.b', 'p.s'),
        bind('<Leader>x', 'p.c', 'p.t'),
        bind('<Leader>x', 'p.d', 'any'),
      ]),
      null,
    );

    expect(entryLines(group(tree, '<Leader>'))).toEqual([
      'item x any',
      'item x p.t',
      'item <Leader> p.s',
      'item <Leader> p.t',
    ]);
  });
});

describe('keyTaken', () => {
  const tree = leaderTree(
    schema([
      bind('<Leader>a', 'p.a', 'any'),
      bind('<Leader>s', 'p.b', 'p.s'),
      bind('<Leader>zg', 'p.c'),
    ]),
    null,
  );
  const top = group(tree, '<Leader>');
  const lineOn = (key: string) => {
    const entry = top.entries.find(
      (each) => each.type === 'item' && each.item.key === key,
    );
    if (entry?.type !== 'item') {
      throw new Error(`no item ${key}`);
    }
    return entry.item.line;
  };

  it.each<{
    case: string;
    key: string;
    scope: ViewScope | null;
    excluded: string[];
    expected: string | null;
  }>([
    {
      case: 'NoScope_AnyItem_Taken',
      key: 'a',
      scope: null,
      excluded: [],
      expected: 'item a',
    },
    {
      case: 'NoScope_ScopedItem_Free',
      key: 's',
      scope: null,
      excluded: [],
      expected: null,
    },
    {
      case: 'EqualScopes_Taken',
      key: 's',
      scope: 'p.s',
      excluded: [],
      expected: 'item s',
    },
    {
      case: 'OtherScope_Free',
      key: 's',
      scope: 'p.t',
      excluded: [],
      expected: null,
    },
    {
      case: 'AnyAgainstAScope_Taken',
      key: 's',
      scope: 'any',
      excluded: [],
      expected: 'item s',
    },
    {
      case: 'AnExcludedLine_Free',
      key: 'a',
      scope: 'any',
      excluded: ['s', 'a'],
      expected: null,
    },
    {
      case: 'ANestedGroup_Group',
      key: 'z',
      scope: 'any',
      excluded: [],
      expected: 'group <Leader>z',
    },
  ])('keyTaken_$case', ({ key, scope, excluded, expected }) => {
    const taken = keyTaken(tree, top, key, scope, excluded.map(lineOn));

    const shown =
      taken === null
        ? null
        : taken.type === 'item'
          ? `item ${taken.item.key}`
          : `group ${taken.group.prefix}`;
    expect(shown).toEqual(expected);
  });
});

describe('freeKeys', () => {
  it('freeKeys_ListsUnusedLettersThenDigits', () => {
    const letters = [...'abcdefghijklmnopqrstuvwxy'];
    const tree = leaderTree(
      schema([
        ...letters.map((key) => bind(`<Leader>${key}`, 'p.a')),
        bind('<Leader>Z', 'p.b'),
        bind('<Leader>0', 'p.c', 'p.s'),
        bind('<Leader>3g', 'p.d'),
      ]),
      null,
    );

    expect(freeKeys(group(tree, '<Leader>'))).toEqual([
      'z',
      '1',
      '2',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ]);
  });
});
