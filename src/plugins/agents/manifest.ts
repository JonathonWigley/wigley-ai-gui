import { definePlugin } from '../../shared/define-plugin';

// The subagents each session runs: main hears chat's agent events, folds each into its session's roster and logs it
// in plugin data, and the page draws one line per running subagent under each session row through sessions' row
// parts. It names `keys` for its layout's key hints.
export const agentsManifest = definePlugin({
  id: 'agents',
  dependsOn: ['sessions', 'chat', 'keys'],
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
