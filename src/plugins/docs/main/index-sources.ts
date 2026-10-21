import { type Files, readIfPresent } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { ProcessRunner } from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import type { IndexEntry, IndexLoad, SessionSourceSpec } from '../contract';
import { joinPath } from '../doc-paths';
import { parseIndexDocument } from '../index-document';
import { locateScript } from './script-locator';

// The machine index `docs_index.py build` writes, under the home folder.
export const MACHINE_INDEX_FILE = '.agents/wigley-docs/index.json';

const NO_INDEX_MESSAGE = 'No docs index yet — building…';
const NO_SCRIPT_MESSAGE = 'docs_index.py not found — set docs.scriptPath';
const NO_FOLDER_MESSAGE = 'No project folder is known for this session';

type ScriptCommand = 'build' | 'session' | 'context';

// A script run's stdout, or the message the view shows when it failed.
type ScriptOutcome =
  | { ok: true; stdout: string }
  | { ok: false; message: string };

export interface IndexSourcesDeps {
  files: Files;
  processes: ProcessRunner;
  homeDir: string;
  scriptPath: string;
  log: Log;
}

export interface IndexSources {
  // The machine index as it is on disk now.
  machineIndex(): Promise<IndexLoad>;
  // Builds the machine index, then reads it. A call while a build runs waits
  // for one more build after it, which every such call shares.
  rebuild(): Promise<IndexLoad>;
  // A fresh index for one session, its entries kept for `loadedEntries`. A
  // Claude session whose `session` run fails, as before its transcript
  // exists, falls back to `context` on its project folder.
  sessionIndex(spec: SessionSourceSpec): Promise<IndexLoad>;
  // Drops the kept entries of every session not in `specs`.
  retainSessions(specs: readonly SessionSourceSpec[]): void;
  // The entries of the machine document last read ([] before any read or
  // after a failed one), then those of each kept session's last index that
  // loaded.
  loadedEntries(): readonly IndexEntry[];
}

// The machine source (`index.json` and `docs_index.py build`) and the session
// source (`docs_index.py session` or `context`).
export function createIndexSources(deps: IndexSourcesDeps): IndexSources {
  const { files, homeDir } = deps;
  const indexFile = joinPath(homeDir, MACHINE_INDEX_FILE);
  let entries: readonly IndexEntry[] = [];
  // Keyed by `sessionKey`.
  const sessionEntries = new Map<string, readonly IndexEntry[]>();
  let runningBuild: Promise<IndexLoad> | null = null;
  let queuedBuild: Promise<IndexLoad> | null = null;

  async function machineIndex(): Promise<IndexLoad> {
    let text: string | null;
    try {
      text = await readIfPresent(files, indexFile);
    } catch (error) {
      entries = [];
      throw error;
    }
    if (text === null) {
      entries = [];
      return { document: null, message: NO_INDEX_MESSAGE };
    }
    const parsed = parseIndexDocument(text);
    if (!parsed.ok) {
      entries = [];
      return { document: null, message: parsed.message };
    }
    entries = parsed.document.entries;
    return { document: parsed.document, message: null };
  }

  async function buildAndRead(): Promise<IndexLoad> {
    const outcome = await runScript(deps, 'build', []);
    const read = await machineIndex();
    return outcome.ok
      ? read
      : { document: read.document, message: outcome.message };
  }

  function startBuild(): Promise<IndexLoad> {
    const started = buildAndRead();
    runningBuild = started;
    const finished = () => {
      if (runningBuild === started) {
        runningBuild = null;
      }
    };
    started.then(finished, finished);
    return started;
  }

  function rebuild(): Promise<IndexLoad> {
    if (runningBuild === null) {
      return startBuild();
    }
    if (queuedBuild === null) {
      const startQueued = () => {
        queuedBuild = null;
        return startBuild();
      };
      queuedBuild = runningBuild.then(startQueued, startQueued);
    }
    return queuedBuild;
  }

  async function sessionIndex(spec: SessionSourceSpec): Promise<IndexLoad> {
    const run = sessionRun(spec);
    if (run === null) {
      return { document: null, message: NO_FOLDER_MESSAGE };
    }
    let outcome = await runScript(deps, run.command, [run.argument]);
    const fallbackDir = run.command === 'session' ? spec.projectDir : null;
    if (!outcome.ok && fallbackDir !== null) {
      deps.log(
        'docs',
        `session ${run.argument} not indexed (${outcome.message}); indexing ${fallbackDir} instead`,
      );
      outcome = await runScript(deps, 'context', [fallbackDir]);
    }
    if (!outcome.ok) {
      return { document: null, message: outcome.message };
    }
    const parsed = parseIndexDocument(outcome.stdout);
    if (!parsed.ok) {
      return { document: null, message: parsed.message };
    }
    sessionEntries.set(sessionKey(spec), parsed.document.entries);
    return { document: parsed.document, message: null };
  }

  function retainSessions(specs: readonly SessionSourceSpec[]): void {
    const kept = new Set(specs.map(sessionKey));
    for (const key of sessionEntries.keys()) {
      if (!kept.has(key)) {
        sessionEntries.delete(key);
      }
    }
  }

  return {
    machineIndex,
    rebuild,
    sessionIndex,
    retainSessions,
    loadedEntries: () => [entries, ...sessionEntries.values()].flat(),
  };
}

// One key per distinct source, so sessions sharing a source share its entries.
function sessionKey(spec: SessionSourceSpec): string {
  return JSON.stringify([spec.hostSessionId, spec.projectDir, spec.harness]);
}

// Codex sets no Claude session id, so a Codex session runs `context`; a relay
// that sends no harness is taken as Claude's.
function sessionRun(
  spec: SessionSourceSpec,
): { command: ScriptCommand; argument: string } | null {
  if (spec.hostSessionId !== null && spec.harness !== 'codex') {
    return { command: 'session', argument: spec.hostSessionId };
  }
  if (spec.projectDir !== null) {
    return { command: 'context', argument: spec.projectDir };
  }
  return null;
}

// Runs `python3 <script> <command> <args>`, logging what it wrote to stderr. A
// failed run's message is stderr's last non-empty line, where a traceback
// puts its cause.
async function runScript(
  deps: IndexSourcesDeps,
  command: ScriptCommand,
  args: string[],
): Promise<ScriptOutcome> {
  const script = await locateScript(
    deps.files,
    deps.homeDir,
    deps.scriptPath,
    deps.log,
  );
  if (script === null) {
    return { ok: false, message: NO_SCRIPT_MESSAGE };
  }
  let result;
  try {
    result = await deps.processes.run('python3', [script, command, ...args]);
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
  const stderr = result.stderr.trim();
  if (result.code !== 0) {
    deps.log(
      'docs',
      `docs_index.py ${command} exited ${result.code}: ${stderr}`,
    );
    return {
      ok: false,
      message: lastLine(stderr) ?? `docs_index.py exited ${result.code}`,
    };
  }
  if (stderr !== '') {
    deps.log('docs', `docs_index.py ${command} wrote to stderr: ${stderr}`);
  }
  return { ok: true, stdout: result.stdout };
}

function lastLine(text: string): string | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.at(-1) ?? null;
}
