import { definePlugin } from '../../shared/define-plugin';

// The project chatroom: main keeps one room per project, contributes the five
// `chatroom_*` tools to every session, answers the edit and commit hooks, wakes
// an idle app-run agent a message is for, and writes each room's view and
// board to the `chatroom.rooms` slot. It names `sessions` for the tools, hooks,
// rows and names, `chat` for the agents' streams and wakes, and `workflow` for
// the board's finished stages, and reads `unity-pool` for the board's clones.
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
  commands: {},
  scopes: {},
  settings: {
    bodyCap: 1500,
    postsPerMinute: 10,
    claimMinutes: 30,
    layout: 'default',
  },
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
