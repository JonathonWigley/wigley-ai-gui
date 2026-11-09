// Every default key of the app and its built-in plugins. The rule for picking
// a key is docs/keymap.md; the user's keymap.json takes entries in this shape.
import type {
  AcceleratorBind,
  DefaultKeymap,
  InterceptBind,
  KeyBind,
} from '../contracts/keymap';
import type {
  PANE_FOCUS_COMMANDS,
  PANE_RESIZE_COMMANDS,
} from '../contracts/panes';
import type { QualifiedCommandId, QualifiedScopeId } from '../contracts/plugin';
import type { ListPickerCommand } from '../shared/list-picker-commands';
import { type builtInManifests, DIGITS } from './manifests';

type BuiltInManifest = (typeof builtInManifests)[number];

// A page command of the core's own.
type CorePageCommand =
  | (typeof PANE_RESIZE_COMMANDS)[keyof typeof PANE_RESIZE_COMMANDS]
  | (typeof PANE_FOCUS_COMMANDS)[keyof typeof PANE_FOCUS_COMMANDS];

// A main-process command of a built-in plugin.
type BuiltInMainCommand = QualifiedCommandId<BuiltInManifest, 'main'>;

type BuiltInAcceleratorBind = Omit<AcceleratorBind, 'command'> & {
  command: BuiltInMainCommand;
};

// `DefaultKeymap` with every command and scope one a built-in manifest or the
// core declares, so a misspelt name fails to compile.
type BuiltInKeymap = Omit<
  DefaultKeymap,
  'binds' | 'app' | 'intercept' | 'global'
> & {
  binds: (Omit<KeyBind, 'scope' | 'command'> & {
    scope: QualifiedScopeId<BuiltInManifest> | 'any';
    command: QualifiedCommandId<BuiltInManifest, 'page'> | CorePageCommand;
  })[];
  app: BuiltInAcceleratorBind[];
  intercept: (Omit<InterceptBind, 'command'> & {
    command: BuiltInMainCommand;
  })[];
  global: BuiltInAcceleratorBind[];
};

// A bare digit picks a numbered choice or action on the page; in a text box,
// where vim reads a digit as a count, `<Leader>a` and a digit picks.
const formsPageChoices = DIGITS.map((digit) => ({
  keys: digit,
  scope: 'forms.forms' as const,
  command: 'forms.choose' as const,
  arg: Number(digit),
}));

// A text box holds focus only in the form's and the review's views, so its
// binds fire in both; `<Leader><Leader>` fires on the form's page as well, and
// so do the answer keys, which still reach the item after Esc leaves the box.
function formsBoxBinds(scope: 'forms.forms' | 'forms.review') {
  const answerWhere =
    scope === 'forms.forms' ? ('both' as const) : ('box' as const);
  const answerBinds = [
    ...DIGITS.map((digit) => ({
      keys: `<Leader>a${digit}`,
      command: 'forms.choose' as const,
      arg: Number(digit),
    })),
    { keys: '<Leader>ac', command: 'forms.clearChoice' as const },
    { keys: '<Leader>ax', command: 'forms.toggleNotApplicable' as const },
  ].map((bind) => ({ ...bind, scope, where: answerWhere }));
  return [
    ...answerBinds,
    ...[
      ...(scope === 'forms.review'
        ? [{ keys: '<Leader><Leader>', command: 'forms.openReview' as const }]
        : []),
      { keys: '<Esc>', command: 'forms.leaveBox' as const },
    ].map((bind) => ({ ...bind, scope, where: 'box' as const })),
  ];
}

// The primer card and its review each scroll by a line and by half a page.
function primerScrollBinds(scope: 'primer.card' | 'primer.review') {
  return [
    { keys: '<C-j>', scope, command: 'primer.lineDown' as const },
    { keys: '<C-k>', scope, command: 'primer.lineUp' as const },
    { keys: '<C-S-j>', scope, command: 'primer.halfPageDown' as const },
    { keys: '<C-S-k>', scope, command: 'primer.halfPageUp' as const },
  ];
}

// The primer's tasks and items columns each step their own rows, set the
// selected task's need and open the review from the page.
function primerColumnBinds(scope: 'primer.tasks' | 'primer.items') {
  return [
    { keys: 'j', scope, command: 'primer.nextRow' as const },
    { keys: '<C-l>', scope, command: 'primer.nextRow' as const },
    { keys: 'k', scope, command: 'primer.prevRow' as const },
    { keys: '<C-h>', scope, command: 'primer.prevRow' as const },
    { keys: 'gg', scope, command: 'primer.firstRow' as const },
    { keys: 'G', scope, command: 'primer.lastRow' as const },
    { keys: 'y', scope, command: 'primer.needYes' as const },
    { keys: 'n', scope, command: 'primer.needNo' as const },
    { keys: 'u', scope, command: 'primer.needUnclear' as const },
    {
      keys: '<Leader><Leader>',
      scope,
      command: 'primer.openReview' as const,
      where: 'page' as const,
    },
  ];
}

// A Chat tab's keys that read the entries and focus the box.
function chatEntryPageBinds() {
  const scope = 'chat.chat' as const;
  return [
    { keys: 'i', scope, command: 'chat.focusBox' as const },
    { keys: 'a', scope, command: 'chat.appendBox' as const },
    { keys: 'j', scope, command: 'chat.nextEntry' as const },
    { keys: 'k', scope, command: 'chat.prevEntry' as const },
    { keys: 'J', scope, command: 'chat.nextMessage' as const },
    { keys: 'K', scope, command: 'chat.prevMessage' as const },
    { keys: 'V', scope, command: 'chat.toggleRange' as const },
    {
      keys: '<Esc>',
      scope,
      command: 'chat.cancelRange' as const,
      where: 'page' as const,
    },
    { keys: '<CR>', scope, command: 'chat.toggleEntry' as const },
    { keys: 'G', scope, command: 'chat.latestEntry' as const },
    { keys: 'gg', scope, command: 'chat.firstEntry' as const },
    { keys: '<C-j>', scope, command: 'chat.lineDown' as const },
    { keys: '<C-k>', scope, command: 'chat.lineUp' as const },
    { keys: '<C-S-j>', scope, command: 'chat.halfPageDown' as const },
    { keys: '<C-S-k>', scope, command: 'chat.halfPageUp' as const },
  ];
}

