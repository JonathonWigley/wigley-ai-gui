import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { ChatMainExports } from '../../chat/contract';
import type { BacklogChunk, ChunkStart } from '../contract';
import { rowKey } from '../row-key';
import { chunkMessage } from './chunk-message';
import type { ChunkStore } from './chunk-store';
import type { BacklogRow } from './rows';

// `rows` reads the backlog's rows as the page loaded them last;
// `prunableTitles` is the titles by repo `prune` may keep, a repo whose load
// skipped a file left out; `launchBrief` is the setting as the user config
// now sets it.
export interface ChunkStarterDeps {
  store: Pick<
    ChunkStore,
    'retireUnheld' | 'prune' | 'markStarting' | 'clearStarting' | 'setSession'
  >;
  rows(): Promise<BacklogRow[]>;
  prunableTitles(): Promise<ReadonlyMap<string, ReadonlySet<string>>>;
  chat: Pick<ChatMainExports, 'launch' | 'defaultProfile' | 'profileOf'>;
  launchBrief(): string;
  log: PluginLog;
}

// Starts chunks: each one session through chat's `launch` in its repo's
// folder under chat's default profile, headless when the chunk is, its first
// message the launch brief and the chunk's open follow-ups. The store marks a
// chunk starting from before its launch until its session is stored, so a
// chunk another call is starting is refused, not launched again. A session
// that launched but was not stored is its chunk's refusal, naming the session.
export interface ChunkStarter {
  // Drops the gone titles from unstarted chunks and retires each started
  // chunk chat no longer holds, then starts each id in order: one result per
  // id, in order.
  start(chunkIds: readonly string[]): Promise<ChunkStart[]>;
}

// The refusal for a start in a repo with no folder.
export function noFolderRefusal(repo: string): string {
  return `${repo} has no folder: add { "repo": "${repo}", "folder": "<its folder>" } to the backlog setting repoFolders`;
}

// The open rows of the chunk's titles, in its order; a title with no row or
// a done row is left out.
function chunkRows(
  chunk: BacklogChunk,
  rows: readonly BacklogRow[],
): BacklogRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return chunk.titles.flatMap((title) => {
    const row = byKey.get(rowKey(chunk.repo, title));
    return row === undefined || row.done ? [] : [row];
  });
}

export function createChunkStarter(deps: ChunkStarterDeps): ChunkStarter {
  const { store, chat, log } = deps;

  // Stores the launched session; a chunk gone from the store or a write that
  // fails becomes the chunk's refusal.
  async function recorded(
    chunk: BacklogChunk,
    sessionId: string,
  ): Promise<ChunkStart> {
    const chunkId = chunk.id;
    let reason: string;
    try {
      if (await store.setSession(chunkId, sessionId)) {
        return { chunkId, sessionId };
      }
      reason = 'the chunk is gone';
    } catch (error) {
      reason = errorText(error);
    }
    log(`chunk ${chunk.name}: session ${sessionId} not stored: ${reason}`);
    return {
      chunkId,
      refusal: `${chunk.name} started session ${sessionId}, but it was not stored: ${reason}`,
    };
  }

  async function launch(
    chunk: BacklogChunk,
    repoFolder: string,
    profile: string,
    items: readonly BacklogRow[],
  ): Promise<ChunkStart> {
    const chunkId = chunk.id;
    let sessionId: string;
    try {
      sessionId = await chat.launch({
        projectDir: repoFolder,
        profile,
        message: {
          text: chunkMessage(deps.launchBrief(), items),
          images: [],
        },
        headless: chunk.headless,
      });
    } catch (error) {
      const text = errorText(error);
      log(`chunk ${chunk.name} not started: ${text}`);
      return { chunkId, refusal: text };
    }
    if (chat.profileOf(sessionId) === null) {
      log(
        `chunk ${chunk.name}: session ${sessionId} closed before it was stored`,
      );
      return {
        chunkId,
        refusal: `${chunk.name}'s session closed as it started`,
      };
    }
    return recorded(chunk, sessionId);
  }

  // Starts a chunk the store marked starting.
  async function startMarked(
    chunk: BacklogChunk,
    rows: readonly BacklogRow[],
  ): Promise<ChunkStart> {
    const { id: chunkId, name } = chunk;
    const items = chunkRows(chunk, rows);
    if (items.length === 0) {
      return {
        chunkId,
        refusal: `None of ${name}'s follow-ups are open in the backlog`,
      };
    }
    const { repoFolder } = items[0];
    if (repoFolder === null) {
      return { chunkId, refusal: noFolderRefusal(chunk.repo) };
    }
    const profile = chat.defaultProfile(null);
    if (profile === null) {
      return { chunkId, refusal: 'Chat has no profiles' };
    }
    return launch(chunk, repoFolder, profile, items);
  }

  async function startOne(
    rows: readonly BacklogRow[],
    chunkId: string,
  ): Promise<ChunkStart> {
    let chunk: BacklogChunk;
    try {
      chunk = await store.markStarting(chunkId);
    } catch (error) {
      return { chunkId, refusal: errorText(error) };
    }
    try {
      return await startMarked(chunk, rows);
    } finally {
      store.clearStarting(chunkId);
    }
  }

  return {
    async start(chunkIds) {
      const rows = await deps.rows();
      await store.prune(await deps.prunableTitles());
      await store.retireUnheld();
      const results: ChunkStart[] = [];
      for (const chunkId of chunkIds) {
        results.push(await startOne(rows, chunkId));
      }
      return results;
    },
  };
}
