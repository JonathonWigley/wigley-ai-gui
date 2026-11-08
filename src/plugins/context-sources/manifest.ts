import { definePlugin } from '../../shared/define-plugin';

// The session hub's Context section: main keeps each session's last `contextBreakdown` agent event from chat's
// `chat.agentEvent` in the `context-sources.breakdowns` slot, and the page draws it in chat's side part through the
// `layout` setting's context-sources layout. It names `sessions` for the rows it forgets, the names in its page log
// and its self-test's launch.
export const contextSourcesManifest = definePlugin({
  id: 'context-sources',
  dependsOn: {
    main: ['chat', 'sessions'],
    page: ['chat'],
  },
  reads: { main: [], page: ['sessions'] },
  commands: {},
  scopes: {},
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The context-sources layout the session hub's Context section draws in: a folder name in context-sources' layouts folder, or default.",
    },
  },
  themeTokens: {},
});
