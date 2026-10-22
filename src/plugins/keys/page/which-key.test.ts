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
  it('whichKeyModel_PageScope_GroupsByNextKeyInKeymapOrder', () => {
    const map = keymap([
      { keys: [' ', 'a', '1'], scope: 's', command: 'choose1' },
      { keys: [' ', 'x'], scope: 'elsewhere', command: 'other' },
      { keys: [' ', 'a', '2'], scope: 's', command: 'choose2' },
      { keys: [' ', ' '], scope: 's', command: 'openReview' },
      { keys: [' ', ';'], scope: 'any', command: 'closeTab' },
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
      entries: [
        { keys: 'a', label: '+choices', kind: 'prefix' },
        { keys: 'Space', label: 'review', kind: 'command' },
        { keys: ';', label: 'close the tab', kind: 'command' },
      ],
    });
  });

  it('whichKeyModel_PrefixSpanningGroups_JoinsGroups', () => {
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
      { keys: 'e', label: '+questions, review', kind: 'prefix' },
    ]);
  });

  it('whichKeyModel_DigitRun_MergesToRange', () => {
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const map = keymap(
      digits.map((digit) => ({
        keys: [' ', digit],
        scope: 's',
        command: `jumpTo${digit}`,
      })),
    );

    const model = whichKeyModel(
      { where: 'page', keys: [' '], scope: 's' },
      map,
      command,
      () => 'go to question',
      'macos',
    );

    expect(model?.entries).toEqual([
      { keys: '1–9', label: 'go to question', kind: 'command' },
    ]);
  });

  it('whichKeyModel_Editor_ReadsLeaderTokens', () => {
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
      entries: [{ keys: 'a', label: '+choices', kind: 'prefix' }],
    });
  });

  it('whichKeyModel_NoCandidates_ReturnsNull', () => {
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

  it('whichKeyModel_NamedGroup_LabelsPrefix', () => {
    const map = keymap(
      [
        { keys: [' ', 'k', 's'], scope: 's', command: 'splitRight' },
        { keys: [' ', 'k', 'd'], scope: 's', command: 'splitDown' },
      ],
      [],
      { '<Leader>k': 'windows' },
    );

    const model = whichKeyModel(
      { where: 'page', keys: [' '], scope: 's' },
      map,
      command,
      label,
      'macos',
    );

    expect(model?.entries).toEqual([
      { keys: 'k', label: '+windows', kind: 'prefix' },
    ]);
  });

  it('whichKeyModel_NamedGroupInBox_LabelsPrefix', () => {
    const map = keymap(
      [],
      [
        { keys: '<Leader>ks', scope: 's', command: 'splitRight' },
        { keys: '<Leader>kd', scope: 's', command: 'splitDown' },
      ],
      { '<Leader>k': 'windows' },
    );

    const model = whichKeyModel(
      { where: 'editor', keys: ['<Space>'], scope: 's' },
      map,
      command,
      label,
      'macos',
    );

    expect(model?.entries).toEqual([
      { keys: 'k', label: '+windows', kind: 'prefix' },
    ]);
  });

  it('whichKeyModel_NamedGroupBackslashLeader_LabelsPrefix', () => {
    const map = keymap(
      [
        { keys: ['\\', 'k', 's'], scope: 's', command: 'splitRight' },
        { keys: ['\\', 'k', 'd'], scope: 's', command: 'splitDown' },
      ],
      [],
      { '<Leader>k': 'windows' },
      '\\',
    );

    const model = whichKeyModel(
      { where: 'page', keys: ['\\'], scope: 's' },
      map,
      command,
      label,
      'macos',
    );

    expect(model?.entries).toEqual([
      { keys: 'k', label: '+windows', kind: 'prefix' },
    ]);
  });

  it('whichKeyModel_NamedGroupLowercaseSpaceLeader_LabelsPrefixPastUnpressableGroup', () => {
    const map = keymap(
      [
        { keys: [' ', 'k', 's'], scope: 's', command: 'splitRight' },
        { keys: [' ', 'k', 'd'], scope: 's', command: 'splitDown' },
      ],
      [],
      { '<Leader><F5>': 'debug', '<Leader>k': 'windows' },
      '<space>',
    );

    const model = whichKeyModel(
      { where: 'page', keys: [' '], scope: 's' },
      map,
      command,
      label,
      'macos',
    );

    expect(model?.entries).toEqual([
      { keys: 'k', label: '+windows', kind: 'prefix' },
    ]);
  });

  it('whichKeyModel_UnnamedPrefix_KeepsCommandGroups', () => {
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
      { keys: 'k', label: '+panes', kind: 'prefix' },
    ]);
  });
});
