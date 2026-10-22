import { definePlugin } from '../../shared/define-plugin';
import type { ChatProfile } from './contract';

// Each profile names a Claude config folder; a leading `~/` means the home
// folder.
export const DEFAULT_PROFILES: ChatProfile[] = [
  { name: 'work', configDir: '~/.claude' },
  { name: 'personal', configDir: '~/.claude-personal' },
];

// The scopes a picker list pushes; each holds the same list binds.
type ListScope = 'picker' | 'resume';

function listPageBinds(scope: ListScope) {
  return [
    { keys: ['j'], scope, command: 'pickerDown' as const },
    { keys: ['k'], scope, command: 'pickerUp' as const },
    { keys: ['Enter'], scope, command: 'pickerPick' as const },
    { keys: ['Escape'], scope, command: 'pickerClose' as const },
    { keys: ['/'], scope, command: 'pickerFilter' as const },
  ];
}

// `<CR>` picks in insert mode too, so Enter in the filter box picks.
function listEditorBinds(scope: ListScope) {
  return [
    { keys: '<CR>', scope, command: 'pickerPick' as const },
    {
      keys: '<CR>',
      mode: 'insert' as const,
      scope,
      command: 'pickerPick' as const,
    },
    { keys: '<Esc>', scope, command: 'pickerList' as const },
  ];
}

