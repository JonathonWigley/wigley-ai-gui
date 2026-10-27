import { describe, expect, it } from 'vitest';
import type { CommandId } from '../contracts/commands';
import type { Keymap } from '../contracts/keymap';
import {
  type CommandLabel,
  chordName,
  editorHints,
  formatAccelerator,
  formatChord,
  formatKeys,
  formatVimKeys,
  formatVimToken,
  normalVimKeys,
  vimTokens,
} from './key-hints';

const CHOICE_LABEL = 'pick a choice';

const LABELS: Partial<Record<CommandId, string>> = {
  'forms.choose1': CHOICE_LABEL,
  'forms.choose2': CHOICE_LABEL,
  'forms.choose3': CHOICE_LABEL,
};

// Unlabelled commands read as their ids, as the page API's lookup does.
const label: CommandLabel = (id) => LABELS[id] ?? id;

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
  page: [],
  app: [],
  intercept: [{ key: 'Tab', control: true, command: 'test.intercept' }],
  global: [{ accelerator: 'Control+Alt+Command+W', command: 'test.summon' }],
  groups: {},
};

describe('formatChord', () => {
  it('prints macOS chords as symbols in Control, Option, Shift, Command order', () => {
    expect(formatChord('<S-D-k>', 'macos')).toBe('⇧⌘K');
    expect(formatChord('<A-o>', 'macos')).toBe('⌥O');
    expect(formatChord('<C-h>', 'macos')).toBe('⌃H');
    expect(formatChord('<C-S-j>', 'macos')).toBe('⌃⇧J');
    expect(formatChord('<D-Enter>', 'macos')).toBe('⌘↩');
    expect(formatChord('<C-A-S-D-1>', 'macos')).toBe('⌃⌥⇧⌘1');
  });

  it('prints Windows chords as names joined by +', () => {
    expect(formatChord('<S-D-k>', 'windows')).toBe('Shift+Win+K');
    expect(formatChord('<A-o>', 'windows')).toBe('Alt+O');
    expect(formatChord('<C-h>', 'windows')).toBe('Ctrl+H');
    expect(formatChord('<C-S-j>', 'windows')).toBe('Ctrl+Shift+J');
    expect(formatChord('<D-Enter>', 'windows')).toBe('Win+Enter');
    expect(formatChord('<C-A-S-D-1>', 'windows')).toBe('Ctrl+Alt+Shift+Win+1');
  });

  it('prints Linux chords as Windows does', () => {
    expect(formatChord('<A-o>', 'linux')).toBe('Alt+O');
  });

  it('returns a token that is no chord as it is', () => {
    expect(formatChord('j', 'macos')).toBe('j');
    expect(formatChord('<Esc>', 'macos')).toBe('<Esc>');
    expect(formatChord('<S-k>', 'macos')).toBe('<S-k>');
  });
});

describe('formatKeys', () => {
  it('names Space and Escape and spaces a sequence', () => {
    expect(formatKeys([' ', ' '], 'macos')).toBe('Space Space');
    expect(formatKeys(['Escape'], 'macos')).toBe('⎋');
    expect(formatKeys(['z', 'a'], 'macos')).toBe('z a');
  });

  it('formatKeys_NamedKeyOnMac_PrintsItsGlyph', () => {
    expect(formatKeys(['Enter'], 'macos')).toBe('↩');
    expect(formatKeys(['Tab'], 'macos')).toBe('⇥');
    expect(formatKeys(['Backspace'], 'macos')).toBe('⌫');
    expect(formatKeys(['Delete'], 'macos')).toBe('⌦');
    expect(formatKeys(['ArrowUp', 'ArrowDown'], 'macos')).toBe('↑ ↓');
    expect(formatKeys(['ArrowLeft', 'ArrowRight'], 'macos')).toBe('← →');
  });

  it('formatKeys_NamedKeyOffMac_PrintsItsName', () => {
    expect(formatKeys([' ', 'Escape'], 'windows')).toBe('Space Esc');
    expect(formatKeys(['Enter'], 'windows')).toBe('Enter');
    expect(formatKeys(['Tab'], 'linux')).toBe('Tab');
    expect(formatKeys(['Backspace'], 'windows')).toBe('Backspace');
    expect(formatKeys(['ArrowUp'], 'windows')).toBe('Up');
  });

  it('prints a chord for the platform', () => {
    expect(formatKeys([' ', '<A-o>'], 'macos')).toBe('Space ⌥O');
  });
});

