import { definePlugin } from '../../shared/define-plugin';

// Records each session lifecycle change chat and sessions announce, and offers
// the closed sessions back in the start prompt through chat's resume sections.
// Main only: it has no surface and no layout.
export const sessionLogManifest = definePlugin({
  id: 'session-log',
  dependsOn: { main: ['chat', 'sessions'], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: { recentlyClosedCount: 10 },
  settingInfo: {
    recentlyClosedCount: {
      label: 'Recently closed sessions',
      description:
        'How many recently closed sessions the start prompt lists; 0 hides the section.',
    },
  },
  themeTokens: {},
});
