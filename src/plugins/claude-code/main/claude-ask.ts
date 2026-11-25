import type { AgentAsk } from '../../../contracts/agent';
import type { RandomUuid } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { ProgramCandidate } from '../../../contracts/platform';
import type {
  ProcessRunner,
  SpawnedProcess,
  SpawnExit,
} from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';
import { programNotFoundMessage } from '../../../shared/program-lookup';
import {
  claudeEnv,
  cliSpawnError,
  exitText,
  withStderr,
} from './claude-launch';
import { parsed } from './json-fields';

// Each ask's own folder inside the first temp folder is this prefix and a
// random suffix, so no project file is near the run and no other user can
// make the folder first.
export const ASK_FOLDER_PREFIX = 'claude-code-ask-';

// The file in the ask's folder that carries the instructions to
// `--system-prompt-file`.
export const ASK_INSTRUCTIONS_FILE_NAME = 'instructions.md';

const STOPPED_MESSAGE = 'the ask was stopped';

// `command` gives the `claude` program and its leading args, null when none
// was found; `askModel` the model each ask runs on, read at each ask, '' for
// the CLI's default; `tempFolders` the OS temp folders, the first holding each
// ask's folder; `randomUuid` the folder's suffix; `env` the environment the
// run starts from, with `homeDir` and `paths` resolving the profile folder as
// every `claude` run does; `log` takes a failure to delete the instructions
// file.
export interface ClaudeAskDeps {
  command(): Promise<ProgramCandidate | null>;
  askModel(): string;
  tempFolders: readonly string[];
  randomUuid: RandomUuid;
  env: Readonly<Record<string, string>>;
  homeDir: string;
  paths: Paths;
  log: Log;
  files: Pick<Files, 'makeFolder' | 'write' | 'deleteFile'>;
  processes: Pick<ProcessRunner, 'spawn'>;
}

// The flags replace Claude Code's system prompt with the file's text and turn
// off its tools, MCP servers, settings (with their hooks, plugins and
// `CLAUDE.md`), slash commands and session saving, so nothing but the call
// reaches the model. No arg holds a line break, which a `.cmd` or `.bat`
// launch on Windows cannot pass.
function askArgs(instructionsFile: string, askModel: string): string[] {
  const modelArgs = askModel === '' ? [] : ['--model', askModel];
  return [
    '-p',
    '--system-prompt-file',
    instructionsFile,
    '--tools',
    '',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--output-format',
    'json',
    ...modelArgs,
  ];
}

function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error(STOPPED_MESSAGE);
  }
}

// The last line of `stdout` holding more than whitespace, '' when none does.
function lastLine(stdout: string): string {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.at(-1)?.trim() ?? '';
}

// The reply a closed ask run gives: the `result` of the JSON object on its
// last non-empty stdout line. Throws the start error, then `is_error`'s
// reason, then the exit, then a missing result, each with stderr (trimmed)
// where it helps.
function askReply(
  exit: SpawnExit,
  stdout: string,
  stderr: string,
  command: string,
): string {
  if (exit.startError !== null) {
    throw new Error(cliSpawnError(exit.startError, command));
  }
  const line = parsed(lastLine(stdout));
  const reply = line.ok && isJsonObject(line.value) ? line.value : null;
  if (reply?.is_error === true) {
    const result = typeof reply.result === 'string' ? reply.result : '';
    const reason = result === '' ? stderr : result;
    throw new Error(
      reason === '' ? 'claude -p failed' : `claude -p failed: ${reason}`,
    );
  }
  if (exit.code !== 0) {
    throw new Error(
      withStderr(
        `claude -p exited with ${exitText(exit.code, exit.signal)}`,
        stderr,
      ),
    );
  }
  if (reply === null || typeof reply.result !== 'string') {
    throw new Error(withStderr('claude -p printed no result', stderr));
  }
  return reply.result;
}

// Spawns the ask in `cwd`, writes the prompt to its stdin and ends it, and
// settles once: on the close, or on `request.signal`'s abort, which kills the
// child with SIGKILL and rejects at once.
function runAsk(
  deps: ClaudeAskDeps,
  program: ProgramCandidate,
  cwd: string,
  instructionsFile: string,
  request: AgentAsk,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let isSettled = false;
    let child: SpawnedProcess | null = null;
    const onAbort = () => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      child?.kill('SIGKILL');
      reject(new Error(STOPPED_MESSAGE));
    };
    const onClosed = (exit: SpawnExit) => {
      request.signal.removeEventListener('abort', onAbort);
      if (isSettled) {
        return;
      }
      isSettled = true;
      try {
        resolve(askReply(exit, stdout, stderr.trim(), program.command));
      } catch (error) {
        reject(error);
      }
    };
    child = deps.processes.spawn(
      program.command,
      [...program.args, ...askArgs(instructionsFile, deps.askModel())],
      {
        cwd,
        env: claudeEnv(deps.env, request.profileDir, deps.homeDir, deps.paths),
        events: {
          stdout: (chunk) => {
            stdout += chunk;
          },
          stderr: (chunk) => {
            stderr += chunk;
          },
          closed: onClosed,
        },
      },
    );
    if (!isSettled) {
      request.signal.addEventListener('abort', onAbort, { once: true });
    }
    child.write(request.prompt);
    child.endInput();
  });
}

async function deleteInstructionsOrLog(
  deps: ClaudeAskDeps,
  instructionsFile: string,
): Promise<void> {
  try {
    await deps.files.deleteFile(instructionsFile);
  } catch (error) {
    deps.log(
      'claude',
      `ask instructions not deleted at ${instructionsFile}: ${errorText(error)}`,
    );
  }
}

// Runs `request` as one isolated `claude -p` in a folder of its own,
// `ASK_FOLDER_PREFIX` and a random suffix inside the first temp folder, made
// before the spawn, with the instructions in `ASK_INSTRUCTIONS_FILE_NAME`
// there, the profile's environment and the prompt on stdin, and resolves with
// the reply's `result`. Each check before the spawn rejects spawning nothing:
// no temp folder, an abort (at the call, during the lookup, the folder make or
// the instructions write), no program found, and a lookup, folder make or
// write that rejects, with its own error. Once the folder is made, the
// instructions file is deleted when the ask settles, however it settles; a
// failed delete is logged and leaves the outcome alone. The folder itself
// stays. The caller's `signal` is the only time limit.
export async function askClaude(
  deps: ClaudeAskDeps,
  request: AgentAsk,
): Promise<string> {
  if (deps.tempFolders.length === 0) {
    throw new Error('no temp folder to run the ask in');
  }
  throwIfStopped(request.signal);
  const program = await deps.command();
  throwIfStopped(request.signal);
  if (program === null) {
    throw new Error(programNotFoundMessage('claude'));
  }
  const cwd = deps.paths.join(
    deps.tempFolders[0],
    `${ASK_FOLDER_PREFIX}${deps.randomUuid()}`,
  );
  await deps.files.makeFolder(cwd);
  const instructionsFile = deps.paths.join(cwd, ASK_INSTRUCTIONS_FILE_NAME);
  try {
    throwIfStopped(request.signal);
    await deps.files.write(instructionsFile, request.instructions);
    throwIfStopped(request.signal);
    return await runAsk(deps, program, cwd, instructionsFile, request);
  } finally {
    await deleteInstructionsOrLog(deps, instructionsFile);
  }
}
