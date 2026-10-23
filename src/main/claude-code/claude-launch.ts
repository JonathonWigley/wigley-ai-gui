import type { AgentStart } from '../../contracts/agent';
import type { Paths } from '../../contracts/paths';

export interface ClaudeLaunch {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

// What a Claude Code session sets for its own children, which an app started
// from a Claude Code terminal inherits: the names claude-stream.md § Launch
// lists. Other `CLAUDE_CODE_*` names are the user's config and pass through.
const NESTED_SESSION_ENV: readonly string[] = [
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_AFK_TIMEOUT_MS',
  'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
];

// The environment every `claude` run for `profileDir` gets: a copy of `env`
// without the nested-session variables, with `CLAUDE_CONFIG_DIR` set to
// `profileDir` resolved against `homeDir` when one is given.
export function claudeEnv(
  env: NodeJS.ProcessEnv,
  profileDir: string | null,
  homeDir: string,
  paths: Paths,
): NodeJS.ProcessEnv {
  const launchEnv = { ...env };
  for (const name of NESTED_SESSION_ENV) {
    delete launchEnv[name];
  }
  if (profileDir !== null) {
    launchEnv.CLAUDE_CONFIG_DIR = paths.expandTilde(profileDir, homeDir);
  }
  return launchEnv;
}

// The arguments, folder and environment `claude` runs one session with:
// stream-json both ways, partial messages streamed, auto permission mode with
// what it would still prompt sent to `permissionTool`, and `claudeEnv`'s
// environment.
export function claudeLaunch(
  request: AgentStart,
  permissionTool: string,
  env: NodeJS.ProcessEnv,
  homeDir: string,
  paths: Paths,
): ClaudeLaunch {
  const sessionFlag = request.resume ? '--resume' : '--session-id';
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
      'auto',
      '--permission-prompt-tool',
      permissionTool,
    ],
    cwd: request.projectDir,
    env: claudeEnv(env, request.profileDir, homeDir, paths),
  };
}

// The config folder a session launched with `claudeLaunch` uses: `profileDir`
// resolved against `homeDir`, which the launch sets as `CLAUDE_CONFIG_DIR`,
// else the non-empty `CLAUDE_CONFIG_DIR` the launch passes through, else
// `<homeDir>/.claude`.
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
  return isInherited ? inherited : paths.join(homeDir, '.claude');
}
