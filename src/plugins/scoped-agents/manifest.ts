import { definePlugin } from '../../shared/define-plugin';

// Scoped agents: the chat sessions a plugin owns per scope, launched on the
// first ask and resumed on reopen. Its main names `chat` for the sessions and
// `sessions` for the session `scopeOf` matches; its page names `chat` for the
// session's chat view. `askSend` and `leaveBox` act on the ask box that holds
// the keys, in scope `ask`. `layout` names the layout the ask box draws with.
export const scopedAgentsManifest = definePlugin({
  id: 'scoped-agents',
  label: 'Scoped agents',
  description:
    "Runs the agent chats a plugin owns per scope, such as Practice's interviewer and Backlog's assistant, and the ask box and chat pane they show in.",
  dependsOn: { main: ['sessions', 'chat'], page: ['chat'] },
  reads: { main: [], page: [] },
  commands: {
    askSend: { label: 'send the ask', group: 'ask', runsIn: 'page' },
    leaveBox: { label: 'leave the box', group: 'ask', runsIn: 'page' },
  },
  scopes: { ask: 'In a scoped agent ask box' },
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The ask box layout: a folder name in scoped-agents' layouts folder, or default.",
    },
  },
  themeTokens: {},
});