// Vim's editor binds are normal-mode maps: `<CR>` sends only in normal mode,
// so Enter in insert mode adds a line.
export const chatManifest = definePlugin({
  id: 'chat',
  dependsOn: ['sessions', 'keys'],
  commands: {
    newSession: { label: 'new session', group: 'sessions', runsIn: 'page' },
    focusBox: { label: 'type a message', group: 'box', runsIn: 'page' },
    appendBox: {
      label: 'type after the message',
      group: 'box',
      runsIn: 'page',
    },
    leaveBox: { label: 'leave the box', group: 'box', runsIn: 'page' },
    send: { label: 'send the message', group: 'box', runsIn: 'page' },
    interrupt: { label: 'interrupt the turn', group: 'chat', runsIn: 'page' },
    nextEntry: { label: 'next entry', group: 'entries', runsIn: 'page' },
    prevEntry: { label: 'previous entry', group: 'entries', runsIn: 'page' },
    toggleEntry: {
      label: 'expand or collapse the entry',
      group: 'entries',
      runsIn: 'page',
    },
    latestEntry: { label: 'latest entry', group: 'entries', runsIn: 'page' },
    firstEntry: { label: 'first entry', group: 'entries', runsIn: 'page' },
    allowPermission: {
      label: 'allow the tool once',
      group: 'permissions',
      runsIn: 'page',
    },
    denyPermission: {
      label: 'deny the tool, with a reason',
      group: 'permissions',
      runsIn: 'page',
    },
    submitReason: {
      label: 'send the denial',
      group: 'permissions',
      runsIn: 'page',
    },
    cancelReason: {
      label: 'back to the chat',
      group: 'permissions',
      runsIn: 'page',
    },
    pickMode: { label: 'permission mode', group: 'controls', runsIn: 'page' },
    pickEffort: { label: 'effort', group: 'controls', runsIn: 'page' },
    pickModel: { label: 'model', group: 'controls', runsIn: 'page' },
    pickControl: { label: 'every control', group: 'controls', runsIn: 'page' },
    endSession: {
      label: 'yes, end the session',
      group: 'confirm',
      runsIn: 'page',
    },
    keepSession: {
      label: 'keep the session',
      group: 'confirm',
      runsIn: 'page',
    },
    pickerDown: { label: 'next line', group: 'picker', runsIn: 'page' },
    pickerUp: { label: 'previous line', group: 'picker', runsIn: 'page' },
    pickerPick: { label: 'pick', group: 'picker', runsIn: 'page' },
    pickerClose: { label: 'close', group: 'picker', runsIn: 'page' },
    pickerFilter: { label: 'filter', group: 'picker', runsIn: 'page' },
    pickerList: { label: 'back to the list', group: 'picker', runsIn: 'page' },
    toggleArchive: {
      label: 'archive or restore the session',
      group: 'picker',
      runsIn: 'page',
    },
    showArchived: {
      label: 'show or hide archived sessions',
      group: 'picker',
      runsIn: 'page',
    },
    nextLayout: { label: 'next chat layout', group: 'debug', runsIn: 'page' },
    prevLayout: {
      label: 'previous chat layout',
      group: 'debug',
      runsIn: 'page',
    },
    copyLayout: {
      label: 'copy the chat layout to a new folder',
      group: 'debug',
      runsIn: 'page',
    },
  },
  scopes: {
    chat: 'In the chat',
    picker: 'In a picker',
    resume: 'In the session list',
    reason: 'In the deny reason box',
    confirm: 'In the end-session confirmation',
  },
  keys: {
    page: [
      { keys: ['i'], scope: 'chat', command: 'focusBox' },
      { keys: ['a'], scope: 'chat', command: 'appendBox' },
      { keys: ['j'], scope: 'chat', command: 'nextEntry' },
      { keys: ['k'], scope: 'chat', command: 'prevEntry' },
      { keys: ['Enter'], scope: 'chat', command: 'toggleEntry' },
      { keys: ['G'], scope: 'chat', command: 'latestEntry' },
      { keys: ['g', 'g'], scope: 'chat', command: 'firstEntry' },
      { keys: ['y'], scope: 'chat', command: 'allowPermission' },
      { keys: ['n'], scope: 'chat', command: 'denyPermission' },
      { keys: ['<C-c>'], scope: 'chat', command: 'interrupt' },
      { keys: ['<D-Enter>'], scope: 'chat', command: 'send' },
      { keys: ['m'], scope: 'chat', command: 'pickMode' },
      { keys: ['e'], scope: 'chat', command: 'pickEffort' },
      { keys: ['o'], scope: 'chat', command: 'pickModel' },
      { keys: ['c'], scope: 'chat', command: 'pickControl' },
      ...listPageBinds('picker'),
      ...listPageBinds('resume'),
      { keys: ['x'], scope: 'resume', command: 'toggleArchive' },
      { keys: ['.'], scope: 'resume', command: 'showArchived' },
      { keys: ['<D-Enter>'], scope: 'reason', command: 'submitReason' },
      { keys: ['Escape'], scope: 'reason', command: 'cancelReason' },
      { keys: ['y'], scope: 'confirm', command: 'endSession' },
      { keys: ['n'], scope: 'confirm', command: 'keepSession' },
      { keys: ['Escape'], scope: 'confirm', command: 'keepSession' },
      { keys: [' ', 'k', 'n'], scope: 'any', command: 'newSession' },
      { keys: [' ', 'z', 'c', 'n'], scope: 'any', command: 'nextLayout' },
      { keys: [' ', 'z', 'c', 'p'], scope: 'any', command: 'prevLayout' },
      { keys: [' ', 'z', 'c', 'c'], scope: 'any', command: 'copyLayout' },
    ],
    editor: [
      { keys: '<CR>', scope: 'chat', command: 'send' },
      { keys: '<Esc>', scope: 'chat', command: 'leaveBox' },
      { keys: '<Leader>cm', scope: 'chat', command: 'pickMode' },
      { keys: '<Leader>ce', scope: 'chat', command: 'pickEffort' },
      { keys: '<Leader>co', scope: 'chat', command: 'pickModel' },
      { keys: '<Leader>cc', scope: 'chat', command: 'pickControl' },
      ...listEditorBinds('picker'),
      ...listEditorBinds('resume'),
      { keys: '<CR>', scope: 'reason', command: 'submitReason' },
      { keys: '<Esc>', scope: 'reason', command: 'cancelReason' },
      { keys: '<Leader>kn', scope: 'any', command: 'newSession' },
    ],
    app: [],
    global: [],
    intercept: [],
  },
  settings: { profiles: DEFAULT_PROFILES },
  themeTokens: {},
});
