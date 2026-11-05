import { definePlugin } from '../../shared/define-plugin';

// The subagents and tasks each session runs and the skills its agents started: main hears chat's agent events, folds
// each into its session's roster and logs it in plugin data, and the page keeps every session's roster and exports it
// to the plugins that draw it (agent-lines, agent-strip, agent-skills). It draws nothing itself.
export const agentsManifest = definePlugin({
  id: 'agents',
  dependsOn: { main: ['sessions', 'chat'], page: [] },
  reads: { main: [], page: ['sessions'] },
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
