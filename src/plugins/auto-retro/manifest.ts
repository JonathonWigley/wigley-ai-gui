import { definePlugin } from '../../shared/define-plugin';
import { strategyControlKind } from '../contributions/contract';

// Auto retro: each conversation the user ends, by closing its session or a /clear, after it sent a message, queues
// the picked retro strategy's command, launched one at a time as an unattended chat row in that strategy's folder,
// shown in the side bar's Retro section and closed once its work ends or it ends before its first turn. It names `chat`
// for the close, clear and process-end events, the launch, the session state and entries, a restored row's history
// read and the close, `sessions` for the rows, their titles and the Retro section, and `contributions` for the retro
// strategies; it reads the profiles from `core.agentHarnesses`.
export const autoRetroManifest = definePlugin({
  id: 'auto-retro',
  label: 'Auto retro',
  description:
    'Runs a background retro for each conversation the user ends, by a close or a /clear, shown in the side bar until it finishes.',
  dependsOn: {
    main: ['chat', 'sessions', 'contributions'],
    page: ['sessions'],
  },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: { strategy: '', layout: 'default', settleSeconds: 5 },
  settingControls: {
    layout: 'layout',
    strategy: strategyControlKind('retro'),
  },
  settingInfo: {
    strategy: {
      label: 'Retro plugin',
      description:
        'The plugin whose retro runs for each ended conversation. Automatic picks the only one installed.',
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