describe('editorHints', () => {
  it('spells the leader and merges the digit binds', () => {
    expect(editorHints(keymap.editor, label, 'macos')).toEqual([
      { keys: 'Space j', label: 'test.nextBox' },
      { keys: 'Space 1–3', label: CHOICE_LABEL },
    ]);
  });

  it('editorHints_Chord_PrintsForPlatform', () => {
    const editor = {
      ...keymap.editor,
      binds: [{ keys: '<A-o>', scope: 'any', command: 'test.next' }],
    } satisfies Keymap['editor'];

    expect(editorHints(editor, label, 'macos')[0].keys).toBe('⌥O');
    expect(editorHints(editor, label, 'windows')[0].keys).toBe('Alt+O');
  });

  it('shows keys bound to one command in two modes once', () => {
    const editor = {
      ...keymap.editor,
      binds: [
        { keys: '<CR>', scope: 'any', command: 'test.pick' },
        { keys: '<CR>', scope: 'any', command: 'test.pick', mode: 'insert' },
      ],
    } satisfies Keymap['editor'];

    expect(editorHints(editor, label, 'macos')).toEqual([
      { keys: '↩', label: 'test.pick' },
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

describe('normalVimKeys', () => {
  it('normalVimKeys_SpellingsOfOneKey_ReadAlike', () => {
    for (const [a, b] of [
      ['<esc>', '<Esc>'],
      ['<CR>', '<Return>'],
      ['<enter>', '<CR>'],
      ['<c-j>', '<C-j>'],
      ['<S-C-k>', '<C-S-k>'],
      ['<C-K>', '<C-S-k>'],
      ['<Space>', ' '],
      ['g<ESC>', 'g<Esc>'],
    ]) {
      expect(normalVimKeys(a)).toBe(normalVimKeys(b));
    }
  });

  it('normalVimKeys_DifferentKeys_ReadApart', () => {
    for (const [a, b] of [
      ['<C-j>', '<A-j>'],
      ['<C-j>', '<C-S-j>'],
      ['<Esc>', '<Tab>'],
      ['gg', 'g'],
      ['j', 'J'],
    ]) {
      expect(normalVimKeys(a)).not.toBe(normalVimKeys(b));
    }
  });
});

describe('formatVimToken', () => {
  it.each([
    { token: '<Space>', expected: 'Space' },
    { token: '<Esc>', expected: '⎋' },
    { token: '<CR>', expected: '↩' },
    { token: '<Return>', expected: '↩' },
    { token: '<cr>', expected: '↩' },
    { token: 'a', expected: 'a' },
    { token: '<A-o>', expected: '⌥O' },
    { token: '<M-x>', expected: '⌘X' },
    { token: '<D-y>', expected: '⌘Y' },
    { token: '<S-C-a>', expected: '⌃⇧A' },
    { token: '<A-O>', expected: '⌥⇧O' },
    { token: '<C-CR>', expected: '⌃↩' },
    { token: '<D-CR>', expected: '⌘↩' },
    { token: '<S-Tab>', expected: '⇧⇥' },
    { token: '<C-Esc>', expected: '⌃⎋' },
    { token: '<A-BS>', expected: '⌥⌫' },
    { token: '<C-Space>', expected: '⌃Space' },
    { token: '<lt>', expected: '<' },
    { token: '<Bslash>', expected: '\\' },
    { token: '<Tab>', expected: '⇥' },
    { token: '<BS>', expected: '⌫' },
    { token: '<Del>', expected: '⌦' },
    { token: '<Up>', expected: '↑' },
    { token: '<Left>', expected: '←' },
    { token: '<F5>', expected: 'F5' },
    { token: '<X-a>', expected: '<X-a>' },
  ])('prints $token on macOS as $expected', ({ token, expected }) => {
    expect(formatVimToken(token, 'macos')).toBe(expected);
  });

  it.each([
    { token: '<Space>', platform: 'windows', expected: 'Space' },
    { token: '<Esc>', platform: 'windows', expected: 'Esc' },
    { token: '<CR>', platform: 'windows', expected: 'Enter' },
    { token: '<A-o>', platform: 'windows', expected: 'Alt+O' },
    { token: '<M-x>', platform: 'windows', expected: 'Win+X' },
    { token: '<S-C-a>', platform: 'windows', expected: 'Ctrl+Shift+A' },
    { token: '<m-a-k>', platform: 'windows', expected: 'Alt+Win+K' },
    { token: '<A-O>', platform: 'windows', expected: 'Alt+Shift+O' },
    { token: '<C-cr>', platform: 'windows', expected: 'Ctrl+Enter' },
    { token: '<S-Tab>', platform: 'windows', expected: 'Shift+Tab' },
    { token: '<Bar>', platform: 'windows', expected: '|' },
    { token: '<Tab>', platform: 'windows', expected: 'Tab' },
    { token: '<BS>', platform: 'windows', expected: 'Backspace' },
    { token: '<Up>', platform: 'linux', expected: 'Up' },
  ] as const)(
    'prints $token on $platform as $expected',
    ({ token, platform, expected }) => {
      expect(formatVimToken(token, platform)).toBe(expected);
    },
  );
});

describe('formatVimKeys', () => {
  it('formatVimKeys_Sequence_SpacesTokensAndSpellsLeader', () => {
    expect(formatVimKeys('<Leader>w', '<Space>', 'macos')).toBe('Space w');
    expect(formatVimKeys('<Leader><M-x>', '<Space>', 'windows')).toBe(
      'Space Win+X',
    );
    expect(formatVimKeys('<CR>', ',', 'windows')).toBe('Enter');
    expect(formatVimKeys('jk', '<Space>', 'macos')).toBe('j k');
    expect(formatVimKeys('<CR>', ',', 'macos')).toBe('↩');
  });
});

describe('chordName', () => {
  it('chordName_OnMac_PrintsGlyphs', () => {
    expect(chordName(keymap.intercept[0], 'macos')).toBe('⌃⇥');
    expect(
      chordName(
        { key: 'k', alt: true, shift: true, meta: true, command: 'test.x' },
        'macos',
      ),
    ).toBe('⌥⇧⌘K');
  });

  it('chordName_OffMac_PrintsWords', () => {
    expect(chordName(keymap.intercept[0], 'windows')).toBe('Ctrl+Tab');
    expect(
      chordName({ key: 'Enter', meta: true, command: 'test.x' }, 'linux'),
    ).toBe('Win+Enter');
  });
});

describe('formatAccelerator', () => {
  it('formatAccelerator_OnMac_PrintsGlyphs', () => {
    expect(formatAccelerator(keymap.global[0].accelerator, 'macos')).toBe(
      '⌃⌥⌘W',
    );
    expect(formatAccelerator('CmdOrCtrl+Shift+Return', 'macos')).toBe('⇧⌘↩');
    expect(formatAccelerator('Option+Esc', 'macos')).toBe('⌥⎋');
    expect(formatAccelerator('Super+Space', 'macos')).toBe('⌘Space');
  });

  it('formatAccelerator_OffMac_PrintsWords', () => {
    expect(formatAccelerator('CommandOrControl+Shift+k', 'windows')).toBe(
      'Ctrl+Shift+K',
    );
    expect(formatAccelerator('Alt+Up', 'linux')).toBe('Alt+Up');
    expect(formatAccelerator('Control+F5', 'windows')).toBe('Ctrl+F5');
  });

  it('formatAccelerator_AltGr_ReturnsAsWritten', () => {
    expect(formatAccelerator('AltGr+e', 'macos')).toBe('AltGr+e');
  });
});
