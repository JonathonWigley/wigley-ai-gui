import { definePlugin } from '../../shared/define-plugin';

// The subagents and tasks each session runs and the skills its agents started: main hears chat's agent events, folds
// each into its session's roster, logs it in plugin data and writes the row's roster to the `agents.rosters` slot, which
// the plugins that draw it read (agent-lines, agent-strip, agent-skills). It draws nothing itself.
export const agentsManifest = definePlugin({
  id: 'agents',
  dependsOn: { main: ['sessions'], page: [] },
  reads: { main: ['chat'], page: [] },
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
