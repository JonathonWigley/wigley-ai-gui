import { definePlugin } from '../../shared/define-plugin';

export const primerManifest = definePlugin({
  id: 'primer',
  dependsOn: ['sessions', 'keys'],
  commands: {},
  scopes: {},
  settings: { autosaveDelayMs: 400, deadlineSeconds: 240 },
  settingInfo: {
    autosaveDelayMs: {
      label: 'Autosave delay',
      description:
        "How long after a change a primer's draft is saved, in milliseconds.",
    },
    deadlineSeconds: {
      label: 'Primer deadline',
      description:
        'How long an agent waits on a primer before it gets a draft back, in seconds, when its session names no deadline.',
    },
  },
  themeTokens: {},
});
