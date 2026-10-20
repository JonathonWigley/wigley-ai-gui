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

// The forms binds, with commands and scopes qualified.
const EXPECTED_EDITOR: EditorBind[] = [
  { keys: '<Leader>x', command: 'forms.toggleNotApplicable' },
  ...DIGITS.map((digit) => ({
    keys: `<Leader>${digit}`,
    command: `forms.jumpTo${digit}`,
  })),
  { keys: '<Leader>en', command: 'forms.nextUnanswered' },
  { keys: '<Leader>ep', command: 'forms.prevUnanswered' },
  ...DIGITS.map((digit) => ({
    keys: `<Leader>a${digit}`,
    command: `forms.choose${digit}`,
  })),
  { keys: '<Leader>ac', command: 'forms.clearChoice' },
  { keys: '<Leader>af', command: 'forms.actFixNow' },
  { keys: '<Leader>au', command: 'forms.actFollowUp' },
  { keys: '<Leader>as', command: 'forms.actLeaveIt' },
  { keys: '<Leader><Leader>', command: 'forms.openReview' },
  { keys: '<Esc>', command: 'forms.leaveBox' },
];

const EXPECTED_PAGE: PageBind[] = [
  { keys: ['j'], scope: 'forms.forms', command: 'forms.nextItem' },
  { keys: ['<C-l>'], scope: 'forms.forms', command: 'forms.nextItem' },
  { keys: ['k'], scope: 'forms.forms', command: 'forms.prevItem' },
  { keys: ['<C-h>'], scope: 'forms.forms', command: 'forms.prevItem' },
  { keys: ['<C-j>'], scope: 'forms.forms', command: 'forms.nextBox' },
  { keys: ['<C-k>'], scope: 'forms.forms', command: 'forms.prevBox' },
  ...DIGITS.map((digit) => ({
    keys: [digit],
    scope: 'forms.forms',
    command: `forms.choose${digit}`,
  })),
  { keys: ['x'], scope: 'forms.forms', command: 'forms.toggleNotApplicable' },
  { keys: ['d'], scope: 'forms.forms', command: 'forms.toggleDontAsk' },
  { keys: ['a'], scope: 'forms.forms', command: 'forms.editNotes' },
  {
    keys: ['Enter'],
    scope: 'forms.forms',
    command: 'forms.acceptRecommendation',
  },
  ...DIGITS.map((digit) => ({
    keys: [' ', digit],
    scope: 'forms.forms',
    command: `forms.jumpTo${digit}`,
  })),
  {
    keys: [' ', 'e', 'n'],
    scope: 'forms.forms',
    command: 'forms.nextUnanswered',
  },
  {
    keys: [' ', 'e', 'p'],
    scope: 'forms.forms',
    command: 'forms.prevUnanswered',
  },
  ...DIGITS.map((digit) => ({
    keys: [' ', 'a', digit],
    scope: 'forms.forms',
    command: `forms.choose${digit}`,
  })),
  { keys: [' ', 'a', 'c'], scope: 'forms.forms', command: 'forms.clearChoice' },
  { keys: [' ', 'a', 'f'], scope: 'forms.forms', command: 'forms.actFixNow' },
  { keys: [' ', 'a', 'u'], scope: 'forms.forms', command: 'forms.actFollowUp' },
  { keys: [' ', 'a', 's'], scope: 'forms.forms', command: 'forms.actLeaveIt' },
  { keys: [' ', ' '], scope: 'forms.forms', command: 'forms.openReview' },
  { keys: [' ', 'Enter'], scope: 'forms.review', command: 'forms.submit' },
  { keys: ['Escape'], scope: 'forms.review', command: 'forms.closeReview' },
  { keys: ['j'], scope: 'forms.review', command: 'forms.reviewNext' },
  { keys: ['k'], scope: 'forms.review', command: 'forms.reviewPrev' },
  { keys: ['Enter'], scope: 'forms.review', command: 'forms.reviewJump' },
  { keys: ['C'], scope: 'forms.review', command: 'forms.askCancel' },
  { keys: ['o'], scope: 'forms.review', command: 'forms.editNote' },
  { keys: ['y'], scope: 'forms.confirm', command: 'forms.confirmCancel' },
  { keys: ['n'], scope: 'forms.confirm', command: 'forms.dismissConfirm' },
  {
    keys: ['Escape'],
    scope: 'forms.confirm',
    command: 'forms.dismissConfirm',
  },
];

describe('formsManifest', () => {
  it('merges to the forms binds', () => {
    const merged = mergeKeymap(EMPTY_CORE, [formsManifest]);

    expect(merged.editor.binds).toEqual(EXPECTED_EDITOR);
    expect(merged.page).toEqual(EXPECTED_PAGE);
  });
});
