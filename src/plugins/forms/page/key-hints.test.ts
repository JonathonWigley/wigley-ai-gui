import { describe, expect, it } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type { Keymap, PageBind } from '../../../contracts/keymap';
import type { CommandLabel } from '../../../shared/key-hints';
import { helpSections } from './key-hints';

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
      { keys: '<Leader>j', command: 'test.nextBox' },
      { keys: '<Leader>1', command: 'forms.choose1' },
      { keys: '<Leader>2', command: 'forms.choose2' },
      { keys: '<Leader>3', command: 'forms.choose3' },
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

describe('helpSections', () => {
  it('lists a section per scope with binds, the editor keys and the chords', () => {
    expect(helpSections(keymap, label).map((section) => section.title)).toEqual(
      [
        'In the form',
        'In the review',
        'In help',
        'Everywhere',
        'In a text box (vim normal mode)',
        'Remaps in a text box',
        'App chords',
        'System-wide chords',
      ],
    );
  });

  it('lists only the binds of its own scope in a scope section', () => {
    const [form] = helpSections(keymap, label);
    expect(form.hints.map((hint) => hint.keys)).toEqual([
      'j',
      '1–3',
      'Space Space',
    ]);
  });

  it('spells intercepted chords and global accelerators', () => {
    const sections = helpSections(keymap, label);
    expect(sections.at(-2)?.hints).toEqual([
      { keys: 'Control+Tab', label: 'test.intercept' },
    ]);
    expect(sections.at(-1)?.hints).toEqual([
      { keys: 'Control+Alt+Command+W', label: 'test.summon' },
    ]);
  });

  it('describes a remap by the keys it sends', () => {
    expect(helpSections(keymap, label)[5].hints).toEqual([
      { keys: 'jk', label: 'sends <Esc> in insert mode' },
    ]);
  });
});
