import type { Disposable } from '../../../contracts/disposable';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { ProcessRunner } from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import {
  type IndexEntry,
  type IndexHarness,
  type IndexLoad,
  type IndexSource,
  MACHINE_SOURCE_ID,
  type SourceRead,
  sessionSourceId,
} from '../contract';
import { parseIndexDocument } from '../index-document';
import { locateScript } from './script-locator';

// The machine index `docs_index.py build` writes, under the home folder.
export const MACHINE_INDEX_FILE = '.agents/wigley-docs/index.json';

const NO_INDEX_MESSAGE = 'No docs index yet — building…';
const NO_SCRIPT_MESSAGE = 'docs_index.py not found — set docs.scriptPath';
const NO_FOLDER_MESSAGE = 'No project folder is known for this session';

type ScriptCommand = 'build' | 'session' | 'context';

// A script run's stdout, or the message the view shows when it failed;
// `isScriptMissing` when no `docs_index.py` was found to run.
type ScriptOutcome =
  | { ok: true; stdout: string }
  | { ok: false; message: string; isScriptMissing: boolean };

export interface IndexSourcesDeps {
  files: Files;
  processes: ProcessRunner;
  homeDir: string;
  // Read at each index run.
  scriptPath(): string;
  log: Log;
  paths: Paths;
}

export const MACHINE_SOURCE_TITLE = 'machine index';
export const SESSION_SOURCE_TITLE = 'session index';

export interface IndexSourceRegistry {
  // Throws on an id already registered. Disposing removes the source and its
  // kept entries.
  add(source: IndexSource): Disposable;
  // Each runs the source with `id` and, while no later run of that source has
  // started, keeps the entries of the document it gives; a result with no
  // document, or a throw, clears them. Each run resolves or rejects with its
  // own result, and rejects for an id not registered.
  load(id: string): Promise<SourceRead>;
  // Runs `rebuild`, or `load` for a source with none.
  rebuild(id: string): Promise<SourceRead>;
  // The kept entries of every registered source, in registration order.
  loadedEntries(): readonly IndexEntry[];
}

interface RegisteredSource {
  source: IndexSource;
  entries: readonly IndexEntry[];
  // The number of the newest run started on this record.
  newestRun: number;
}

export function createIndexSourceRegistry(): IndexSourceRegistry {
  // Iterates in registration order.
  const registered = new Map<string, RegisteredSource>();

  function add(source: IndexSource): Disposable {
    if (registered.has(source.id)) {
      throw new Error(`Docs index source ${source.id} is already registered`);
    }
    const record: RegisteredSource = { source, entries: [], newestRun: 0 };
    registered.set(source.id, record);
    return {
      dispose() {
        if (registered.get(source.id) === record) {
          registered.delete(source.id);
        }
      },
    };
  }

  // A load still running when its source is disposed writes to the removed
  // record, so its entries reach no `loadedEntries`. A run that settles after
  // a newer run of its source started leaves the entries to that newer run.
  async function run(
    id: string,
    read: (source: IndexSource) => Promise<IndexLoad>,
  ): Promise<SourceRead> {
    const record = registered.get(id);
    if (record === undefined) {
      throw new Error(`No docs index source ${id}`);
    }
    const { source } = record;
    record.newestRun += 1;
    const runNumber = record.newestRun;
    let load: IndexLoad;
    try {
      load = await read(source);
    } catch (error) {
      if (runNumber === record.newestRun) {
        record.entries = [];
      }
      throw error;
    }
    if (runNumber === record.newestRun) {
      record.entries = load.document?.entries ?? [];
    }
    return {
      ...load,
      title: source.title,
      canRebuild: source.rebuild !== undefined,
    };
  }

  return {
    add,
    load: (id) => run(id, (source) => source.load()),
    rebuild: (id) =>
      run(id, (source) =>
        source.rebuild !== undefined ? source.rebuild() : source.load(),
      ),
    loadedEntries: () =>
      [...registered.values()].flatMap((record) => record.entries),
  };
}

// `index.json` as it is on disk, rebuilt by `docs_index.py build`. A rebuild
// called while a build runs waits for one more build after it, which every
// such call shares.
export function createMachineSource(deps: IndexSourcesDeps): IndexSource {
  const indexFile = deps.paths.join(deps.homeDir, MACHINE_INDEX_FILE);
  let runningBuild: Promise<IndexLoad> | null = null;
  let queuedBuild: Promise<IndexLoad> | null = null;

  async function read(): Promise<IndexLoad> {
    const text = await readIfPresent(deps.files, indexFile);
    if (text === null) {
      return { document: null, message: NO_INDEX_MESSAGE };
    }
    const parsed = parseIndexDocument(text);
    if (!parsed.ok) {
      return { document: null, message: parsed.message };
    }
    return { document: parsed.document, message: null };
  }

  async function buildAndRead(): Promise<IndexLoad> {
    const outcome = await runScript(deps, 'build', []);
    const load = await read();
    return outcome.ok
      ? load
      : { document: load.document, message: outcome.message };
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

  return {
    id: MACHINE_SOURCE_ID,
    title: MACHINE_SOURCE_TITLE,
    load: read,
    rebuild,
  };
}

// What a session's index source reads for, built from the
// `sessions.connected` payload's `info`.
export interface SessionSourceSpec {
  hostSessionId: string | null;
  projectDir: string | null;
  harness: IndexHarness | null;
}

// A fresh index for one session on each load. A Claude session whose
// `session` run fails, as before its transcript exists, falls back to
// `context` on its project folder, unless no script was found to run.
export function createSessionSource(
  deps: IndexSourcesDeps,
  sessionId: string,
  spec: SessionSourceSpec,
): IndexSource {
  return {
    id: sessionSourceId(sessionId),
    title: SESSION_SOURCE_TITLE,
    load: () => sessionIndex(deps, spec),
  };
}

async function sessionIndex(
  deps: IndexSourcesDeps,
  spec: SessionSourceSpec,
): Promise<IndexLoad> {
  const run = sessionRun(spec);
  if (run === null) {
    return { document: null, message: NO_FOLDER_MESSAGE };
  }
  let outcome = await runScript(deps, run.command, [run.argument]);
  const fallbackDir = run.command === 'session' ? spec.projectDir : null;
  if (!outcome.ok && !outcome.isScriptMissing && fallbackDir !== null) {
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
  return { document: parsed.document, message: null };
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

// Runs `python3 -X utf8 <script> <command> <args>`, logging what it wrote to
// stderr. UTF-8 mode lets the script print the index's `→` to a Windows
// console's cp1252 pipe. A failed run's message is stderr's last non-empty
// line, where a traceback puts its cause.
async function runScript(
  deps: IndexSourcesDeps,
  command: ScriptCommand,
  args: string[],
): Promise<ScriptOutcome> {
  const script = await locateScript(
    deps.files,
    deps.homeDir,
    deps.scriptPath(),
    deps.log,
    deps.paths,
  );
  if (script === null) {
    return { ok: false, message: NO_SCRIPT_MESSAGE, isScriptMissing: true };
  }
  let result;
  try {
    result = await deps.processes.run('python3', [
      '-X',
      'utf8',
      script,
      command,
      ...args,
    ]);
  } catch (error) {
    return { ok: false, message: errorText(error), isScriptMissing: false };
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
      isScriptMissing: false,
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
