import { definePlugin } from '../../shared/define-plugin';

// Stashes a session: a note dialog over the focused pane's session, then the
// normal close, and the stashed sessions offered back in the start prompt
// through chat's resume sections, above Recently closed. `note` is the scope
// while the note dialog shows. It names `sessions` for the focused session,
// its close and its titles, and `chat` for the close and open events and the
// resume section.
export const sessionStashManifest = definePlugin({
  id: 'session-stash',
  label: 'Session stash',
  description:
    'Stashes a session with a note, and offers it again in the start prompt.',
  dependsOn: { main: ['chat', 'sessions'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {
    stash: { label: 'stash the session', group: 'sessions', runsIn: 'page' },
    noteAccept: {
      label: 'stash',
      group: 'stash',
      runsIn: 'page',
      risky: true,
    },
    noteCancel: { label: 'cancel', group: 'stash', runsIn: 'page' },
  },
  scopes: { note: 'In the stash dialog' },
  settings: { layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The session-stash layout the stash dialog draws in: a folder name in session-stash's layouts folder, or default.",
    },
  },
  themeTokens: {},
});
