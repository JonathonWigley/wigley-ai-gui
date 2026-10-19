import { describe, expect, it } from 'vitest';
import type { EditorBind, Keymap, PageBind } from '../../contracts/keymap';
import { mergeKeymap } from '../../shared/plugin-manifests';
import { formsManifest } from './manifest';

const EMPTY_CORE: Keymap = {
  editor: { leader: '<Space>', remaps: [], binds: [] },
  page: [],
  app: [],
  intercept: [],
  global: [],
};

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

// The forms binds as the central keymap held them before forms became a
// plugin, with scopes qualified and help's commands renamed.
const EXPECTED_EDITOR: EditorBind[] = [
  { keys: '<Leader>j', command: 'forms.nextBox' },
  { keys: '<Leader>k', command: 'forms.prevBox' },
  { keys: '<Leader>n', command: 'forms.nextItem' },
  { keys: '<Leader>p', command: 'forms.prevItem' },
  { keys: '<Leader>x', command: 'forms.toggleNotApplicable' },
  { keys: '<Leader>c', command: 'forms.clearChoice' },
  ...DIGITS.map((digit) => ({
    keys: `<Leader>${digit}`,
    command: `forms.choose${digit}`,
  })),
  { keys: '<Leader><Leader>', command: 'forms.openReview' },
  { keys: '<Esc>', command: 'forms.leaveBox' },
];

const EXPECTED_PAGE: PageBind[] = [
  { keys: ['j'], scope: 'forms.forms', command: 'forms.nextItem' },
  { keys: ['k'], scope: 'forms.forms', command: 'forms.prevItem' },
  ...DIGITS.map((digit) => ({
    keys: [digit],
    scope: 'forms.forms',
    command: `forms.choose${digit}`,
  })),
  { keys: ['x'], scope: 'forms.forms', command: 'forms.toggleNotApplicable' },
  { keys: ['d'], scope: 'forms.forms', command: 'forms.toggleDontAsk' },
  { keys: ['a'], scope: 'forms.forms', command: 'forms.editWhat' },
  { keys: ['w'], scope: 'forms.forms', command: 'forms.editWhy' },
  { keys: ['o'], scope: 'forms.forms', command: 'forms.editNote' },
  { keys: ['g', 't'], scope: 'forms.forms', command: 'forms.nextRound' },
  { keys: ['g', 'T'], scope: 'forms.forms', command: 'forms.prevRound' },
  { keys: [' ', ' '], scope: 'forms.forms', command: 'forms.openReview' },
  { keys: ['z', 'a'], scope: 'forms.forms', command: 'forms.toggleFold' },
  { keys: ['z', 'R'], scope: 'forms.forms', command: 'forms.unfoldAll' },
  { keys: ['z', 'M'], scope: 'forms.forms', command: 'forms.foldAll' },
  { keys: [' ', 'Enter'], scope: 'forms.review', command: 'forms.submit' },
  { keys: ['Escape'], scope: 'forms.review', command: 'forms.closeReview' },
  { keys: ['j'], scope: 'forms.review', command: 'forms.reviewNext' },
  { keys: ['k'], scope: 'forms.review', command: 'forms.reviewPrev' },
  { keys: ['Enter'], scope: 'forms.review', command: 'forms.reviewJump' },
  { keys: ['C'], scope: 'forms.review', command: 'forms.askCancel' },
  { keys: ['o'], scope: 'forms.review', command: 'forms.editNote' },
  { keys: ['g', 't'], scope: 'forms.review', command: 'forms.nextRound' },
  { keys: ['g', 'T'], scope: 'forms.review', command: 'forms.prevRound' },
  { keys: ['y'], scope: 'forms.confirm', command: 'forms.confirmCancel' },
  { keys: ['n'], scope: 'forms.confirm', command: 'forms.dismissConfirm' },
  {
    keys: ['Escape'],
    scope: 'forms.confirm',
    command: 'forms.dismissConfirm',
  },
  { keys: ['?'], scope: 'forms.forms', command: 'forms.toggleHelp' },
  { keys: ['?'], scope: 'forms.review', command: 'forms.toggleHelp' },
  { keys: ['?'], scope: 'forms.confirm', command: 'forms.toggleHelp' },
  { keys: ['?'], scope: 'forms.idle', command: 'forms.toggleHelp' },
  { keys: ['?'], scope: 'forms.help', command: 'forms.closeHelp' },
  { keys: ['Escape'], scope: 'forms.help', command: 'forms.closeHelp' },
];

describe('formsManifest', () => {
  it("merges to today's forms binds", () => {
    const merged = mergeKeymap(EMPTY_CORE, [formsManifest]);

    expect(merged.editor.binds).toEqual(EXPECTED_EDITOR);
    expect(merged.page).toEqual(EXPECTED_PAGE);
  });
});
