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
import { type builtInManifests, DIGITS, MAX_CANDIDATES } from './manifests';

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

// The digits of an audio picker moment's rows: its candidates, then None of
// these, so no digit binds a row a moment can never hold.
const AUDIO_PICKER_ROW_DIGITS = DIGITS.slice(0, MAX_CANDIDATES + 1);

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
  'scheduling.picker',
  'builds.picker',
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
    '<Leader>m': 'build',
    '<Leader>v': 'view',
    '<Leader>d': 'demo',
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
        'backlog.table',
        'backlog.review',
        'backlog.strip',
        'work-inbox.sections',
        'work-inbox.list',
        'work-inbox.box',
        'work-board.board',
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
        'audio-picker.list',
        'notes.popup',
        'notes.title',
        'practice.list',
        'practice.problem',
        'practice.editor',
        'practice.console',
        'scheduling.list',
        'scheduling.detail',
        'scheduling.editor',
        'scoped-agents.ask',
        'chatroom.threads',
        'chatroom.log',
        'builds.games',
        'builds.list',
        'builds.graph',
        'builds.offer',
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
    { keys: '<Leader>ki', scope: 'any', command: 'work-inbox.showMode' },
    { keys: '<Leader>kj', scope: 'any', command: 'work-board.showMode' },
    { keys: '<Leader>kp', scope: 'any', command: 'practice.showMode' },
    { keys: '<Leader>kt', scope: 'any', command: 'scheduling.showMode' },
    { keys: '<Leader>kc', scope: 'any', command: 'chatroom.showMode' },
    { keys: '<Leader>km', scope: 'any', command: 'builds.showMode' },
    { keys: '<Leader>mq', scope: 'any', command: 'builds.pickQueue' },
    { keys: '<Leader>mm', scope: 'any', command: 'builds.queueOffer' },
    { keys: '<Leader>mx', scope: 'any', command: 'builds.dismissOffer' },
    { keys: '<Leader>vd', scope: 'any', command: 'backlog.toggleDone' },
    {
      keys: '<Leader>vi',
      scope: 'any',
      command: 'practice.toggleInterviewer',
    },
    {
      keys: '<Leader>va',
      scope: 'any',
      command: 'backlog.toggleAgentReadyOnly',
    },
    { keys: '<Leader>vb', scope: 'any', command: 'backlog.toggleAssistant' },
    { keys: '<Leader>vr', scope: 'any', command: 'backlog.pickRepo' },
    {
      keys: '<Leader>vc',
      scope: 'any',
      command: 'backlog.toggleChunkedHidden',
    },
    { keys: '<Leader>vs', scope: 'any', command: 'backlog.toggleStaleFirst' },
    { keys: '<Leader>vu', scope: 'any', command: 'usage.toggleDetails' },
    { keys: '<Leader>vy', scope: 'any', command: 'system-stats.togglePanel' },

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

    // ── Audio picker ───────────────────────────────────────────────────────
    { keys: 'j', scope: 'audio-picker.list', command: 'audio-picker.nextRow' },
    { keys: 'k', scope: 'audio-picker.list', command: 'audio-picker.prevRow' },
    {
      keys: 'gg',
      scope: 'audio-picker.list',
      command: 'audio-picker.firstRow',
    },
    { keys: 'G', scope: 'audio-picker.list', command: 'audio-picker.lastRow' },
    {
      keys: '<C-l>',
      scope: 'audio-picker.list',
      command: 'audio-picker.nextMoment',
    },
    {
      keys: '<C-h>',
      scope: 'audio-picker.list',
      command: 'audio-picker.prevMoment',
    },
    {
      keys: '<CR>',
      scope: 'audio-picker.list',
      command: 'audio-picker.chooseRow',
    },
    ...AUDIO_PICKER_ROW_DIGITS.map((digit) => ({
      keys: digit,
      scope: 'audio-picker.list' as const,
      command: 'audio-picker.choose' as const,
      arg: Number(digit),
    })),
    ...AUDIO_PICKER_ROW_DIGITS.map((digit) => ({
      keys: `<Leader>a${digit}`,
      scope: 'audio-picker.list' as const,
      command: 'audio-picker.choose' as const,
      arg: Number(digit),
      where: 'box' as const,
    })),
    {
      keys: 'p',
      scope: 'audio-picker.list',
      command: 'audio-picker.togglePlay',
    },
    { keys: 'a', scope: 'audio-picker.list', command: 'audio-picker.editNote' },
    { keys: 'i', scope: 'audio-picker.list', command: 'audio-picker.editNote' },
    {
      keys: '<Tab>',
      scope: 'audio-picker.list',
      command: 'audio-picker.nextBox',
    },
    {
      keys: '<S-Tab>',
      scope: 'audio-picker.list',
      command: 'audio-picker.prevBox',
    },
    {
      keys: '<Esc>',
      scope: 'audio-picker.list',
      command: 'audio-picker.leaveBox',
      where: 'box',
    },
    {
      keys: '<D-Enter>',
      scope: 'audio-picker.list',
      command: 'audio-picker.submit',
    },
    {
      keys: 'C',
      scope: 'audio-picker.list',
      command: 'audio-picker.askCancel',
    },
    {
      keys: '<C-j>',
      scope: 'audio-picker.list',
      command: 'audio-picker.lineDown',
    },
    {
      keys: '<C-k>',
      scope: 'audio-picker.list',
      command: 'audio-picker.lineUp',
    },
    {
      keys: 'y',
      scope: 'audio-picker.confirm',
      command: 'audio-picker.confirmCancel',
    },
    {
      keys: 'n',
      scope: 'audio-picker.confirm',
      command: 'audio-picker.dismissConfirm',
    },
    {
      keys: '<Esc>',
      scope: 'audio-picker.confirm',
      command: 'audio-picker.dismissConfirm',
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
    { keys: 'j', scope: 'backlog.table', command: 'backlog.listDown' },
    { keys: 'k', scope: 'backlog.table', command: 'backlog.listUp' },
    { keys: 'gg', scope: 'backlog.table', command: 'backlog.listTop' },
    { keys: 'G', scope: 'backlog.table', command: 'backlog.listBottom' },
    { keys: '<CR>', scope: 'backlog.table', command: 'backlog.activate' },
    { keys: '/', scope: 'backlog.table', command: 'backlog.filter' },
    { keys: 'R', scope: 'backlog.table', command: 'backlog.rescan' },
    { keys: 'o', scope: 'backlog.table', command: 'backlog.openInDocs' },
    { keys: 'x', scope: 'backlog.table', command: 'backlog.mark' },
    { keys: 'c', scope: 'backlog.table', command: 'backlog.addToChunk' },
    { keys: 'u', scope: 'backlog.table', command: 'backlog.removeFromChunk' },
    { keys: 'gl', scope: 'backlog.table', command: 'backlog.toggleCommits' },
    { keys: 'W', scope: 'backlog.table', command: 'backlog.sweep' },
    // The chunk keys act on the cursor row's chunk in the table and on the
    // cursor chunk in the strip.
    ...(['backlog.table', 'backlog.strip'] as const).flatMap((scope) => [
      { keys: 'r', scope, command: 'backlog.renameChunk' as const },
      { keys: 's', scope, command: 'backlog.startChunk' as const },
      { keys: 'S', scope, command: 'backlog.startAllChunks' as const },
      { keys: 'H', scope, command: 'backlog.toggleHeadless' as const },
    ]),
    // The table's scroll keys scroll the review shown beside it.
    ...(['backlog.table', 'backlog.review'] as const).flatMap((scope) => [
      { keys: '<C-j>', scope, command: 'backlog.lineDown' as const },
      { keys: '<C-k>', scope, command: 'backlog.lineUp' as const },
      { keys: '<C-S-j>', scope, command: 'backlog.halfPageDown' as const },
      { keys: '<C-S-k>', scope, command: 'backlog.halfPageUp' as const },
    ]),
    { keys: 'j', scope: 'backlog.review', command: 'backlog.lineDown' },
    { keys: 'k', scope: 'backlog.review', command: 'backlog.lineUp' },
    { keys: 'gg', scope: 'backlog.review', command: 'backlog.scrollTop' },
    { keys: 'G', scope: 'backlog.review', command: 'backlog.scrollEnd' },
    { keys: 'o', scope: 'backlog.review', command: 'backlog.openInDocs' },
    { keys: 'gl', scope: 'backlog.review', command: 'backlog.toggleCommits' },
    { keys: 'h', scope: 'backlog.strip', command: 'backlog.stripLeft' },
    { keys: 'l', scope: 'backlog.strip', command: 'backlog.stripRight' },
    { keys: '<CR>', scope: 'backlog.strip', command: 'backlog.activate' },
    { keys: '<CR>', scope: 'backlog.box', command: 'backlog.boxAccept' },
    { keys: '<Esc>', scope: 'backlog.box', command: 'backlog.boxCancel' },

    // ── Inbox and Board ────────────────────────────────────────────────────
    {
      keys: 'j',
      scope: 'work-inbox.sections',
      command: 'work-inbox.sectionDown',
    },
    {
      keys: 'k',
      scope: 'work-inbox.sections',
      command: 'work-inbox.sectionUp',
    },
    {
      keys: 'gg',
      scope: 'work-inbox.sections',
      command: 'work-inbox.sectionTop',
    },
    {
      keys: 'G',
      scope: 'work-inbox.sections',
      command: 'work-inbox.sectionBottom',
    },
    {
      keys: '<CR>',
      scope: 'work-inbox.sections',
      command: 'work-inbox.openSection',
    },
    {
      keys: 'l',
      scope: 'work-inbox.sections',
      command: 'work-inbox.peekSection',
    },
    { keys: 'j', scope: 'work-inbox.list', command: 'work-inbox.listDown' },
    { keys: 'k', scope: 'work-inbox.list', command: 'work-inbox.listUp' },
    { keys: 'gg', scope: 'work-inbox.list', command: 'work-inbox.listTop' },
    { keys: 'G', scope: 'work-inbox.list', command: 'work-inbox.listBottom' },
    { keys: '<CR>', scope: 'work-inbox.list', command: 'work-inbox.openSlack' },
    { keys: 'i', scope: 'work-inbox.list', command: 'work-inbox.editDraft' },
    { keys: '<D-Enter>', scope: 'work-inbox.list', command: 'work-inbox.send' },
    { keys: 'd', scope: 'work-inbox.list', command: 'work-inbox.dismiss' },
    { keys: 'z', scope: 'work-inbox.list', command: 'work-inbox.snooze' },
    { keys: 'u', scope: 'work-inbox.list', command: 'work-inbox.restore' },
    { keys: 'b', scope: 'work-inbox.list', command: 'work-inbox.addToBoard' },
    { keys: 's', scope: 'work-inbox.list', command: 'work-inbox.startSession' },
    {
      keys: 't',
      scope: 'work-inbox.list',
      command: 'work-inbox.ticketOnBoard',
    },
    {
      keys: '<Esc>',
      scope: 'work-inbox.list',
      command: 'work-inbox.clearFilter',
    },
    { keys: 'gs', scope: 'work-inbox.list', command: 'work-inbox.showJobRow' },
    // `W` types in a draft, so the box scope leaves it unbound.
    ...(['work-inbox.sections', 'work-inbox.list'] as const).map((scope) => ({
      keys: 'W',
      scope,
      command: 'work-inbox.sweep' as const,
    })),
    { keys: '<D-Enter>', scope: 'work-inbox.box', command: 'work-inbox.send' },
    {
      keys: '<Esc>',
      scope: 'work-inbox.box',
      command: 'work-inbox.leaveBox',
      where: 'box',
    },
    { keys: 'j', scope: 'work-board.board', command: 'work-board.cardDown' },
    { keys: 'k', scope: 'work-board.board', command: 'work-board.cardUp' },
    { keys: 'gg', scope: 'work-board.board', command: 'work-board.cardTop' },
    { keys: 'G', scope: 'work-board.board', command: 'work-board.cardBottom' },
    { keys: 'h', scope: 'work-board.board', command: 'work-board.columnLeft' },
    { keys: 'l', scope: 'work-board.board', command: 'work-board.columnRight' },
    { keys: 'H', scope: 'work-board.board', command: 'work-board.moveLeft' },
    { keys: 'L', scope: 'work-board.board', command: 'work-board.moveRight' },
    { keys: '<CR>', scope: 'work-board.board', command: 'work-board.openCard' },
    { keys: 'y', scope: 'work-board.board', command: 'work-board.accept' },
    { keys: 'n', scope: 'work-board.board', command: 'work-board.notYet' },
    { keys: 't', scope: 'work-board.board', command: 'work-board.threads' },
    {
      keys: 's',
      scope: 'work-board.board',
      command: 'work-board.startSession',
    },
    { keys: 'd', scope: 'work-board.board', command: 'work-board.deleteTask' },
    { keys: 'W', scope: 'work-board.board', command: 'work-board.sweep' },
    { keys: 'gs', scope: 'work-board.board', command: 'work-board.showJobRow' },

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
    { keys: 'a', scope: 'practice.list', command: 'practice.importStart' },
    { keys: '<CR>', scope: 'practice.box', command: 'practice.boxAccept' },
    { keys: '<Esc>', scope: 'practice.box', command: 'practice.boxCancel' },
    // A chord fires inside a box and the editor as well, ahead of vim.
    ...(
      [
        'practice.list',
        'practice.problem',
        'practice.editor',
        'practice.console',
        'scoped-agents.ask',
      ] as const
    ).flatMap((scope) => [
      { keys: "<D-'>", scope, command: 'practice.run' as const },
      { keys: '<D-Enter>', scope, command: 'practice.submit' as const },
    ]),
    { keys: 'j', scope: 'practice.problem', command: 'practice.paneDown' },
    { keys: 'k', scope: 'practice.problem', command: 'practice.paneUp' },
    { keys: 'gg', scope: 'practice.problem', command: 'practice.paneTop' },
    { keys: 'G', scope: 'practice.problem', command: 'practice.paneBottom' },
    {
      keys: '<CR>',
      scope: 'practice.problem',
      command: 'practice.openSubmission',
    },
    {
      keys: '<Esc>',
      scope: 'practice.problem',
      command: 'practice.closeSubmission',
      where: 'page',
    },
    // The problem pane's and the console's tabs, box and scroll keys; Esc in
    // a box's normal mode leaves the box.
    ...(['practice.problem', 'practice.console'] as const).flatMap((scope) => [
      { keys: 'gt', scope, command: 'practice.nextTab' as const },
      { keys: 'gT', scope, command: 'practice.prevTab' as const },
      {
        keys: 'i',
        scope,
        command: 'practice.editBox' as const,
        where: 'page' as const,
      },
      {
        keys: '<Esc>',
        scope,
        command: 'practice.leaveBox' as const,
        where: 'box' as const,
      },
      { keys: '<C-j>', scope, command: 'practice.lineDown' as const },
      { keys: '<C-k>', scope, command: 'practice.lineUp' as const },
      { keys: '<C-S-j>', scope, command: 'practice.halfPageDown' as const },
      { keys: '<C-S-k>', scope, command: 'practice.halfPageUp' as const },
    ]),
    { keys: 'y', scope: 'practice.confirm', command: 'practice.confirmYes' },
    { keys: 'n', scope: 'practice.confirm', command: 'practice.confirmNo' },
    { keys: '<Esc>', scope: 'practice.confirm', command: 'practice.confirmNo' },
    // The scoped-agents ask box, the same keys: Enter sends in normal and
    // insert mode, Esc in normal mode leaves it.
    {
      keys: '<CR>',
      scope: 'scoped-agents.ask',
      command: 'scoped-agents.askSend',
      where: 'box',
    },
    {
      keys: '<Esc>',
      scope: 'scoped-agents.ask',
      command: 'scoped-agents.leaveBox',
      where: 'box',
    },
    {
      keys: '<CR>',
      scope: 'scoped-agents.ask',
      command: 'scoped-agents.askSend',
      mode: 'insert',
    },
    {
      keys: '<CR>',
      scope: 'practice.import',
      command: 'practice.importAccept',
    },
    {
      keys: '<Esc>',
      scope: 'practice.import',
      command: 'practice.importCancel',
    },

    // ── Schedules ──────────────────────────────────────────────────────────
    { keys: 'j', scope: 'scheduling.list', command: 'scheduling.listDown' },
    { keys: 'k', scope: 'scheduling.list', command: 'scheduling.listUp' },
    { keys: 'gg', scope: 'scheduling.list', command: 'scheduling.listTop' },
    { keys: 'G', scope: 'scheduling.list', command: 'scheduling.listBottom' },
    { keys: '<CR>', scope: 'scheduling.list', command: 'scheduling.open' },
    {
      keys: 'l',
      scope: 'scheduling.list',
      command: 'scheduling.openKeepingFocus',
    },
    {
      keys: 'j',
      scope: 'scheduling.detail',
      command: 'scheduling.historyDown',
    },
    { keys: 'k', scope: 'scheduling.detail', command: 'scheduling.historyUp' },
    {
      keys: 'gg',
      scope: 'scheduling.detail',
      command: 'scheduling.historyTop',
    },
    {
      keys: 'G',
      scope: 'scheduling.detail',
      command: 'scheduling.historyBottom',
    },
    { keys: '<CR>', scope: 'scheduling.detail', command: 'scheduling.openRun' },
    { keys: 'l', scope: 'scheduling.detail', command: 'scheduling.openRun' },
    ...(['scheduling.list', 'scheduling.detail'] as const).flatMap((scope) => [
      { keys: 'a', scope, command: 'scheduling.newTask' as const },
      { keys: 'i', scope, command: 'scheduling.edit' as const },
      { keys: 'p', scope, command: 'scheduling.togglePaused' as const },
      { keys: 'r', scope, command: 'scheduling.runNow' as const },
      { keys: 'd', scope, command: 'scheduling.remove' as const },
      { keys: '<C-j>', scope, command: 'scheduling.lineDown' as const },
      { keys: '<C-k>', scope, command: 'scheduling.lineUp' as const },
      { keys: '<C-S-j>', scope, command: 'scheduling.halfPageDown' as const },
      { keys: '<C-S-k>', scope, command: 'scheduling.halfPageUp' as const },
    ]),
    {
      keys: 'j',
      scope: 'scheduling.editor',
      command: 'scheduling.fieldDown',
      where: 'page',
    },
    {
      keys: 'k',
      scope: 'scheduling.editor',
      command: 'scheduling.fieldUp',
      where: 'page',
    },
    {
      keys: '<CR>',
      scope: 'scheduling.editor',
      command: 'scheduling.editField',
      where: 'page',
    },
    {
      keys: 'i',
      scope: 'scheduling.editor',
      command: 'scheduling.editField',
      where: 'page',
    },
    {
      keys: '<Tab>',
      scope: 'scheduling.editor',
      command: 'scheduling.nextField',
    },
    {
      keys: '<S-Tab>',
      scope: 'scheduling.editor',
      command: 'scheduling.previousField',
    },
    {
      keys: '<D-Enter>',
      scope: 'scheduling.editor',
      command: 'scheduling.save',
    },
    {
      keys: '<Esc>',
      scope: 'scheduling.editor',
      command: 'scheduling.leaveBox',
      where: 'box',
    },
    {
      keys: '<Esc>',
      scope: 'scheduling.editor',
      command: 'scheduling.cancelEdit',
      where: 'page',
    },
    {
      keys: 'y',
      scope: 'scheduling.confirm',
      command: 'scheduling.confirmYes',
    },
    { keys: 'n', scope: 'scheduling.confirm', command: 'scheduling.confirmNo' },
    {
      keys: '<Esc>',
      scope: 'scheduling.confirm',
      command: 'scheduling.confirmNo',
    },

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

    // ── Chatroom ───────────────────────────────────────────────────────────
    { keys: 'j', scope: 'chatroom.threads', command: 'chatroom.listDown' },
    { keys: 'k', scope: 'chatroom.threads', command: 'chatroom.listUp' },
    { keys: 'gg', scope: 'chatroom.threads', command: 'chatroom.listTop' },
    { keys: 'G', scope: 'chatroom.threads', command: 'chatroom.listBottom' },
    { keys: '<CR>', scope: 'chatroom.threads', command: 'chatroom.openThread' },
    { keys: 'j', scope: 'chatroom.log', command: 'chatroom.logDown' },
    { keys: 'k', scope: 'chatroom.log', command: 'chatroom.logUp' },
    { keys: 'gg', scope: 'chatroom.log', command: 'chatroom.logTop' },
    { keys: 'G', scope: 'chatroom.log', command: 'chatroom.logBottom' },
    { keys: 'i', scope: 'chatroom.log', command: 'chatroom.compose' },
    { keys: 'r', scope: 'chatroom.log', command: 'chatroom.reply' },
    // The composer is a one-line box: Enter sends and Esc leaves it.
    { keys: '<CR>', scope: 'chatroom.composer', command: 'chatroom.send' },
    {
      keys: '<Esc>',
      scope: 'chatroom.composer',
      command: 'chatroom.leaveComposer',
    },

    // ── Builds ─────────────────────────────────────────────────────────────
    { keys: 'j', scope: 'builds.games', command: 'builds.gameDown' },
    { keys: 'k', scope: 'builds.games', command: 'builds.gameUp' },
    { keys: 'gg', scope: 'builds.games', command: 'builds.gameTop' },
    { keys: 'G', scope: 'builds.games', command: 'builds.gameBottom' },
    { keys: '<CR>', scope: 'builds.games', command: 'builds.openGame' },
    { keys: 'q', scope: 'builds.games', command: 'builds.pickQueue' },
    { keys: 'j', scope: 'builds.list', command: 'builds.listDown' },
    { keys: 'k', scope: 'builds.list', command: 'builds.listUp' },
    { keys: 'gg', scope: 'builds.list', command: 'builds.listTop' },
    { keys: 'G', scope: 'builds.list', command: 'builds.listBottom' },
    { keys: '<CR>', scope: 'builds.list', command: 'builds.focusGraph' },
    { keys: 'q', scope: 'builds.list', command: 'builds.pickQueue' },
    { keys: 'o', scope: 'builds.list', command: 'builds.openWeb' },
    { keys: 'x', scope: 'builds.list', command: 'builds.cancel' },
    { keys: 's', scope: 'builds.list', command: 'builds.download' },
    { keys: '<Esc>', scope: 'builds.graph', command: 'builds.leaveGraph' },
    { keys: 'h', scope: 'builds.graph', command: 'builds.graphLeft' },
    { keys: 'l', scope: 'builds.graph', command: 'builds.graphRight' },
    { keys: 'k', scope: 'builds.graph', command: 'builds.graphUp' },
    { keys: 'j', scope: 'builds.graph', command: 'builds.graphDown' },
    { keys: 's', scope: 'builds.graph', command: 'builds.saveLog' },
    { keys: 'o', scope: 'builds.graph', command: 'builds.openJob' },
    // `k` and Esc both hand the offer card's cursor back to the entries.
    { keys: '<CR>', scope: 'builds.offer', command: 'builds.queueOffer' },
    { keys: 'x', scope: 'builds.offer', command: 'builds.dismissOffer' },
    { keys: 'k', scope: 'builds.offer', command: 'builds.leaveOffer' },
    { keys: '<Esc>', scope: 'builds.offer', command: 'builds.leaveOffer' },
    { keys: 'i', scope: 'builds.offer', command: 'builds.offerFocusBox' },
    { keys: 'a', scope: 'builds.offer', command: 'builds.offerAppendBox' },

    // ── System stats ───────────────────────────────────────────────────────
    {
      keys: 'j',
      scope: 'system-stats.panel',
      command: 'system-stats.cursorDown',
    },
    {
      keys: 'k',
      scope: 'system-stats.panel',
      command: 'system-stats.cursorUp',
    },
    {
      keys: 'gg',
      scope: 'system-stats.panel',
      command: 'system-stats.cursorTop',
    },
    {
      keys: 'G',
      scope: 'system-stats.panel',
      command: 'system-stats.cursorBottom',
    },
    {
      keys: 's',
      scope: 'system-stats.panel',
      command: 'system-stats.cycleSort',
    },
    {
      keys: '<CR>',
      scope: 'system-stats.panel',
      command: 'system-stats.openGroup',
    },
    {
      keys: 'l',
      scope: 'system-stats.panel',
      command: 'system-stats.openGroup',
    },
    {
      keys: 'h',
      scope: 'system-stats.panel',
      command: 'system-stats.closeGroup',
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

    // ── Demo ───────────────────────────────────────────────────────────────
    {
      keys: '<Leader>dd',
      scope: 'any',
      command: 'demo.togglePanel',
      where: 'page',
    },
    { keys: '<Leader>dn', scope: 'any', command: 'demo.next', where: 'page' },
    {
      keys: '<Leader>dp',
      scope: 'any',
      command: 'demo.previous',
      where: 'page',
    },
    {
      keys: '<Leader>da',
      scope: 'any',
      command: 'demo.autoplay',
      where: 'page',
    },
    { keys: '<Leader>dr', scope: 'any', command: 'demo.reset', where: 'page' },
    {
      keys: '<Leader>dh',
      scope: 'any',
      command: 'demo.showReal',
      where: 'page',
    },
    { keys: '<Leader>dx', scope: 'any', command: 'demo.stop', where: 'page' },
    { keys: 'j', scope: 'demo.panel', command: 'demo.cursorDown' },
    { keys: 'k', scope: 'demo.panel', command: 'demo.cursorUp' },
    { keys: '<CR>', scope: 'demo.panel', command: 'demo.goToCursor' },
    { keys: 'i', scope: 'demo.panel', command: 'demo.askAgent' },

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
      keys: '<Leader>zlm',
      scope: 'any',
      command: 'audio-picker.openPreview',
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
      keys: '<Leader>zlr',
      scope: 'any',
      command: 'chatroom.preview',
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