// `<CR>` sends in insert mode too; Shift+Enter, which no bind takes, adds a
// line.
function chatBoxBinds() {
  const scope = 'chat.chat' as const;
  return [
    ...[
      { keys: '<CR>', command: 'chat.send' as const },
      { keys: '<Esc>', command: 'chat.leaveBox' as const },
      { keys: '<Leader>cx', command: 'chat.removeImage' as const },
      { keys: '<Leader>cp', command: 'chat.pullBackQueued' as const },
    ].map((bind) => ({ ...bind, scope, where: 'box' as const })),
    {
      keys: '<CR>',
      scope,
      command: 'chat.send' as const,
      mode: 'insert' as const,
    },
  ];
}

// Every list picker's scope, each bound to the shared list keys by
// `listPickerBinds`; a new picker scope joins this list.
export const LIST_PICKER_SCOPES = [
  'sessions.picker',
  'chat.picker',
  'chat.resume',
  'docs.picker',
  'settings.picker',
  'backlog.picker',
  'notes.picker',
  'keys.picker',
] as const;

type ListPickerScope = (typeof LIST_PICKER_SCOPES)[number];

// The plugin a picker scope belongs to.
type PickerPlugin<S extends ListPickerScope> = S extends `${infer P}.${string}`
  ? P
  : never;

// The shared list keys in one picker scope: `<CR>` chooses in insert mode
// too, so Enter in the filter box chooses, and Esc in the box's normal mode
// leaves it for the list.
function listPickerBinds<S extends ListPickerScope>(scope: S) {
  const plugin = scope.slice(0, scope.indexOf('.')) as PickerPlugin<S>;
  const command = <C extends ListPickerCommand>(id: C) =>
    `${plugin}.${id}` as `${PickerPlugin<S>}.${C}`;
  return [
    { keys: 'j', scope, command: command('pickerDown') },
    { keys: 'k', scope, command: command('pickerUp') },
    { keys: 'gg', scope, command: command('pickerTop') },
    { keys: 'G', scope, command: command('pickerBottom') },
    { keys: '<CR>', scope, command: command('pickerChoose') },
    { keys: 'l', scope, command: command('pickerChoose') },
    { keys: '/', scope, command: command('pickerFilter') },
    { keys: '<Esc>', scope, command: command('pickerCancel') },
    {
      keys: '<CR>',
      scope,
      command: command('pickerChoose'),
      where: 'box' as const,
    },
    {
      keys: '<CR>',
      scope,
      command: command('pickerChoose'),
      mode: 'insert' as const,
    },
    {
      keys: '<Esc>',
      scope,
      command: command('pickerList'),
      where: 'box' as const,
    },
  ];
}

