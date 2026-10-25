import { createHash } from 'node:crypto';
import type { Files } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { ProcessRunner } from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import type {
  CloneStatus,
  FileStatus,
  IndexEntry,
  IndexHarness,
  InstalledCopy,
  PluginStatusRead,
} from '../contract';
import { installedCopies, metaString } from '../index-document';

const FETCH_TIMEOUT_MS = 15000;

const HARNESS_ORDER: readonly IndexHarness[] = ['claude', 'codex'];

export interface PluginStatusDeps {
  processes: ProcessRunner;
  files: Files;
  paths: Paths;
  log: Log;
}

// A marketplace clone: one `root`, and the index entries merged into it.
interface Clone {
  root: string;
  merged: IndexEntry[];
}

// The statuses one clone has set so far, by entry id.
interface StatusMarks {
  uncommitted: Set<string>;
  unpushed: Set<string>;
  notInstalled: Map<string, IndexHarness[]>;
}

// Each clone root's fetch while it runs; a read asking to fetch that root
// meanwhile shares its result.
const runningFetches: { root: string; failed: Promise<boolean> }[] = [];

// The git statuses of every marketplace clone among `entries`, in the order
// each clone's root first appears. Clones run in parallel, the git commands
// of one clone in sequence. With `fetch`, each clone first runs `git fetch`,
// capped at 15 s; `fetchFailed` reports that fetch alone. Any other git
// failure stops that clone's statuses where they stand and logs
// `plugin status <root>: <reason>` under `docs`; it never rejects the read.
export async function readPluginStatus(
  entries: readonly IndexEntry[],
  deps: PluginStatusDeps,
  options: { fetch: boolean },
): Promise<PluginStatusRead> {
  const clones = clonesOf(entries, deps.paths);
  return {
    clones: await Promise.all(
      clones.map((clone) => readClone(clone, entries, deps, options.fetch)),
    ),
  };
}

function clonesOf(entries: readonly IndexEntry[], paths: Paths): Clone[] {
  const clones: Clone[] = [];
  for (const entry of entries) {
    const root = entry.root;
    if (root === null || installedCopies(entry) === null) {
      continue;
    }
    const clone = clones.find((known) => paths.samePath(known.root, root));
    if (clone === undefined) {
      clones.push({ root, merged: [entry] });
    } else {
      clone.merged.push(entry);
    }
  }
  return clones;
}

async function readClone(
  clone: Clone,
  entries: readonly IndexEntry[],
  deps: PluginStatusDeps,
  fetch: boolean,
): Promise<CloneStatus> {
  const marks: StatusMarks = {
    uncommitted: new Set(),
    unpushed: new Set(),
    notInstalled: new Map(),
  };
  const fetchFailed = fetch ? await sharedFetch(clone.root, deps) : false;
  try {
    await markStatuses(clone, entries, deps, marks);
  } catch (error) {
    deps.log('docs', `plugin status ${clone.root}: ${errorText(error)}`);
  }
  return {
    root: clone.root,
    fetchedAt: await readFetchedAt(clone.root, deps),
    fetchFailed,
    files: filesOf(clone.merged, marks),
  };
}

// Whether the clone's fetch failed: a non-zero exit, the cap passed, or git
// not starting. Never rejects.
function sharedFetch(root: string, deps: PluginStatusDeps): Promise<boolean> {
  const running = runningFetches.find((fetch) =>
    deps.paths.samePath(fetch.root, root),
  );
  if (running !== undefined) {
    return running.failed;
  }
  const record = { root, failed: runFetch(root, deps) };
  runningFetches.push(record);
  const finished = () => {
    runningFetches.splice(runningFetches.indexOf(record), 1);
  };
  void record.failed.then(finished);
  return record.failed;
}

async function runFetch(
  root: string,
  deps: PluginStatusDeps,
): Promise<boolean> {
  try {
    const result = await deps.processes.run(
      'git',
      ['-C', root, 'fetch', '--quiet'],
      { timeoutMs: FETCH_TIMEOUT_MS },
    );
    return result.code !== 0 || result.timedOut;
  } catch {
    return true;
  }
}

