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

// The forms editor binds, with commands qualified, each in one scope.
function editorBindsIn(scope: string): EditorBind[] {
  return [
    { keys: '<Leader>x', scope, command: 'forms.toggleNotApplicable' },
    ...DIGITS.map((digit) => ({
      keys: `<Leader>a${digit}`,
      scope,
      command: `forms.choose${digit}`,
    })),
    { keys: '<Leader>ac', scope, command: 'forms.clearChoice' },
    { keys: '<Leader>af', scope, command: 'forms.actFixNow' },
    { keys: '<Leader>au', scope, command: 'forms.actFollowUp' },
    { keys: '<Leader>as', scope, command: 'forms.actLeaveIt' },
    { keys: '<Leader><Leader>', scope, command: 'forms.openReview' },
    { keys: '<Esc>', scope, command: 'forms.leaveBox' },
  ];
}

// The forms binds, with commands and scopes qualified.
const EXPECTED_EDITOR: EditorBind[] = [
  ...editorBindsIn('forms.forms'),
  ...editorBindsIn('forms.review'),
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
  { keys: ['c'], scope: 'forms.forms', command: 'forms.clearChoice' },
  { keys: ['f'], scope: 'forms.forms', command: 'forms.actFixNow' },
  { keys: ['u'], scope: 'forms.forms', command: 'forms.actFollowUp' },
  { keys: ['s'], scope: 'forms.forms', command: 'forms.actLeaveIt' },
  { keys: ['<A-n>'], scope: 'forms.forms', command: 'forms.nextUnanswered' },
  { keys: ['<A-p>'], scope: 'forms.forms', command: 'forms.prevUnanswered' },
  { keys: [' ', ' '], scope: 'forms.forms', command: 'forms.openReview' },
  { keys: ['<D-Enter>'], scope: 'forms.review', command: 'forms.submit' },
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
  { keys: [' ', 'z', 'l', 'n'], scope: 'any', command: 'forms.nextLayout' },
  { keys: [' ', 'z', 'l', 'p'], scope: 'any', command: 'forms.prevLayout' },
  { keys: [' ', 'z', 'l', 'c'], scope: 'any', command: 'forms.copyLayout' },
  { keys: [' ', 'z', 'l', 'o'], scope: 'any', command: 'forms.openPreview' },
];

describe('formsManifest', () => {
  it('merges to the forms binds', () => {
    const merged = mergeKeymap(EMPTY_CORE, [formsManifest], {});

    expect(merged.editor.binds).toEqual(EXPECTED_EDITOR);
    expect(merged.page).toEqual(EXPECTED_PAGE);
  });
});
