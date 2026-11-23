import { type Files, readIfPresent } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { ProcessRunner } from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import { programNotFoundMessage } from '../../../shared/program-lookup';
import { type GameRectTuple, isGameRectWithArea } from './live-tools';

// The Unity script the probe runs, from the first installed liveView strategy
// with a probe: its full path, its C# entry, and its plugin's name.
export interface ProbeScript {
  file: string;
  entry: string;
  pluginName: string;
}

const PROBE_ARGS = JSON.stringify([JSON.stringify({ action: 'probe' })]);
const PIPELINE_PACKAGE = 'com.unity.pipeline';
const SCRIPT_TIMEOUT_S = 8;
// An old pin's run_script takes its own timeout in ms and the CLI's in s: the
// CLI's timeout this far past the script's, on an old pin.
const LEGACY_CLI_SLACK_S = 15;
// How long past the CLI's `--timeout` the app lets a run go before killing it:
// 23 s on a grouped pin, 38 s on an old one.
const CLIENT_SLACK_S = 15;
// How deep a reply may nest its script's reply under `result` keys.
const MAX_REPLY_DEPTH = 6;

export const PROBE_ATTEMPTS = 3;
const PROBE_RETRY_MS = 1000;

type ProbeResult = { rect: GameRectTuple } | { error: string };

export interface GameViewProbeDeps {
  processes: Pick<ProcessRunner, 'run' | 'resolveProgram'>;
  files: Pick<Files, 'read' | 'realPath'>;
  paths: Pick<Paths, 'join'>;
  // The probe script to run, or null when no installed plugin gives one.
  locateScript(): Promise<ProbeScript | null>;
  wait(ms: number): Promise<void>;
}

interface ProbeReply {
  playing: boolean;
  window: GameRectTuple | null;
}

// The Game View rect of the editor that has `projectPath` open, from the
// probe script's `probe` action run through `unity command script run`
// (`run_script` below com.unity.pipeline 0.9): `[x, y, width, height]` in
// top-left global screen points. Up to PROBE_ATTEMPTS calls, PROBE_RETRY_MS
// apart while `isCancelled` reads false: a failed call, or a reply with no
// window or from an editor not yet playing, tries again, and the last call
// takes a window whether or not the editor plays. Never rejects.
export async function probeGameRect(
  deps: GameViewProbeDeps,
  projectPath: string,
  isCancelled: () => boolean,
): Promise<ProbeResult> {
  try {
    const script = await deps.locateScript();
    if (script === null) {
      return { error: 'no installed plugin gives a Game View probe' };
    }
    const unity = await deps.processes.resolveProgram('unity');
    if (unity === null) {
      return { error: programNotFoundMessage('unity') };
    }
    // The CLI is handed the resolved folder.
    const call = await probeCall(
      deps,
      await deps.files.realPath(projectPath),
      script,
    );
    const args = [...unity.args, ...call.args];
    const timeoutMs = (call.cliTimeoutS + CLIENT_SLACK_S) * 1000;
    let lastError = '';
    for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt += 1) {
      if (attempt > 1) {
        await deps.wait(PROBE_RETRY_MS);
      }
      if (isCancelled()) {
        return { error: 'the playtest show was interrupted' };
      }
      const reply = await probeOnce(deps, unity.command, args, timeoutMs);
      if ('error' in reply) {
        lastError = reply.error;
        continue;
      }
      const isLastAttempt = attempt === PROBE_ATTEMPTS;
      if (reply.window !== null && (reply.playing || isLastAttempt)) {
        return { rect: reply.window };
      }
      lastError =
        reply.window === null
          ? 'the editor has no Game View open'
          : 'the editor is not playing';
    }
    return { error: lastError };
  } catch (error) {
    return { error: errorText(error) };
  }
}

// The CLI args of one probe call of `script` in the editor of `projectPath`,
// by the names its com.unity.pipeline pin takes, and the `--timeout` they
// pass the CLI.
async function probeCall(
  deps: Pick<GameViewProbeDeps, 'files' | 'paths'>,
  projectPath: string,
  script: ProbeScript,
): Promise<{ args: string[]; cliTimeoutS: number }> {
  const manifest = await readIfPresent(
    deps.files,
    deps.paths.join(projectPath, 'Packages', 'manifest.json'),
  );
  const call = [
    '--file',
    script.file,
    '--entry',
    script.entry,
    '--args',
    PROBE_ARGS,
  ];
  const tail = ['--json', '--project-path', projectPath];
  if (usesGroupedNames(manifest)) {
    return {
      args: [
        'command',
        'script',
        'run',
        ...call,
        '--timeout',
        String(SCRIPT_TIMEOUT_S),
        ...tail,
      ],
      cliTimeoutS: SCRIPT_TIMEOUT_S,
    };
  }
  const cliTimeoutS = SCRIPT_TIMEOUT_S + LEGACY_CLI_SLACK_S;
  return {
    args: [
      'command',
      'run_script',
      ...call,
      '--timeout_ms',
      String(SCRIPT_TIMEOUT_S * 1000),
      '--timeout',
      String(cliTimeoutS),
      ...tail,
    ],
    cliTimeoutS,
  };
}

