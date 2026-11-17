import type { AgentStart } from '../../contracts/agent';
import type { Paths } from '../../contracts/paths';
import { NESTED_SESSION_ENV, SESSION_ROW_ENV } from '../../shared/session-env';
import { launchMode } from './claude-controls';

export interface ClaudeLaunch {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  // The names `claudeEnv` removes, which a child that inherits another environment must not take from it.
  unsetEnv: string[];
}

const IDLE_COMPACT_ENV = 'CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS';
// The app's own values, not a parent session's: an app setting and the row id. A
// session launch sets them from its request, and no other value in the inherited
// environment reaches a `claude` run, the user's own included. A profile's
// `settings.json` `env` still reaches the child.
const APP_LAUNCH_ENV: readonly string[] = [IDLE_COMPACT_ENV, SESSION_ROW_ENV];
const CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';

// The names no `claude` run for `profileDir` inherits: the nested-session
// variables, the app's own values, and `CLAUDE_CONFIG_DIR` when `profileDir`
// resolves against `homeDir` to the default `<homeDir>/.claude`.
export function claudeUnsetEnv(
  profileDir: string | null,
  homeDir: string,
  paths: Paths,
): string[] {
  const names = [...NESTED_SESSION_ENV, ...APP_LAUNCH_ENV];
  // macOS keeps the login for an unset CLAUDE_CONFIG_DIR under a different
  // Keychain entry than for any set value, the default folder's included.
  const isDefaultFolder =
    profileDir !== null &&
    paths.samePath(
      paths.expandTilde(profileDir, homeDir),
      defaultConfigFolder(homeDir, paths),
    );
  if (isDefaultFolder) {
    names.push(CONFIG_DIR_ENV);
  }
  return names;
}

// The environment every `claude` run for `profileDir` gets: a copy of `env`
// without the names `claudeUnsetEnv` gives, with `CLAUDE_CONFIG_DIR` set to
// `profileDir` resolved against `homeDir` when one is given and it is not the
// default folder.
export function claudeEnv(
  env: NodeJS.ProcessEnv,
  profileDir: string | null,
  homeDir: string,
  paths: Paths,
): NodeJS.ProcessEnv {
  const launchEnv = { ...env };
  const unsetNames = claudeUnsetEnv(profileDir, homeDir, paths);
  for (const name of unsetNames) {
    delete launchEnv[name];
  }
  if (profileDir !== null && !unsetNames.includes(CONFIG_DIR_ENV)) {
    launchEnv[CONFIG_DIR_ENV] = paths.expandTilde(profileDir, homeDir);
  }
  return launchEnv;
}

export function defaultConfigFolder(homeDir: string, paths: Paths): string {
  return paths.join(homeDir, '.claude');
}

// The arguments, folder and environment `claude` runs one session with:
// stream-json both ways, partial messages streamed, the request's `mode`
// control as the permission mode (`launchMode`) with what it would still
// prompt sent to `permissionTool`, its `model` and `effort` controls as
// `--model` and `--effort`, and the request's `instructions`, when there are
// any, as one `--append-system-prompt` joined with a blank line, and
// `claudeEnv`'s environment, plus the request's `idleCompactMinTokens` when it
// is not null and its `rowId` as `WIGLEY_SESSION_ROW`, and `claudeUnsetEnv`'s
// names.
export function claudeLaunch(
  request: AgentStart,
  permissionTool: string,
  env: NodeJS.ProcessEnv,
  homeDir: string,
  paths: Paths,
): ClaudeLaunch {
  const sessionFlag = request.resume ? '--resume' : '--session-id';
  const { model, effort } = request.controls;
  const modelArgs = model === undefined ? [] : ['--model', model];
  const effortArgs = effort === undefined ? [] : ['--effort', effort];
  const instructionArgs =
    request.instructions.length === 0
      ? []
      : ['--append-system-prompt', request.instructions.join('\n\n')];
  const launchEnv = claudeEnv(env, request.profileDir, homeDir, paths);
  if (request.idleCompactMinTokens !== null) {
    launchEnv[IDLE_COMPACT_ENV] = String(request.idleCompactMinTokens);
  }
  launchEnv[SESSION_ROW_ENV] = request.rowId;
  return {
    args: [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      // stream-json output exits at once without it.
      '--verbose',
      sessionFlag,
      request.sessionId,
      '--permission-mode',
      launchMode(request.controls),
      '--permission-prompt-tool',
      permissionTool,
      ...modelArgs,
      ...effortArgs,
      ...instructionArgs,
    ],
    cwd: request.projectDir,
    env: launchEnv,
    unsetEnv: claudeUnsetEnv(request.profileDir, homeDir, paths),
  };
}

// The config folder a session launched with `claudeLaunch` uses: `profileDir`
// resolved against `homeDir`, which the launch sets as `CLAUDE_CONFIG_DIR`
// (or leaves unset for the default folder), else the non-empty
// `CLAUDE_CONFIG_DIR` the launch passes through, else `<homeDir>/.claude`.
export function claudeConfigFolder(
  profileDir: string | null,
  env: NodeJS.ProcessEnv,
  homeDir: string,
  paths: Paths,
): string {
  if (profileDir !== null) {
    return paths.expandTilde(profileDir, homeDir);
  }
  const inherited = env.CLAUDE_CONFIG_DIR;
  const isInherited = inherited !== undefined && inherited !== '';
  return isInherited ? inherited : defaultConfigFolder(homeDir, paths);
}
