import type { Disposable } from '../../../contracts/disposable';
import {
  type Files,
  type FileStat,
  isMissingFile,
  readIfPresent,
} from '../../../contracts/files';
import type { Git, GitCommit } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { BacklogStaleness, RowKey } from '../contract';
import type { BacklogRow } from './rows';

// How many of the newest commits touching a row's named paths are read.
export const STALENESS_LOG_LIMIT = 100;

const STALENESS_FILE = 'staleness.json';
// A pass sends what it read after this many rows.
const SEND_EVERY = 10;
const FENCE = '```';
const BACKTICK = '`';
// A trailing `:12`, `:12:5` or `:12-20`.
const LINE_REFERENCE = /(:\d+)+(-\d+)?$/;
const NOT_PATH_CHARACTER = /[\s:<>*?{}[\]()$=,|'"#]/;
const NOT_PATH_STARTS = ['/', '~', '-', '..'];
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,6}$/;
const SECTION_HEADING = '## ';
// What follows a title in its line and stays with it: bold marks, and a
// list-shaped title's closing `:` or `.`.
const ANCHOR_TAIL = '*:.';

// Reads each open row's staleness through git, caching the git facts in
// plugin data under both clones' HEADs and the row's text.
export interface StalenessReader extends Disposable {
  // Stats the named paths of every open row, then resolves to the entries of
  // the open rows a valid cached entry gives, and queues the rest. One pass
  // reads the queue a row at a time, sending what it read after every ten
  // rows and when the queue empties, and writing `staleness.json` at each
  // send. A row queued again during the pass is read once, as its newest
  // call gave it. A row whose git call rejected is logged, sent, and left out
  // of `staleness.json`, so the next call queues it again.
  read(rows: readonly BacklogRow[]): Promise<Record<RowKey, BacklogStaleness>>;
  // The commits after the row was written that touched a path it names,
  // newest first, read now; `[]` when the row has no written commit, no repo
  // clone or no named paths. Rejects with git's error, or the error resolving
  // a path that is there.
  commitsSince(row: BacklogRow): Promise<GitCommit[]>;
  // Every entry read or cached in this run.
  entries(): Record<RowKey, BacklogStaleness>;
}

// `data` is the plugin's data folder; `send` gets each pass's batches.
export interface StalenessDeps {
  git: Pick<Git, 'topLevel' | 'resolveCommit' | 'log' | 'firstAdded'>;
  files: Pick<Files, 'stat' | 'read' | 'realPath'>;
  data: Pick<Files, 'read' | 'write'>;
  paths: Paths;
  log: PluginLog;
  send(entries: Record<RowKey, BacklogStaleness>): void;
}

type StalenessFacts = Pick<
  BacklogStaleness,
  'writtenAt' | 'commitsSince' | 'lastCommit'
>;

// One `staleness.json` entry: the facts read under `heads` (the repo clone's
// HEAD, a space, the home clone's) for the row whose one line and body were
// `body`.
interface StoredEntry {
  heads: string;
  body: string;
  facts: StalenessFacts;
}

const NO_FACTS: StalenessFacts = {
  writtenAt: null,
  commitsSince: 0,
  lastCommit: null,
};

type FoundPaths = Pick<BacklogStaleness, 'namedPaths' | 'gonePaths'>;

// The row's follow-up file and repo folder with every link resolved, as git
// spells paths below a clone; the clone holding the row's home, and the one
// holding its repo folder.
interface RowClones {
  file: string;
  repoFolder: string | null;
  homeClone: string | null;
  repoClone: string | null;
}

// A row as one `read` call found it: its clones with their heads, or the
// error finding them gave.
interface QueuedRow {
  row: BacklogRow;
  found: FoundPaths;
  clones: (RowClones & { heads: string }) | { error: unknown };
}

// The commit that wrote a row, and the commits since that touched a path it
// names, newest first.
interface RowHistory {
  written: GitCommit | null;
  since: GitCommit[];
}

// One read call's lookups, each run once per argument.
interface Lookups {
  topLevel(folder: string | null): Promise<string | null>;
  // The clone's HEAD sha; '' for no clone or no commit.
  head(clone: string | null): Promise<string>;
  stat(path: string): Promise<FileStat | null>;
  // `path` with every link resolved; `path` itself when nothing is there.
  realPath(path: string): Promise<string>;
}