export const defaultKeymap = {
  leader: '<Space>',
  groups: {
    '<Leader>b': 'session',
    '<Leader>k': 'go to',
    '<Leader>v': 'view',
    '<Leader>z': 'debug',
    '<Leader>zl': 'layout previews',
    '<Leader>c': 'chat controls',
    '<Leader>a': 'answer',
    '<Leader>n': 'notes',
    '<Leader>w': 'workflow',
    '<Leader>p': 'projects',
  },
  binds: [
    // ── Windows and modes ──────────────────────────────────────────────────
    { keys: '<Leader>ks', scope: 'any', command: 'sessions.showMode' },
    // Bound per main view, so a dialog, picker or confirm keeps its own keys.
    ...(
      [
        'sessions.idle',
        'sessions.sidebar',
        'chat.chat',
        'chat.hub',
        'agent-strip.strip',
        'docs.tree',
        'docs.doc',
        'docs.aside',
        'backlog.homes',
        'backlog.list',
        'backlog.detail',
        'settings.sections',
        'settings.rows',
        'settings.leaderGroups',
        'settings.leaderItems',
        'gallery.gallery',
        'forms.forms',
        'forms.review',
        'primer.tasks',
        'primer.items',
        'primer.card',
        'primer.review',
        'backlog.editor',
        'notes.popup',
        'notes.title',
        'practice.list',
        'practice.problem',
        'practice.editor',
        'practice.console',
      ] as const
    ).map((scope) => ({
      keys: '<C-n>',
      scope,
      command: 'chat.startNewSession' as const,
    })),
    { keys: '<Leader>kd', scope: 'any', command: 'docs.showMode' },
    { keys: '<Leader>vt', scope: 'any', command: 'docs.toggleTree' },
    { keys: '<Leader>vw', scope: 'any', command: 'docs.toggleWikiView' },
    { keys: '<Leader>k,', scope: 'any', command: 'settings.showMode' },
    { keys: '<Leader>kb', scope: 'any', command: 'backlog.showMode' },
    { keys: '<Leader>kp', scope: 'any', command: 'practice.showMode' },
    { keys: '<Leader>vd', scope: 'any', command: 'backlog.toggleDone' },
    {
      keys: '<Leader>va',
      scope: 'any',
      command: 'backlog.toggleAgentReadyOnly',
    },
    { keys: '<Leader>vu', scope: 'any', command: 'usage.toggleDetails' },

    // ── Tabs and sessions ──────────────────────────────────────────────────
    { keys: '<A-S-o>', scope: 'any', command: 'sessions.nextSession' },
    { keys: '<A-S-i>', scope: 'any', command: 'sessions.prevSession' },
    { keys: '<A-o>', scope: 'any', command: 'sessions.nextTab' },
    { keys: '<A-i>', scope: 'any', command: 'sessions.prevTab' },
    { keys: '<D-w>', scope: 'any', command: 'sessions.closeSession' },
    { keys: '<Leader>;', scope: 'any', command: 'sessions.closeSession' },
    { keys: "<Leader>'", scope: 'any', command: 'session-stash.stash' },
    { keys: '<Leader>bn', scope: 'any', command: 'chat.newSession' },
    { keys: '<Leader>br', scope: 'any', command: 'sessions.renameSession' },
    { keys: '<Leader>bd', scope: 'any', command: 'sessions.closeSession' },
    { keys: '<Leader>bs', scope: 'any', command: 'session-stash.stash' },
    { keys: '<Leader>bX', scope: 'any', command: 'chat.stopAll' },
    { keys: '<Leader>bp', scope: 'any', command: 'sessions.togglePopup' },
    { keys: '<Leader>bh', scope: 'any', command: 'chat.toggleSideParts' },
    { keys: '<Leader>pf', scope: 'any', command: 'sessions.favoriteProject' },
    { keys: '<Leader>pk', scope: 'any', command: 'sessions.moveProjectUp' },
    { keys: '<Leader>pj', scope: 'any', command: 'sessions.moveProjectDown' },
    // The Sessions list, past the leftmost pane: its cursor's row keys.
    { keys: 'j', scope: 'sessions.sidebar', command: 'sessions.listDown' },
    { keys: 'k', scope: 'sessions.sidebar', command: 'sessions.listUp' },
    { keys: 'gg', scope: 'sessions.sidebar', command: 'sessions.listTop' },
    { keys: 'G', scope: 'sessions.sidebar', command: 'sessions.listBottom' },
    { keys: '<CR>', scope: 'sessions.sidebar', command: 'sessions.listOpen' },
    { keys: 'l', scope: 'sessions.sidebar', command: 'sessions.listShow' },
    { keys: '<Esc>', scope: 'sessions.sidebar', command: 'sessions.listBack' },
    { keys: 's', scope: 'sessions.sidebar', command: 'sessions.listFavorite' },
    { keys: 'K', scope: 'sessions.sidebar', command: 'sessions.listMoveUp' },
    { keys: 'J', scope: 'sessions.sidebar', command: 'sessions.listMoveDown' },
    { keys: 'r', scope: 'sessions.sidebar', command: 'sessions.listRename' },
    { keys: 'd', scope: 'sessions.sidebar', command: 'sessions.listClose' },

    // ── Workflow ───────────────────────────────────────────────────────────
    { keys: '<Leader>ww', scope: 'any', command: 'workflow.mainAction' },
    {
      keys: '<Leader>wn',
      scope: 'any',
      command: 'workflow-large.makeInNewSession',
    },
    { keys: '<Leader>wr', scope: 'any', command: 'workflow-large.resumeMake' },
    { keys: '<Leader>wo', scope: 'any', command: 'workflow-large.openPlan' },
    { keys: '<Leader>wt', scope: 'any', command: 'workflow-large.retro' },
    { keys: '<Leader>wd', scope: 'any', command: 'workflow-large.dismiss' },
    { keys: '<Leader>ws', scope: 'any', command: 'workflow.toggleSidePane' },
    {
      keys: '<Leader>wf',
      scope: 'any',
      command: 'workflow.toggleFinishedWaves',
    },
    { keys: '<Leader>wh', scope: 'any', command: 'workflow.toggleHeadless' },

    // ── Panes ──────────────────────────────────────────────────────────────
    { keys: '<A-h>', scope: 'any', command: 'panes.focusLeft' },
    { keys: '<A-l>', scope: 'any', command: 'panes.focusRight' },
    { keys: '<A-j>', scope: 'any', command: 'panes.focusDown' },
    { keys: '<A-k>', scope: 'any', command: 'panes.focusUp' },
    { keys: '<A-S-h>', scope: 'any', command: 'panes.resizePaneLeft' },
    { keys: '<A-S-l>', scope: 'any', command: 'panes.resizePaneRight' },
    { keys: '<A-S-j>', scope: 'any', command: 'panes.resizePaneDown' },
    { keys: '<A-S-k>', scope: 'any', command: 'panes.resizePaneUp' },
    { keys: "<A-'>", scope: 'any', command: 'sessions.splitDown' },
    { keys: '<A-;>', scope: 'any', command: 'sessions.splitRight' },
    { keys: '<A-w>', scope: 'any', command: 'sessions.closePane' },
    { keys: '<C-A-h>', scope: 'any', command: 'sessions.swapPaneLeft' },
    { keys: '<C-A-j>', scope: 'any', command: 'sessions.swapPaneDown' },
    { keys: '<C-A-k>', scope: 'any', command: 'sessions.swapPaneUp' },
    { keys: '<C-A-l>', scope: 'any', command: 'sessions.swapPaneRight' },
    {
      keys: '<CR>',
      scope: 'sessions.rename',
      command: 'sessions.renameAccept',
    },
    {
      keys: '<Esc>',
      scope: 'sessions.rename',
      command: 'sessions.renameCancel',
    },
    {
      keys: '<CR>',
      scope: 'session-stash.note',
      command: 'session-stash.noteAccept',
    },
    {
      keys: '<Esc>',
      scope: 'session-stash.note',
      command: 'session-stash.noteCancel',
    },

    // ── Help ───────────────────────────────────────────────────────────────
    { keys: '<Leader>?', scope: 'any', command: 'keys.toggleHelp' },
    { keys: '<Leader>/', scope: 'any', command: 'keys.searchLeader' },
    { keys: '<Esc>', scope: 'keys.help', command: 'keys.closeHelp' },
    { keys: 'j', scope: 'keys.help', command: 'keys.lineDown' },
    { keys: 'k', scope: 'keys.help', command: 'keys.lineUp' },
    { keys: '<C-j>', scope: 'keys.help', command: 'keys.lineDown' },
    { keys: '<C-k>', scope: 'keys.help', command: 'keys.lineUp' },
    { keys: '<C-S-j>', scope: 'keys.help', command: 'keys.halfPageDown' },
    { keys: '<C-S-k>', scope: 'keys.help', command: 'keys.halfPageUp' },
    { keys: 'gg', scope: 'keys.help', command: 'keys.scrollTop' },
    { keys: 'G', scope: 'keys.help', command: 'keys.scrollEnd' },

    // ── Forms ──────────────────────────────────────────────────────────────
    { keys: 'j', scope: 'forms.forms', command: 'forms.nextLine' },
    { keys: '<C-l>', scope: 'forms.forms', command: 'forms.nextItem' },
    { keys: 'k', scope: 'forms.forms', command: 'forms.prevLine' },
    { keys: '<C-h>', scope: 'forms.forms', command: 'forms.prevItem' },
    { keys: 'gg', scope: 'forms.forms', command: 'forms.firstItem' },
    { keys: 'G', scope: 'forms.forms', command: 'forms.lastItem' },
    { keys: '<C-j>', scope: 'forms.forms', command: 'forms.lineDown' },
    { keys: '<C-k>', scope: 'forms.forms', command: 'forms.lineUp' },
    { keys: '<C-S-j>', scope: 'forms.forms', command: 'forms.halfPageDown' },
    { keys: '<C-S-k>', scope: 'forms.forms', command: 'forms.halfPageUp' },
    { keys: '<Tab>', scope: 'forms.forms', command: 'forms.nextBox' },
    { keys: '<S-Tab>', scope: 'forms.forms', command: 'forms.prevBox' },
    ...formsPageChoices,
    { keys: 'x', scope: 'forms.forms', command: 'forms.toggleNotApplicable' },
    { keys: 'd', scope: 'forms.forms', command: 'forms.toggleDontAsk' },
    { keys: 'a', scope: 'forms.forms', command: 'forms.editNotes' },
    { keys: 'o', scope: 'forms.forms', command: 'forms.editNotes' },
    { keys: 'za', scope: 'forms.forms', command: 'forms.toggleNotice' },
    {
      keys: '<CR>',
      scope: 'forms.forms',
      command: 'forms.acceptRecommendation',
    },
    { keys: 'c', scope: 'forms.forms', command: 'forms.clearChoice' },
    { keys: '<A-n>', scope: 'forms.forms', command: 'forms.nextUnanswered' },
    { keys: '<A-p>', scope: 'forms.forms', command: 'forms.prevUnanswered' },
    {
      keys: '<Leader><Leader>',
      scope: 'forms.forms',
      command: 'forms.openReview',
      where: 'both',
    },
    { keys: '<D-Enter>', scope: 'forms.review', command: 'forms.submit' },
    { keys: '<Esc>', scope: 'forms.review', command: 'forms.closeReview' },
    { keys: 'j', scope: 'forms.review', command: 'forms.reviewNext' },
    { keys: 'k', scope: 'forms.review', command: 'forms.reviewPrev' },
    { keys: 'gg', scope: 'forms.review', command: 'forms.reviewTop' },
    { keys: 'G', scope: 'forms.review', command: 'forms.reviewBottom' },
    { keys: '<CR>', scope: 'forms.review', command: 'forms.reviewJump' },
    { keys: 'C', scope: 'forms.review', command: 'forms.askCancel' },
    { keys: 'o', scope: 'forms.review', command: 'forms.editNote' },
    { keys: '<C-j>', scope: 'forms.review', command: 'forms.lineDown' },
    { keys: '<C-k>', scope: 'forms.review', command: 'forms.lineUp' },
    { keys: '<C-S-j>', scope: 'forms.review', command: 'forms.halfPageDown' },
    { keys: '<C-S-k>', scope: 'forms.review', command: 'forms.halfPageUp' },
    { keys: '<Tab>', scope: 'forms.review', command: 'forms.nextBox' },
    { keys: '<S-Tab>', scope: 'forms.review', command: 'forms.prevBox' },
    { keys: 'y', scope: 'forms.confirm', command: 'forms.confirmCancel' },
    { keys: 'n', scope: 'forms.confirm', command: 'forms.dismissConfirm' },
    { keys: '<Esc>', scope: 'forms.confirm', command: 'forms.dismissConfirm' },
    ...formsBoxBinds('forms.forms'),
    ...formsBoxBinds('forms.review'),

    // ── Primer ─────────────────────────────────────────────────────────────
    ...primerColumnBinds('primer.tasks'),
    ...primerColumnBinds('primer.items'),
    { keys: 'A', scope: 'primer.tasks', command: 'primer.addExtraTask' },
    { keys: 'D', scope: 'primer.tasks', command: 'primer.removeExtraTask' },
    { keys: 'x', scope: 'primer.items', command: 'primer.toggleInclude' },
    { keys: 'j', scope: 'primer.card', command: 'primer.nextRow' },
    { keys: '<C-l>', scope: 'primer.card', command: 'primer.nextRow' },
    { keys: 'k', scope: 'primer.card', command: 'primer.prevRow' },
    { keys: '<C-h>', scope: 'primer.card', command: 'primer.prevRow' },
    { keys: 'gg', scope: 'primer.card', command: 'primer.firstRow' },
    { keys: 'G', scope: 'primer.card', command: 'primer.lastRow' },
    { keys: 'x', scope: 'primer.card', command: 'primer.toggleInclude' },
    { keys: 'c', scope: 'primer.card', command: 'primer.editItemComment' },
    { keys: 'C', scope: 'primer.card', command: 'primer.editTaskComment' },
    { keys: 'a', scope: 'primer.card', command: 'primer.addItem' },
    { keys: 'i', scope: 'primer.card', command: 'primer.editFirstField' },
    { keys: '<Tab>', scope: 'primer.card', command: 'primer.nextBox' },
    { keys: '<S-Tab>', scope: 'primer.card', command: 'primer.prevBox' },
    ...primerScrollBinds('primer.card'),
    {
      keys: '<Leader><Leader>',
      scope: 'primer.card',
      command: 'primer.openReview',
      where: 'both',
    },
    {
      keys: '<Esc>',
      scope: 'primer.card',
      command: 'primer.leaveBox',
      where: 'box',
    },
    { keys: '<D-Enter>', scope: 'primer.review', command: 'primer.submit' },
    { keys: '<Esc>', scope: 'primer.review', command: 'primer.closeReview' },
    { keys: 'C', scope: 'primer.review', command: 'primer.askCancel' },
    { keys: 'j', scope: 'primer.review', command: 'primer.reviewNext' },
    { keys: 'k', scope: 'primer.review', command: 'primer.reviewPrev' },
    { keys: 'gg', scope: 'primer.review', command: 'primer.reviewTop' },
    { keys: 'G', scope: 'primer.review', command: 'primer.reviewBottom' },
    { keys: '<CR>', scope: 'primer.review', command: 'primer.reviewJump' },
    ...primerScrollBinds('primer.review'),
    { keys: 'y', scope: 'primer.confirm', command: 'primer.confirmCancel' },
    { keys: 'n', scope: 'primer.confirm', command: 'primer.dismissConfirm' },
    {
      keys: '<Esc>',
      scope: 'primer.confirm',
      command: 'primer.dismissConfirm',
    },

    // ── Chat ───────────────────────────────────────────────────────────────
    ...chatEntryPageBinds(),
    { keys: 'y', scope: 'chat.chat', command: 'chat.allowOrCopy' },
    { keys: 'n', scope: 'chat.chat', command: 'chat.denyPermission' },
    { keys: '<C-c>', scope: 'chat.chat', command: 'chat.interrupt' },
    { keys: '<D-Enter>', scope: 'chat.chat', command: 'chat.sendNow' },
    { keys: 'm', scope: 'chat.chat', command: 'chat.pickMode' },
    { keys: 'e', scope: 'chat.chat', command: 'chat.pickEffort' },
    { keys: 'o', scope: 'chat.chat', command: 'chat.pickModel' },
    { keys: 'c', scope: 'chat.chat', command: 'chat.pickControl' },
    { keys: 'x', scope: 'chat.resume', command: 'chat.toggleArchive' },
    { keys: '.', scope: 'chat.resume', command: 'chat.showArchived' },
    { keys: '<D-Enter>', scope: 'chat.reason', command: 'chat.submitReason' },
    { keys: '<Esc>', scope: 'chat.reason', command: 'chat.cancelReason' },
    { keys: '<D-Enter>', scope: 'chat.signIn', command: 'chat.submitCode' },
    { keys: '<Esc>', scope: 'chat.signIn', command: 'chat.cancelSignIn' },
    { keys: 'y', scope: 'chat.confirm', command: 'chat.endSession' },
    { keys: 'n', scope: 'chat.confirm', command: 'chat.keepSession' },
    { keys: '<Esc>', scope: 'chat.confirm', command: 'chat.keepSession' },
    { keys: 'h', scope: 'chat.image', command: 'chat.prevImage' },
    { keys: 'l', scope: 'chat.image', command: 'chat.nextImage' },
    { keys: '<Esc>', scope: 'chat.image', command: 'chat.closeImage' },
    { keys: 'x', scope: 'chat.image', command: 'chat.removeShownImage' },
    {
      keys: '<Leader>ci',
      scope: 'chat.chat',
      command: 'chat.showAttachments',
    },
    ...chatBoxBinds(),
    {
      keys: '<Leader>cm',
      scope: 'chat.chat',
      command: 'chat.pickMode',
      where: 'box',
    },
    {
      keys: '<Leader>ce',
      scope: 'chat.chat',
      command: 'chat.pickEffort',
      where: 'box',
    },
    {
      keys: '<Leader>co',
      scope: 'chat.chat',
      command: 'chat.pickModel',
      where: 'box',
    },
    {
      keys: '<Leader>cc',
      scope: 'chat.chat',
      command: 'chat.pickControl',
      where: 'box',
    },
    {
      keys: '<CR>',
      scope: 'chat.reason',
      command: 'chat.submitReason',
      where: 'box',
    },
    {
      keys: '<Esc>',
      scope: 'chat.reason',
      command: 'chat.cancelReason',
      where: 'box',
    },
    // A code is one line, so Enter sends it in insert mode too.
    {
      keys: '<CR>',
      scope: 'chat.signIn',
      command: 'chat.submitCode',
      where: 'box',
    },
    {
      keys: '<CR>',
      scope: 'chat.signIn',
      command: 'chat.submitCode',
      mode: 'insert',
    },
    {
      keys: '<Esc>',
      scope: 'chat.signIn',
      command: 'chat.cancelSignIn',
      where: 'box',
    },
    {
      keys: '<Leader>cy',
      scope: 'chat.signIn',
      command: 'chat.copySignInLink',
      where: 'box',
    },

    // ── Session hub ────────────────────────────────────────────────────────
    { keys: 'j', scope: 'chat.hub', command: 'chat.nextSection' },
    { keys: 'k', scope: 'chat.hub', command: 'chat.prevSection' },
    { keys: 'gg', scope: 'chat.hub', command: 'chat.firstSection' },
    { keys: 'G', scope: 'chat.hub', command: 'chat.lastSection' },
    { keys: '<CR>', scope: 'chat.hub', command: 'chat.toggleCursorSection' },
    { keys: 'l', scope: 'chat.hub', command: 'chat.toggleCursorSection' },
    { keys: '<Esc>', scope: 'chat.hub', command: 'chat.leaveHub' },
    { keys: '<C-j>', scope: 'chat.hub', command: 'chat.hubLineDown' },
    { keys: '<C-k>', scope: 'chat.hub', command: 'chat.hubLineUp' },
    { keys: '<C-S-j>', scope: 'chat.hub', command: 'chat.hubHalfPageDown' },
    { keys: '<C-S-k>', scope: 'chat.hub', command: 'chat.hubHalfPageUp' },

    // ── Agent strip ────────────────────────────────────────────────────────
    // `k` and Esc both hand the cursor back to the entries.
    { keys: 'h', scope: 'agent-strip.strip', command: 'agent-strip.prevBox' },
    { keys: 'l', scope: 'agent-strip.strip', command: 'agent-strip.nextBox' },
    { keys: 'k', scope: 'agent-strip.strip', command: 'agent-strip.leave' },
    { keys: '<Esc>', scope: 'agent-strip.strip', command: 'agent-strip.leave' },
    { keys: 'i', scope: 'agent-strip.strip', command: 'agent-strip.focusBox' },
    { keys: 'a', scope: 'agent-strip.strip', command: 'agent-strip.appendBox' },
    {
      keys: '<CR>',
      scope: 'agent-strip.strip',
      command: 'agent-strip.toggleBox',
    },
    {
      keys: '<C-j>',
      scope: 'agent-strip.strip',
      command: 'agent-strip.lineDown',
    },
    {
      keys: '<C-k>',
      scope: 'agent-strip.strip',
      command: 'agent-strip.lineUp',
    },
    {
      keys: '<C-S-j>',
      scope: 'agent-strip.strip',
      command: 'agent-strip.halfPageDown',
    },
    {
      keys: '<C-S-k>',
      scope: 'agent-strip.strip',
      command: 'agent-strip.halfPageUp',
    },

    // ── Visual ─────────────────────────────────────────────────────────────
    { keys: 'v', scope: 'chat.chat', command: 'visual.openVisuals' },
    { keys: 'w', scope: 'chat.chat', command: 'visual.toggleWidth' },
    { keys: 'h', scope: 'visual.overlay', command: 'visual.prevVisual' },
    { keys: 'l', scope: 'visual.overlay', command: 'visual.nextVisual' },
    { keys: '<Esc>', scope: 'visual.overlay', command: 'visual.closeVisual' },

    // ── Docs ───────────────────────────────────────────────────────────────
    { keys: 'j', scope: 'docs.tree', command: 'docs.treeDown' },
    { keys: 'k', scope: 'docs.tree', command: 'docs.treeUp' },
    { keys: 'gg', scope: 'docs.tree', command: 'docs.treeTop' },
    { keys: 'G', scope: 'docs.tree', command: 'docs.treeBottom' },
    { keys: 'gh', scope: 'docs.tree', command: 'docs.openMain' },
    { keys: 'l', scope: 'docs.tree', command: 'docs.treeOpen' },
    { keys: '<CR>', scope: 'docs.tree', command: 'docs.treeToggle' },
    { keys: 'h', scope: 'docs.tree', command: 'docs.treeClose' },
    { keys: '/', scope: 'docs.tree', command: 'docs.filter' },
    { keys: 'R', scope: 'docs.tree', command: 'docs.rescan' },
    { keys: 'c', scope: 'docs.tree', command: 'docs.pickContext' },
    { keys: 's', scope: 'docs.tree', command: 'docs.toggleStar' },
    { keys: 'a', scope: 'docs.tree', command: 'docs.createByKind' },
    { keys: 'A', scope: 'docs.tree', command: 'docs.createByPath' },
    { keys: 'r', scope: 'docs.tree', command: 'docs.rename' },
    { keys: 'd', scope: 'docs.tree', command: 'docs.trash' },
    // The tree's scroll keys scroll the doc shown beside it.
    { keys: '<C-j>', scope: 'docs.tree', command: 'docs.lineDown' },
    { keys: '<C-k>', scope: 'docs.tree', command: 'docs.lineUp' },
    { keys: '<C-S-j>', scope: 'docs.tree', command: 'docs.halfPageDown' },
    { keys: '<C-S-k>', scope: 'docs.tree', command: 'docs.halfPageUp' },
    { keys: '<Esc>', scope: 'docs.doc', command: 'docs.backToTree' },
    { keys: 'gh', scope: 'docs.doc', command: 'docs.openMain' },
    { keys: 'j', scope: 'docs.doc', command: 'docs.scrollDown' },
    { keys: 'k', scope: 'docs.doc', command: 'docs.scrollUp' },
    { keys: 'gg', scope: 'docs.doc', command: 'docs.scrollTop' },
    { keys: 'G', scope: 'docs.doc', command: 'docs.scrollEnd' },
    { keys: '<C-j>', scope: 'docs.doc', command: 'docs.lineDown' },
    { keys: '<C-k>', scope: 'docs.doc', command: 'docs.lineUp' },
    { keys: '<C-S-j>', scope: 'docs.doc', command: 'docs.halfPageDown' },
    { keys: '<C-S-k>', scope: 'docs.doc', command: 'docs.halfPageUp' },
    { keys: 'i', scope: 'docs.doc', command: 'docs.edit' },
    { keys: 'l', scope: 'docs.doc', command: 'docs.listOpen' },
    { keys: '<CR>', scope: 'docs.doc', command: 'docs.listOpen' },
    { keys: 'e', scope: 'docs.doc', command: 'docs.editSection' },
    { keys: '<C-h>', scope: 'docs.doc', command: 'docs.prevSection' },
    { keys: '<C-l>', scope: 'docs.doc', command: 'docs.nextSection' },
    { keys: '<C-o>', scope: 'docs.doc', command: 'docs.historyBack' },
    { keys: '<C-i>', scope: 'docs.doc', command: 'docs.historyForward' },
    // Esc in the editor's normal mode closes it as `:q` does.
    {
      keys: '<Esc>',
      scope: 'docs.doc',
      command: 'docs.quitEditor',
      where: 'box',
    },
    { keys: 'j', scope: 'docs.aside', command: 'docs.asideDown' },
    { keys: 'k', scope: 'docs.aside', command: 'docs.asideUp' },
    { keys: 'gg', scope: 'docs.aside', command: 'docs.asideTop' },
    { keys: 'G', scope: 'docs.aside', command: 'docs.asideBottom' },
    { keys: '<CR>', scope: 'docs.aside', command: 'docs.asideOpen' },
    { keys: 'l', scope: 'docs.aside', command: 'docs.asideOpen' },
    { keys: '<Esc>', scope: 'docs.aside', command: 'docs.backToDoc' },
    { keys: 'r', scope: 'docs.conflict', command: 'docs.conflictReload' },
    { keys: 'o', scope: 'docs.conflict', command: 'docs.conflictOverwrite' },
    { keys: '<Esc>', scope: 'docs.conflict', command: 'docs.conflictCancel' },
    { keys: '<Tab>', scope: 'docs.box', command: 'docs.boxComplete' },
    { keys: '<S-Tab>', scope: 'docs.box', command: 'docs.boxComplete' },
    { keys: '<CR>', scope: 'docs.box', command: 'docs.boxAccept' },
    { keys: '<Esc>', scope: 'docs.box', command: 'docs.boxCancel' },
    { keys: 'y', scope: 'docs.confirm', command: 'docs.confirmYes' },
    { keys: 'n', scope: 'docs.confirm', command: 'docs.confirmNo' },
    { keys: '<Esc>', scope: 'docs.confirm', command: 'docs.confirmNo' },

    // ── Settings ───────────────────────────────────────────────────────────
    ...(
      [
        'settings.sections',
        'settings.rows',
        'settings.leaderGroups',
        'settings.leaderItems',
      ] as const
    ).flatMap((scope) => [
      { keys: 'j', scope, command: 'settings.down' as const },
      { keys: 'k', scope, command: 'settings.up' as const },
      { keys: 'gg', scope, command: 'settings.top' as const },
      { keys: 'G', scope, command: 'settings.bottom' as const },
      { keys: '<CR>', scope, command: 'settings.open' as const },
    ]),
    ...(['settings.sections', 'settings.rows'] as const).flatMap((scope) => [
      { keys: '/', scope, command: 'settings.filter' as const },
      { keys: '<Esc>', scope, command: 'settings.clearFilter' as const },
    ]),
    { keys: 'i', scope: 'settings.rows', command: 'settings.edit' },
    { keys: 'r', scope: 'settings.rows', command: 'settings.reset' },
    { keys: 'a', scope: 'settings.rows', command: 'settings.addBind' },
    { keys: 'd', scope: 'settings.rows', command: 'settings.removeBind' },
    { keys: 'f', scope: 'settings.rows', command: 'settings.cycleKeyFilter' },
    { keys: '?', scope: 'settings.rows', command: 'settings.findByKey' },
    { keys: 'a', scope: 'settings.leaderGroups', command: 'settings.addBind' },
    {
      keys: 'd',
      scope: 'settings.leaderGroups',
      command: 'settings.removeBind',
    },
    {
      keys: 'R',
      scope: 'settings.leaderGroups',
      command: 'settings.renameGroup',
    },
    { keys: 'a', scope: 'settings.leaderItems', command: 'settings.addBind' },
    { keys: 'c', scope: 'settings.leaderItems', command: 'settings.changeKey' },
    {
      keys: 'd',
      scope: 'settings.leaderItems',
      command: 'settings.removeBind',
    },
    {
      keys: 'm',
      scope: 'settings.leaderItems',
      command: 'settings.moveToGroup',
    },
    { keys: 'r', scope: 'settings.leaderItems', command: 'settings.reset' },
    {
      keys: 'l',
      scope: 'settings.sections',
      command: 'settings.openKeepingFocus',
    },
    { keys: '<CR>', scope: 'settings.box', command: 'settings.boxAccept' },
    { keys: '<Esc>', scope: 'settings.box', command: 'settings.boxCancel' },

    // ── Backlog ────────────────────────────────────────────────────────────
    // The homes share the list's moves and its repo keys.
    ...(['backlog.homes', 'backlog.list'] as const).flatMap((scope) => [
      { keys: 'j', scope, command: 'backlog.listDown' as const },
      { keys: 'k', scope, command: 'backlog.listUp' as const },
      { keys: 'gg', scope, command: 'backlog.listTop' as const },
      { keys: 'G', scope, command: 'backlog.listBottom' as const },
      { keys: 'l', scope, command: 'backlog.open' as const },
      { keys: '<CR>', scope, command: 'backlog.toggle' as const },
      // Uppercase, so the one step out of the app is never a lowercase slip.
      { keys: 'C', scope, command: 'backlog.commit' as const },
      { keys: 'R', scope, command: 'backlog.rescan' as const },
    ]),
    { keys: 'h', scope: 'backlog.list', command: 'backlog.back' },
    { keys: '/', scope: 'backlog.list', command: 'backlog.filter' },
    { keys: 'a', scope: 'backlog.list', command: 'backlog.create' },
    { keys: 'i', scope: 'backlog.list', command: 'backlog.edit' },
    { keys: 'd', scope: 'backlog.list', command: 'backlog.delete' },
    { keys: 't', scope: 'backlog.list', command: 'backlog.toggleAgentReady' },
    { keys: 'T', scope: 'backlog.list', command: 'backlog.pickTag' },
    { keys: 'o', scope: 'backlog.list', command: 'backlog.openInDocs' },
    // The homes' and the list's scroll keys scroll the detail shown beside
    // them.
    ...(['backlog.homes', 'backlog.list', 'backlog.detail'] as const).flatMap(
      (scope) => [
        { keys: '<C-j>', scope, command: 'backlog.lineDown' as const },
        { keys: '<C-k>', scope, command: 'backlog.lineUp' as const },
        { keys: '<C-S-j>', scope, command: 'backlog.halfPageDown' as const },
        { keys: '<C-S-k>', scope, command: 'backlog.halfPageUp' as const },
      ],
    ),
    { keys: 'j', scope: 'backlog.detail', command: 'backlog.lineDown' },
    { keys: 'k', scope: 'backlog.detail', command: 'backlog.lineUp' },
    { keys: 'gg', scope: 'backlog.detail', command: 'backlog.scrollTop' },
    { keys: 'G', scope: 'backlog.detail', command: 'backlog.scrollEnd' },
    { keys: 'o', scope: 'backlog.detail', command: 'backlog.openInDocs' },
    // A chord fires inside a box as well, so the editor's chords need no
    // `where`.
    { keys: '<D-Enter>', scope: 'backlog.editor', command: 'backlog.save' },
    { keys: '<Tab>', scope: 'backlog.editor', command: 'backlog.nextField' },
    {
      keys: '<S-Tab>',
      scope: 'backlog.editor',
      command: 'backlog.previousField',
    },
    // Esc in a box's normal mode leaves the box; on the page it cancels.
    {
      keys: '<Esc>',
      scope: 'backlog.editor',
      command: 'backlog.leaveBox',
      where: 'box',
    },
    {
      keys: '<Esc>',
      scope: 'backlog.editor',
      command: 'backlog.cancelEdit',
      where: 'page',
    },
    // Inside a box `T` stays vim's.
    {
      keys: 'T',
      scope: 'backlog.editor',
      command: 'backlog.pickTag',
      where: 'page',
    },
    { keys: '<CR>', scope: 'backlog.box', command: 'backlog.boxAccept' },
    { keys: '<Esc>', scope: 'backlog.box', command: 'backlog.boxCancel' },
    { keys: 'y', scope: 'backlog.confirm', command: 'backlog.confirmYes' },
    { keys: 'n', scope: 'backlog.confirm', command: 'backlog.confirmNo' },
    { keys: '<Esc>', scope: 'backlog.confirm', command: 'backlog.confirmNo' },

    // ── Practice ───────────────────────────────────────────────────────────
    { keys: 'j', scope: 'practice.list', command: 'practice.listDown' },
    { keys: 'k', scope: 'practice.list', command: 'practice.listUp' },
    { keys: 'gg', scope: 'practice.list', command: 'practice.listTop' },
    { keys: 'G', scope: 'practice.list', command: 'practice.listBottom' },
    { keys: '<CR>', scope: 'practice.list', command: 'practice.openProblem' },
    {
      keys: 'l',
      scope: 'practice.list',
      command: 'practice.openKeepingFocus',
    },
    { keys: '/', scope: 'practice.list', command: 'practice.filter' },
    { keys: '<CR>', scope: 'practice.box', command: 'practice.boxAccept' },
    { keys: '<Esc>', scope: 'practice.box', command: 'practice.boxCancel' },

    // ── Notes ──────────────────────────────────────────────────────────────
    { keys: '<Leader>nn', scope: 'any', command: 'notes.open' },
    { keys: 'j', scope: 'notes.popup', command: 'notes.nextField' },
    { keys: 'k', scope: 'notes.popup', command: 'notes.prevField' },
    { keys: '<CR>', scope: 'notes.popup', command: 'notes.act' },
    { keys: 'i', scope: 'notes.popup', command: 'notes.editBox' },
    { keys: 't', scope: 'notes.popup', command: 'notes.pickTarget' },
    { keys: '#', scope: 'notes.popup', command: 'notes.pickTags' },
    { keys: 's', scope: 'notes.popup', command: 'notes.pickSession' },
    { keys: 'l', scope: 'notes.popup', command: 'notes.nextImage' },
    { keys: 'h', scope: 'notes.popup', command: 'notes.prevImage' },
    { keys: 'x', scope: 'notes.popup', command: 'notes.remove' },
    // Esc in the body box's normal mode leaves the box; on the page it closes.
    { keys: '<Esc>', scope: 'notes.popup', command: 'notes.close' },
    {
      keys: '<Esc>',
      scope: 'notes.popup',
      command: 'notes.leaveBox',
      where: 'box',
    },
    // A chord fires inside the body box as well.
    { keys: '<Tab>', scope: 'notes.popup', command: 'notes.nextBox' },
    { keys: '<S-Tab>', scope: 'notes.popup', command: 'notes.prevBox' },
    { keys: '<D-Enter>', scope: 'notes.popup', command: 'notes.sendFollowup' },
    // Leader binds fire on the page and in the body box in normal mode.
    { keys: '<Leader>nf', scope: 'notes.popup', command: 'notes.sendFollowup' },
    {
      keys: '<Leader>na',
      scope: 'notes.popup',
      command: 'notes.appendFollowup',
    },
    { keys: '<Leader>ns', scope: 'notes.popup', command: 'notes.sendSession' },
    { keys: '<Leader>nc', scope: 'notes.popup', command: 'notes.capture' },
    { keys: '<Leader>nd', scope: 'notes.popup', command: 'notes.discard' },
    { keys: '<Esc>', scope: 'notes.title', command: 'notes.leaveBox' },
    { keys: '<CR>', scope: 'notes.title', command: 'notes.nextBox' },
    { keys: '<Tab>', scope: 'notes.title', command: 'notes.nextBox' },
    { keys: '<S-Tab>', scope: 'notes.title', command: 'notes.prevBox' },
    { keys: '<D-Enter>', scope: 'notes.title', command: 'notes.sendFollowup' },
    { keys: 's', scope: 'notes.markup', command: 'notes.toolSelect' },
    { keys: 'p', scope: 'notes.markup', command: 'notes.toolPen' },
    { keys: 't', scope: 'notes.markup', command: 'notes.toolText' },
    { keys: 'a', scope: 'notes.markup', command: 'notes.toolArrow' },
    { keys: 'b', scope: 'notes.markup', command: 'notes.toolBox' },
    { keys: 'c', scope: 'notes.markup', command: 'notes.nextColour' },
    { keys: 'C', scope: 'notes.markup', command: 'notes.prevColour' },
    { keys: 'u', scope: 'notes.markup', command: 'notes.undo' },
    { keys: '<C-r>', scope: 'notes.markup', command: 'notes.redo' },
    { keys: '<Esc>', scope: 'notes.markup', command: 'notes.closeMarkup' },
    { keys: 'y', scope: 'notes.confirm', command: 'notes.confirmYes' },
    { keys: 'n', scope: 'notes.confirm', command: 'notes.confirmNo' },
    { keys: '<Esc>', scope: 'notes.confirm', command: 'notes.confirmNo' },

    // ── List pickers ───────────────────────────────────────────────────────
    ...LIST_PICKER_SCOPES.flatMap((scope) => listPickerBinds(scope)),

    // ── Unity pool ─────────────────────────────────────────────────────────
    { keys: 'j', scope: 'unity-pool.panel', command: 'unity-pool.cursorDown' },
    { keys: 'k', scope: 'unity-pool.panel', command: 'unity-pool.cursorUp' },
    { keys: 'gg', scope: 'unity-pool.panel', command: 'unity-pool.cursorTop' },
    {
      keys: 'G',
      scope: 'unity-pool.panel',
      command: 'unity-pool.cursorBottom',
    },
    {
      keys: '<CR>',
      scope: 'unity-pool.panel',
      command: 'unity-pool.showHolder',
    },

    // ── Gallery ────────────────────────────────────────────────────────────
    {
      keys: 't',
      scope: 'gallery.gallery',
      command: 'gallery.toggleTransparency',
    },
    { keys: 'gg', scope: 'gallery.gallery', command: 'gallery.scrollTop' },
    { keys: 'G', scope: 'gallery.gallery', command: 'gallery.scrollEnd' },
    { keys: 'j', scope: 'gallery.gallery', command: 'gallery.lineDown' },
    { keys: 'k', scope: 'gallery.gallery', command: 'gallery.lineUp' },
    { keys: '<C-j>', scope: 'gallery.gallery', command: 'gallery.lineDown' },
    { keys: '<C-k>', scope: 'gallery.gallery', command: 'gallery.lineUp' },
    {
      keys: '<C-S-j>',
      scope: 'gallery.gallery',
      command: 'gallery.halfPageDown',
    },
    {
      keys: '<C-S-k>',
      scope: 'gallery.gallery',
      command: 'gallery.halfPageUp',
    },

    // ── Debug and testing ──────────────────────────────────────────────────
    {
      keys: '<Leader>zlo',
      scope: 'any',
      command: 'forms.openPreview',
      where: 'page',
    },
    {
      keys: '<Leader>zlp',
      scope: 'any',
      command: 'primer.openPreview',
      where: 'page',
    },
    {
      keys: '<Leader>zls',
      scope: 'any',
      command: 'sessions.openPreview',
      where: 'page',
    },
    {
      keys: '<Leader>zlc',
      scope: 'any',
      command: 'chat.openPreview',
      where: 'page',
    },
    {
      keys: '<Leader>zla',
      scope: 'any',
      command: 'agents.openPreview',
      where: 'page',
    },
    {
      keys: '<Leader>zlw',
      scope: 'any',
      command: 'workflow.openPreview',
      where: 'page',
    },
    {
      keys: '<Leader>zg',
      scope: 'any',
      command: 'gallery.showMode',
      where: 'page',
    },
    {
      keys: '<Leader>zs',
      scope: 'any',
      command: 'gallery.swapShellLayout',
      where: 'page',
    },
  ],
  remaps: [],
  app: [{ accelerator: 'CommandOrControl+,', command: 'settings.show' }],
  intercept: [],

  // ── App chords ───────────────────────────────────────────────────────────
  global: [{ accelerator: 'Control+Alt+Command+W', command: 'window.summon' }],
} satisfies BuiltInKeymap;
