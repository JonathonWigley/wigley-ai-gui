import { describe, expect, it } from 'vitest';
import type { CommandId } from '../contracts/commands';
import type { Keymap, PageBind } from '../contracts/keymap';
import {
  type CommandLabel,
  editorHints,
  formatKeys,
  formatVimToken,
  pageHints,
  vimTokens,
} from './key-hints';

const CHOICE_LABEL = 'pick a choice';

const LABELS: Partial<Record<CommandId, string>> = {
  'forms.choose1': CHOICE_LABEL,
  'forms.choose2': CHOICE_LABEL,
  'forms.choose3': CHOICE_LABEL,
  'test.back': 'back to the form',
};

// Unlabelled commands read as their ids, as the page API's lookup does.
const label: CommandLabel = (id) => LABELS[id] ?? id;

const choiceBinds: PageBind[] = ['1', '2', '3'].map((digit): PageBind => ({
  keys: [digit],
  scope: 'forms.forms',
  command: `forms.choose${digit}`,
}));

const keymap: Keymap = {
  editor: {
    leader: '<Space>',
    remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
    binds: [
      { keys: '<Leader>j', scope: 'any', command: 'test.nextBox' },
      { keys: '<Leader>1', scope: 'any', command: 'forms.choose1' },
      { keys: '<Leader>2', scope: 'any', command: 'forms.choose2' },
      { keys: '<Leader>3', scope: 'any', command: 'forms.choose3' },
    ],
  },
  page: [
    { keys: ['j'], scope: 'forms.forms', command: 'test.down' },
    ...choiceBinds,
    { keys: [' ', ' '], scope: 'forms.forms', command: 'test.review' },
    { keys: ['Escape'], scope: 'forms.review', command: 'test.back' },
    { keys: ['?'], scope: 'forms.help', command: 'test.close' },
    { keys: ['Escape'], scope: 'forms.help', command: 'test.close' },
    { keys: ['F1'], scope: 'any', command: 'test.anywhere' },
  ],
  app: [],
  intercept: [{ key: 'Tab', control: true, command: 'test.intercept' }],
  global: [{ accelerator: 'Control+Alt+Command+W', command: 'test.summon' }],
};

describe('formatKeys', () => {
  it('names Space and Escape and spaces a sequence', () => {
    expect(formatKeys([' ', ' '])).toBe('Space Space');
    expect(formatKeys(['Escape'])).toBe('Esc');
    expect(formatKeys(['z', 'a'])).toBe('z a');
  });
});

describe('pageHints', () => {
  it("lists the view's binds and the any-scope binds, in keymap order", () => {
    expect(
      pageHints(keymap.page, 'forms.forms', label).map((hint) => hint.keys),
    ).toEqual(['j', '1–3', 'Space Space', 'F1']);
  });

  it('lists the review binds with their labels, leaving out other views', () => {
    expect(pageHints(keymap.page, 'forms.review', label)).toEqual([
      { keys: 'Esc', label: 'back to the form' },
      { keys: 'F1', label: 'test.anywhere' },
    ]);
  });

  it('merges a run of digits with one label into a range', () => {
    expect(pageHints(keymap.page, 'forms.forms', label)[1]).toEqual({
      keys: '1–3',
      label: CHOICE_LABEL,
    });
  });

  it('joins other neighbours with one label', () => {
    expect(pageHints(keymap.page, 'forms.help', label)[0]).toEqual({
      keys: '? / Esc',
      label: 'test.close',
    });
  });
});

describe('editorHints', () => {
  it('spells the leader and merges the digit binds', () => {
    expect(editorHints(keymap.editor, label)).toEqual([
      { keys: '<Space>j', label: 'test.nextBox' },
      { keys: '<Space>1–3', label: CHOICE_LABEL },
    ]);
  });

  it('shows keys bound to one command in two modes once', () => {
    const editor = {
      ...keymap.editor,
      binds: [
        { keys: '<CR>', scope: 'any', command: 'test.pick' },
        { keys: '<CR>', scope: 'any', command: 'test.pick', mode: 'insert' },
      ],
    } satisfies Keymap['editor'];

    expect(editorHints(editor, label)).toEqual([
      { keys: '<CR>', label: 'test.pick' },
    ]);
  });
});

describe('vimTokens', () => {
  it('vimTokens_SplitsGroupsAndCharacters_ReplacingLeader', () => {
    expect(vimTokens('<Leader>a1', '<Space>')).toEqual(['<Space>', 'a', '1']);
    expect(vimTokens('<Leader><Leader>', '<Space>')).toEqual([
      '<Space>',
      '<Space>',
    ]);
    expect(vimTokens('<Esc>', '<Space>')).toEqual(['<Esc>']);
  });
});

describe('formatVimToken', () => {
  it('formatVimToken_NamesSpaceEscAndEnter', () => {
    expect(formatVimToken('<Space>')).toBe('Space');
    expect(formatVimToken('<Esc>')).toBe('Esc');
    expect(formatVimToken('<CR>')).toBe('Enter');
    expect(formatVimToken('a')).toBe('a');
  });
});
