import { definePlugin } from '../../shared/define-plugin';

export const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

// The number keys that pick a card's numbered choices and actions.
export const NUMBER_KEY_COUNT = DIGITS.length;

const CHOICE_LABEL = 'pick the numbered choice or action (again clears)';

// Forms' scopes are its view names, each titled for the key help.
export const formsManifest = definePlugin({
  id: 'forms',
  dependsOn: { main: ['sessions', 'chat'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {
    nextItem: { label: 'next item', group: 'items', runsIn: 'page' },
    prevItem: { label: 'previous item', group: 'items', runsIn: 'page' },
    nextLine: {
      label: 'next notice line or item',
      group: 'items',
      runsIn: 'page',
    },
    prevLine: {
      label: 'previous notice line or item',
      group: 'items',
      runsIn: 'page',
    },
    toggleNotice: {
      label: 'open or close the notice line',
      group: 'items',
      runsIn: 'page',
    },
    nextUnanswered: {
      label: 'next unanswered item',
      group: 'items',
      runsIn: 'page',
    },
    prevUnanswered: {
      label: 'previous unanswered item',
      group: 'items',
      runsIn: 'page',
    },
    choose: {
      label: CHOICE_LABEL,
      group: 'choices',
      runsIn: 'page',
      arg: 'number',
    },
    clearChoice: {
      label: 'clear the choice',
      group: 'choices',
      runsIn: 'page',
    },
    acceptRecommendation: {
      label: 'accept the recommendation, or open or close the notice line',
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
    // A card's click names its item by rail position, so a click never acts on
    // the item the focused box sits on; each `At` command is its key's twin.
    chooseAt: {
      label: 'pick the numbered choice on the item',
      group: 'choices',
      runsIn: 'page',
      arg: { item: 'number', number: 'number' },
    },
    clearChoiceAt: {
      label: 'clear the choice on the item',
      group: 'choices',
      runsIn: 'page',
      arg: 'number',
    },
    acceptRecommendationAt: {
      label: 'accept the recommendation on the item',
      group: 'choices',
      runsIn: 'page',
      arg: 'number',
    },
    toggleNotApplicableAt: {
      label: 'not applicable on the item',
      group: 'answer',
      runsIn: 'page',
      arg: 'number',
    },
    toggleDontAskAt: {
      label: "don't ask me this on the item",
      group: 'answer',
      runsIn: 'page',
      arg: 'number',
    },
    toggleNoticeAt: {
      label: 'open or close the numbered notice line',
      group: 'items',
      runsIn: 'page',
      arg: 'number',
    },
    focusItem: {
      label: 'focus the item',
      group: 'items',
      runsIn: 'page',
      arg: 'number',
    },
    pickRailItem: {
      label: 'pick the rail item',
      group: 'items',
      runsIn: 'page',
      arg: 'number',
    },
    reviewJumpAt: {
      label: 'jump to the review row',
      group: 'review',
      runsIn: 'page',
      arg: 'number',
    },
    editNotes: { label: 'notes box', group: 'boxes', runsIn: 'page' },
    editNote: { label: 'round note', group: 'boxes', runsIn: 'page' },
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
    submit: { label: 'send answers', group: 'review', runsIn: 'page' },
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
  settings: { autosaveDelayMs: 400, deadlineSeconds: 240, layout: 'default' },
  settingInfo: {
    autosaveDelayMs: {
      label: 'Autosave delay',
      description:
        "How long after a change a round's draft is saved, in milliseconds.",
    },
    deadlineSeconds: {
      label: 'Round deadline',
      description:
        'How long an agent waits on a round before it gets a draft back, in seconds, when its session names no deadline.',
    },
    layout: {
      label: 'Layout',
      description:
        "The forms layout that draws what a round and its items do not name a layout for: a folder name in forms' layouts folder, or default.",
    },
  },
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
