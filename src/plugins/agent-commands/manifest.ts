import { definePlugin } from '../../shared/define-plugin';

// Every agent's way into the app: three MCP tools that list the commands, run
// one and read any slot. Main only: it has no surface, commands or settings of
// its own, and reads every slot by id.
export const agentCommandsManifest = definePlugin({
  id: 'agent-commands',
  label: 'Agent commands',
  description:
    "Lets an agent list and run the app's commands and read its state, asking the user before a risky one.",
  dependsOn: { main: ['sessions', 'chat', 'forms'], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: {},
  settingInfo: {},
  themeTokens: {},
  readsEverySlot: true,
});
