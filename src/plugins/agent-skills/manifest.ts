import { definePlugin } from '../../shared/define-plugin';

// The session hub's Skills section: the page draws one row per skill in chat's side part, through the
// `layout` setting's agent-skills layout, reading each session's roster from agents' `agents.rosters` slot. It names `keys` for
// its layout's key hints, and `sessions` for the names in its page log and its self-test's launch.
export const agentSkillsManifest = definePlugin({
  id: 'agent-skills',
  dependsOn: {
    main: ['chat', 'sessions'],
    page: ['agents', 'chat'],
  },
  reads: { main: [], page: ['sessions'] },
  commands: {},
  scopes: {},
  settings: { layout: 'default' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The agent-skills layout the session hub's Skills section draws in: a folder name in agent-skills' layouts folder, or default.",
    },
  },
  themeTokens: {},
});
