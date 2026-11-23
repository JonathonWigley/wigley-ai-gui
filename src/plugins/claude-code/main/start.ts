import type { MainPart } from '../../../contracts/plugin';
import { agentPluginDir } from '../../../shared/agent-plugin';
import { sessionsMainKey } from '../../sessions/contract';
import { claudeCodeManifest } from '../manifest';
import { createClaudeCodeHarness } from './claude-code-harness';
import {
  createPermissionRoute,
  PERMISSION_OFFLINE,
  PERMISSION_TOOL_NAME,
  PERMISSION_TOOLS,
} from './permission-route';

// Registers the Claude Code adapter, run as `services.agentHomeDir`: its
// command, read at each launch, is the `command` setting with `~` expanded
// against that home, or `claude` looked up on PATH, then in `~/.local/bin`,
// when the setting is empty; its profile folders expand `~` against that home
// too. A `.cmd` or `.bat` command set on Windows reaches the session host's
// spawn unwrapped, so it starts the one-shots but no session. A settings
// change refreshes the registration, so the registry re-reads the `profiles`
// setting. Contributes `permission_prompt` to every session,
// routed by the row id to the row's process, denying while the app is closed
// (`PERMISSION_OFFLINE`); the contribution lives and dies
// with the part, and its dispose ends every tool session, cancelling each
// waiting call while the hosted processes run on.
export const claudeCodeMainPart: MainPart<typeof claudeCodeManifest> = {
  manifest: claudeCodeManifest,
  start(api) {
    const { services } = api;
    const permissions = createPermissionRoute();
    const harness = createClaudeCodeHarness({
      command: async () => {
        const setting = api.settings().command;
        return setting === ''
          ? services.processes.resolveProgram('claude')
          : {
              command: services.paths.expandTilde(
                setting,
                services.agentHomeDir,
              ),
              args: [],
            };
      },
      permissions,
      env: services.agentEnvironment,
      log: (_source, message) => services.log(message),
      host: services.sessionHost,
      processes: services.processes,
      files: services.files,
      homeDir: services.agentHomeDir,
      paths: services.paths,
      agentPluginDir: agentPluginDir(services.appDir, services.paths),
      clock: services.clock,
      randomUuid: services.randomUuid,
      profiles: () => api.settings().profiles,
    });
    const registration = services.agentHarnesses.register(harness);
    api
      .dependency(sessionsMainKey)
      .contributeTools(
        PERMISSION_TOOLS,
        (session) => permissions.toolSession(session),
        { offline: { [PERMISSION_TOOL_NAME]: PERMISSION_OFFLINE } },
      );
    api.onSettingsChanged(() => registration.refresh());
    // The part's own dispose runs before its registrations, which dispose in
    // reverse track order, so the harness leaves the registry (chat detaches
    // its processes) before the permission contribution cancels the waiting
    // calls; tracked alone, the contribution would go first.
    return { commands: {}, dispose: () => registration.dispose() };
  },
};
