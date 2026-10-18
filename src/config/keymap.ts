import type {
  EditorBind,
  Keymap,
  PageBind,
  ViewScope,
} from '../contracts/keymap';

const CHOICE_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

// `?` opens help from every view; inside help it closes help instead.
const HELP_SCOPES: ViewScope[] = ['forms', 'review', 'confirm', 'idle'];

const pageChoiceBinds = CHOICE_DIGITS.map((digit): PageBind => ({
  keys: [digit],
  scope: 'forms',
  command: `forms.choose${digit}`,
}));

const editorChoiceBinds = CHOICE_DIGITS.map((digit): EditorBind => ({
  keys: `<Leader>${digit}`,
  command: `forms.choose${digit}`,
}));

const helpBinds = HELP_SCOPES.map((scope): PageBind => ({
  keys: ['?'],
  scope,
  command: 'help.toggle',
}));

export const defaultKeymap: Keymap = {
  editor: {
    leader: '<Space>',
    remaps: [{ mode: 'insert', keys: 'jk', to: '<Esc>' }],
    binds: [
      { keys: '<Leader>j', command: 'forms.nextBox' },
      { keys: '<Leader>k', command: 'forms.prevBox' },
      { keys: '<Leader>n', command: 'forms.nextItem' },
      { keys: '<Leader>p', command: 'forms.prevItem' },
      { keys: '<Leader>x', command: 'forms.toggleNotApplicable' },
      { keys: '<Leader>c', command: 'forms.clearChoice' },
      ...editorChoiceBinds,
      { keys: '<Leader><Leader>', command: 'forms.openReview' },
      { keys: '<Esc>', command: 'forms.leaveBox' },
    ],
  },
  page: [
    { keys: ['j'], scope: 'forms', command: 'forms.nextItem' },
    { keys: ['k'], scope: 'forms', command: 'forms.prevItem' },
    ...pageChoiceBinds,
    { keys: ['x'], scope: 'forms', command: 'forms.toggleNotApplicable' },
    { keys: ['d'], scope: 'forms', command: 'forms.toggleDontAsk' },
    { keys: ['a'], scope: 'forms', command: 'forms.editWhat' },
    { keys: ['w'], scope: 'forms', command: 'forms.editWhy' },
    { keys: ['o'], scope: 'forms', command: 'forms.editNote' },
    { keys: [']'], scope: 'forms', command: 'forms.nextRound' },
    { keys: ['['], scope: 'forms', command: 'forms.prevRound' },
    { keys: [' ', ' '], scope: 'forms', command: 'forms.openReview' },
    { keys: ['z', 'a'], scope: 'forms', command: 'forms.toggleFold' },
    { keys: ['z', 'R'], scope: 'forms', command: 'forms.unfoldAll' },
    { keys: ['z', 'M'], scope: 'forms', command: 'forms.foldAll' },
    { keys: ['Enter'], scope: 'review', command: 'forms.submit' },
    { keys: ['Escape'], scope: 'review', command: 'forms.closeReview' },
    { keys: ['j'], scope: 'review', command: 'forms.reviewNext' },
    { keys: ['k'], scope: 'review', command: 'forms.reviewPrev' },
    { keys: ['g'], scope: 'review', command: 'forms.reviewJump' },
    { keys: ['C'], scope: 'review', command: 'forms.askCancel' },
    { keys: ['o'], scope: 'review', command: 'forms.editNote' },
    { keys: [']'], scope: 'review', command: 'forms.nextRound' },
    { keys: ['['], scope: 'review', command: 'forms.prevRound' },
    { keys: ['y'], scope: 'confirm', command: 'forms.confirmCancel' },
    { keys: ['n'], scope: 'confirm', command: 'forms.dismissConfirm' },
    { keys: ['Escape'], scope: 'confirm', command: 'forms.dismissConfirm' },
    ...helpBinds,
    { keys: ['?'], scope: 'help', command: 'help.close' },
    { keys: ['Escape'], scope: 'help', command: 'help.close' },
  ],
  app: [],
  intercept: [],
  global: [{ accelerator: 'Control+Alt+Command+W', command: 'window.summon' }],
};