// Whether a project's `Packages/manifest.json` text pins com.unity.pipeline at
// 0.9 or above: false only for a pin whose leading
// MAJOR.MINOR reads below 0.9; true for a missing or unreadable manifest, entry
// or value.
function usesGroupedNames(manifestText: string | null): boolean {
  if (manifestText === null) {
    return true;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return true;
  }
  const dependencies = recordOf(recordOf(manifest)?.dependencies);
  const pin = dependencies?.[PIPELINE_PACKAGE];
  const version = typeof pin === 'string' ? /^\D*(\d+)\.(\d+)/.exec(pin) : null;
  if (version === null) {
    return true;
  }
  const major = Number(version[1]);
  const minor = Number(version[2]);
  return major > 0 || minor >= 9;
}

async function probeOnce(
  deps: Pick<GameViewProbeDeps, 'processes'>,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProbeReply | { error: string }> {
  const result = await deps.processes.run(command, args, { timeoutMs });
  if (result.timedOut) {
    return { error: 'unity script run timed out' };
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    return { error: `unity script run exited ${result.code}: ${detail}` };
  }
  return probeReplyOf(result.stdout);
}

// The probe's reply out of a `script run` or `run_script` call's stdout,
// whatever the pin: the script's reply is the first value holding `ok`, under
// `result` keys (an old pin's envelope: `data.result`), JSON strings parsed on
// the way.
function probeReplyOf(stdout: string): ProbeReply | { error: string } {
  let value: unknown = stdout.trim();
  for (let depth = 0; depth < MAX_REPLY_DEPTH; depth += 1) {
    if (typeof value === 'string') {
      const text = value;
      try {
        value = JSON.parse(text);
      } catch {
        return { error: `the probe's reply is not JSON: ${text.slice(0, 80)}` };
      }
    }
    const record = recordOf(value);
    if (record === null) {
      return { error: "the probe's reply holds no script reply" };
    }
    if ('ok' in record) {
      return scriptReplyOf(record);
    }
    if (record.success === false) {
      return { error: `the probe failed: ${failureText(record)}` };
    }
    value = 'result' in record ? record.result : recordOf(record.data)?.result;
  }
  return { error: "the probe's reply holds no script reply" };
}

function scriptReplyOf(
  reply: Record<string, unknown>,
): ProbeReply | { error: string } {
  if (reply.ok !== true) {
    const reason = typeof reply.error === 'string' ? reply.error : 'not ok';
    return { error: `the probe failed: ${reason}` };
  }
  return {
    playing: reply.playing === true,
    window: isGameRectWithArea(reply.window) ? reply.window : null,
  };
}

// The reason a failed reply gives: its `error`, `errorDetails`,
// `failureReason` and `message`, its `errors[].message`, and the error-severity
// compile `diagnostics` it, its `data` or its `data.result` carries, as
// `line:column message`, joined with '; '.
function failureText(record: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ['error', 'errorDetails', 'failureReason', 'message']) {
    const text = record[key];
    if (typeof text === 'string' && text !== '' && !parts.includes(text)) {
      parts.push(text);
    }
  }
  const errors = Array.isArray(record.errors) ? record.errors : [];
  for (const item of errors) {
    const message = recordOf(item)?.message;
    if (typeof message === 'string' && message !== '') {
      parts.push(message);
    }
  }
  const data = recordOf(record.data);
  for (const holder of [record, data, recordOf(data?.result)]) {
    parts.push(...diagnosticLines(holder));
  }
  return parts.length === 0 ? 'no error message' : parts.join('; ');
}

// A reply's error-severity compile diagnostics, as `line:column message`.
function diagnosticLines(holder: Record<string, unknown> | null): string[] {
  const diagnostics = Array.isArray(holder?.diagnostics)
    ? holder.diagnostics
    : [];
  const lines: string[] = [];
  for (const item of diagnostics) {
    const diagnostic = recordOf(item);
    if (diagnostic === null || (diagnostic.severity ?? 'error') !== 'error') {
      continue;
    }
    const where = ['line', 'column']
      .filter((key) => key in diagnostic)
      .map((key) => String(diagnostic[key]))
      .join(':');
    const message =
      typeof diagnostic.message === 'string' ? diagnostic.message : '';
    lines.push(`${where} ${message}`.trim());
  }
  return lines;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
