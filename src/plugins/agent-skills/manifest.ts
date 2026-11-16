import { definePlugin } from '../../shared/define-plugin';

// The session hub's Skills section: the page draws a chip per skill, grouped by namespace, in chat's side part,
// through the `layout` setting's agent-skills layout, reading each session's roster from agents' `agents.rosters` slot.
// It names `sessions` for the names in its page log and its self-test's launch.
export const agentSkillsManifest = definePlugin({
  id: 'agent-skills',
  label: 'Agent skills',
  description:
    "Lists the skills each session's agents started, in the Skills section of the session hub.",
  dependsOn: {
    main: ['chat', 'sessions'],
    page: ['chat'],
  },
  reads: { main: [], page: ['agents', 'sessions'] },
  commands: {},
  scopes: {},
  settings: { layout: 'default' },
  settingControls: { layout: 'layout' },
  settingInfo: {
    layout: {
      label: 'Layout',
      description:
        "The agent-skills layout the session hub's Skills section draws in: a folder name in agent-skills' layouts folder, or default.",
    },
  },
  themeTokens: {},
});
