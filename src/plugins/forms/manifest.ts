import { definePlugin } from '../../shared/define-plugin';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
type Digit = (typeof DIGITS)[number];
type ChoiceCommand = `choose${Digit}`;
type JumpCommand = `jumpTo${Digit}`;

const CHOICE_LABEL = 'pick a choice (again clears)';
const JUMP_LABEL = 'go to question';

const choiceCommands = Object.fromEntries(
  DIGITS.map((digit) => [
    `choose${digit}`,
    { label: CHOICE_LABEL, group: 'choices', runsIn: 'page' },
  ]),
) as Record<ChoiceCommand, { label: string; group: 'choices'; runsIn: 'page' }>;

const jumpCommands = Object.fromEntries(
  DIGITS.map((digit) => [
    `jumpTo${digit}`,
    { label: JUMP_LABEL, group: 'questions', runsIn: 'page' },
  ]),
) as Record<JumpCommand, { label: string; group: 'questions'; runsIn: 'page' }>;

// A bare digit picks a choice; `Space a` and a digit picks too, as the box's
// `<Leader>a` and a digit do.
const pageChoiceBinds = DIGITS.map((digit) => ({
  keys: [digit],
  scope: 'forms' as const,
  command: `choose${digit}` as const,
}));

const pageLeaderChoiceBinds = DIGITS.map((digit) => ({
  keys: [' ', 'a', digit],
  scope: 'forms' as const,
  command: `choose${digit}` as const,
}));

const editorChoiceBinds = DIGITS.map((digit) => ({
  keys: `<Leader>a${digit}`,
  command: `choose${digit}` as const,
}));

const pageJumpBinds = DIGITS.map((digit) => ({
  keys: [' ', digit],
  scope: 'forms' as const,
  command: `jumpTo${digit}` as const,
}));

const editorJumpBinds = DIGITS.map((digit) => ({
  keys: `<Leader>${digit}`,
  command: `jumpTo${digit}` as const,
}));

// A text box holds focus only in the form's and the review's views, so its
// binds fire in both.
const EDITOR_SCOPES = ['forms', 'review'] as const;

const editorBinds = [
  { keys: '<Leader>x', command: 'toggleNotApplicable' },
  ...editorJumpBinds,
  { keys: '<Leader>en', command: 'nextUnanswered' },
  { keys: '<Leader>ep', command: 'prevUnanswered' },
  ...editorChoiceBinds,
  { keys: '<Leader>ac', command: 'clearChoice' },
  { keys: '<Leader>af', command: 'actFixNow' },
  { keys: '<Leader>au', command: 'actFollowUp' },
  { keys: '<Leader>as', command: 'actLeaveIt' },
  { keys: '<Leader><Leader>', command: 'openReview' },
  { keys: '<Esc>', command: 'leaveBox' },
] as const;

