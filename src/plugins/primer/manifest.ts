import { definePlugin } from '../../shared/define-plugin';

// The primer's scopes are its view's places, each titled for the key help.
export const primerManifest = definePlugin({
  id: 'primer',
  label: 'Primer',
  description:
    'Shows each feature primer an agent opens in a Primer tab, to answer it.',
  dependsOn: { main: ['sessions', 'chat'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {
    nextRow: { label: 'next row', group: 'rows', runsIn: 'page' },
    prevRow: { label: 'previous row', group: 'rows', runsIn: 'page' },
    firstRow: { label: 'first row', group: 'rows', runsIn: 'page' },
    lastRow: { label: 'last row', group: 'rows', runsIn: 'page' },
    // A column's click names its row, as the row keys move to one.
    selectTask: {
      label: 'select the task row',
      group: 'rows',
      runsIn: 'page',
      arg: 'number',
    },
    selectItem: {
      label: 'select the item row',
      group: 'rows',
      runsIn: 'page',
      arg: 'number',
    },
    needYes: { label: 'needed', group: 'need', runsIn: 'page' },
    needNo: { label: 'not needed', group: 'need', runsIn: 'page' },
    needUnclear: { label: 'unclear', group: 'need', runsIn: 'page' },
    addExtraTask: {
      label: 'add an extra task',
      group: 'tasks',
      runsIn: 'page',
    },
    removeExtraTask: {
      label: 'remove the extra task',
      group: 'tasks',
      runsIn: 'page',
    },
    toggleInclude: {
      label: 'include the item',
      group: 'items',
      runsIn: 'page',
    },
    toggleIncludeAt: {
      label: 'include the item row',
      group: 'items',
      runsIn: 'page',
      arg: 'number',
    },
    addItem: { label: 'add an item', group: 'items', runsIn: 'page' },
    editItemComment: {
      label: 'item comment box',
      group: 'boxes',
      runsIn: 'page',
    },
    editTaskComment: {
      label: 'task comment box',
      group: 'boxes',
      runsIn: 'page',
    },
    editFirstField: { label: 'first box', group: 'boxes', runsIn: 'page' },
    nextBox: { label: 'next box', group: 'boxes', runsIn: 'page' },
    prevBox: { label: 'previous box', group: 'boxes', runsIn: 'page' },
    leaveBox: { label: 'leave the box', group: 'boxes', runsIn: 'page' },
    lineDown: { label: 'scroll a line down', group: 'view', runsIn: 'page' },
    lineUp: { label: 'scroll a line up', group: 'view', runsIn: 'page' },
    halfPageDown: {
      label: 'scroll half a page down',
      group: 'view',
      runsIn: 'page',
    },
    halfPageUp: {
      label: 'scroll half a page up',
      group: 'view',
      runsIn: 'page',
    },
    openReview: { label: 'review', group: 'review', runsIn: 'page' },
    closeReview: {
      label: 'back to the primer',
      group: 'review',
      runsIn: 'page',
    },
    reviewNext: { label: 'next task', group: 'review', runsIn: 'page' },
    reviewPrev: { label: 'previous task', group: 'review', runsIn: 'page' },
    reviewTop: { label: 'first task', group: 'review', runsIn: 'page' },
    reviewBottom: { label: 'last task', group: 'review', runsIn: 'page' },
    reviewJump: { label: 'jump to the task', group: 'review', runsIn: 'page' },
    submit: {
      label: 'send the primer',
      group: 'review',
      runsIn: 'page',
      risky: true,
    },
    askCancel: {
      label: 'cancel the primer',
      group: 'review',
      runsIn: 'page',
    },
    confirmCancel: {
      label: 'yes, cancel the primer',
      group: 'confirm',
      runsIn: 'page',
      risky: true,
    },
    dismissConfirm: {
      label: 'keep the primer',
      group: 'confirm',
      runsIn: 'page',
    },
    openPreview: {
      label: 'open the primer layout preview',
      group: 'debug',
      runsIn: 'page',
    },
  },
  scopes: {
    tasks: 'In the primer tasks',
    items: 'In the primer items',
    card: 'In the primer card',
    review: 'In the primer review',
    confirm: 'In the primer cancel confirmation',
    idle: 'With no primer open',
  },
  settings: { autosaveDelayMs: 400, deadlineSeconds: 240, layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    autosaveDelayMs: {
      label: 'Autosave delay',
      description:
        "How long after a change a primer's draft is saved, in milliseconds.",
    },
    deadlineSeconds: {
      label: 'Primer deadline',
      description:
        'How long an agent waits on a primer before it gets a draft back, in seconds, when its session names no deadline.',
    },
    layout: {
      label: 'Layout',
      description:
        "The primer layout that draws the primer popup: a folder name in the primer's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
