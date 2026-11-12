import type { Clock, RandomHex } from '../../../contracts/ambient';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { isSameJson } from '../../../shared/json';
import { createSerialQueue } from '../../../shared/serial-queue';
import type { BacklogChunk, ChunkEdit, RowKey } from '../contract';
import type { BacklogRow } from './rows';

const CHUNKS_FILE = 'chunks.json';

// One chunk `replaceUnstarted` makes.
export interface ChunkPlan {
  name: string;
  titles: string[];
}

// Backlog's chunks, kept in `chunks.json` in its plugin data as
// `{ "chunks": [...] }` in strip order; the one writer of chunks. Every call
// runs after the one before it settles. A call that changes the list writes
// the file, then calls `changed`; a refused call rejects with its reason and
// writes and sends nothing. `edit`, `replaceUnstarted` and `retireUnheld`
// first retire each started chunk whose session chat no longer holds, asking
// only once chat's restore settled. A chunk marked starting is left alone:
// `edit` refuses every change to it (`<name> is starting`), and
// `replaceUnstarted` and `prune` keep it.
export interface ChunkStore {
  // The chunks, a missing or unreadable file reading as none.
  chunks(): Promise<BacklogChunk[]>;
  // Applies `edit`; resolves to the chunks after it.
  edit(edit: ChunkEdit): Promise<BacklogChunk[]>;
  // Replaces `repo`'s unstarted chunks with one chunk per plan, appended in
  // order; `titles` is every title of the repo's rows. A plan named as an
  // unstarted chunk it replaces keeps that chunk's id and headless flag.
  replaceUnstarted(
    repo: string,
    plans: readonly ChunkPlan[],
    titles: ReadonlySet<string>,
  ): Promise<BacklogChunk[]>;
  // Marks the chunk starting and resolves to it; rejects with `No chunk <id>`,
  // `<name> has started` or `<name> is starting`, marking nothing.
  markStarting(chunkId: string): Promise<BacklogChunk>;
  // Drops the chunk's starting mark; nothing when it has none.
  clearStarting(chunkId: string): void;
  // Stores the session the chunk started and resolves true; for an id no
  // chunk has, logs, changes nothing and resolves false.
  setSession(chunkId: string, sessionId: string): Promise<boolean>;
  // Deletes the chunk that started `sessionId`; nothing when none did.
  retire(sessionId: string): Promise<void>;
  // Retires each started chunk whose session chat no longer holds; resolves
  // to the chunks after it.
  retireUnheld(): Promise<BacklogChunk[]>;
  // For each unstarted chunk of a repo the map names, drops every title not
  // in that repo's set, deleting a chunk left with none. A repo the map lacks
  // is left as it is.
  prune(
    titlesByRepo: ReadonlyMap<string, ReadonlySet<string>>,
  ): Promise<BacklogChunk[]>;
}

// `data` is backlog's plugin data. `restored` settles once chat's restore
// of its saved rows ends; `isHeld` says whether chat holds a session.
// `changed` hears the chunks after each change. `clock` stamps the name an
// unreadable file is moved aside to.
export interface ChunkStoreDeps {
  data: Pick<Files, 'read' | 'write' | 'rename'>;
  randomHex: RandomHex;
  clock: Clock;
  restored(): Promise<void>;
  isHeld(sessionId: string): boolean;
  log: PluginLog;
  changed(chunks: BacklogChunk[]): void;
}

interface KeyParts {
  repo: string;
  title: string;
}

// `chunks.json` as read: `unreadable` when a file is there that could not be
// read or parsed.
interface ChunksRead {
  chunks: BacklogChunk[];
  unreadable: boolean;
}

// For each repo the rows hold, its rows' titles, done rows included.
export function titlesByRepo(
  rows: readonly BacklogRow[],
): Map<string, Set<string>> {
  const byRepo = new Map<string, Set<string>>();
  for (const row of rows) {
    let titles = byRepo.get(row.repo);
    if (titles === undefined) {
      titles = new Set();
      byRepo.set(row.repo, titles);
    }
    titles.add(row.title);
  }
  return byRepo;
}

