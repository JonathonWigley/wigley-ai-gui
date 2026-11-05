import { definePlugin } from '../../shared/define-plugin';

// The agent strip above every Chat tab's composer box: the page draws one box per subagent and task of the session's
// roster, read from agents' page exports, as a chat composer part whose stop takes the entry cursor, through the
// `layout` setting's agent-strip layout. It names `sessions` for each session's name in its log lines, `keys` for its
// layout's key hints, and `chat` for its composer part and its self-test's launch.
export const agentStripManifest = definePlugin({
  id: 'agent-strip',
  dependsOn: {
    main: ['chat', 'sessions'],
    page: ['agents', 'chat', 'sessions', 'keys'],
  },
  reads: { main: [], page: [] },
  commands: {
    prevBox: { label: 'previous box', group: 'agent strip', runsIn: 'page' },
    nextBox: { label: 'next box', group: 'agent strip', runsIn: 'page' },
    leave: {
      label: 'back to the entries',
      group: 'agent strip',
      runsIn: 'page',
    },
    focusBox: {
      label: 'type a message',
      group: 'agent strip',
      runsIn: 'page',
    },
    appendBox: {
      label: 'type after the message',
      group: 'agent strip',
      runsIn: 'page',
    },
    toggleBox: {
      label: 'open or close the box',
      group: 'agent strip',
      runsIn: 'page',
    },
  },
  scopes: { strip: 'In the agent strip' },
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The agent-strip layout the boxes above the Chat composer draw in: a folder name in agent-strip's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
