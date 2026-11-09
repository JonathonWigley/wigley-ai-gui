import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  ProcessResult,
  ProcessRunner,
} from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';
import {
  SESSION_IDENTITY_ENV,
  SESSION_ROW_ENV,
} from '../../../shared/session-env';
import type { PoolClaimRequest } from '../../chat/contract';
import type { PoolAction, PoolActionResult } from '../contract';

const RUN_TIMEOUT_MS = 30_000;
const HOST_SESSION_ENV = 'CLAUDE_CODE_SESSION_ID';

// What a claim run answered: the clone's path, or the CLI's error code (`no-cli`, `cli-failed` and `cancelled` when
// it gave none).
export type ClaimAnswer = { ok: true; path: string } | CliFailure;

type CliFailure = { ok: false; error: string; message: string };

// The CLI and the Python that runs it; `scriptPath` is the raw setting, `~` not yet expanded.
export interface CliDeps {
  processes: ProcessRunner;
  files: Pick<Files, 'stat'>;
  paths: Pick<Paths, 'expandTilde'>;
  homeDir: string;
  scriptPath: string;
  pythonCommand: string;
}

// The Python arguments of `unity-pool <action> <pool> <clone> --json`.
export function poolCommandArgs(
  scriptPath: string,
  action: PoolAction,
  pool: string,
  clone: number,
): string[] {
  return ['-X', 'utf8', scriptPath, action, pool, String(clone), '--json'];
}

// The Python arguments of `unity-pool claim --branch <branch> --pool <pool> --wait --json`.
export function claimCommandArgs(
  scriptPath: string,
  pool: string,
  branch: string,
): string[] {
  return [
    '-X',
    'utf8',
    scriptPath,
    'claim',
    '--branch',
    branch,
    '--pool',
    pool,
    '--wait',
    '--json',
  ];
}

// The Python arguments of `unity-pool release --json`.
export function releaseCommandArgs(scriptPath: string): string[] {
  return ['-X', 'utf8', scriptPath, 'release', '--json'];
}

// The claim's JSON answer from the last non-empty stdout line, read as `readActionResult` reads an action's.
export function readClaimAnswer(result: ProcessResult): ClaimAnswer {
  const answer = parseJson(lastLine(result.stdout));
  if (isJsonObject(answer)) {
    if (answer.ok === true) {
      return typeof answer.path === 'string'
        ? { ok: true, path: answer.path }
        : {
            ok: false,
            error: 'cli-failed',
            message: 'unity-pool claim answered no path',
          };
    }
  }
  return failureOf(answer, result);
}

// The CLI's JSON answer from the last non-empty stdout line; its `ok` decides, not the exit code.
export function readActionResult(result: ProcessResult): PoolActionResult {
  if (result.timedOut) {
    return { ok: false, error: 'cli-failed', message: 'unity-pool timed out' };
  }
  const answer = parseJson(lastLine(result.stdout));
  if (isJsonObject(answer)) {
    const { pool, clone } = answer;
    if (
      answer.ok === true &&
      typeof pool === 'string' &&
      typeof clone === 'number'
    ) {
      return { ok: true, pool, clone };
    }
  }
  return failureOf(answer, result);
}

// The CLI's `ok: false` answer; with none, `cli-failed` carrying the last stderr line, so a stack trace shows only its
// error.
function failureOf(answer: unknown, result: ProcessResult): CliFailure {
  if (isJsonObject(answer) && answer.ok === false) {
    return {
      ok: false,
      error: typeof answer.error === 'string' ? answer.error : 'unknown',
      message: typeof answer.message === 'string' ? answer.message : 'unknown',
    };
  }
  return {
    ok: false,
    error: 'cli-failed',
    message: lastLine(result.stderr) ?? `unity-pool exited ${result.code}`,
  };
}

// The script the `scriptPath` setting names, the setting itself when set. Empty, it is `~/.local/bin/unity-pool`,
// where macOS and Linux link the tool; a Windows install writes launchers there, not a symlink a Python can run, so
// Windows runs the tool from its own folder.
export function resolveScriptPath(setting: string, windows: boolean): string {
  if (setting !== '') {
    return setting;
  }
  return windows
    ? '~/wigley-agents/tools/unity-pool/unity-pool'
    : '~/.local/bin/unity-pool';
}