// The candidate between a pair of backticks as a repo path; null when it is
// no path.
function pathOf(candidate: string): string | null {
  let path = candidate.replace(LINE_REFERENCE, '');
  if (path.startsWith('./')) {
    path = path.slice(2);
  }
  if (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  const isNoPath =
    path === '' ||
    NOT_PATH_CHARACTER.test(path) ||
    NOT_PATH_STARTS.some((start) => path.startsWith(start));
  const isPathShaped = path.includes('/') || FILE_EXTENSION.test(path);
  return !isNoPath && isPathShaped ? path : null;
}

// The texts between each pair of single backticks in `line`.
function backtickSpans(line: string): string[] {
  const parts = line.split(BACKTICK);
  return parts.filter((_, index) => {
    const isAfterOpening = index % 2 === 1;
    const isClosed = index < parts.length - 1;
    return isAfterOpening && isClosed;
  });
}

// The repo paths `text` names between backticks, outside fenced code, each
// once in first-seen order: a candidate with a trailing line reference, a
// leading `./` and a trailing `/` stripped, kept when it holds a `/` or ends
// in a file extension, and holds no space, `:`, glob, bracket or quote, and
// starts with none of `/`, `~`, `-` or `..`.
export function namedPaths(text: string): string[] {
  const kept = new Set<string>();
  let isInFence = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith(FENCE)) {
      isInFence = !isInFence;
      continue;
    }
    if (isInFence) {
      continue;
    }
    for (const span of backtickSpans(line)) {
      const path = pathOf(span);
      if (path !== null) {
        kept.add(path);
      }
    }
  }
  return [...kept];
}

// The text of the follow-up file's `line` that `Git.firstAdded` searches for
// the item titled `title`: the title with the bold marks around it, a `## `
// heading's marker, and its closing `:` or `.`, ending in a newline when it
// ends the line, a trailing `\r` dropped first. A list marker is left out.
// `title` when the line does not hold it.
export function itemAnchor(fileLine: string, title: string): string {
  const line = fileLine.endsWith('\r') ? fileLine.slice(0, -1) : fileLine;
  const at = line.indexOf(title);
  if (at < 0) {
    return title;
  }
  let start = at;
  while (start > 0 && line[start - 1] === '*') {
    start -= 1;
  }
  if (line.slice(0, start) === SECTION_HEADING) {
    start = 0;
  }
  let end = at + title.length;
  while (end < line.length && ANCHOR_TAIL.includes(line[end])) {
    end += 1;
  }
  const anchor = line.slice(start, end);
  return end === line.length ? `${anchor}\n` : anchor;
}

// First match wins: a gone path, a commit since, no written date, else fresh.
export function stalenessOf(facts: {
  gonePaths: readonly string[];
  commitsSince: number;
  writtenAt: string | null;
}): BacklogStaleness['level'] {
  if (facts.gonePaths.length > 0) {
    return 'stale';
  }
  if (facts.commitsSince > 0) {
    return 'moved';
  }
  return facts.writtenAt === null ? 'unknown' : 'fresh';
}

// `load` run once per key; later calls share the first call's promise.
function onceEach<T>(
  load: (key: string) => Promise<T>,
): (key: string) => Promise<T> {
  const loaded = new Map<string, Promise<T>>();
  return (key) => {
    let value = loaded.get(key);
    if (value === undefined) {
      value = load(key);
      loaded.set(key, value);
    }
    return value;
  };
}

function createLookups(
  git: StalenessDeps['git'],
  files: StalenessDeps['files'],
): Lookups {
  const topLevel = onceEach((folder) => git.topLevel(folder));
  const head = onceEach(
    async (clone) => (await git.resolveCommit(clone, 'HEAD')) ?? '',
  );
  return {
    topLevel: async (folder) => (folder === null ? null : topLevel(folder)),
    head: async (clone) => (clone === null ? '' : head(clone)),
    stat: onceEach((path) => files.stat(path)),
    realPath: onceEach(async (path) => {
      try {
        return await files.realPath(path);
      } catch (error) {
        if (isMissingFile(error)) {
          return path;
        }
        throw error;
      }
    }),
  };
}

// The text a row's paths and cache entry are read from.
function rowText(row: BacklogRow): string {
  return `${row.oneLine}\n${row.body}`;
}

