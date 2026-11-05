import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  ProcessResult,
  ProcessRunner,
} from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';
import { SESSION_IDENTITY_ENV } from '../../../shared/session-env';
import type { PoolAction, PoolActionResult } from '../contract';

const RUN_TIMEOUT_MS = 30_000;

// The Python arguments of `unity-pool <action> <pool> <clone> --json`.
export function poolCommandArgs(
  scriptPath: string,
  action: PoolAction,
  pool: string,
  clone: number,
): string[] {
  return ['-X', 'utf8', scriptPath, action, pool, String(clone), '--json'];
}

// The CLI's JSON answer from the last non-empty stdout line; its `ok` decides, not the exit code. With no JSON
// answer, `cli-failed` carries the last stderr line, so a stack trace shows only its error.
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
    if (answer.ok === false) {
      return {
        ok: false,
        error: typeof answer.error === 'string' ? answer.error : 'unknown',
        message:
          typeof answer.message === 'string' ? answer.message : 'unknown',
      };
    }
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
  deps: {
    processes: ProcessRunner;
    files: Pick<Files, 'stat'>;
    paths: Pick<Paths, 'expandTilde'>;
    homeDir: string;
    scriptPath: string;
    pythonCommand: string;
  },
  action: PoolAction,
  pool: string,
  clone: number,
): Promise<PoolActionResult> {
  const script = deps.paths.expandTilde(deps.scriptPath, deps.homeDir);
  if ((await deps.files.stat(script)) === null) {
    return {
      ok: false,
      error: 'no-cli',
      message: `unity-pool not found at ${script}`,
    };
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

function lastLine(text: string): string | null {
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
