import { definePlugin } from '../../shared/define-plugin';
import { LIST_PICKER_COMMANDS } from '../../shared/list-picker-commands';
import type { ProjectSetting } from './contract';

export const chatManifest = definePlugin({
  id: 'chat',
  label: 'Chat',
  description:
    'Runs agent sessions in the Chat tab, with the transcript, the composer and the start prompt.',
  dependsOn: { main: ['sessions'], page: ['sessions', 'markdown-blocks'] },
  reads: { main: [], page: [] },
  commands: {
    newSession: { label: 'new session', group: 'sessions', runsIn: 'page' },
    startNewSession: {
      label: 'new session, no saved sessions listed',
      group: 'sessions',
      runsIn: 'page',
    },
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
    showAttachments: {
      label: 'show the attached images',
      group: 'box',
      runsIn: 'page',
    },
    removeImageAt: {
      label: 'remove this attached image',
      group: 'box',
      runsIn: 'page',
      arg: { sessionId: 'string', index: 'number' },
    },
    pullBackMessage: {
      label: 'pull back this pending message',
      group: 'box',
      runsIn: 'page',
      arg: { sessionId: 'string', queuedId: 'string' },
    },
    openImage: {
      label: 'open this image',
      group: 'image',
      runsIn: 'page',
      arg: { sessionId: 'string', entryId: 'string', index: 'number' },
    },
    nextImage: { label: 'next image', group: 'image', runsIn: 'page' },
    prevImage: { label: 'previous image', group: 'image', runsIn: 'page' },
    closeImage: { label: 'close the image', group: 'image', runsIn: 'page' },
    removeShownImage: {
      label: 'remove the shown image',
      group: 'image',
      runsIn: 'page',
    },
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
      label: "expand or collapse the block's expander, else the entry",
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
    toggleRun: {
      label: 'expand or collapse this activity line',
      group: 'entries',
      runsIn: 'page',
      arg: { sessionId: 'string', runId: 'string' },
    },
    toggleExpander: {
      label: 'expand or collapse this part of the entry',
      group: 'entries',
      runsIn: 'page',
      arg: { sessionId: 'string', entryId: 'string', place: 'number' },
    },
    moveFocus: {
      label: 'move the cursor to this stop',
      group: 'entries',
      runsIn: 'page',
      arg: { sessionId: 'string', stopId: 'string' },
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
    allowEntry: {
      label: 'allow this tool once',
      group: 'permissions',
      runsIn: 'page',
      arg: { sessionId: 'string', entryId: 'string' },
    },
    denyEntry: {
      label: 'deny this tool, with a reason',
      group: 'permissions',
      runsIn: 'page',
      arg: { sessionId: 'string', entryId: 'string' },
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
    ...LIST_PICKER_COMMANDS,
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
    nextSection: { label: 'next section', group: 'hub', runsIn: 'page' },
    prevSection: { label: 'previous section', group: 'hub', runsIn: 'page' },
    firstSection: { label: 'first section', group: 'hub', runsIn: 'page' },
    lastSection: { label: 'last section', group: 'hub', runsIn: 'page' },
    toggleCursorSection: {
      label: 'fold or unfold the section',
      group: 'hub',
      runsIn: 'page',
    },
    leaveHub: { label: 'back to the transcript', group: 'hub', runsIn: 'page' },
    hubLineDown: {
      label: 'scroll the section a line down',
      group: 'hub',
      runsIn: 'page',
    },
    hubLineUp: {
      label: 'scroll the section a line up',
      group: 'hub',
      runsIn: 'page',
    },
    hubHalfPageDown: {
      label: 'scroll the section half a page down',
      group: 'hub',
      runsIn: 'page',
    },
    hubHalfPageUp: {
      label: 'scroll the section half a page up',
      group: 'hub',
      runsIn: 'page',
    },
    toggleSection: {
      label: 'collapse or expand this session hub section',
      group: 'view',
      runsIn: 'page',
      arg: 'string',
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
    hub: 'In the session hub',
  },
  settings: {
    projects: [] as ProjectSetting[],
    layout: 'default',
    keepIdleMinutes: 60,
    completionDescriptions: true,
    defaultHarness: 'claude',
  },
  settingControls: { layout: 'layout' },
  settingInfo: {
    projects: {
      label: 'Projects',
      description:
        'The projects a new session starts from, in the order the start prompt lists them: a name, and a folder or a unity-pool pool, each; and an optional profile every session of the project runs under.',
    },
    layout: {
      label: 'Layout',
      description:
        "The chat layout every Chat tab draws in: a folder name in chat's layouts folder, or default.",
    },
    keepIdleMinutes: {
      label: 'Keep idle sessions (minutes)',
      description:
        "How long a session whose turn has ended keeps its agent process while the app is closed. Past it the process ends, and the next message resumes the session. The default, 60, is the prompt cache's life.",
    },
    completionDescriptions: {
      label: 'Completion descriptions',
      description:
        "Show each command's description beside its name in the / completion list.",
    },
    defaultHarness: {
      label: 'Default harness',
      description:
        "The id of the agent harness a new session runs on: claude for Claude Code. A project that names a profile runs on that profile's harness, and a resumed session on the harness it was saved with.",
    },
  },
  themeTokens: {
    'side-section-floor': { kind: 'length', default: '64px' },
  },
});