// The row's named paths whose first segment its repo folder holds, and those
// of them missing from it; none when the row has no repo folder.
async function foundPaths(
  row: BacklogRow,
  lookups: Lookups,
  paths: Paths,
): Promise<FoundPaths> {
  const { repoFolder } = row;
  const found: FoundPaths = { namedPaths: [], gonePaths: [] };
  if (repoFolder === null) {
    return found;
  }
  for (const candidate of namedPaths(rowText(row))) {
    const [firstSegment] = candidate.split('/');
    const first = await lookups.stat(paths.join(repoFolder, firstSegment));
    if (first === null) {
      continue;
    }
    found.namedPaths.push(candidate);
    if ((await lookups.stat(paths.join(repoFolder, candidate))) === null) {
      found.gonePaths.push(candidate);
    }
  }
  return found;
}

async function rowClones(
  row: BacklogRow,
  lookups: Lookups,
): Promise<RowClones> {
  const [file, homeRoot, repoFolder] = await Promise.all([
    lookups.realPath(row.path),
    lookups.realPath(row.homeRoot),
    row.repoFolder === null ? null : lookups.realPath(row.repoFolder),
  ]);
  const [homeClone, repoClone] = await Promise.all([
    lookups.topLevel(homeRoot),
    lookups.topLevel(repoFolder),
  ]);
  return { file, repoFolder, homeClone, repoClone };
}

// Logs that `path` is not below `clone`, which git gave as holding it.
function logNotBelow(
  log: PluginLog,
  row: BacklogRow,
  path: string,
  clone: string,
): void {
  log(`staleness of ${row.title}: ${path} is not below its clone ${clone}`);
}

// The anchor of the row's line in its follow-up file as `readText` gives it
// now; the title when the file cannot be read or is shorter.
async function anchorOf(
  row: BacklogRow,
  readText: (path: string) => Promise<string>,
): Promise<string> {
  let text: string;
  try {
    text = await readText(row.path);
  } catch {
    return row.title;
  }
  const line = text.split('\n')[row.line - 1];
  return line === undefined ? row.title : itemAnchor(line, row.title);
}

// The oldest commit that added the row's anchor to its file, or its title
// when no commit added the anchor; null outside a clone, and, logged, when
// the file is not below its clone.
async function writtenCommit(
  deps: Pick<StalenessDeps, 'git' | 'paths' | 'log'>,
  row: BacklogRow,
  clones: RowClones,
  readText: (path: string) => Promise<string>,
): Promise<GitCommit | null> {
  const { file, homeClone } = clones;
  if (homeClone === null) {
    return null;
  }
  const below = deps.paths.segmentsBelow(file, homeClone);
  if (below === null) {
    logNotBelow(deps.log, row, file, homeClone);
    return null;
  }
  const file = below.join('/');
  const anchor = await anchorOf(row, readText);
  const written = await deps.git.firstAdded(homeClone, file, anchor);
  const triesTitle = written === null && anchor !== row.title;
  return triesTitle ? deps.git.firstAdded(homeClone, file, row.title) : written;
}

// The commits strictly later than `written`, by committer date, that touched
// a named path, of the newest STALENESS_LOG_LIMIT; each path below the repo
// folder's clone. None, logged, when the repo folder is not below its clone.
async function commitsAfter(
  deps: Pick<StalenessDeps, 'git' | 'paths' | 'log'>,
  row: BacklogRow,
  written: GitCommit,
  repoFolder: string,
  repoClone: string,
  named: readonly string[],
): Promise<GitCommit[]> {
  const prefix = deps.paths.segmentsBelow(repoFolder, repoClone);
  if (prefix === null) {
    logNotBelow(deps.log, row, repoFolder, repoClone);
    return [];
  }
  if (named.length === 0) {
    return [];
  }
  const logPaths = named.map((path) => [...prefix, path].join('/'));
  const commits = await deps.git.log(repoClone, logPaths, STALENESS_LOG_LIMIT);
  const writtenTime = Date.parse(written.at);
  return commits.filter((commit) => {
    const isLater = Date.parse(commit.at) > writtenTime;
    const isOtherCommit = commit.sha !== written.sha;
    return isLater && isOtherCommit;
  });
}

