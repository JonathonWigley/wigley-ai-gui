import { describe, expect, it } from 'vitest';
import type { Keymap, PageBind } from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import { whichKeyModel } from './which-key';

const COMMANDS: Record<string, { label: string; group: string }> = {
  choose1: { label: 'pick a choice', group: 'choices' },
  choose2: { label: 'pick a choice', group: 'choices' },
  nextUnanswered: { label: 'next unanswered', group: 'questions' },
  openReview: { label: 'review', group: 'review' },
  submit: { label: 'submit', group: 'review' },
  closeTab: { label: 'close the tab', group: 'tabs' },
  other: { label: 'other scope', group: 'other' },
  splitRight: { label: 'split right', group: 'panes' },
  splitDown: { label: 'split down', group: 'panes' },
};

function command(id: string): CommandInfo | undefined {
  const decl = COMMANDS[id];
  return decl === undefined
    ? undefined
    : { ...decl, id, plugin: 'test', runsIn: 'page' };
}

const label = (id: string) => command(id)?.label ?? id;

function keymap(
  page: PageBind[],
  editor: Keymap['editor']['binds'] = [],
  groups: Keymap['groups'] = {},
  leader = '<Space>',
) {
  return {
    editor: { leader, remaps: [], binds: editor },
    page,
    app: [],
    intercept: [],
    global: [],
    groups,
  } satisfies Keymap;
}

