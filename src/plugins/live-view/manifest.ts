import { definePlugin } from '../../shared/define-plugin';

// The session hub's Live section: main answers the agent's `show_live_view` and `hide_live_view` tools by writing each
// session's pick to the `live-view.picks` slot, and the page streams the picked window in chat's side part through the
// `layout` setting's live-view layout. It names `sessions` for the tools it contributes and the picks it forgets, and
// reads it on the page for the names in its page log.
export const liveViewManifest = definePlugin({
  id: 'live-view',
  label: 'Live view',
  description:
    "Streams a Unity editor's Game View into the session hub while an agent plays it.",
  dependsOn: {
    main: ['chat', 'sessions'],
    page: ['chat'],
  },
  reads: { main: [], page: ['sessions'] },
  commands: {
    openScreenSettings: {
      label: 'open the Screen Recording settings',
      group: 'hub',
      runsIn: 'main',
    },
  },
  scopes: {},
  settings: { frameRate: 30, layout: 'default' },
  settingInfo: {
    frameRate: {
      label: 'Frame rate',
      description:
        "The most frames a second the Live section's stream asks for.",
    },
    layout: {
      label: 'Layout',
      description:
        "The live-view layout the session hub's Live section draws in: a folder name in live-view's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
