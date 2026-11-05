import { definePlugin } from '../../shared/define-plugin';

// Holds a send to an idle session whose prompt cache is cold and whose context
// is above `minTokens`, and compacts first, through chat's send gate. Main only:
// it has no surface and no layout.
export const autoCompactManifest = definePlugin({
  id: 'auto-compact',
  dependsOn: { main: ['chat'], page: [] },
  commands: {},
  scopes: {},
  settings: { minTokens: 150000 },
  settingInfo: {
    minTokens: {
      label: 'Auto-compact threshold',
      description:
        'Compact a session before a message when its prompt cache is cold and its context is above this many tokens; 0 turns it off.',
    },
  },
  themeTokens: {},
});
