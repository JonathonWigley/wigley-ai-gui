import { definePlugin } from '../../shared/define-plugin';

// The subagents each session runs: main hears chat's agent events, folds each into its session's roster and logs it
// in plugin data, and the page draws one line per running subagent under each session row through sessions' row
// parts, through the `layout` setting's agents layout. It names `keys` for its layout's key hints.
export const agentsManifest = definePlugin({
  id: 'agents',
  dependsOn: ['sessions', 'chat', 'keys'],
  commands: {
    openPreview: {
      label: 'open the agents layout preview',
      group: 'debug',
      runsIn: 'page',
    },
  },
  scopes: {},
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The agents layout the subagent lines under each session row draw in: a folder name in agents' layouts folder, or default.",
    },
  },
  themeTokens: {},
});