function isStarted(chunk: BacklogChunk): boolean {
  return chunk.sessionId !== null;
}

// Why the chunk's follow-ups and headless flag cannot change — `has started`
// or `is starting` — or null when they can.
function startState(
  chunk: BacklogChunk,
  starting: ReadonlySet<string>,
): string | null {
  if (isStarted(chunk)) {
    return 'has started';
  }
  return starting.has(chunk.id) ? 'is starting' : null;
}

// The repo and title of a row key, split at its first newline.
function keyParts(key: RowKey): KeyParts {
  const at = key.indexOf('\n');
  if (at === -1) {
    throw new Error(`${key} is not a row key`);
  }
  return { repo: key.slice(0, at), title: key.slice(at + 1) };
}

function chunkById(chunks: readonly BacklogChunk[], id: string): BacklogChunk {
  const chunk = chunks.find((candidate) => candidate.id === id);
  if (chunk === undefined) {
    throw new Error(`No chunk ${id}`);
  }
  return chunk;
}

function chunkHolding(
  chunks: readonly BacklogChunk[],
  key: KeyParts,
): BacklogChunk | undefined {
  return chunks.find(
    (chunk) => chunk.repo === key.repo && chunk.titles.includes(key.title),
  );
}

// The chunk holding only the titles `keep` passes: itself when it keeps
// every title, none when it keeps none.
function keptTitles(
  chunk: BacklogChunk,
  keep: (title: string) => boolean,
): BacklogChunk[] {
  const titles = chunk.titles.filter(keep);
  if (titles.length === chunk.titles.length) {
    return [chunk];
  }
  return titles.length === 0 ? [] : [{ ...chunk, titles }];
}

// `chunks` with `titles` taken out of `repo`'s chunks.
function withoutTitles(
  chunks: readonly BacklogChunk[],
  repo: string,
  titles: ReadonlySet<string>,
): BacklogChunk[] {
  return chunks.flatMap((chunk) =>
    chunk.repo === repo
      ? keptTitles(chunk, (title) => !titles.has(title))
      : [chunk],
  );
}

function requireKeys(keys: readonly RowKey[]): KeyParts[] {
  if (keys.length === 0) {
    throw new Error('No follow-ups given');
  }
  return keys.map(keyParts);
}

function refuseKeysOfStartingOrStarted(
  chunks: readonly BacklogChunk[],
  keys: readonly KeyParts[],
  starting: ReadonlySet<string>,
): void {
  for (const key of keys) {
    const holder = chunkHolding(chunks, key);
    if (holder === undefined) {
      continue;
    }
    const state = startState(holder, starting);
    if (state !== null) {
      throw new Error(`${key.title} is in ${holder.name}, which ${state}`);
    }
  }
}

function refuseTwoRepos(keys: readonly KeyParts[]): void {
  const other = keys.find((key) => key.repo !== keys[0].repo);
  if (other !== undefined) {
    throw new Error(
      `${other.title} is in ${other.repo}; a chunk holds one repo's follow-ups`,
    );
  }
}

// The unstarted chunk `chunkId` names, every key of its repo.
function addTarget(
  chunks: readonly BacklogChunk[],
  chunkId: string,
  keys: readonly KeyParts[],
  starting: ReadonlySet<string>,
): BacklogChunk {
  const target = chunkById(chunks, chunkId);
  const state = startState(target, starting);
  if (state !== null) {
    throw new Error(`${target.name} ${state}; its follow-ups cannot change`);
  }
  const other = keys.find((key) => key.repo !== target.repo);
  if (other !== undefined) {
    throw new Error(`${other.title} is in ${other.repo}, not ${target.repo}`);
  }
  return target;
}