// Marks uncommitted files; with an upstream, then unpushed and not-installed
// files. Throws on the first git run that cannot start or that fails.
async function markStatuses(
  clone: Clone,
  entries: readonly IndexEntry[],
  deps: PluginStatusDeps,
  marks: StatusMarks,
): Promise<void> {
  const { root } = clone;
  const scope = scopeOf(clone, deps.paths);
  const upstream = await deps.processes.run('git', [
    '-C',
    root,
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ]);
  const hasUpstream = upstream.code === 0;
  const status = await gitOutput(deps, 'status', [
    '-C',
    root,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    scope,
  ]);
  for (const path of porcelainPaths(status)) {
    markEntriesAt(clone, path, deps.paths, marks.uncommitted);
  }
  if (!hasUpstream) {
    return;
  }
  const diff = await gitOutput(deps, 'diff', [
    '-C',
    root,
    'diff',
    '--name-only',
    '-z',
    '@{u}...HEAD',
    '--',
    scope,
  ]);
  for (const path of nulFields(diff)) {
    markEntriesAt(clone, path, deps.paths, marks.unpushed);
  }
  const tree = await gitOutput(deps, 'ls-tree', [
    '-C',
    root,
    'ls-tree',
    '-r',
    '-z',
    '@{u}',
    '--',
    scope,
  ]);
  const upstreamBlobs = upstreamBlobsOf(clone, tree, deps.paths);
  for (const entry of clone.merged) {
    const notInstalled = await harnessesNotInstalled(
      entry,
      entries,
      upstreamBlobs.get(entry.id) ?? null,
      deps.files,
    );
    if (notInstalled.length > 0) {
      marks.notInstalled.set(entry.id, notInstalled);
    }
  }
}

