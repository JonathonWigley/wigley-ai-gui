import { definePlugin } from '../../shared/define-plugin';

// The `local` backend kind of Builds: a command per build kind, started detached in the game's clone, registered
// through builds' `addBackend`.
export const buildsLocalManifest = definePlugin({
  id: 'builds-local',
  label: 'Local builds',
  description:
    'Adds the local backend kind to Builds: a command per build kind, run in a clone.',
  demoSkip: 'Its builds show in the Builds steps, which draw sample data.',
  dependsOn: { main: ['builds'], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
