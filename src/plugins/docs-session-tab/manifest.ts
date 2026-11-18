import { definePlugin } from '../../shared/define-plugin';

// A Docs tab in each session over that session's docs index: a page-only
// plugin that adds a docs view through docs' `addView` as a sessions tab. It
// owns no command, layout or setting.
export const docsSessionTabManifest = definePlugin({
  id: 'docs-session-tab',
  label: 'Docs session tab',
  description:
    'Adds a Docs tab in each session, over the docs that session reads.',
  demoSkip:
    "Its Docs tab shows in docs' docs.sessionTab step, which needs a demo session from docs' main half.",
  dependsOn: { main: [], page: ['docs', 'sessions'] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
});