// The stdout of a git run; throws when it cannot start or exits non-zero.
async function gitOutput(
  deps: PluginStatusDeps,
  name: string,
  args: string[],
): Promise<string> {
  const result = await deps.processes.run('git', args);
  if (result.code !== 0) {
    throw new Error(
      `git ${name} exited ${String(result.code)}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

// The merged entries' common folder as a pathspec below root; `.` for root
// itself or a folder not inside it.
function scopeOf(clone: Clone, paths: Paths): string {
  const folder = paths.commonFolder(clone.merged.map((entry) => entry.path));
  const segments =
    folder === null ? null : paths.segmentsBelow(folder, clone.root);
  return segments === null || segments.length === 0 ? '.' : segments.join('/');
}

function nulFields(output: string): string[] {
  return output.split('\0').filter((field) => field !== '');
}

// Every path a `status --porcelain=v1 -z` output names: each record is
// `XY <path>`, and a rename or copy (`R` or `C` in either column) is followed
// by the original path, which is named too.
function porcelainPaths(output: string): string[] {
  const fields = nulFields(output);
  const named: string[] = [];
  let index = 0;
  while (index < fields.length) {
    const record = fields[index];
    named.push(record.slice(3));
    const isRenameOrCopy = /[RC]/.test(record.slice(0, 2));
    if (isRenameOrCopy && index + 1 < fields.length) {
      named.push(fields[index + 1]);
      index += 1;
    }
    index += 1;
  }
  return named;
}

// Adds to `marked` the id of each merged entry at `gitPath` below root, so
// every hook entry of one `hooks.json` shares the file's status.
function markEntriesAt(
  clone: Clone,
  gitPath: string,
  paths: Paths,
  marked: Set<string>,
): void {
  for (const entry of entriesAt(clone, gitPath, paths)) {
    marked.add(entry.id);
  }
}

function entriesAt(clone: Clone, gitPath: string, paths: Paths): IndexEntry[] {
  const full = paths.join(clone.root, gitPath);
  return clone.merged.filter((entry) => paths.samePath(entry.path, full));
}

// Merged entry id → its upstream blob sha, from `ls-tree -r -z` records
// `<mode> <type> <sha>\t<path>`; only blobs count.
function upstreamBlobsOf(
  clone: Clone,
  output: string,
  paths: Paths,
): Map<string, string> {
  const blobs = new Map<string, string>();
  for (const record of nulFields(output)) {
    const tab = record.indexOf('\t');
    if (tab === -1) {
      continue;
    }
    const [, type, sha] = record.slice(0, tab).split(' ');
    if (type !== 'blob') {
      continue;
    }
    for (const entry of entriesAt(clone, record.slice(tab + 1), paths)) {
      blobs.set(entry.id, sha);
    }
  }
  return blobs;
}

// The harnesses the entry's plugin is installed for whose copies do not all
// match the upstream blob, in `HARNESS_ORDER`; every one of them when the
// file is absent upstream.
async function harnessesNotInstalled(
  entry: IndexEntry,
  entries: readonly IndexEntry[],
  upstreamSha: string | null,
  files: Files,
): Promise<IndexHarness[]> {
  const copies = installedCopies(entry) ?? [];
  const notInstalled: IndexHarness[] = [];
  for (const harness of pluginHarnesses(entry.plugin, entries)) {
    const harnessCopies = copies.filter((copy) => copy.harness === harness);
    const isInstalled =
      upstreamSha !== null &&
      harnessCopies.length > 0 &&
      (await allCopiesMatch(harnessCopies, upstreamSha, files));
    if (!isInstalled) {
      notInstalled.push(harness);
    }
  }
  return notInstalled;
}

// The `meta.harness` of each `plugin` entry for `plugin`, in `HARNESS_ORDER`.
function pluginHarnesses(
  plugin: string | null,
  entries: readonly IndexEntry[],
): IndexHarness[] {
  if (plugin === null) {
    return [];
  }
  const named = entries
    .filter((entry) => entry.kind === 'plugin' && entry.plugin === plugin)
    .map((entry) => metaString(entry, 'harness'));
  return HARNESS_ORDER.filter((harness) => named.includes(harness));
}

async function allCopiesMatch(
  copies: readonly InstalledCopy[],
  upstreamSha: string,
  files: Files,
): Promise<boolean> {
  for (const copy of copies) {
    if (!(await copyMatches(copy, upstreamSha, files))) {
      return false;
    }
  }
  return true;
}

// A copy matches when its bytes, or those bytes with CRLF turned to LF, hash
// to the upstream blob. A copy that cannot be read does not match.
async function copyMatches(
  copy: InstalledCopy,
  upstreamSha: string,
  files: Files,
): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = await files.readBytes(copy.path);
  } catch {
    return false;
  }
  return (
    blobId(bytes) === upstreamSha ||
    blobId(withLfEndings(bytes)) === upstreamSha
  );
}

// Git's blob id: the hex sha1 of `blob <byte length>\0` and the bytes.
function blobId(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest('hex');
}

function withLfEndings(bytes: Uint8Array): Uint8Array {
  const CR = 0x0d;
  const LF = 0x0a;
  return bytes.filter(
    (byte, index) => !(byte === CR && bytes[index + 1] === LF),
  );
}

// The modified time of the clone's `FETCH_HEAD` (ISO); null when git cannot
// say where it is or the file is absent.
async function readFetchedAt(
  root: string,
  deps: PluginStatusDeps,
): Promise<string | null> {
  try {
    const result = await deps.processes.run('git', [
      '-C',
      root,
      'rev-parse',
      '--git-path',
      'FETCH_HEAD',
    ]);
    if (result.code !== 0) {
      return null;
    }
    const gitPath = result.stdout.trim();
    const fetchHead = deps.paths.isAbsolute(gitPath)
      ? gitPath
      : deps.paths.join(root, gitPath);
    return new Date(await deps.files.modified(fetchHead)).toISOString();
  } catch {
    return null;
  }
}

// Each merged entry with a status set, in merged order.
function filesOf(
  merged: readonly IndexEntry[],
  marks: StatusMarks,
): Record<string, FileStatus> {
  const files: Record<string, FileStatus> = {};
  for (const entry of merged) {
    const status: FileStatus = {
      uncommitted: marks.uncommitted.has(entry.id),
      unpushed: marks.unpushed.has(entry.id),
      notInstalled: marks.notInstalled.get(entry.id) ?? [],
    };
    const hasStatus =
      status.uncommitted || status.unpushed || status.notInstalled.length > 0;
    if (hasStatus) {
      files[entry.id] = status;
    }
  }
  return files;
}
