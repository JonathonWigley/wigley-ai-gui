import { definePlugin } from '../../shared/define-plugin';

// Auto retro: each session the user closes, after it sent a message, queues a background `/wigley:retro auto` run,
// launched one at a time as an unattended chat row in the retro folder, shown in the side bar's Retro section and
// closed once its work ends. It names `chat` for the close and clear events, the launch, the profiles, the session
// state and the close, and `sessions` for the rows, their titles and the Retro section.
export const autoRetroManifest = definePlugin({
  id: 'auto-retro',
  dependsOn: { main: ['chat', 'sessions'], page: ['sessions'] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: { folder: '~/wigley-agents', layout: 'default', settleSeconds: 5 },
  settingInfo: {
    folder: {
      label: 'Retro folder',
      description:
        'The folder each background retro runs in: the clone that holds the retro ledger. ~ is the home folder.',
    },
    layout: {
      label: 'Layout',
      description:
        "The auto-retro layout the Retro section's queued count draws in: a folder name in auto-retro's layouts folder, or default.",
    },
    settleSeconds: {
      label: 'Settle seconds',
      description:
        'How long a retro row rests idle before it closes. 0 closes it at once.',
    },
  },
  themeTokens: {},
});
