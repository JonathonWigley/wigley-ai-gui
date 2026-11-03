import { definePlugin } from '../../shared/define-plugin';

// The sidebar's subagent and task lines: the page draws one line per running subagent and task under each session
// row through sessions' row parts, through the `layout` setting's agent-lines layout, reading each session's roster
// from agents' page exports. It names `keys` for its layout's key hints and `chat` for its self-test's launch.
export const agentLinesManifest = definePlugin({
  id: 'agent-lines',
  dependsOn: ['agents', 'sessions', 'chat', 'keys'],
  commands: {},
  scopes: {},
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The agent-lines layout the subagent and task lines under each session row draw in: a folder name in agent-lines' layouts folder, or default.",
    },
  },
  themeTokens: {},
});
