import { definePlugin } from '../../shared/define-plugin';

// The Claude Code harness: the adapter that runs agent sessions on the `claude`
// CLI, registered in the core's harness registry. Main only: it has no surface,
// no commands and no layout, and reads only services. Its `command` setting names
// the `claude` program; empty, it is the platform's.
export const claudeCodeManifest = definePlugin({
  id: 'claude-code',
  label: 'Claude Code',
  description: 'Runs agent sessions on the Claude Code CLI.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: { command: '' },
  settingInfo: {
    command: {
      label: 'Claude command',
      description:
        'The claude program sessions run; ~ is the home folder. Empty, it is the platform default, ~/.local/bin/claude. Applies to the next session.',
    },
  },
  themeTokens: {},
});
