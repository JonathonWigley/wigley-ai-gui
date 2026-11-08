import { definePlugin } from '../../shared/define-plugin';

// The sidebar's working line: the page draws one line under each session row while the session runs any subagent or
// task, through sessions' row parts, through the `layout` setting's agent-lines layout, reading each session's roster
// from agents' `agents.rosters` slot. Its main names `chat` and `sessions` for its self-test's launch.
export const agentLinesManifest = definePlugin({
  id: 'agent-lines',
  label: 'Agent lines',
  description:
    'Shows a working line under each session row while its agents run subagents or tasks.',
  dependsOn: {
    main: ['chat', 'sessions'],
    page: ['sessions'],
  },
  reads: { main: [], page: ['agents'] },
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
