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
import { type builtInManifests, DIGITS } from './manifests';

type BuiltInManifest = (typeof builtInManifests)[number];

// A page command of the core's own.
type CorePageCommand =
  | (typeof PANE_RESIZE_COMMANDS)[keyof typeof PANE_RESIZE_COMMANDS]
  | (typeof PANE_FOCUS_COMMANDS)[keyof typeof PANE_FOCUS_COMMANDS];

// A main-process command of a built-in plugin, or the core's.
type BuiltInMainCommand =
  | QualifiedCommandId<BuiltInManifest, 'main'>
  | 'window.summon';

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
  command: `forms.choose${digit}` as const,
}));

// A text box holds focus only in the form's and the review's views, so its
// binds fire in both; `<Leader><Leader>` fires on the form's page as well.
function formsBoxBinds(scope: 'forms.forms' | 'forms.review') {
  return [
    { keys: '<Leader>x', command: 'forms.toggleNotApplicable' as const },
    ...DIGITS.map((digit) => ({
      keys: `<Leader>a${digit}`,
      command: `forms.choose${digit}` as const,
    })),
    { keys: '<Leader>ac', command: 'forms.clearChoice' as const },
    ...(scope === 'forms.review'
      ? [{ keys: '<Leader><Leader>', command: 'forms.openReview' as const }]
      : []),
    { keys: '<Esc>', command: 'forms.leaveBox' as const },
  ].map((bind) => ({ ...bind, scope, where: 'box' as const }));
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
    { keys: '<CR>', scope, command: 'chat.toggleEntry' as const },
    { keys: 'G', scope, command: 'chat.latestEntry' as const },
    { keys: 'gg', scope, command: 'chat.firstEntry' as const },
    { keys: '<C-j>', scope, command: 'chat.lineDown' as const },
    { keys: '<C-k>', scope, command: 'chat.lineUp' as const },
    { keys: '<C-S-j>', scope, command: 'chat.halfPageDown' as const },
    { keys: '<C-S-k>', scope, command: 'chat.halfPageUp' as const },
  ];
}

// A box's binds are normal-mode maps: `<CR>` sends only in normal mode, so
// Enter in insert mode adds a line.
function chatBoxBinds() {
  const scope = 'chat.chat' as const;
  return [
    { keys: '<CR>', command: 'chat.send' as const },
    { keys: '<Esc>', command: 'chat.leaveBox' as const },
    { keys: '<Leader>cx', command: 'chat.removeImage' as const },
    { keys: '<Leader>cp', command: 'chat.pullBackQueued' as const },
  ].map((bind) => ({ ...bind, scope, where: 'box' as const }));
}

// The chat's picker and session list each hold the same list keys.
function chatListPageBinds(scope: 'chat.picker' | 'chat.resume') {
  return [
    { keys: 'j', scope, command: 'chat.pickerDown' as const },
    { keys: 'k', scope, command: 'chat.pickerUp' as const },
    { keys: '<CR>', scope, command: 'chat.pickerPick' as const },
    { keys: '<Esc>', scope, command: 'chat.pickerClose' as const },
    { keys: '/', scope, command: 'chat.pickerFilter' as const },
  ];
}

// `<CR>` picks in insert mode too, so Enter in the filter box picks.
function chatListBoxBinds(scope: 'chat.picker' | 'chat.resume') {
  return [
    {
      keys: '<CR>',
      scope,
      command: 'chat.pickerPick' as const,
      where: 'box' as const,
    },
    {
      keys: '<CR>',
      scope,
      command: 'chat.pickerPick' as const,
      mode: 'insert' as const,
    },
    {
      keys: '<Esc>',
      scope,
      command: 'chat.pickerList' as const,
      where: 'box' as const,
    },
  ];
}

