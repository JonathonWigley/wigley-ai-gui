import type { RandomHex } from '../../../contracts/ambient';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { isSameJson } from '../../../shared/json';
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
// only once chat's restore settled.
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
  // Stores the session the chunk started; for an id no chunk has, logs and
  // changes nothing.
  setSession(chunkId: string, sessionId: string): Promise<BacklogChunk[]>;
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
// `changed` hears the chunks after each change.
export interface ChunkStoreDeps {
  data: Pick<Files, 'read' | 'write'>;
  randomHex: RandomHex;
  restored(): Promise<void>;
  isHeld(sessionId: string): boolean;
  log: PluginLog;
  changed(chunks: BacklogChunk[]): void;
}

interface KeyParts {
  repo: string;
  title: string;
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

function refuseStartedKeys(
  chunks: readonly BacklogChunk[],
  keys: readonly KeyParts[],
): void {
  for (const key of keys) {
    const holder = chunkHolding(chunks, key);
    if (holder !== undefined && isStarted(holder)) {
      throw new Error(`${key.title} is in ${holder.name}, which has started`);
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
): BacklogChunk {
  const target = chunkById(chunks, chunkId);
  if (isStarted(target)) {
    throw new Error(`${target.name} has started; its follow-ups cannot change`);
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
): BacklogChunk[] {
  const keys = requireKeys(edit.keys);
  const target =
    edit.chunkId === null ? null : addTarget(chunks, edit.chunkId, keys);
  if (target === null) {
    refuseTwoRepos(keys);
  }
  refuseStartedKeys(chunks, keys);
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
): BacklogChunk[] {
  const keys = requireKeys(edit.keys);
  refuseStartedKeys(chunks, keys);
  let next = [...chunks];
  for (const key of keys) {
    next = withoutTitles(next, key.repo, new Set([key.title]));
  }
  return next;
}

function renamed(
  chunks: readonly BacklogChunk[],
  edit: Extract<ChunkEdit, { type: 'rename' }>,
): BacklogChunk[] {
  const chunk = chunkById(chunks, edit.chunkId);
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
): BacklogChunk[] {
  const chunk = chunkById(chunks, edit.chunkId);
  if (isStarted(chunk)) {
    throw new Error(
      `${chunk.name} has started; its headless flag cannot change`,
    );
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
): BacklogChunk[] {
  switch (edit.type) {
    case 'add':
      return added(chunks, edit, randomHex);
    case 'remove':
      return removed(chunks, edit);
    case 'rename':
      return renamed(chunks, edit);
    case 'setHeadless':
      return withHeadless(chunks, edit);
  }
}

// Throws the first refusal the plans meet, the checks in order.
function refusePlans(
  chunks: readonly BacklogChunk[],
  repo: string,
  plans: readonly ChunkPlan[],
  titles: ReadonlySet<string>,
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
  refuseStartedKeys(
    chunks,
    planned.map((title) => ({ repo, title })),
  );
}

// `repo`'s unstarted chunks replaced by one chunk per plan at the end; each
// plan takes the id and headless flag of the first unmatched old chunk of
// its name.
function replaced(
  chunks: readonly BacklogChunk[],
  repo: string,
  plans: readonly ChunkPlan[],
  titles: ReadonlySet<string>,
  randomHex: RandomHex,
): BacklogChunk[] {
  const trimmed = plans.map((plan) => ({ ...plan, name: plan.name.trim() }));
  refusePlans(chunks, repo, trimmed, titles);
  const isReplaced = (chunk: BacklogChunk) =>
    chunk.repo === repo && !isStarted(chunk);
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
): BacklogChunk[] {
  return chunks.flatMap((chunk) => {
    const titles = titlesByRepo.get(chunk.repo);
    return titles === undefined || isStarted(chunk)
      ? [chunk]
      : keptTitles(chunk, (title) => titles.has(title));
  });
}

// `chunks.json`'s chunks; none when it is missing, and none, logged, when
// it is unreadable.
async function readChunks(
  data: ChunkStoreDeps['data'],
  log: PluginLog,
): Promise<BacklogChunk[]> {
  try {
    const text = await readIfPresent(data, CHUNKS_FILE);
    if (text === null) {
      return [];
    }
    const { chunks } = JSON.parse(text) as { chunks: unknown };
    if (!Array.isArray(chunks)) {
      throw new Error(`${CHUNKS_FILE} holds no chunks`);
    }
    return chunks as BacklogChunk[];
  } catch {
    log(`${CHUNKS_FILE} unreadable; starting with no chunks`);
    return [];
  }
}

// The chunks are read once and kept in memory.
export function createChunkStore(deps: ChunkStoreDeps): ChunkStore {
  const { data, randomHex, log } = deps;
  let kept: BacklogChunk[] | null = null;
  let last: Promise<unknown> = Promise.resolve();

  function queued<T>(run: () => Promise<T>): Promise<T> {
    const result = last.then(run);
    last = result.catch(() => undefined);
    return result;
  }

  async function current(): Promise<BacklogChunk[]> {
    kept ??= await readChunks(data, log);
    return kept;
  }

  // Writes `next` and tells `changed` when it differs from `before`.
  async function stored(
    before: BacklogChunk[],
    next: BacklogChunk[],
  ): Promise<BacklogChunk[]> {
    if (isSameJson(before, next)) {
      return before;
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
    chunks: () => queued(current),
    edit: (edit) =>
      queued(async () => {
        const before = await current();
        const live = await withoutUnheld(before);
        return stored(before, edited(live, edit, randomHex));
      }),
    replaceUnstarted: (repo, plans, titles) =>
      queued(async () => {
        const before = await current();
        const live = await withoutUnheld(before);
        return stored(before, replaced(live, repo, plans, titles, randomHex));
      }),
    setSession: (chunkId, sessionId) =>
      queued(async () => {
        const before = await current();
        if (!before.some((chunk) => chunk.id === chunkId)) {
          log(`No chunk ${chunkId} for session ${sessionId}`);
          return before;
        }
        return stored(
          before,
          before.map((chunk) =>
            chunk.id === chunkId ? { ...chunk, sessionId } : chunk,
          ),
        );
      }),
    retire: (sessionId) =>
      queued(async () => {
        const before = await current();
        await stored(
          before,
          before.filter((chunk) => chunk.sessionId !== sessionId),
        );
      }),
    retireUnheld: () =>
      queued(async () => {
        const before = await current();
        return stored(before, await withoutUnheld(before));
      }),
    prune: (titlesByRepo) =>
      queued(async () => {
        const before = await current();
        return stored(before, pruned(before, titlesByRepo));
      }),
  };
}
