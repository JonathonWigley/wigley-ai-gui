import { definePlugin } from '../../shared/define-plugin';

// The audio picker's scopes are its popup's places, each titled for the key
// help; a notes box binds in `list` with `where: 'box'`.
export const audioPickerManifest = definePlugin({
  id: 'audio-picker',
  label: 'Audio picker',
  description:
    'Shows each audio picker an agent opens in a popup over its session, to play its candidate sounds and choose one per moment.',
  dependsOn: { main: ['sessions', 'chat'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {
    nextRow: { label: 'next row', group: 'rows', runsIn: 'page' },
    prevRow: { label: 'previous row', group: 'rows', runsIn: 'page' },
    firstRow: { label: 'first row', group: 'rows', runsIn: 'page' },
    lastRow: { label: 'last row', group: 'rows', runsIn: 'page' },
    // A click on a row names its 0-based moment and row.
    selectRow: {
      label: 'move the cursor to the row and choose it',
      group: 'rows',
      runsIn: 'page',
      arg: { moment: 'number', row: 'number' },
    },
    nextMoment: { label: 'next moment', group: 'moments', runsIn: 'page' },
    prevMoment: { label: 'previous moment', group: 'moments', runsIn: 'page' },
    chooseRow: { label: 'choose the row', group: 'choices', runsIn: 'page' },
    // The 1-based row of the cursor's moment; a number past its last row does
    // nothing.
    choose: {
      label: 'choose the numbered row of the moment',
      group: 'choices',
      runsIn: 'page',
      arg: 'number',
    },
    togglePlay: {
      label: 'play or stop the row',
      group: 'play',
      runsIn: 'page',
    },
    // A click on a row's play button names its 0-based moment and candidate.
    playRow: {
      label: "play or stop the row's sound",
      group: 'play',
      runsIn: 'page',
      arg: { moment: 'number', candidate: 'number' },
    },
    editNote: { label: 'moment notes box', group: 'boxes', runsIn: 'page' },
    nextBox: { label: 'next box', group: 'boxes', runsIn: 'page' },
    prevBox: { label: 'previous box', group: 'boxes', runsIn: 'page' },
    leaveBox: { label: 'leave the box', group: 'boxes', runsIn: 'page' },
    lineDown: { label: 'scroll a line down', group: 'view', runsIn: 'page' },
    lineUp: { label: 'scroll a line up', group: 'view', runsIn: 'page' },
    submit: { label: 'send the picks', group: 'send', runsIn: 'page' },
    askCancel: {
      label: 'cancel the audio picker',
      group: 'send',
      runsIn: 'page',
    },
    confirmCancel: {
      label: 'yes, cancel the audio picker',
      group: 'confirm',
      runsIn: 'page',
    },
    dismissConfirm: {
      label: 'keep the audio picker',
      group: 'confirm',
      runsIn: 'page',
    },
    openPreview: {
      label: 'open the audio picker layout preview',
      group: 'debug',
      runsIn: 'page',
    },
  },
  scopes: {
    list: 'In the audio picker',
    confirm: 'In the audio picker cancel confirmation',
    idle: 'With no audio picker open',
  },
  settings: { autosaveDelayMs: 400, deadlineSeconds: 240, layout: 'default' },
  settingInfo: {
    autosaveDelayMs: {
      label: 'Autosave delay',
      description:
        "How long after a change an audio picker's draft is saved, in milliseconds.",
    },
    deadlineSeconds: {
      label: 'Audio picker deadline',
      description:
        'How long an agent waits on an audio picker before it gets a draft back, in seconds, when its session names no deadline.',
    },
    layout: {
      label: 'Audio picker layout',
      description: 'Which layout draws the audio picker.',
    },
  },
  themeTokens: {},
});