// Each key not already in the target moves to its end, out of the unstarted
// chunk that held it; `chunkId` null makes the target a new chunk at the end.
function added(
  chunks: readonly BacklogChunk[],
  edit: Extract<ChunkEdit, { type: 'add' }>,
  randomHex: RandomHex,
  starting: ReadonlySet<string>,
): BacklogChunk[] {
  const keys = requireKeys(edit.keys);
  const target =
    edit.chunkId === null
      ? null
      : addTarget(chunks, edit.chunkId, keys, starting);
  if (target === null) {
    refuseTwoRepos(keys);
  }
  refuseKeysOfStartingOrStarted(chunks, keys, starting);
  const repo = target?.repo ?? keys[0].repo;
  const held = target?.titles ?? [];
  const moving = [
    ...new Set(
      keys.map((key) => key.title).filter((title) => !held.includes(title)),
    ),
  ];
  const others = withoutTitles(chunks, repo, new Set(moving));
  if (target === null) {
    const made: BacklogChunk = {
      id: randomHex(),
      repo,
      name: keys[0].title,
      titles: moving,
      headless: false,
      sessionId: null,
    };
    return [...others, made];
  }
  return others.map((chunk) =>
    chunk.id === target.id
      ? { ...chunk, titles: [...chunk.titles, ...moving] }
      : chunk,
  );
}

function removed(
  chunks: readonly BacklogChunk[],
  edit: Extract<ChunkEdit, { type: 'remove' }>,
  starting: ReadonlySet<string>,
): BacklogChunk[] {
  const keys = requireKeys(edit.keys);
  refuseKeysOfStartingOrStarted(chunks, keys, starting);
  let next = [...chunks];
  for (const key of keys) {
    next = withoutTitles(next, key.repo, new Set([key.title]));
  }
  return next;
}

// A started chunk may be renamed; one starting may not.
function renamed(
  chunks: readonly BacklogChunk[],
  edit: Extract<ChunkEdit, { type: 'rename' }>,
  starting: ReadonlySet<string>,
): BacklogChunk[] {
  const chunk = chunkById(chunks, edit.chunkId);
  if (starting.has(chunk.id)) {
    throw new Error(`${chunk.name} is starting`);
  }
  const name = edit.name.trim();
  if (name === '') {
    throw new Error('A chunk needs a name');
  }
  return chunks.map((candidate) =>
    candidate === chunk ? { ...candidate, name } : candidate,
  );
}

function withHeadless(
  chunks: readonly BacklogChunk[],
  edit: Extract<ChunkEdit, { type: 'setHeadless' }>,
  starting: ReadonlySet<string>,
): BacklogChunk[] {
  const chunk = chunkById(chunks, edit.chunkId);
  const state = startState(chunk, starting);
  if (state !== null) {
    throw new Error(`${chunk.name} ${state}; its headless flag cannot change`);
  }
  return chunks.map((candidate) =>
    candidate === chunk ? { ...candidate, headless: edit.headless } : candidate,
  );
}

// The chunks after `edit`; throws the refusal when it is refused.
function edited(
  chunks: readonly BacklogChunk[],
  edit: ChunkEdit,
  randomHex: RandomHex,
  starting: ReadonlySet<string>,
): BacklogChunk[] {
  switch (edit.type) {
    case 'add':
      return added(chunks, edit, randomHex, starting);
    case 'remove':
      return removed(chunks, edit, starting);
    case 'rename':
      return renamed(chunks, edit, starting);
    case 'setHeadless':
      return withHeadless(chunks, edit, starting);
  }
}

