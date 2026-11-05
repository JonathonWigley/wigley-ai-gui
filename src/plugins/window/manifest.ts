import { definePlugin } from '../../shared/define-plugin';

// The command that brings the app forward from any other app. Main only: it has
// no surface and no layout.
export const windowManifest = definePlugin({
  id: 'window',
  dependsOn: { main: [], page: [] },
  commands: {
    summon: { label: 'show the app', group: 'window', runsIn: 'main' },
  },
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
