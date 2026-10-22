import { describe, expect, it } from 'vitest';
import type { CommandId } from '../contracts/commands';
import type { Keymap, PageBind } from '../contracts/keymap';
import {
  type CommandLabel,
  chordName,
  editorHints,
  formatAccelerator,
  formatChord,
  formatKeys,
  formatVimKeys,
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
  groups: {},
};

describe('formatChord', () => {
  it('prints macOS chords as symbols in Control, Option, Shift, Command order', () => {
    expect(formatChord('<S-D-k>', 'macos')).toBe('⇧⌘K');
    expect(formatChord('<A-o>', 'macos')).toBe('⌥O');
    expect(formatChord('<C-h>', 'macos')).toBe('⌃H');
    expect(formatChord('<D-Enter>', 'macos')).toBe('⌘↩');
    expect(formatChord('<C-A-S-D-1>', 'macos')).toBe('⌃⌥⇧⌘1');
  });

  it('prints Windows chords as names joined by +', () => {
    expect(formatChord('<S-D-k>', 'windows')).toBe('Shift+Win+K');
    expect(formatChord('<A-o>', 'windows')).toBe('Alt+O');
    expect(formatChord('<C-h>', 'windows')).toBe('Ctrl+H');
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

describe('pageHints', () => {
  it("lists the view's binds and the any-scope binds, in keymap order", () => {
    expect(
      pageHints(keymap.page, 'forms.forms', label, 'macos').map(
        (hint) => hint.keys,
      ),
    ).toEqual(['j', '1–3', 'Space Space', 'F1']);
  });

  it('lists the review binds with their labels, leaving out other views', () => {
    expect(pageHints(keymap.page, 'forms.review', label, 'macos')).toEqual([
      { keys: '⎋', label: 'back to the form' },
      { keys: 'F1', label: 'test.anywhere' },
    ]);
  });

  it('merges a run of digits with one label into a range', () => {
    expect(pageHints(keymap.page, 'forms.forms', label, 'macos')[1]).toEqual({
      keys: '1–3',
      label: CHOICE_LABEL,
    });
  });

  it('joins other neighbours with one label', () => {
    expect(pageHints(keymap.page, 'forms.help', label, 'macos')[0]).toEqual({
      keys: '? / ⎋',
      label: 'test.close',
    });
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

describe('formatVimToken', () => {
  it('formatVimToken_NamesSpaceEscAndEnter', () => {
    expect(formatVimToken('<Space>', 'macos')).toBe('Space');
    expect(formatVimToken('<Esc>', 'macos')).toBe('⎋');
    expect(formatVimToken('<CR>', 'macos')).toBe('↩');
    expect(formatVimToken('a', 'macos')).toBe('a');
    expect(formatVimToken('<Space>', 'windows')).toBe('Space');
    expect(formatVimToken('<Esc>', 'windows')).toBe('Esc');
    expect(formatVimToken('<CR>', 'windows')).toBe('Enter');
  });

  it('formatVimToken_Chord_PrintsForPlatform', () => {
    expect(formatVimToken('<A-o>', 'windows')).toBe('Alt+O');
    expect(formatVimToken('<A-o>', 'macos')).toBe('⌥O');
  });

  it('formatVimToken_MetaChord_PrintsCommandOrWin', () => {
    expect(formatVimToken('<M-x>', 'macos')).toBe('⌘X');
    expect(formatVimToken('<M-x>', 'windows')).toBe('Win+X');
    expect(formatVimToken('<D-x>', 'macos')).toBe('⌘X');
  });

  it('formatVimToken_ModifiersInAnyOrderOrCase_PrintInPlatformOrder', () => {
    expect(formatVimToken('<S-C-a>', 'macos')).toBe('⌃⇧A');
    expect(formatVimToken('<S-C-a>', 'windows')).toBe('Ctrl+Shift+A');
    expect(formatVimToken('<m-a-k>', 'windows')).toBe('Alt+Win+K');
  });

  it('formatVimToken_CapitalLetter_HoldsShift', () => {
    expect(formatVimToken('<A-O>', 'macos')).toBe('⌥⇧O');
    expect(formatVimToken('<A-O>', 'windows')).toBe('Alt+Shift+O');
    expect(formatVimToken('<A-o>', 'macos')).not.toBe(
      formatVimToken('<A-O>', 'macos'),
    );
  });

  it('formatVimToken_NamedKeyChord_PrintsItsName', () => {
    expect(formatVimToken('<C-CR>', 'macos')).toBe('⌃↩');
    expect(formatVimToken('<C-cr>', 'windows')).toBe('Ctrl+Enter');
    expect(formatVimToken('<S-Tab>', 'windows')).toBe('Shift+Tab');
  });

  it('formatVimToken_ReturnChord_PrintsAsThePageChordDoes', () => {
    expect(formatVimToken('<D-CR>', 'macos')).toBe(
      formatChord('<D-Enter>', 'macos'),
    );
    expect(formatVimToken('<D-CR>', 'macos')).toBe('⌘↩');
  });

  it('formatVimToken_BareReturn_PrintsAsThePageKeyDoes', () => {
    expect(formatVimToken('<CR>', 'macos')).toBe(
      formatKeys(['Enter'], 'macos'),
    );
    expect(formatVimToken('<Return>', 'macos')).toBe('↩');
    expect(formatVimToken('<CR>', 'windows')).toBe(
      formatKeys(['Enter'], 'windows'),
    );
  });

  it('formatVimToken_NamedKeyChordOnMac_PrintsItsGlyph', () => {
    expect(formatVimToken('<S-Tab>', 'macos')).toBe('⇧⇥');
    expect(formatVimToken('<C-Esc>', 'macos')).toBe('⌃⎋');
    expect(formatVimToken('<A-BS>', 'macos')).toBe('⌥⌫');
    expect(formatVimToken('<C-Space>', 'macos')).toBe('⌃Space');
  });

  it('formatVimToken_SpecialCharacterName_PrintsTheCharacter', () => {
    expect(formatVimToken('<lt>', 'macos')).toBe('<');
    expect(formatVimToken('<Bar>', 'windows')).toBe('|');
    expect(formatVimToken('<Bslash>', 'macos')).toBe('\\');
  });

  it('formatVimToken_NamedKeyOnMac_PrintsItsGlyph', () => {
    expect(formatVimToken('<Tab>', 'macos')).toBe('⇥');
    expect(formatVimToken('<BS>', 'macos')).toBe('⌫');
    expect(formatVimToken('<Del>', 'macos')).toBe('⌦');
    expect(formatVimToken('<cr>', 'macos')).toBe('↩');
    expect(formatVimToken('<Up>', 'macos')).toBe('↑');
    expect(formatVimToken('<Left>', 'macos')).toBe('←');
  });

  it('formatVimToken_NamedKeyOffMac_PrintsItsName', () => {
    expect(formatVimToken('<Tab>', 'windows')).toBe('Tab');
    expect(formatVimToken('<BS>', 'windows')).toBe('Backspace');
    expect(formatVimToken('<Up>', 'linux')).toBe('Up');
  });

  it('formatVimToken_UnnamedKey_PrintsBareName', () => {
    expect(formatVimToken('<F5>', 'macos')).toBe('F5');
  });

  it('formatVimToken_UnknownModifier_ReturnsAsIs', () => {
    expect(formatVimToken('<X-a>', 'macos')).toBe('<X-a>');
  });
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
