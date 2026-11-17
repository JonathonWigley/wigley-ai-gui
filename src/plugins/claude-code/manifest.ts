import type { HarnessProfile } from '../../contracts/agent';
import { definePlugin } from '../../shared/define-plugin';

// Each profile names a Claude config folder; a leading `~/` means the home
// folder.
export const DEFAULT_PROFILES: HarnessProfile[] = [
  { name: 'work', configDir: '~/.claude' },
  { name: 'personal', configDir: '~/.claude-personal' },
];

// The Claude Code harness: the adapter that runs agent sessions on the `claude`
// CLI, registered in the core's harness registry. Main only: it has no surface,
// no commands and no layout, and reads only services. Its `command` setting names
// the `claude` program, empty for the platform's; its `profiles` setting is the
// harness's profiles.
export const claudeCodeManifest = definePlugin({
  id: 'claude-code',
  label: 'Claude Code',
  description: 'Runs agent sessions on the Claude Code CLI.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: { command: '', profiles: DEFAULT_PROFILES },
  settingInfo: {
    command: {
      label: 'Claude command',
      description:
        'The claude program sessions run; ~ is the home folder. Empty, it is the platform default, ~/.local/bin/claude. Applies to the next session.',
    },
    profiles: {
      label: 'Profiles',
      description:
        'The Claude Code profiles a new session can start in: a name and its config folder each. A name another harness already has is left out.',
    },
  },
  themeTokens: {},
});