describe('whichKeyModel', () => {
  it('groups a page scope by next key in key order', () => {
    const map = keymap([
      { keys: [' ', ' '], scope: 's', command: 'openReview' },
      { keys: [' ', ';'], scope: 'any', command: 'closeTab' },
      { keys: [' ', 'a', '1'], scope: 's', command: 'choose1' },
      { keys: [' ', 'x'], scope: 'elsewhere', command: 'other' },
      { keys: [' ', 'a', '2'], scope: 's', command: 'choose2' },
    ]);

    const model = whichKeyModel(
      { where: 'page', keys: [' '], scope: 's' },
      map,
      command,
      label,
      'macos',
    );

    expect(model).toEqual({
      title: 'Space',
      name: null,
      entries: [
        { keys: 'a', label: 'choices', kind: 'prefix' },
        { keys: ';', label: 'close the tab', kind: 'command' },
        { keys: 'Space', label: 'review', kind: 'command' },
      ],
    });
  });

  // Each spelling of a key sorts to the one place the Leader menu sorts it.
  it.each<{ where: 'page' | 'editor'; map: Keymap; pending: string }>([
    {
      where: 'page',
      map: keymap(
        [
          { keys: [' ', '|'], scope: 'any', command: 'splitRight' },
          { keys: [' ', 'Backspace'], scope: 'any', command: 'closeTab' },
          { keys: [' ', 'Enter'], scope: 'any', command: 'submit' },
          { keys: [' ', ';'], scope: 'any', command: 'openReview' },
          { keys: [' ', 'a'], scope: 'any', command: 'nextUnanswered' },
        ],
        [],
      ),
      pending: ' ',
    },
    {
      where: 'editor',
      map: keymap(
        [],
        [
          { keys: '<Leader><Bar>', scope: 'any', command: 'splitRight' },
          { keys: '<Leader><BS>', scope: 'any', command: 'closeTab' },
          { keys: '<Leader><CR>', scope: 'any', command: 'submit' },
          { keys: '<Leader>;', scope: 'any', command: 'openReview' },
          { keys: '<Leader>a', scope: 'any', command: 'nextUnanswered' },
        ],
      ),
      pending: '<Space>',
    },
  ])(
    'sorts the spellings of a key to one place: $where',
    ({ where, map, pending }) => {
      const model = whichKeyModel(
        { where, keys: [pending], scope: 's' },
        map,
        command,
        label,
        'macos',
      );

      expect(model?.entries.map((entry) => entry.keys)).toEqual([
        'a',
        ';',
        '⌫',
        '↩',
        '|',
      ]);
    },
  );

  it('joins groups that a prefix spans', () => {
    const map = keymap([
      { keys: [' ', 'e', 'n'], scope: 's', command: 'nextUnanswered' },
      { keys: [' ', 'e', 'r'], scope: 's', command: 'submit' },
      { keys: [' ', 'e', 'o'], scope: 's', command: 'openReview' },
    ]);

    const model = whichKeyModel(
      { where: 'page', keys: [' '], scope: 's' },
      map,
      command,
      label,
      'macos',
    );

    expect(model?.entries).toEqual([
      { keys: 'e', label: 'questions, review', kind: 'prefix' },
    ]);
  });

  const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  const choose = (id: string): CommandInfo => ({
    id,
    plugin: 'forms',
    label: 'pick a choice',
    group: 'choices',
    runsIn: 'page',
    arg: 'number',
  });

  it.each([
    {
      case: 'over nine commands',
      binds: DIGITS.map((digit) => ({
        keys: [' ', digit],
        scope: 's',
        command: `jumpTo${digit}`,
      })),
      lookup: command,
      shown: 'go to question',
    },
    {
      case: 'over one command bound nine times, each with its own arg',
      binds: DIGITS.map((digit) => ({
        keys: [' ', digit],
        scope: 's',
        command: 'forms.choose',
        arg: Number(digit),
      })),
      lookup: choose,
      shown: 'pick a choice',
    },
  ] as {
    case: string;
    binds: PageBind[];
    lookup: (id: string) => CommandInfo | undefined;
    shown: string;
  }[])(
    'prints a digit run as one range line $case',
    ({ binds, lookup, shown }) => {
      const model = whichKeyModel(
        { where: 'page', keys: [' '], scope: 's' },
        keymap(binds),
        lookup,
        () => shown,
        'macos',
      );

      expect(model?.entries).toEqual([
        { keys: '1–9', label: shown, kind: 'command' },
      ]);
    },
  );

  it('reads leader tokens in the editor', () => {
    const map = keymap(
      [],
      [
        { keys: '<Leader>a1', scope: 'any', command: 'choose1' },
        { keys: 'zz', scope: 'any', command: 'other' },
      ],
    );

    const model = whichKeyModel(
      { where: 'editor', keys: ['<Space>'], scope: 's' },
      map,
      command,
      label,
      'macos',
    );

    expect(model).toEqual({
      title: 'Space',
      name: null,
      entries: [{ keys: 'a', label: 'choices', kind: 'prefix' }],
    });
  });

  it('returns null with no candidates', () => {
    const map = keymap([
      { keys: [' ', ' '], scope: 's', command: 'openReview' },
      { keys: ['g'], scope: 's', command: 'other' },
    ]);

    const model = whichKeyModel(
      { where: 'page', keys: ['g'], scope: 's' },
      map,
      command,
      label,
      'macos',
    );

    expect(model).toBeNull();
  });

  it('lists in a box only the editor binds firing in the pending scope', () => {
    const map = keymap(
      [],
      [
        { keys: '<Leader>x', scope: 'a.view', command: 'choose1' },
        { keys: '<Leader>y', scope: 'b.other', command: 'other' },
      ],
    );

    const model = whichKeyModel(
      { where: 'editor', keys: ['<Space>'], scope: 'a.view' },
      map,
      command,
      label,
      'macos',
    );

    expect(model?.entries.map((entry) => entry.keys)).toEqual(['x']);
  });

  const splitsOnPage = (leader: string): PageBind[] => [
    { keys: [leader, 'k', 's'], scope: 's', command: 'splitRight' },
    { keys: [leader, 'k', 'd'], scope: 's', command: 'splitDown' },
  ];

  it.each([
    {
      case: 'on the page',
      leader: '<Space>',
      page: splitsOnPage(' '),
      editor: [],
      groups: { '<Leader>k': 'windows' },
      pending: { where: 'page', keys: [' '], scope: 's' },
    },
    {
      case: 'in a box',
      leader: '<Space>',
      page: [],
      editor: [
        { keys: '<Leader>ks', scope: 's', command: 'splitRight' },
        { keys: '<Leader>kd', scope: 's', command: 'splitDown' },
      ],
      groups: { '<Leader>k': 'windows' },
      pending: { where: 'editor', keys: ['<Space>'], scope: 's' },
    },
    {
      case: 'with a backslash leader',
      leader: '\\',
      page: splitsOnPage('\\'),
      editor: [],
      groups: { '<Leader>k': 'windows' },
      pending: { where: 'page', keys: ['\\'], scope: 's' },
    },
    {
      case: 'with a lowercase <space> leader, past a group no key presses',
      leader: '<space>',
      page: splitsOnPage(' '),
      editor: [],
      groups: { '<Leader><F5>': 'debug', '<Leader>k': 'windows' },
      pending: { where: 'page', keys: [' '], scope: 's' },
    },
  ] as {
    case: string;
    leader: string;
    page: PageBind[];
    editor: Keymap['editor']['binds'];
    groups: Keymap['groups'];
    pending: Parameters<typeof whichKeyModel>[0];
  }[])(
    "labels a named group's prefix $case",
    ({ leader, page, editor, groups, pending }) => {
      const map = keymap(page, editor, groups, leader);

      const model = whichKeyModel(pending, map, command, label, 'macos');

      expect(model?.entries).toEqual([
        { keys: 'k', label: 'windows', kind: 'prefix' },
      ]);
    },
  );

  it.each([
    {
      case: 'a named page group',
      page: [{ keys: [' ', 'b', 'd'], scope: 's', command: 'closeTab' }],
      editor: [],
      groups: { '<Leader>b': 'session' },
      pending: { where: 'page', keys: [' ', 'b'], scope: 's' },
      name: 'session',
    },
    {
      case: 'the bare leader',
      page: [{ keys: [' ', 'b', 'd'], scope: 's', command: 'closeTab' }],
      editor: [],
      groups: { '<Leader>b': 'session' },
      pending: { where: 'page', keys: [' '], scope: 's' },
      name: null,
    },
    {
      case: 'a prefix no group names',
      page: [{ keys: [' ', 'f', 'd'], scope: 's', command: 'closeTab' }],
      editor: [],
      groups: { '<Leader>b': 'session' },
      pending: { where: 'page', keys: [' ', 'f'], scope: 's' },
      name: null,
    },
    {
      case: 'a named group in a box',
      page: [],
      editor: [{ keys: '<Leader>bd', scope: 's', command: 'closeTab' }],
      groups: { '<Leader>b': 'session' },
      pending: { where: 'editor', keys: ['<Space>', 'b'], scope: 's' },
      name: 'session',
    },
  ] as {
    case: string;
    page: PageBind[];
    editor: Keymap['editor']['binds'];
    groups: Keymap['groups'];
    pending: Parameters<typeof whichKeyModel>[0];
    name: string | null;
  }[])(
    'names the header of the pending keys by their group $case',
    ({ page, editor, groups, pending, name }) => {
      const map = keymap(page, editor, groups);

      const model = whichKeyModel(pending, map, command, label, 'macos');

      expect(model?.name).toBe(name);
    },
  );

  it('keeps command groups under an unnamed prefix', () => {
    const map = keymap([
      { keys: [' ', 'k', 's'], scope: 's', command: 'splitRight' },
      { keys: [' ', 'k', 'd'], scope: 's', command: 'splitDown' },
    ]);

    const model = whichKeyModel(
      { where: 'page', keys: [' '], scope: 's' },
      map,
      command,
      label,
      'macos',
    );

    expect(model?.entries).toEqual([
      { keys: 'k', label: 'panes', kind: 'prefix' },
    ]);
  });
});
