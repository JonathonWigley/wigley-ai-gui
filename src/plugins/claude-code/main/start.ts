import { CLAUDE_PERMISSION_TOOL } from '../../../contracts/agent';
import type { PlatformPrograms } from '../../../contracts/platform';
import type { MainPart } from '../../../contracts/plugin';
import { claudeCodeManifest } from '../manifest';
import { createClaudeCodeHarness } from './claude-code-harness';

// The program the `command` setting names, the setting itself when set. Empty,
// it is the platform's `claude`.
export function claudeCommand(
  setting: string,
  programs: PlatformPrograms,
): string {
  return setting === '' ? programs.claude : setting;
}

// Registers the Claude Code adapter, run as `services.agentHomeDir`: its
// command, read at each spawn, and its profile folders expand `~` against that
// home. A settings change refreshes the registration, so the registry re-reads
// the `profiles` setting.
export const claudeCodeMainPart: MainPart<typeof claudeCodeManifest> = {
  manifest: claudeCodeManifest,
  start(api) {
    const { services } = api;
    const harness = createClaudeCodeHarness({
      command: () =>
        services.paths.expandTilde(
          claudeCommand(api.settings().command, services.platform.programs),
          services.agentHomeDir,
        ),
      permissionTool: CLAUDE_PERMISSION_TOOL,
      env: services.agentEnvironment,
      log: (_source, message) => services.log(message),
      host: services.sessionHost,
      processes: services.processes,
      files: services.files,
      homeDir: services.agentHomeDir,
      paths: services.paths,
      clock: services.clock,
      randomUuid: services.randomUuid,
      profiles: () => api.settings().profiles,
    });
    const registration = services.agentHarnesses.register(harness);
    api.onSettingsChanged(() => registration.refresh());
    return { commands: {}, dispose: () => registration.dispose() };
  },
};
