import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  ProcessResult,
  ProcessRunner,
} from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';
import { programNotFoundMessage } from '../../../shared/program-lookup';
import { SESSION_IDENTITY_ENV } from '../../../shared/session-env';
import type { PoolAction, PoolActionResult } from '../contract';

// Open may wait on `unity status`, then activates the editor by pid; when the desktop cannot, it falls back to `editor focus` (`editor_focus` on Pipeline 0.8), which the CLI gives 60 seconds.
const RUN_TIMEOUT_MS: Record<PoolAction, number> = {
  hold: 30_000,
  release: 30_000,
  open: 120_000,
};

type CliFailure = { ok: false; error: string; message: string };

// The CLI and the runner whose `resolveProgram('python')` runs it, answering `no-python` when it finds none;
// `scriptPath` is the raw setting, `~` not yet expanded.
export interface CliDeps {
  processes: ProcessRunner;
  files: Pick<Files, 'stat'>;
  paths: Pick<Paths, 'expandTilde'>;
  homeDir: string;
  scriptPath: string;
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

// The CLI's JSON answer from the last non-empty stdout line; its `ok` decides, not the exit code.
export function readActionResult(result: ProcessResult): PoolActionResult {
  if (result.timedOut) {
    return { ok: false, error: 'cli-failed', message: 'unity-pool timed out' };
  }
  const answer = parseJson(lastLine(result.stdout));
  if (isJsonObject(answer)) {
    const { pool, clone, editorOpening } = answer;
    if (
      answer.ok === true &&
      typeof pool === 'string' &&
      typeof clone === 'number'
    ) {
      return {
        ok: true,
        pool,
        clone,
        editorOpening:
          typeof editorOpening === 'boolean' ? editorOpening : null,
      };
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

// Runs `<python> -X utf8 <script> <action> <pool> <clone> --json` with the Python `resolveProgram('python')` gives,
// its own args leading, `scriptPath` being the raw setting with `~` not yet expanded, without any session's identity
// in its environment, so the CLI takes the run as the user's. A script missing from its path runs nothing and answers
// `no-cli`; no Python found runs nothing and answers `no-python`.
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
    const python = await deps.processes.resolveProgram('python');
    if (python === null) {
      return {
        ok: false,
        error: 'no-python',
        message: programNotFoundMessage('python'),
      };
    }
    const result = await deps.processes.run(
      python.command,
      [...python.args, ...poolCommandArgs(script, action, pool, clone)],
      { timeoutMs: RUN_TIMEOUT_MS[action], unsetEnv: SESSION_IDENTITY_ENV },
    );
    return readActionResult(result);
  } catch (error) {
    return { ok: false, error: 'cli-failed', message: errorText(error) };
  }
}

// The script the deps name with `~` expanded, `no-cli` when no file is there, or `cli-failed` when the stat itself
// fails.
async function findScript(deps: CliDeps): Promise<string | CliFailure> {
  const script = deps.paths.expandTilde(deps.scriptPath, deps.homeDir);
  try {
    if ((await deps.files.stat(script)) === null) {
      return {
        ok: false,
        error: 'no-cli',
        message: `unity-pool not found at ${script}`,
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: 'cli-failed',
      message: `unity-pool could not be checked at ${script}: ${errorText(error)}`,
    };
  }
  return script;
}

// The last non-empty line of `text`, trimmed; null when it has none.
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
