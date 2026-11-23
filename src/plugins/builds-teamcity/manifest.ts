import { definePlugin } from '../../shared/define-plugin';

// The `teamcity` backend kind of Builds, over the `teamcity` CLI, registered through builds' `addBackend`.
export const buildsTeamcityManifest = definePlugin({
  id: 'builds-teamcity',
  label: 'TeamCity builds',
  description:
    'Adds the teamcity backend kind to Builds, over the teamcity CLI.',
  demoSkip: 'It adds a backend kind to Builds and draws nothing of its own.',
  dependsOn: { main: ['builds'], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