async function rowHistory(
  deps: Pick<StalenessDeps, 'git' | 'paths' | 'log'>,
  row: BacklogRow,
  clones: RowClones,
  named: readonly string[],
  readText: (path: string) => Promise<string>,
): Promise<RowHistory> {
  const written = await writtenCommit(deps, row, clones, readText);
  const { repoFolder, repoClone } = clones;
  const hasRepoHistory =
    written !== null && repoClone !== null && repoFolder !== null;
  if (!hasRepoHistory) {
    return { written, since: [] };
  }
  return {
    written,
    since: await commitsAfter(
      deps,
      row,
      written,
      repoFolder,
      repoClone,
      named,
    ),
  };
}

function factsOf(history: RowHistory): StalenessFacts {
  return {
    writtenAt: history.written?.at ?? null,
    commitsSince: history.since.length,
    lastCommit: history.since[0] ?? null,
  };
}

function stalenessFrom(
  facts: StalenessFacts,
  found: FoundPaths,
): BacklogStaleness {
  return {
    ...facts,
    namedPaths: found.namedPaths,
    gonePaths: found.gonePaths,
    level: stalenessOf({
      gonePaths: found.gonePaths,
      commitsSince: facts.commitsSince,
      writtenAt: facts.writtenAt,
    }),
  };
}

// The cached entry that still holds for the row as `queued` found it; null
// when none does.
function validEntry(
  cached: StoredEntry | undefined,
  queued: QueuedRow,
): StoredEntry | null {
  const { clones } = queued;
  if (cached === undefined) {
    return null;
  }
  if ('error' in clones) {
    return null;
  }
  const isSameHeads = cached.heads === clones.heads;
  const isSameBody = cached.body === rowText(queued.row);
  return isSameHeads && isSameBody ? cached : null;
}

// `staleness.json`'s entries; none, logged, when it is unreadable.
async function readStored(
  data: StalenessDeps['data'],
  log: PluginLog,
): Promise<Map<RowKey, StoredEntry>> {
  try {
    const text = await readIfPresent(data, STALENESS_FILE);
    if (text === null) {
      return new Map();
    }
    const { entries } = JSON.parse(text) as { entries: unknown };
    if (typeof entries !== 'object' || entries === null) {
      throw new Error(`${STALENESS_FILE} holds no entries`);
    }
    return new Map(Object.entries(entries as Record<RowKey, StoredEntry>));
  } catch {
    log(`${STALENESS_FILE} unreadable; reading every row`);
    return new Map();
  }
}