// Runs `<pythonCommand> -X utf8 <script> <action> <pool> <clone> --json`, `scriptPath` being the raw setting with `~`
// not yet expanded, without any session's identity in its environment, so the CLI takes the run as the user's. A
// script missing from its path runs nothing and answers `no-cli`.
export async function runPoolCommand(
  deps: CliDeps,
  action: PoolAction,
  pool: string,
  clone: number,
): Promise<PoolActionResult> {
  const script = await findScript(deps);
  if (typeof script !== 'string') {
    return script;
  }
  try {
    const result = await deps.processes.run(
      deps.pythonCommand,
      poolCommandArgs(script, action, pool, clone),
      { timeoutMs: RUN_TIMEOUT_MS, unsetEnv: SESSION_IDENTITY_ENV },
    );
    return readActionResult(result);
  } catch (error) {
    return { ok: false, error: 'cli-failed', message: errorText(error) };
  }
}

// Runs `unity-pool claim --branch <branch> --pool <pool> --wait --json` under the session's two ids
// (`CLAUDE_CODE_SESSION_ID` the host session id, `WIGLEY_SESSION_ROW` the row id) and no other session's, with no
// timeout: only `signal` stops it, answering `cancelled`. It releases nothing: the caller runs `runPoolRelease` when
// the CLI may have granted a clone. Once the part stops the platform kills its processes, so no release runs after a
// stop and the pool's claim expiry frees the clone.
export async function runPoolClaim(
  deps: CliDeps,
  request: PoolClaimRequest,
  signal: AbortSignal,
): Promise<ClaimAnswer> {
  const script = await findScript(deps);
  if (typeof script !== 'string') {
    return script;
  }
  try {
    const result = await deps.processes.run(
      deps.pythonCommand,
      claimCommandArgs(script, request.pool, request.branch),
      { signal, ...sessionEnv(request) },
    );
    return readClaimAnswer(result);
  } catch (error) {
    return signal.aborted
      ? { ok: false, error: 'cancelled', message: 'claim cancelled' }
      : { ok: false, error: 'cli-failed', message: errorText(error) };
  }
}

// Runs `unity-pool release --json` under the request's two ids, as `runPoolClaim` runs the claim, in the home folder:
// a cwd inside a clone would name that clone's pool, so the CLI finds the pool from the session's claim instead. A
// session holding no clone answers `not-holder`.
export async function runPoolRelease(
  deps: CliDeps,
  request: PoolClaimRequest,
): Promise<PoolActionResult> {
  const script = await findScript(deps);
  if (typeof script !== 'string') {
    return script;
  }
  try {
    const result = await deps.processes.run(
      deps.pythonCommand,
      releaseCommandArgs(script),
      {
        cwd: deps.homeDir,
        timeoutMs: RUN_TIMEOUT_MS,
        ...sessionEnv(request),
      },
    );
    return readActionResult(result);
  } catch (error) {
    return { ok: false, error: 'cli-failed', message: errorText(error) };
  }
}

// The script the deps name with `~` expanded, or `no-cli` when no file is there.
async function findScript(deps: CliDeps): Promise<string | CliFailure> {
  const script = deps.paths.expandTilde(deps.scriptPath, deps.homeDir);
  if ((await deps.files.stat(script)) === null) {
    return {
      ok: false,
      error: 'no-cli',
      message: `unity-pool not found at ${script}`,
    };
  }
  return script;
}

// The run's environment as the request's session: every other session name dropped, its two ids set.
function sessionEnv(request: PoolClaimRequest): {
  unsetEnv: readonly string[];
  setEnv: Readonly<Record<string, string>>;
} {
  return {
    unsetEnv: SESSION_IDENTITY_ENV.filter(
      (name) => name !== HOST_SESSION_ENV && name !== SESSION_ROW_ENV,
    ),
    setEnv: {
      [HOST_SESSION_ENV]: request.hostSessionId,
      [SESSION_ROW_ENV]: request.rowId,
    },
  };
}

// The last non-empty line of `text`, trimmed; null when it has none.
export function lastLine(text: string): string | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.length === 0 ? null : lines[lines.length - 1].trim();
}

function parseJson(text: string | null): unknown {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
