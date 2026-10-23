import { definePlugin } from '../../shared/define-plugin';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
type Digit = (typeof DIGITS)[number];
type ChoiceCommand = `choose${Digit}`;

const CHOICE_LABEL = 'pick a choice (again clears)';

const choiceCommands = Object.fromEntries(
  DIGITS.map((digit) => [
    `choose${digit}`,
    { label: CHOICE_LABEL, group: 'choices', runsIn: 'page' },
  ]),
) as Record<ChoiceCommand, { label: string; group: 'choices'; runsIn: 'page' }>;

// Forms' scopes are its view names, each titled for the key help.
export const formsManifest = definePlugin({
  id: 'forms',
  dependsOn: ['sessions', 'keys'],
  commands: {
    nextItem: { label: 'next item', group: 'items', runsIn: 'page' },
    prevItem: { label: 'previous item', group: 'items', runsIn: 'page' },
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
  settings: { autosaveDelayMs: 400, deadlineSeconds: 240 },
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