// The reader over `deps`. After `dispose` the pass stops before its next row,
// the queue is dropped, and nothing is sent or written again; a `read` then
// resolves its cached entries and queues nothing.
export function createStalenessReader(deps: StalenessDeps): StalenessReader {
  const { git, files, data, paths, log, send } = deps;
  let stored: Promise<Map<RowKey, StoredEntry>> | null = null;
  const known = new Map<RowKey, BacklogStaleness>();
  // Insertion order is read order; a key queued again keeps its place.
  const queue = new Map<RowKey, QueuedRow>();
  // Read since the last send.
  const unsent = new Map<RowKey, BacklogStaleness>();
  // The keys of the last `read` call's rows: a write keeps only these.
  let writtenKeys = new Set<RowKey>();
  let isPassRunning = false;
  let isDisposed = false;

  function storedEntries(): Promise<Map<RowKey, StoredEntry>> {
    stored ??= readStored(data, log);
    return stored;
  }

  async function queuedRow(
    row: BacklogRow,
    lookups: Lookups,
  ): Promise<QueuedRow> {
    let found: FoundPaths = { namedPaths: [], gonePaths: [] };
    try {
      found = await foundPaths(row, lookups, paths);
      const clones = await rowClones(row, lookups);
      const [repoHead, homeHead] = await Promise.all([
        lookups.head(clones.repoClone),
        lookups.head(clones.homeClone),
      ]);
      const heads = `${repoHead} ${homeHead}`;
      return { row, found, clones: { ...clones, heads } };
    } catch (error) {
      return { row, found, clones: { error } };
    }
  }

  // The row's staleness, and its entry for `staleness.json`; no entry when a
  // git call rejected.
  async function readQueued(
    queued: QueuedRow,
    readText: (path: string) => Promise<string>,
  ): Promise<{ staleness: BacklogStaleness; entry: StoredEntry | null }> {
    const { row, found, clones } = queued;
    const failed = (error: unknown) => {
      log(`staleness of ${row.title}: ${errorText(error)}`);
      return { staleness: stalenessFrom(NO_FACTS, found), entry: null };
    };
    if ('error' in clones) {
      return failed(clones.error);
    }
    try {
      const history = await rowHistory(
        deps,
        row,
        clones,
        found.namedPaths,
        readText,
      );
      const facts = factsOf(history);
      return {
        staleness: stalenessFrom(facts, found),
        entry: { heads: clones.heads, body: rowText(row), facts },
      };
    } catch (error) {
      return failed(error);
    }
  }

  // Writes the cache, keeping only the last call's keys, then sends what was
  // read since the last send.
  async function flush(cache: Map<RowKey, StoredEntry>): Promise<void> {
    if (isDisposed) {
      return;
    }
    for (const key of cache.keys()) {
      if (!writtenKeys.has(key)) {
        cache.delete(key);
      }
    }
    try {
      await data.write(
        STALENESS_FILE,
        JSON.stringify({ entries: Object.fromEntries(cache) }),
      );
    } catch (error) {
      log(`${STALENESS_FILE} not written: ${errorText(error)}`);
    }
    const hasToSend = !isDisposed && unsent.size > 0;
    if (!hasToSend) {
      return;
    }
    send(Object.fromEntries(unsent));
    unsent.clear();
  }

  function takeQueued(): QueuedRow | null {
    const next = queue.entries().next();
    if (next.done === true) {
      return null;
    }
    const [key, queued] = next.value;
    queue.delete(key);
    return queued;
  }

  async function runPass(): Promise<void> {
    const cache = await storedEntries();
    const readText = onceEach((path) => files.read(path));
    let readSinceSend = 0;
    for (
      let queued = takeQueued();
      queued !== null && !isDisposed;
      queued = takeQueued()
    ) {
      const { staleness, entry } = await readQueued(queued, readText);
      if (isDisposed) {
        return;
      }
      const { key } = queued.row;
      known.set(key, staleness);
      unsent.set(key, staleness);
      if (entry !== null) {
        cache.set(key, entry);
      }
      readSinceSend += 1;
      if (readSinceSend === SEND_EVERY) {
        readSinceSend = 0;
        await flush(cache);
      }
    }
    if (unsent.size > 0) {
      await flush(cache);
    }
  }

  function startPass(): void {
    const canStart = !isPassRunning && !isDisposed && queue.size > 0;
    if (!canStart) {
      return;
    }
    isPassRunning = true;
    runPass()
      .catch((error: unknown) =>
        log(`staleness pass stopped: ${errorText(error)}`),
      )
      .finally(() => {
        isPassRunning = false;
        startPass();
      });
  }

  async function read(
    rows: readonly BacklogRow[],
  ): Promise<Record<RowKey, BacklogStaleness>> {
    writtenKeys = new Set(rows.map((row) => row.key));
    const cache = await storedEntries();
    const lookups = createLookups(git, files);
    const open = rows.filter((row) => !row.done);
    const queuedRows = await Promise.all(
      open.map((row) => queuedRow(row, lookups)),
    );
    const cached: Record<RowKey, BacklogStaleness> = {};
    for (const queued of queuedRows) {
      const { key } = queued.row;
      const entry = validEntry(cache.get(key), queued);
      if (entry === null) {
        if (!isDisposed) {
          queue.set(key, queued);
        }
        continue;
      }
      queue.delete(key);
      const staleness = stalenessFrom(entry.facts, queued.found);
      cached[key] = staleness;
      known.set(key, staleness);
    }
    startPass();
    return cached;
  }

  async function commitsSince(row: BacklogRow): Promise<GitCommit[]> {
    const lookups = createLookups(git, files);
    const found = await foundPaths(row, lookups, paths);
    const clones = await rowClones(row, lookups);
    const readText = (path: string) => files.read(path);
    const history = await rowHistory(
      deps,
      row,
      clones,
      found.namedPaths,
      readText,
    );
    return history.since;
  }

  return {
    read,
    commitsSince,
    entries: () => Object.fromEntries(known),
    dispose() {
      isDisposed = true;
      queue.clear();
    },
  };
}
