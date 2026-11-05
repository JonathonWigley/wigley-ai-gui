import { definePlugin } from '../../shared/define-plugin';

// Plan usage and session usage, always on screen: main polls each chat
// profile's plan windows through the Claude harness and folds in the live rows
// and usage events chat forwards; the page draws the status-bar plan line, each
// session's context line above its Chat box (a chat composer part), its spend in
// its Chat status line (a chat status part) and the right-bar details through
// the `layout` setting's usage layout, and exports the whole session line as a
// part for a tab bar (usage-tab-line).
// `pollIntervalSeconds` is how often each profile is polled, at least 60.
export const usageManifest = definePlugin({
  id: 'usage',
  dependsOn: { main: ['chat', 'sessions'], page: ['chat', 'sessions'] },
  reads: { main: [], page: [] },
  commands: {
    toggleDetails: {
      label: 'hide or show usage details',
      group: 'view',
      runsIn: 'page',
    },
  },
  scopes: {},
  settings: { pollIntervalSeconds: 300, layout: 'default' },
  settingInfo: {
    pollIntervalSeconds: {
      label: 'Plan usage poll',
      description:
        "How often each profile's plan usage is read, in seconds; at least 60. A change moves the next read.",
    },
    layout: {
      label: 'Usage layout',
      description:
        "The layout that draws the status-bar plan line, each session's usage line and the usage details: a folder in the layouts/usage folder, or default.",
    },
  },
  themeTokens: {},
});
