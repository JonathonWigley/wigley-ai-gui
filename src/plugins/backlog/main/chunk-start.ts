import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { ChatMainExports } from '../../chat/contract';
import type { BacklogChunk, ChunkStart } from '../contract';
import { rowKey } from '../row-key';
import { chunkMessage } from './chunk-message';
import { type ChunkStore, titlesByRepo } from './chunk-store';
import type { BacklogRow } from './rows';

// `rows` reads the backlog's rows as the page loaded them last;
// `launchBrief` is the setting as the user config now sets it.
export interface ChunkStarterDeps {
  store: Pick<ChunkStore, 'retireUnheld' | 'setSession' | 'prune'>;
  rows(): Promise<BacklogRow[]>;
  chat: Pick<ChatMainExports, 'launch' | 'defaultProfile' | 'profileOf'>;
  launchBrief(): string;
  log: PluginLog;
}

// Starts chunks: each one session through chat's `launch` in its repo's
// folder under chat's default profile, headless when the chunk is, its first
// message the launch brief and the chunk's follow-ups. A chunk whose launch is
// in flight, from this call or another, is not launched again.
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

// The rows of the chunk's titles, in its order; a title with no row is left
// out.
function chunkRows(
  chunk: BacklogChunk,
  rows: readonly BacklogRow[],
): BacklogRow[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return chunk.titles.flatMap((title) => {
    const row = byKey.get(rowKey(chunk.repo, title));
    return row === undefined ? [] : [row];
  });
}

export function createChunkStarter(deps: ChunkStarterDeps): ChunkStarter {
  const { store, chat, log } = deps;
  // Chunk ids whose launch is in flight.
  const starting = new Set<string>();
  // Chunk ids this starter stored a session for, which another call's
  // earlier read may still show unstarted.
  const started = new Set<string>();

  // Launches the chunk and stores its session; `starting` holds its id from
  // the launch until the session is stored.
  async function launch(
    chunk: BacklogChunk,
    repoFolder: string,
    profile: string,
    items: readonly BacklogRow[],
  ): Promise<ChunkStart> {
    const chunkId = chunk.id;
    starting.add(chunkId);
    try {
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
        return { chunkId, refusal: `${chunk.name}'s session closed as it started` };
      }
      const stored = store.setSession(chunkId, sessionId);
      started.add(chunkId);
      await stored;
      return { chunkId, sessionId };
    } finally {
      starting.delete(chunkId);
    }
  }

  async function startOne(
    chunks: readonly BacklogChunk[],
    rows: readonly BacklogRow[],
    chunkId: string,
  ): Promise<ChunkStart> {
    const chunk = chunks.find((candidate) => candidate.id === chunkId);
    if (chunk === undefined) {
      return { chunkId, refusal: `No chunk ${chunkId}` };
    }
    const { name } = chunk;
    if (chunk.sessionId !== null || started.has(chunkId)) {
      return { chunkId, refusal: `${name} has started` };
    }
    if (starting.has(chunkId)) {
      return { chunkId, refusal: `${name} is starting` };
    }
    const items = chunkRows(chunk, rows);
    if (items.length === 0) {
      return {
        chunkId,
        refusal: `None of ${name}'s follow-ups are in the backlog`,
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

  return {
    async start(chunkIds) {
      const rows = await deps.rows();
      await store.prune(titlesByRepo(rows));
      const chunks = await store.retireUnheld();
      const results: ChunkStart[] = [];
      for (const chunkId of chunkIds) {
        results.push(await startOne(chunks, rows, chunkId));
      }
      return results;
    },
  };
}
