import { definePlugin } from '../../shared/define-plugin';

// Records each session lifecycle change chat and sessions announce, and offers
// the closed sessions back in the start prompt through chat's resume sections.
// It has no surface and no layout; its page part only registers the demo step.
export const sessionLogManifest = definePlugin({
  id: 'session-log',
  label: 'Session log',
  description:
    "Records each session's start and end, and offers closed sessions again in the start prompt.",
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
