import { definePlugin } from '../../shared/define-plugin';

// The project chatroom: main keeps one room per project, contributes the five
// `chatroom_*` tools to every session, answers the edit and commit hooks, wakes
// an idle app-run agent a message is for, and writes each room's view and
// board to the `chatroom.rooms` slot. It names `sessions` for the tools, hooks,
// rows and names, `chat` for the agents' streams and wakes, and `workflow` for
// the board's finished stages, and reads `unity-pool` for the board's clones.
// Its page adds Chatroom mode, the unread badge under each session row and the
// row's `asks you` activity, naming `sessions` for the rows. `openThreadRow`
// is the click on a thread row (`<room>\n<thread>`) and `openRowRoom` the
// click on a row badge (the row id), so they have no key.
export const chatroomManifest = definePlugin({
  id: 'chatroom',
  label: 'Chatroom',
  description:
    "One room per project where agent sessions and the user talk, beside a board of every session's live state.",
  dependsOn: {
    main: ['sessions', 'chat', 'workflow'],
    page: ['sessions'],
  },
  reads: { main: ['unity-pool'], page: [] },
  commands: {
    showMode: {
      label: 'chatroom (again: toggle the side bar)',
      group: 'modes',
      runsIn: 'page',
    },
    preview: {
      label: 'open the chatroom layout preview',
      group: 'debug',
      runsIn: 'page',
    },
    listDown: { label: 'next thread', group: 'threads', runsIn: 'page' },
    listUp: { label: 'previous thread', group: 'threads', runsIn: 'page' },
    listTop: { label: 'first thread', group: 'threads', runsIn: 'page' },
    listBottom: { label: 'last thread', group: 'threads', runsIn: 'page' },
    openThread: { label: 'open the thread', group: 'threads', runsIn: 'page' },
    openThreadRow: {
      label: 'open this thread',
      group: 'threads',
      runsIn: 'page',
      arg: 'string',
    },
    openRowRoom: {
      label: "open this session's newest unread thread",
      group: 'threads',
      runsIn: 'page',
      arg: 'string',
    },
    logDown: { label: 'next message', group: 'log', runsIn: 'page' },
    logUp: { label: 'previous message', group: 'log', runsIn: 'page' },
    logTop: { label: 'first message', group: 'log', runsIn: 'page' },
    logBottom: { label: 'newest message', group: 'log', runsIn: 'page' },
    compose: { label: 'compose', group: 'log', runsIn: 'page' },
    reply: { label: 'reply', group: 'log', runsIn: 'page' },
    send: { label: 'send', group: 'composer', runsIn: 'page' },
    leaveComposer: {
      label: 'leave the composer',
      group: 'composer',
      runsIn: 'page',
    },
  },
  scopes: {
    threads: 'In the chatroom thread list',
    log: 'In the chatroom thread log',
    composer: 'In the chatroom composer',
  },
  settings: {
    bodyCap: 1500,
    postsPerMinute: 10,
    claimMinutes: 30,
    layout: 'default',
  },
  settingControls: { layout: 'layout' },
  settingInfo: {
    bodyCap: {
      label: 'Message length cap',
      description:
        'The most characters a chatroom post may hold; a longer post is refused and the agent puts the content in a file.',
    },
    postsPerMinute: {
      label: 'Posts per minute',
      description:
        'The most posts one sender may make in a minute; more are refused.',
    },
    claimMinutes: {
      label: 'Claim length',
      description:
        'How many minutes a claim holds when the agent names no length.',
    },
    layout: {
      label: 'Layout',
      description:
        "The chatroom layout Chatroom mode draws in: a folder name in chatroom's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
