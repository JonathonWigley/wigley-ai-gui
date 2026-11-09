import { definePlugin } from '../../shared/define-plugin';

// Holds a send to an idle session whose prompt cache is cold and whose context
// is above `minTokens`, and compacts first, through chat's send gate; and
// compacts a workflow session whose main turn ended while its subagents run,
// when its context is above `agentWaitMinTokens`, through chat's `compact`. Main
// only: it has no surface and no layout.
export const autoCompactManifest = definePlugin({
  id: 'auto-compact',
  label: 'Auto compact',
  description:
    'Compacts an idle session whose prompt cache is cold before the next message, when its context is large.',
  dependsOn: { main: ['chat'], page: [] },
  reads: { main: ['workflow'], page: [] },
  commands: {},
  scopes: {},
  settings: { minTokens: 150000, agentWaitMinTokens: 200000 },
  settingInfo: {
    minTokens: {
      label: 'Auto-compact threshold',
      description:
        'Compact a session before a message when its prompt cache is cold and its context is above this many tokens; 0 turns it off.',
    },
    agentWaitMinTokens: {
      label: 'Agent-wait compact threshold',
      description:
        'Compact a workflow session when its main turn ends while subagents still run and its context is above this many tokens; 0 turns it off.',
    },
  },
  themeTokens: {},
});