// Throws the first refusal the plans meet, the checks in order.
function refusePlans(
  chunks: readonly BacklogChunk[],
  repo: string,
  plans: readonly ChunkPlan[],
  titles: ReadonlySet<string>,
  starting: ReadonlySet<string>,
): void {
  if (plans.some((plan) => plan.name === '')) {
    throw new Error('A chunk needs a name');
  }
  const empty = plans.find((plan) => plan.titles.length === 0);
  if (empty !== undefined) {
    throw new Error(`${empty.name} holds no follow-ups`);
  }
  const planned = plans.flatMap((plan) => plan.titles);
  const unknown = planned.find((title) => !titles.has(title));
  if (unknown !== undefined) {
    throw new Error(`No follow-up titled ${unknown} in ${repo}`);
  }
  const repeated = planned.find(
    (title, index) => planned.indexOf(title) !== index,
  );
  if (repeated !== undefined) {
    throw new Error(`${repeated} is in two chunks`);
  }
  refuseKeysOfStartingOrStarted(
    chunks,
    planned.map((title) => ({ repo, title })),
    starting,
  );
}

// `repo`'s unstarted chunks replaced by one chunk per plan at the end; each
// plan takes the id and headless flag of the first unmatched old chunk of
// its name. A starting chunk stays.
function replaced(
  chunks: readonly BacklogChunk[],
  repo: string,
  plans: readonly ChunkPlan[],
  titles: ReadonlySet<string>,
  randomHex: RandomHex,
  starting: ReadonlySet<string>,
): BacklogChunk[] {
  const trimmed = plans.map((plan) => ({ ...plan, name: plan.name.trim() }));
  refusePlans(chunks, repo, trimmed, titles, starting);
  const isReplaced = (chunk: BacklogChunk) =>
    chunk.repo === repo && startState(chunk, starting) === null;
  const unmatched = chunks.filter(isReplaced);
  const made = trimmed.map((plan): BacklogChunk => {
    const index = unmatched.findIndex((chunk) => chunk.name === plan.name);
    const [old] = index === -1 ? [] : unmatched.splice(index, 1);
    return {
      id: old?.id ?? randomHex(),
      repo,
      name: plan.name,
      titles: [...plan.titles],
      headless: old?.headless ?? false,
      sessionId: null,
    };
  });
  return [...chunks.filter((chunk) => !isReplaced(chunk)), ...made];
}

function pruned(
  chunks: readonly BacklogChunk[],
  titlesByRepo: ReadonlyMap<string, ReadonlySet<string>>,
  starting: ReadonlySet<string>,
): BacklogChunk[] {
  return chunks.flatMap((chunk) => {
    const titles = titlesByRepo.get(chunk.repo);
    return titles === undefined || startState(chunk, starting) !== null
      ? [chunk]
      : keptTitles(chunk, (title) => titles.has(title));
  });
}

function isChunk(value: unknown): value is BacklogChunk {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const chunk = value as Record<string, unknown>;
  const hasNames = [chunk.id, chunk.repo, chunk.name].every(
    (field) => typeof field === 'string',
  );
  const hasTitles =
    Array.isArray(chunk.titles) &&
    chunk.titles.every((title) => typeof title === 'string');
  const hasSession =
    chunk.sessionId === null || typeof chunk.sessionId === 'string';
  return (
    hasNames && hasTitles && typeof chunk.headless === 'boolean' && hasSession
  );
}

// The chunks of `listed` that have a chunk's shape; each other one is
// dropped and logged.
function wellFormedChunks(
  listed: readonly unknown[],
  log: PluginLog,
): BacklogChunk[] {
  return listed.flatMap((value, index) => {
    if (isChunk(value)) {
      return [value];
    }
    log(`${CHUNKS_FILE}: dropped malformed chunk at index ${String(index)}`);
    return [];
  });
}

// `chunks.json`'s chunks; none when it is missing, and none, logged, when
// it is unreadable.
async function readChunks(
  data: ChunkStoreDeps['data'],
  log: PluginLog,
): Promise<ChunksRead> {
  let listed: unknown[];
  try {
    const text = await readIfPresent(data, CHUNKS_FILE);
    if (text === null) {
      return { chunks: [], unreadable: false };
    }
    const { chunks } = JSON.parse(text) as { chunks: unknown };
    if (!Array.isArray(chunks)) {
      throw new Error(`${CHUNKS_FILE} holds no chunks`);
    }
    listed = chunks;
  } catch {
    log(`${CHUNKS_FILE} unreadable; starting with no chunks`);
    return { chunks: [], unreadable: true };
  }
  return { chunks: wellFormedChunks(listed, log), unreadable: false };
}

