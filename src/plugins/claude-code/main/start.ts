import type { PlatformPrograms } from '../../../contracts/platform';
import type { MainPart } from '../../../contracts/plugin';
import { sessionsMainKey } from '../../sessions/contract';
import { claudeCodeManifest } from '../manifest';
import { createClaudeCodeHarness } from './claude-code-harness';
import { createPermissionRoute, PERMISSION_TOOLS } from './permission-route';

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
// the `profiles` setting. Contributes `permission_prompt` to every session,
// routed by the row id to the row's process; the contribution lives and dies
// with the part, and its dispose ends every tool session, cancelling each
// waiting call while the hosted processes run on.
export const claudeCodeMainPart: MainPart<typeof claudeCodeManifest> = {
  manifest: claudeCodeManifest,
  start(api) {
    const { services } = api;
    const permissions = createPermissionRoute();
    const harness = createClaudeCodeHarness({
      command: () =>
        services.paths.expandTilde(
          claudeCommand(api.settings().command, services.platform.programs),
          services.agentHomeDir,
        ),
      permissions,
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
    api
      .dependency(sessionsMainKey)
      .contributeTools(PERMISSION_TOOLS, (session) =>
        permissions.toolSession(session),
      );
    api.onSettingsChanged(() => registration.refresh());
    // The part's own dispose runs before its registrations, which dispose in
    // reverse track order, so the harness leaves the registry (chat detaches
    // its processes) before the permission contribution cancels the waiting
    // calls; tracked alone, the contribution would go first.
    return { commands: {}, dispose: () => registration.dispose() };
  },
};
