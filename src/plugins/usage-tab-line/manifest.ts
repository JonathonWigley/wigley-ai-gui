import { definePlugin } from '../../shared/define-plugin';

// Each session's usage line in its tab bar: a page-only plugin that places
// usage's session line, drawn through usage's layout, as a sessions bar part.
// It owns no layout and no setting.
export const usageTabLineManifest = definePlugin({
  id: 'usage-tab-line',
  dependsOn: { main: [], page: ['usage', 'sessions'] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
