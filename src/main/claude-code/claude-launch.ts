import type { AgentStart } from '../../contracts/agent';

export interface ClaudeLaunch {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

// The arguments, folder and environment `claude` runs one session with:
// stream-json both ways, partial messages streamed, auto permission mode with
// what it would still prompt sent to `permissionTool`.
export function claudeLaunch(
  request: AgentStart,
  permissionTool: string,
  env: NodeJS.ProcessEnv,
): ClaudeLaunch {
  const sessionFlag = request.resume ? '--resume' : '--session-id';
  const launchEnv = { ...env };
  if (request.profileDir !== null) {
    launchEnv.CLAUDE_CONFIG_DIR = request.profileDir;
  }
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
    env: launchEnv,
  };
}
