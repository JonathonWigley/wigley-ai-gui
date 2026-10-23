// Every default key of the app and its built-in plugins. The rule for picking
// a key is docs/keymap.md; the user's keymap.json takes entries in this shape.
import type {
  AcceleratorBind,
  DefaultKeymap,
  InterceptBind,
  KeyBind,
} from '../contracts/keymap';
import type { QualifiedCommandId, QualifiedScopeId } from '../contracts/plugin';
import type { builtInManifests } from './manifests';

type BuiltInManifest = (typeof builtInManifests)[number];

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
    command: QualifiedCommandId<BuiltInManifest, 'page'>;
  })[];
  app: BuiltInAcceleratorBind[];
  intercept: (Omit<InterceptBind, 'command'> & {
    command: BuiltInMainCommand;
  })[];
  global: BuiltInAcceleratorBind[];
};

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

// A bare digit picks a choice on the page; in a text box, where vim reads a
// digit as a count, `<Leader>a` and a digit picks.
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
    { keys: '<Leader>af', command: 'forms.actFixNow' as const },
    { keys: '<Leader>au', command: 'forms.actFollowUp' as const },
    { keys: '<Leader>as', command: 'forms.actLeaveIt' as const },
    ...(scope === 'forms.review'
      ? [{ keys: '<Leader><Leader>', command: 'forms.openReview' as const }]
      : []),
    { keys: '<Esc>', command: 'forms.leaveBox' as const },
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
    '<Leader>zl': 'forms layouts',
    '<Leader>zc': 'chat layouts',
    '<Leader>c': 'chat controls',
    '<Leader>a': 'answer',
  },
  binds: [
    // ── Windows and modes ──────────────────────────────────────────────────
    { keys: '<Leader>ks', scope: 'any', command: 'sessions.showMode' },
    { keys: '<Leader>kn', scope: 'any', command: 'chat.newSession' },
    { keys: '<Leader>kd', scope: 'any', command: 'docs.showMode' },
    { keys: '<Leader>vt', scope: 'any', command: 'docs.toggleTree' },
    { keys: '<Leader>k,', scope: 'any', command: 'settings.showMode' },

    // ── Tabs and sessions ──────────────────────────────────────────────────
    { keys: '<A-S-o>', scope: 'any', command: 'sessions.nextSession' },
    { keys: '<A-S-i>', scope: 'any', command: 'sessions.prevSession' },
    { keys: '<A-o>', scope: 'any', command: 'sessions.nextTab' },
    { keys: '<A-i>', scope: 'any', command: 'sessions.prevTab' },
    { keys: '<D-w>', scope: 'any', command: 'sessions.closeSession' },
    { keys: '<Leader>;', scope: 'any', command: 'sessions.closeSession' },

    // ── Help ───────────────────────────────────────────────────────────────
    { keys: '<Leader>?', scope: 'any', command: 'keys.toggleHelp' },
    { keys: '<Esc>', scope: 'keys.help', command: 'keys.closeHelp' },

    // ── Forms ──────────────────────────────────────────────────────────────
    { keys: 'j', scope: 'forms.forms', command: 'forms.nextItem' },
    { keys: '<C-l>', scope: 'forms.forms', command: 'forms.nextItem' },
    { keys: 'k', scope: 'forms.forms', command: 'forms.prevItem' },
    { keys: '<C-h>', scope: 'forms.forms', command: 'forms.prevItem' },
    { keys: '<C-j>', scope: 'forms.forms', command: 'forms.nextBox' },
    { keys: '<C-k>', scope: 'forms.forms', command: 'forms.prevBox' },
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
    { keys: 'f', scope: 'forms.forms', command: 'forms.actFixNow' },
    { keys: 'u', scope: 'forms.forms', command: 'forms.actFollowUp' },
    { keys: 's', scope: 'forms.forms', command: 'forms.actLeaveIt' },
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
    { keys: 'y', scope: 'forms.confirm', command: 'forms.confirmCancel' },
    { keys: 'n', scope: 'forms.confirm', command: 'forms.dismissConfirm' },
    { keys: '<Esc>', scope: 'forms.confirm', command: 'forms.dismissConfirm' },
    ...formsBoxBinds('forms.forms'),
    ...formsBoxBinds('forms.review'),

    // ── Chat ───────────────────────────────────────────────────────────────
    { keys: 'i', scope: 'chat.chat', command: 'chat.focusBox' },
    { keys: 'a', scope: 'chat.chat', command: 'chat.appendBox' },
    { keys: 'j', scope: 'chat.chat', command: 'chat.nextEntry' },
    { keys: 'k', scope: 'chat.chat', command: 'chat.prevEntry' },
    { keys: '<CR>', scope: 'chat.chat', command: 'chat.toggleEntry' },
    { keys: 'G', scope: 'chat.chat', command: 'chat.latestEntry' },
    { keys: 'gg', scope: 'chat.chat', command: 'chat.firstEntry' },
    { keys: '<C-j>', scope: 'chat.chat', command: 'chat.halfPageDown' },
    { keys: '<C-k>', scope: 'chat.chat', command: 'chat.halfPageUp' },
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
    // A box's binds are normal-mode maps: `<CR>` sends only in normal mode, so
    // Enter in insert mode adds a line.
    { keys: '<CR>', scope: 'chat.chat', command: 'chat.send', where: 'box' },
    {
      keys: '<Esc>',
      scope: 'chat.chat',
      command: 'chat.leaveBox',
      where: 'box',
    },
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
      keys: '<Leader>cx',
      scope: 'chat.chat',
      command: 'chat.removeImage',
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

    // ── Docs ───────────────────────────────────────────────────────────────
    { keys: 'j', scope: 'docs.tree', command: 'docs.treeDown' },
    { keys: 'k', scope: 'docs.tree', command: 'docs.treeUp' },
    { keys: 'gg', scope: 'docs.tree', command: 'docs.treeTop' },
    { keys: 'G', scope: 'docs.tree', command: 'docs.treeBottom' },
    { keys: 'l', scope: 'docs.tree', command: 'docs.treeOpen' },
    { keys: '<CR>', scope: 'docs.tree', command: 'docs.treeOpen' },
    { keys: 'h', scope: 'docs.tree', command: 'docs.treeClose' },
    { keys: '/', scope: 'docs.tree', command: 'docs.filter' },
    { keys: 'R', scope: 'docs.tree', command: 'docs.rescan' },
    { keys: 'c', scope: 'docs.tree', command: 'docs.pickContext' },
    { keys: 'a', scope: 'docs.tree', command: 'docs.createByKind' },
    { keys: 'A', scope: 'docs.tree', command: 'docs.createByPath' },
    { keys: 'r', scope: 'docs.tree', command: 'docs.rename' },
    { keys: 'd', scope: 'docs.tree', command: 'docs.trash' },
    { keys: '<A-l>', scope: 'docs.tree', command: 'docs.focusDoc' },
    { keys: '<A-h>', scope: 'docs.doc', command: 'docs.focusTree' },
    { keys: 'j', scope: 'docs.doc', command: 'docs.scrollDown' },
    { keys: 'k', scope: 'docs.doc', command: 'docs.scrollUp' },
    { keys: '<C-j>', scope: 'docs.doc', command: 'docs.halfPageDown' },
    { keys: '<C-k>', scope: 'docs.doc', command: 'docs.halfPageUp' },
    { keys: 'i', scope: 'docs.doc', command: 'docs.edit' },
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
    {
      keys: '<A-l>',
      scope: 'settings.sections',
      command: 'settings.focusRows',
    },
    {
      keys: '<A-h>',
      scope: 'settings.rows',
      command: 'settings.focusSections',
    },
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

    // ── Gallery ────────────────────────────────────────────────────────────
    {
      keys: 't',
      scope: 'gallery.gallery',
      command: 'gallery.toggleTransparency',
    },
    { keys: 'gg', scope: 'gallery.gallery', command: 'gallery.scrollTop' },
    { keys: 'G', scope: 'gallery.gallery', command: 'gallery.scrollEnd' },
    { keys: '<C-j>', scope: 'gallery.gallery', command: 'gallery.pageDown' },
    { keys: '<C-k>', scope: 'gallery.gallery', command: 'gallery.pageUp' },

    // ── Debug and testing ──────────────────────────────────────────────────
    {
      keys: '<Leader>zln',
      scope: 'any',
      command: 'forms.nextLayout',
      where: 'page',
    },
    {
      keys: '<Leader>zlp',
      scope: 'any',
      command: 'forms.prevLayout',
      where: 'page',
    },
    {
      keys: '<Leader>zlc',
      scope: 'any',
      command: 'forms.copyLayout',
      where: 'page',
    },
    {
      keys: '<Leader>zlo',
      scope: 'any',
      command: 'forms.openPreview',
      where: 'page',
    },
    {
      keys: '<Leader>zcn',
      scope: 'any',
      command: 'chat.nextLayout',
      where: 'page',
    },
    {
      keys: '<Leader>zcp',
      scope: 'any',
      command: 'chat.prevLayout',
      where: 'page',
    },
    {
      keys: '<Leader>zcc',
      scope: 'any',
      command: 'chat.copyLayout',
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