// The chunks are read once and kept in memory; starting marks live only in
// memory. An unreadable file is moved aside to
// `chunks.json.unreadable-<epoch ms>` before the first write.
export function createChunkStore(deps: ChunkStoreDeps): ChunkStore {
  const { data, randomHex, log } = deps;
  const queue = createSerialQueue();
  const starting = new Set<string>();
  let kept: BacklogChunk[] | null = null;
  let isUnreadableFileKept = false;

  async function current(): Promise<BacklogChunk[]> {
    if (kept === null) {
      const read = await readChunks(data, log);
      kept = read.chunks;
      isUnreadableFileKept = read.unreadable;
    }
    return kept;
  }

  async function moveUnreadableAside(): Promise<void> {
    const aside = `${CHUNKS_FILE}.unreadable-${String(deps.clock.now())}`;
    await data.rename(CHUNKS_FILE, aside);
    isUnreadableFileKept = false;
    log(`${CHUNKS_FILE} moved aside to ${aside}`);
  }

  // Writes `next` and tells `changed` when it differs from `before`.
  async function stored(
    before: BacklogChunk[],
    next: BacklogChunk[],
  ): Promise<BacklogChunk[]> {
    if (isSameJson(before, next)) {
      return before;
    }
    if (isUnreadableFileKept) {
      await moveUnreadableAside();
    }
    await data.write(CHUNKS_FILE, JSON.stringify({ chunks: next }, null, 2));
    kept = next;
    deps.changed(next);
    return next;
  }

  // `chunks` less each started chunk whose session chat no longer holds,
  // asked once chat's restore settled.
  async function withoutUnheld(
    chunks: BacklogChunk[],
  ): Promise<BacklogChunk[]> {
    if (!chunks.some(isStarted)) {
      return chunks;
    }
    await deps.restored();
    return chunks.filter(
      (chunk) => chunk.sessionId === null || deps.isHeld(chunk.sessionId),
    );
  }

  return {
    chunks: () => queue.run(current),
    edit: (edit) =>
      queue.run(async () => {
        const before = await current();
        const live = await withoutUnheld(before);
        return stored(before, edited(live, edit, randomHex, starting));
      }),
    replaceUnstarted: (repo, plans, titles) =>
      queue.run(async () => {
        const before = await current();
        const live = await withoutUnheld(before);
        return stored(
          before,
          replaced(live, repo, plans, titles, randomHex, starting),
        );
      }),
    markStarting: (chunkId) =>
      queue.run(async () => {
        const chunk = chunkById(await current(), chunkId);
        const state = startState(chunk, starting);
        if (state !== null) {
          throw new Error(`${chunk.name} ${state}`);
        }
        starting.add(chunkId);
        return chunk;
      }),
    clearStarting: (chunkId) => {
      starting.delete(chunkId);
    },
    setSession: (chunkId, sessionId) =>
      queue.run(async () => {
        const before = await current();
        if (!before.some((chunk) => chunk.id === chunkId)) {
          log(`No chunk ${chunkId} for session ${sessionId}`);
          return false;
        }
        await stored(
          before,
          before.map((chunk) =>
            chunk.id === chunkId ? { ...chunk, sessionId } : chunk,
          ),
        );
        return true;
      }),
    retire: (sessionId) =>
      queue.run(async () => {
        const before = await current();
        await stored(
          before,
          before.filter((chunk) => chunk.sessionId !== sessionId),
        );
      }),
    retireUnheld: () =>
      queue.run(async () => {
        const before = await current();
        return stored(before, await withoutUnheld(before));
      }),
    prune: (titlesByRepo) =>
      queue.run(async () => {
        const before = await current();
        return stored(before, pruned(before, titlesByRepo, starting));
      }),
  };
}
