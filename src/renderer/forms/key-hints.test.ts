import { describe, expect, it } from 'vitest';
import type { Keymap, PageBind } from '../../contracts/keymap';
import { commandLabel } from './command-labels';
import { editorHints, formatKeys, helpSections, pageHints } from './key-hints';

const choiceBinds: PageBind[] = ['1', '2', '3'].map((digit): PageBind => ({
  keys: [digit],
  scope: 'forms',
  command: `forms.choose${digit}`,
}));

const keymap: Keymap = {
  editor: {
    leader: '<Space>',
    remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
    binds: [
      { keys: '<Leader>j', command: 'test.nextBox' },
      { keys: '<Leader>1', command: 'forms.choose1' },
      { keys: '<Leader>2', command: 'forms.choose2' },
      { keys: '<Leader>3', command: 'forms.choose3' },
    ],
  },
  page: [
    { keys: ['j'], scope: 'forms', command: 'test.down' },
    ...choiceBinds,
    { keys: [' ', ' '], scope: 'forms', command: 'test.review' },
    { keys: ['Escape'], scope: 'review', command: 'test.back' },
    { keys: ['?'], scope: 'help', command: 'test.close' },
    { keys: ['Escape'], scope: 'help', command: 'test.close' },
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
    expect(pageHints(keymap.page, 'forms').map((hint) => hint.keys)).toEqual([
      'j',
      '1–3',
      'Space Space',
      'F1',
    ]);
  });

  it('leaves out binds of other views', () => {
    expect(pageHints(keymap.page, 'review')).toEqual([
      { keys: 'Esc', label: 'test.back' },
      { keys: 'F1', label: 'test.anywhere' },
    ]);
  });

  it('merges a run of digits with one label into a range', () => {
    expect(pageHints(keymap.page, 'forms')[1]).toEqual({
      keys: '1–3',
      label: commandLabel('forms.choose1'),
    });
  });

  it('joins other neighbours with one label', () => {
    expect(pageHints(keymap.page, 'help')[0]).toEqual({
      keys: '? / Esc',
      label: 'test.close',
    });
  });
});

describe('editorHints', () => {
  it('spells the leader and merges the digit binds', () => {
    expect(editorHints(keymap.editor)).toEqual([
      { keys: '<Space>j', label: 'test.nextBox' },
      { keys: '<Space>1–3', label: commandLabel('forms.choose1') },
    ]);
  });
});

describe('helpSections', () => {
  it('lists a section per scope with binds, the editor keys and the chords', () => {
    expect(helpSections(keymap).map((section) => section.title)).toEqual([
      'In the form',
      'In the review',
      'In help',
      'Everywhere',
      'In a text box (vim normal mode)',
      'Remaps in a text box',
      'App chords',
      'System-wide chords',
    ]);
  });

  it('lists only the binds of its own scope in a scope section', () => {
    const [form] = helpSections(keymap);
    expect(form.hints.map((hint) => hint.keys)).toEqual([
      'j',
      '1–3',
      'Space Space',
    ]);
  });

  it('spells intercepted chords and global accelerators', () => {
    const sections = helpSections(keymap);
    expect(sections.at(-2)?.hints).toEqual([
      { keys: 'Control+Tab', label: 'test.intercept' },
    ]);
    expect(sections.at(-1)?.hints).toEqual([
      { keys: 'Control+Alt+Command+W', label: 'test.summon' },
    ]);
  });

  it('describes a remap by the keys it sends', () => {
    expect(helpSections(keymap)[5].hints).toEqual([
      { keys: 'jk', label: 'sends <Esc> in insert mode' },
    ]);
  });
});
