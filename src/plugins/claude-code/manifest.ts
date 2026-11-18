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
// no commands and no layout, and reads only services. It depends on sessions,
// whose sessions it serves the `permission_prompt` tool. Its `command` setting
// names the `claude` program, empty to look it up; its `profiles` setting is
// the harness's profiles.
export const claudeCodeManifest = definePlugin({
  id: 'claude-code',
  label: 'Claude Code',
  description: 'Runs agent sessions on the Claude Code CLI.',
  dependsOn: { main: ['sessions'], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: {},
  settings: { command: '', profiles: DEFAULT_PROFILES },
  settingInfo: {
    command: {
      label: 'Claude command',
      description:
        'The claude program sessions run: a program name or a path; ~ is the home folder. Empty, the app looks for claude on PATH, then in ~/.local/bin. Applies to the next session.',
    },
    profiles: {
      label: 'Profiles',
      description:
        'The Claude Code profiles a new session can start in: a name and its config folder each. A name another harness already has is left out.',
    },
  },
  themeTokens: {},
});
