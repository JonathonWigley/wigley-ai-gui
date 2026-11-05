import { definePlugin } from '../../shared/define-plugin';

// The sidebar's working line: the page draws one line under each session row while the session runs any subagent or
// task, through sessions' row parts, through the `layout` setting's agent-lines layout, reading each session's roster
// from agents' `agents.rosters` slot. It names `keys` for its layout's key hints and `chat` for its self-test's launch.
export const agentLinesManifest = definePlugin({
  id: 'agent-lines',
  dependsOn: {
    main: ['chat', 'sessions'],
    page: ['agents', 'sessions'],
  },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The agent-lines layout the working line under each session row draws in: a folder name in agent-lines' layouts folder, or default.",
    },
  },
  themeTokens: {},
});