// Forms' scopes are its view names, each titled for the key help.
export const formsManifest = definePlugin({
  id: 'forms',
  dependsOn: ['sessions', 'keys'],
  commands: {
    nextItem: { label: 'next item', group: 'questions', runsIn: 'page' },
    prevItem: { label: 'previous item', group: 'questions', runsIn: 'page' },
    ...jumpCommands,
    nextUnanswered: {
      label: 'next unanswered item',
      group: 'questions',
      runsIn: 'page',
    },
    prevUnanswered: {
      label: 'previous unanswered item',
      group: 'questions',
      runsIn: 'page',
    },
    ...choiceCommands,
    clearChoice: {
      label: 'clear the choice',
      group: 'choices',
      runsIn: 'page',
    },
    acceptRecommendation: {
      label: 'accept the recommendation',
      group: 'choices',
      runsIn: 'page',
    },
    // Each label names every card's word for the action.
    actFixNow: {
      label: 'fix now · decide now · fix anyway',
      group: 'choices',
      runsIn: 'page',
    },
    actFollowUp: {
      label: 'follow-up · plan it',
      group: 'choices',
      runsIn: 'page',
    },
    actLeaveIt: {
      label: 'leave it · drop it',
      group: 'choices',
      runsIn: 'page',
    },
    toggleNotApplicable: {
      label: 'not applicable',
      group: 'answer',
      runsIn: 'page',
    },
    toggleDontAsk: {
      label: "don't ask me this",
      group: 'answer',
      runsIn: 'page',
    },
    editNotes: { label: 'notes box', group: 'boxes', runsIn: 'page' },
    editNote: { label: 'round note', group: 'boxes', runsIn: 'page' },
    nextBox: { label: 'next box', group: 'boxes', runsIn: 'page' },
    prevBox: { label: 'previous box', group: 'boxes', runsIn: 'page' },
    leaveBox: { label: 'leave the box', group: 'boxes', runsIn: 'page' },
    openReview: { label: 'review', group: 'review', runsIn: 'page' },
    closeReview: {
      label: 'back to the form',
      group: 'review',
      runsIn: 'page',
    },
    reviewNext: { label: 'next row', group: 'review', runsIn: 'page' },
    reviewPrev: { label: 'previous row', group: 'review', runsIn: 'page' },
    reviewJump: {
      label: 'go to the item',
      group: 'review',
      runsIn: 'page',
    },
    submit: { label: 'submit', group: 'review', runsIn: 'page' },
    askCancel: { label: 'cancel the round', group: 'review', runsIn: 'page' },
    confirmCancel: {
      label: 'yes, cancel the round',
      group: 'confirm',
      runsIn: 'page',
    },
    dismissConfirm: {
      label: 'keep the round',
      group: 'confirm',
      runsIn: 'page',
    },
    nextLayout: { label: 'next layout', group: 'debug', runsIn: 'page' },
    prevLayout: { label: 'previous layout', group: 'debug', runsIn: 'page' },
    copyLayout: {
      label: 'copy the layout to a new folder',
      group: 'debug',
      runsIn: 'page',
    },
    openPreview: {
      label: 'open the layout preview round',
      group: 'debug',
      runsIn: 'page',
    },
  },
  scopes: {
    forms: 'In the form',
    review: 'In the review',
    confirm: 'In the cancel confirmation',
    idle: 'With no round open',
  },
  keys: {
    editor: EDITOR_SCOPES.flatMap((scope) =>
      editorBinds.map((bind) => ({ ...bind, scope })),
    ),
    page: [
      { keys: ['j'], scope: 'forms', command: 'nextItem' },
      { keys: ['<C-l>'], scope: 'forms', command: 'nextItem' },
      { keys: ['k'], scope: 'forms', command: 'prevItem' },
      { keys: ['<C-h>'], scope: 'forms', command: 'prevItem' },
      { keys: ['<C-j>'], scope: 'forms', command: 'nextBox' },
      { keys: ['<C-k>'], scope: 'forms', command: 'prevBox' },
      ...pageChoiceBinds,
      { keys: ['x'], scope: 'forms', command: 'toggleNotApplicable' },
      { keys: ['d'], scope: 'forms', command: 'toggleDontAsk' },
      { keys: ['a'], scope: 'forms', command: 'editNotes' },
      { keys: ['Enter'], scope: 'forms', command: 'acceptRecommendation' },
      ...pageJumpBinds,
      { keys: [' ', 'e', 'n'], scope: 'forms', command: 'nextUnanswered' },
      { keys: [' ', 'e', 'p'], scope: 'forms', command: 'prevUnanswered' },
      ...pageLeaderChoiceBinds,
      { keys: [' ', 'a', 'c'], scope: 'forms', command: 'clearChoice' },
      { keys: [' ', 'a', 'f'], scope: 'forms', command: 'actFixNow' },
      { keys: [' ', 'a', 'u'], scope: 'forms', command: 'actFollowUp' },
      { keys: [' ', 'a', 's'], scope: 'forms', command: 'actLeaveIt' },
      { keys: [' ', ' '], scope: 'forms', command: 'openReview' },
      { keys: [' ', 'Enter'], scope: 'review', command: 'submit' },
      { keys: ['Escape'], scope: 'review', command: 'closeReview' },
      { keys: ['j'], scope: 'review', command: 'reviewNext' },
      { keys: ['k'], scope: 'review', command: 'reviewPrev' },
      { keys: ['Enter'], scope: 'review', command: 'reviewJump' },
      { keys: ['C'], scope: 'review', command: 'askCancel' },
      { keys: ['o'], scope: 'review', command: 'editNote' },
      { keys: ['y'], scope: 'confirm', command: 'confirmCancel' },
      { keys: ['n'], scope: 'confirm', command: 'dismissConfirm' },
      { keys: ['Escape'], scope: 'confirm', command: 'dismissConfirm' },
      { keys: [' ', 'z', 'l', 'n'], scope: 'any', command: 'nextLayout' },
      { keys: [' ', 'z', 'l', 'p'], scope: 'any', command: 'prevLayout' },
      { keys: [' ', 'z', 'l', 'c'], scope: 'any', command: 'copyLayout' },
      { keys: [' ', 'z', 'l', 'o'], scope: 'any', command: 'openPreview' },
    ],
    app: [],
    global: [],
    intercept: [],
  },
  settings: { autosaveDelayMs: 400, deadlineSeconds: 240 },
  themeTokens: {
    'origin-caused': { kind: 'color', default: 'var(--wg-status-error)' },
    'origin-pre-existing': { kind: 'color', default: '#eba0ac' },
    'origin-design': { kind: 'color', default: 'var(--wg-accent)' },
    'origin-nit': { kind: 'color', default: '#9399b2' },
    'severity-critical': { kind: 'color', default: 'var(--wg-status-error)' },
    'severity-important': {
      kind: 'color',
      default: 'var(--wg-status-attention)',
    },
    'severity-minor': { kind: 'color', default: 'var(--wg-fg-tertiary)' },
  },
});