export const defaultKeymap = {
  leader: '<Space>',
  groups: {
    '<Leader>k': 'windows',
    '<Leader>v': 'view',
    '<Leader>z': 'debug',
    '<Leader>zl': 'layout previews',
    '<Leader>c': 'chat controls',
    '<Leader>a': 'answer',
    '<Leader>n': 'notes',
    '<Leader>w': 'workflow',
    '<Leader>r': 'rename',
  },
  binds: [
    // ── Windows and modes ──────────────────────────────────────────────────
    { keys: '<Leader>ks', scope: 'any', command: 'sessions.showMode' },
    { keys: '<Leader>kn', scope: 'any', command: 'chat.newSession' },
    { keys: '<Leader>kd', scope: 'any', command: 'docs.showMode' },
    { keys: '<Leader>vt', scope: 'any', command: 'docs.toggleTree' },
    { keys: '<Leader>k,', scope: 'any', command: 'settings.showMode' },
    { keys: '<Leader>kb', scope: 'any', command: 'backlog.showMode' },
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
    { keys: '<Leader>rr', scope: 'any', command: 'sessions.renameSession' },

    // ── Workflow ───────────────────────────────────────────────────────────
    { keys: '<Leader>ww', scope: 'any', command: 'workflow.mainAction' },
    { keys: '<Leader>wn', scope: 'any', command: 'workflow.makeInNewSession' },
    { keys: '<Leader>wr', scope: 'any', command: 'workflow.resumeMake' },
    { keys: '<Leader>wo', scope: 'any', command: 'workflow.openPlan' },
    { keys: '<Leader>wt', scope: 'any', command: 'workflow.retro' },
    { keys: '<Leader>wd', scope: 'any', command: 'workflow.dismiss' },
    { keys: '<C-j>', scope: 'workflow.flow', command: 'workflow.lineDown' },
    { keys: '<C-k>', scope: 'workflow.flow', command: 'workflow.lineUp' },
    {
      keys: '<C-S-j>',
      scope: 'workflow.flow',
      command: 'workflow.halfPageDown',
    },
    {
      keys: '<C-S-k>',
      scope: 'workflow.flow',
      command: 'workflow.halfPageUp',
    },

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
    { keys: 'j', scope: 'sessions.picker', command: 'sessions.pickerDown' },
    { keys: 'k', scope: 'sessions.picker', command: 'sessions.pickerUp' },
    {
      keys: '<CR>',
      scope: 'sessions.picker',
      command: 'sessions.pickerChoose',
    },
    {
      keys: '<Esc>',
      scope: 'sessions.picker',
      command: 'sessions.pickerCancel',
    },
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

    // ── Help ───────────────────────────────────────────────────────────────
    { keys: '<Leader>?', scope: 'any', command: 'keys.toggleHelp' },
    { keys: '<Esc>', scope: 'keys.help', command: 'keys.closeHelp' },

    // ── Forms ──────────────────────────────────────────────────────────────
    { keys: 'j', scope: 'forms.forms', command: 'forms.nextItem' },
    { keys: '<C-l>', scope: 'forms.forms', command: 'forms.nextItem' },
    { keys: 'k', scope: 'forms.forms', command: 'forms.prevItem' },
    { keys: '<C-h>', scope: 'forms.forms', command: 'forms.prevItem' },
    { keys: '<C-j>', scope: 'forms.forms', command: 'forms.lineDown' },
    { keys: '<C-k>', scope: 'forms.forms', command: 'forms.lineUp' },
    { keys: '<C-S-j>', scope: 'forms.forms', command: 'forms.halfPageDown' },
    { keys: '<C-S-k>', scope: 'forms.forms', command: 'forms.halfPageUp' },
    { keys: '<C-n>', scope: 'forms.forms', command: 'forms.nextBox' },
    { keys: '<C-p>', scope: 'forms.forms', command: 'forms.prevBox' },
    ...formsPageChoices,
    { keys: 'x', scope: 'forms.forms', command: 'forms.toggleNotApplicable' },
    { keys: 'd', scope: 'forms.forms', command: 'forms.toggleDontAsk' },
    { keys: 'a', scope: 'forms.forms', command: 'forms.editNotes' },
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
    { keys: '<CR>', scope: 'forms.review', command: 'forms.reviewJump' },
    { keys: 'C', scope: 'forms.review', command: 'forms.askCancel' },
    { keys: 'o', scope: 'forms.review', command: 'forms.editNote' },
    { keys: '<C-j>', scope: 'forms.review', command: 'forms.lineDown' },
    { keys: '<C-k>', scope: 'forms.review', command: 'forms.lineUp' },
    { keys: '<C-S-j>', scope: 'forms.review', command: 'forms.halfPageDown' },
    { keys: '<C-S-k>', scope: 'forms.review', command: 'forms.halfPageUp' },
    { keys: '<C-n>', scope: 'forms.review', command: 'forms.nextBox' },
    { keys: '<C-p>', scope: 'forms.review', command: 'forms.prevBox' },
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
    { keys: '<C-l>', scope: 'primer.card', command: 'primer.nextRow' },
    { keys: '<C-h>', scope: 'primer.card', command: 'primer.prevRow' },
    { keys: 'x', scope: 'primer.card', command: 'primer.toggleInclude' },
    { keys: 'c', scope: 'primer.card', command: 'primer.editItemComment' },
    { keys: 'C', scope: 'primer.card', command: 'primer.editTaskComment' },
    { keys: 'a', scope: 'primer.card', command: 'primer.addItem' },
    { keys: 'i', scope: 'primer.card', command: 'primer.editFirstField' },
    { keys: '<C-n>', scope: 'primer.card', command: 'primer.nextBox' },
    { keys: '<C-p>', scope: 'primer.card', command: 'primer.prevBox' },
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
    { keys: 'y', scope: 'chat.chat', command: 'chat.allowPermission' },
    { keys: 'n', scope: 'chat.chat', command: 'chat.denyPermission' },
    { keys: '<C-c>', scope: 'chat.chat', command: 'chat.interrupt' },
    { keys: '<D-Enter>', scope: 'chat.chat', command: 'chat.send' },
    { keys: 'm', scope: 'chat.chat', command: 'chat.pickMode' },
    { keys: 'e', scope: 'chat.chat', command: 'chat.pickEffort' },
    { keys: 'o', scope: 'chat.chat', command: 'chat.pickModel' },
    { keys: 'c', scope: 'chat.chat', command: 'chat.pickControl' },
    ...chatListPageBinds('chat.picker'),
    ...chatListPageBinds('chat.resume'),
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
    ...chatListBoxBinds('chat.picker'),
    ...chatListBoxBinds('chat.resume'),
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

    // ── Visual ─────────────────────────────────────────────────────────────
    { keys: 'v', scope: 'chat.chat', command: 'visual.openVisuals' },
    { keys: 'h', scope: 'visual.overlay', command: 'visual.prevVisual' },
    { keys: 'l', scope: 'visual.overlay', command: 'visual.nextVisual' },
    { keys: '<Esc>', scope: 'visual.overlay', command: 'visual.closeVisual' },

    // ── Docs ───────────────────────────────────────────────────────────────
    { keys: 'j', scope: 'docs.tree', command: 'docs.treeDown' },
    { keys: 'k', scope: 'docs.tree', command: 'docs.treeUp' },
    { keys: 'gg', scope: 'docs.tree', command: 'docs.treeTop' },
    { keys: 'G', scope: 'docs.tree', command: 'docs.treeBottom' },
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
    { keys: 'j', scope: 'docs.doc', command: 'docs.scrollDown' },
    { keys: 'k', scope: 'docs.doc', command: 'docs.scrollUp' },
    { keys: '<C-j>', scope: 'docs.doc', command: 'docs.lineDown' },
    { keys: '<C-k>', scope: 'docs.doc', command: 'docs.lineUp' },
    { keys: '<C-S-j>', scope: 'docs.doc', command: 'docs.halfPageDown' },
    { keys: '<C-S-k>', scope: 'docs.doc', command: 'docs.halfPageUp' },
    { keys: 'i', scope: 'docs.doc', command: 'docs.edit' },
    // Esc in the editor's normal mode closes it as `:q` does.
    {
      keys: '<Esc>',
      scope: 'docs.doc',
      command: 'docs.quitEditor',
      where: 'box',
    },
    { keys: 'r', scope: 'docs.conflict', command: 'docs.conflictReload' },
    { keys: 'o', scope: 'docs.conflict', command: 'docs.conflictOverwrite' },
    { keys: '<Esc>', scope: 'docs.conflict', command: 'docs.conflictCancel' },
    { keys: 'j', scope: 'docs.picker', command: 'docs.pickerDown' },
    { keys: 'k', scope: 'docs.picker', command: 'docs.pickerUp' },
    { keys: '<CR>', scope: 'docs.picker', command: 'docs.pickerChoose' },
    { keys: 'l', scope: 'docs.picker', command: 'docs.pickerChoose' },
    { keys: '<Esc>', scope: 'docs.picker', command: 'docs.pickerCancel' },
    { keys: '<Tab>', scope: 'docs.box', command: 'docs.boxComplete' },
    { keys: '<CR>', scope: 'docs.box', command: 'docs.boxAccept' },
    { keys: '<Esc>', scope: 'docs.box', command: 'docs.boxCancel' },
    { keys: 'y', scope: 'docs.confirm', command: 'docs.confirmYes' },
    { keys: 'n', scope: 'docs.confirm', command: 'docs.confirmNo' },
    { keys: '<Esc>', scope: 'docs.confirm', command: 'docs.confirmNo' },

    // ── Settings ───────────────────────────────────────────────────────────
    ...(['settings.sections', 'settings.rows'] as const).flatMap((scope) => [
      { keys: 'j', scope, command: 'settings.down' as const },
      { keys: 'k', scope, command: 'settings.up' as const },
      { keys: 'gg', scope, command: 'settings.top' as const },
      { keys: 'G', scope, command: 'settings.bottom' as const },
      { keys: '<CR>', scope, command: 'settings.open' as const },
      { keys: '/', scope, command: 'settings.filter' as const },
      { keys: '<Esc>', scope, command: 'settings.clearFilter' as const },
    ]),
    { keys: 'i', scope: 'settings.rows', command: 'settings.edit' },
    { keys: 'r', scope: 'settings.rows', command: 'settings.reset' },
    { keys: 'a', scope: 'settings.rows', command: 'settings.addBind' },
    { keys: 'd', scope: 'settings.rows', command: 'settings.removeBind' },
    { keys: '<CR>', scope: 'settings.box', command: 'settings.boxAccept' },
    { keys: '<Esc>', scope: 'settings.box', command: 'settings.boxCancel' },
    { keys: 'j', scope: 'settings.picker', command: 'settings.pickerDown' },
    { keys: 'k', scope: 'settings.picker', command: 'settings.pickerUp' },
    {
      keys: '<CR>',
      scope: 'settings.picker',
      command: 'settings.pickerChoose',
    },
    {
      keys: '<Esc>',
      scope: 'settings.picker',
      command: 'settings.pickerCancel',
    },

    // ── Backlog ────────────────────────────────────────────────────────────
    { keys: 'j', scope: 'backlog.list', command: 'backlog.listDown' },
    { keys: 'k', scope: 'backlog.list', command: 'backlog.listUp' },
    { keys: 'gg', scope: 'backlog.list', command: 'backlog.listTop' },
    { keys: 'G', scope: 'backlog.list', command: 'backlog.listBottom' },
    { keys: 'l', scope: 'backlog.list', command: 'backlog.open' },
    { keys: '<CR>', scope: 'backlog.list', command: 'backlog.toggle' },
    { keys: 'h', scope: 'backlog.list', command: 'backlog.back' },
    { keys: '/', scope: 'backlog.list', command: 'backlog.filter' },
    { keys: 'a', scope: 'backlog.list', command: 'backlog.create' },
    { keys: 'i', scope: 'backlog.list', command: 'backlog.edit' },
    { keys: 'd', scope: 'backlog.list', command: 'backlog.delete' },
    { keys: 't', scope: 'backlog.list', command: 'backlog.toggleAgentReady' },
    { keys: 'T', scope: 'backlog.list', command: 'backlog.pickTag' },
    // Uppercase, so the one step out of the app is never a lowercase slip.
    { keys: 'C', scope: 'backlog.list', command: 'backlog.commit' },
    { keys: 'R', scope: 'backlog.list', command: 'backlog.rescan' },
    { keys: 'o', scope: 'backlog.list', command: 'backlog.openInDocs' },
    // The list's scroll keys scroll the detail shown beside it.
    ...(['backlog.list', 'backlog.detail'] as const).flatMap((scope) => [
      { keys: '<C-j>', scope, command: 'backlog.lineDown' as const },
      { keys: '<C-k>', scope, command: 'backlog.lineUp' as const },
      { keys: '<C-S-j>', scope, command: 'backlog.halfPageDown' as const },
      { keys: '<C-S-k>', scope, command: 'backlog.halfPageUp' as const },
    ]),
    { keys: 'j', scope: 'backlog.detail', command: 'backlog.lineDown' },
    { keys: 'k', scope: 'backlog.detail', command: 'backlog.lineUp' },
    { keys: 'o', scope: 'backlog.detail', command: 'backlog.openInDocs' },
    // A chord fires inside a box as well, so the editor's chords need no
    // `where`.
    { keys: '<D-Enter>', scope: 'backlog.editor', command: 'backlog.save' },
    { keys: '<C-n>', scope: 'backlog.editor', command: 'backlog.nextField' },
    {
      keys: '<C-p>',
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
    { keys: 'j', scope: 'backlog.picker', command: 'backlog.pickerDown' },
    { keys: 'k', scope: 'backlog.picker', command: 'backlog.pickerUp' },
    { keys: '<CR>', scope: 'backlog.picker', command: 'backlog.pickerChoose' },
    { keys: 'l', scope: 'backlog.picker', command: 'backlog.pickerChoose' },
    { keys: '<Esc>', scope: 'backlog.picker', command: 'backlog.pickerCancel' },

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
    { keys: '<C-n>', scope: 'notes.popup', command: 'notes.nextBox' },
    { keys: '<C-p>', scope: 'notes.popup', command: 'notes.prevBox' },
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
    { keys: '<C-n>', scope: 'notes.title', command: 'notes.nextBox' },
    { keys: '<C-p>', scope: 'notes.title', command: 'notes.prevBox' },
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
    { keys: 'j', scope: 'notes.picker', command: 'notes.pickerDown' },
    { keys: 'k', scope: 'notes.picker', command: 'notes.pickerUp' },
    { keys: '<CR>', scope: 'notes.picker', command: 'notes.pickerChoose' },
    { keys: '<Esc>', scope: 'notes.picker', command: 'notes.pickerCancel' },
    { keys: '/', scope: 'notes.picker', command: 'notes.pickerFilter' },
    // `<CR>` picks in insert mode too, so Enter in the filter box picks.
    {
      keys: '<CR>',
      scope: 'notes.picker',
      command: 'notes.pickerChoose',
      where: 'box',
    },
    {
      keys: '<CR>',
      scope: 'notes.picker',
      command: 'notes.pickerChoose',
      mode: 'insert',
    },
    {
      keys: '<Esc>',
      scope: 'notes.picker',
      command: 'notes.pickerList',
      where: 'box',
    },
    { keys: 'y', scope: 'notes.confirm', command: 'notes.confirmYes' },
    { keys: 'n', scope: 'notes.confirm', command: 'notes.confirmNo' },
    { keys: '<Esc>', scope: 'notes.confirm', command: 'notes.confirmNo' },

    // ── Gallery ────────────────────────────────────────────────────────────
    {
      keys: 't',
      scope: 'gallery.gallery',
      command: 'gallery.toggleTransparency',
    },
    { keys: 'gg', scope: 'gallery.gallery', command: 'gallery.scrollTop' },
    { keys: 'G', scope: 'gallery.gallery', command: 'gallery.scrollEnd' },
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
