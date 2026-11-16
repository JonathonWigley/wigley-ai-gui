import { definePlugin } from '../../shared/define-plugin';

// The session hub's Context section: main keeps each session's last `contextBreakdown` agent event from chat's
// `chat.agentEvent` in the `context-sources.breakdowns` slot, and the page draws it in chat's side part through the
// `layout` setting's context-sources layout. It names `sessions` for the rows it forgets, the names in its page log
// and its self-test's launch.
export const contextSourcesManifest = definePlugin({
  id: 'context-sources',
  label: 'Context sources',
  description:
    "Shows what fills each session's context, in the Context section of the session hub.",
  dependsOn: {
    main: ['chat', 'sessions'],
    page: ['chat'],
  },
  reads: { main: [], page: ['sessions'] },
  commands: {},
  scopes: {},
  settings: { layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The context-sources layout the session hub's Context section draws in: a folder name in context-sources' layouts folder, or default.",
    },
  },
  // The sources' colours by place in the list: Catppuccin Mocha's lavender, teal, pink, sky, maroon, overlay 2,
  // rosewater, surface 2, flamingo and subtext 0, leaving out the accent's, the links' and every status's hue.
  themeTokens: {
    'series-1': { kind: 'color', default: '#b4befe' },
    'series-2': { kind: 'color', default: '#94e2d5' },
    'series-3': { kind: 'color', default: '#f5c2e7' },
    'series-4': { kind: 'color', default: '#89dceb' },
    'series-5': { kind: 'color', default: '#eba0ac' },
    'series-6': { kind: 'color', default: '#9399b2' },
    'series-7': { kind: 'color', default: '#f5e0dc' },
    'series-8': { kind: 'color', default: '#585b70' },
    'series-9': { kind: 'color', default: '#f2cdcd' },
    'series-10': { kind: 'color', default: '#a6adc8' },
  },
});
