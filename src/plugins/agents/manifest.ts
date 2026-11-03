import { definePlugin } from '../../shared/define-plugin';

// The subagents and tasks each session runs: main hears chat's agent events, folds each into its session's roster and
// logs it in plugin data, and the page keeps every session's roster and exports it to the plugins that draw it
// (agent-lines, agent-strip). It draws nothing itself.
export const agentsManifest = definePlugin({
  id: 'agents',
  dependsOn: ['sessions', 'chat'],
  commands: {
    openPreview: {
      label: 'open the agents sample session',
      group: 'debug',
      runsIn: 'page',
    },
  },
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
