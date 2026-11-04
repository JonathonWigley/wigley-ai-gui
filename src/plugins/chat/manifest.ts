import { definePlugin } from '../../shared/define-plugin';
import type { ChatProfile } from './contract';

// Each profile names a Claude config folder; a leading `~/` means the home
// folder.
export const DEFAULT_PROFILES: ChatProfile[] = [
  { name: 'work', configDir: '~/.claude' },
  { name: 'personal', configDir: '~/.claude-personal' },
];

export const chatManifest = definePlugin({
  id: 'chat',
  dependsOn: ['sessions', 'keys'],
  commands: {
    newSession: { label: 'new session', group: 'sessions', runsIn: 'page' },
    stopAll: {
      label: "stop every session's process",
      group: 'sessions',
      runsIn: 'page',
    },
    focusBox: { label: 'type a message', group: 'box', runsIn: 'page' },
    appendBox: {
      label: 'type after the message',
      group: 'box',
      runsIn: 'page',
    },
    leaveBox: { label: 'leave the box', group: 'box', runsIn: 'page' },
    send: { label: 'send the message', group: 'box', runsIn: 'page' },
    sendNow: {
      label:
        'send now: the focused pending row, or the box with every pending message',
      group: 'box',
      runsIn: 'page',
    },
    removeImage: {
      label: 'remove the last attached image',
      group: 'box',
      runsIn: 'page',
    },
    pullBackQueued: {
      label: 'pull back the newest unsent pending message',
      group: 'box',
      runsIn: 'page',
    },
    nextImage: { label: 'next image', group: 'image', runsIn: 'page' },
    prevImage: { label: 'previous image', group: 'image', runsIn: 'page' },
    closeImage: { label: 'close the image', group: 'image', runsIn: 'page' },
    interrupt: { label: 'interrupt the turn', group: 'chat', runsIn: 'page' },
    nextEntry: { label: 'next block', group: 'entries', runsIn: 'page' },
    prevEntry: { label: 'previous block', group: 'entries', runsIn: 'page' },
    nextMessage: { label: 'next message', group: 'entries', runsIn: 'page' },
    prevMessage: {
      label: 'previous message',
      group: 'entries',
      runsIn: 'page',
    },
    toggleRange: {
      label: 'start or end a range',
      group: 'entries',
      runsIn: 'page',
    },
    cancelRange: {
      label: 'cancel the range',
      group: 'entries',
      runsIn: 'page',
    },
    toggleEntry: {
      label: 'expand or collapse the entry',
      group: 'entries',
      runsIn: 'page',
    },
    latestEntry: { label: 'latest entry', group: 'entries', runsIn: 'page' },
    firstEntry: { label: 'first entry', group: 'entries', runsIn: 'page' },
    lineDown: {
      label: 'scroll a line down',
      group: 'entries',
      runsIn: 'page',
    },
    lineUp: {
      label: 'scroll a line up',
      group: 'entries',
      runsIn: 'page',
    },
    halfPageDown: {
      label: 'scroll half a page down',
      group: 'entries',
      runsIn: 'page',
    },
    halfPageUp: {
      label: 'scroll half a page up',
      group: 'entries',
      runsIn: 'page',
    },
    allowOrCopy: {
      label: 'allow the tool once, or copy',
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
    submitCode: {
      label: 'send the sign-in code',
      group: 'signIn',
      runsIn: 'page',
    },
    cancelSignIn: {
      label: 'cancel the sign-in',
      group: 'signIn',
      runsIn: 'page',
    },
    copySignInLink: {
      label: 'copy the sign-in link',
      group: 'signIn',
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
    toggleSideParts: {
      label: 'hide or show the session hub',
      group: 'view',
      runsIn: 'page',
    },
    openPreview: {
      label: 'open the chat layout preview',
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
    signIn: 'In the sign-in dialog',
    image: 'In the image viewer',
  },
  settings: {
    profiles: DEFAULT_PROFILES,
    layout: 'default',
    keepIdleMinutes: 60,
  },
  settingInfo: {
    profiles: {
      label: 'Profiles',
      description:
        'The Claude profiles a new session can start in: a name and its config folder each.',
    },
    layout: {
      label: 'Layout',
      description:
        "The chat layout every Chat tab draws in: a folder name in chat's layouts folder, or default.",
    },
    keepIdleMinutes: {
      label: 'Keep idle sessions (minutes)',
      description:
        "How long a session whose turn has ended keeps its Claude process while the app is closed. Past it the process ends, and the next message resumes the session. The default, 60, is the prompt cache's life.",
    },
  },
  themeTokens: {},
});
