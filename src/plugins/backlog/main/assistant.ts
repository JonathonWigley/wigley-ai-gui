import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { isJsonObject } from '../../../shared/json';
import type {
  ScopedAgentRecord,
  ScopedAgentStore,
} from '../../scoped-agents/contract';
import type { BacklogStaleness, RowKey } from '../contract';
import type { BacklogRow } from './rows';

// Backlog's one scoped agent: a single assistant for every repo, at one scope.
export const ASSISTANT_ID = 'assistant';
export const ASSISTANT_SCOPE = 'global';
export const ASSISTANT_TITLE = 'Backlog assistant';

export const ASSISTANT_INSTRUCTIONS = `You are the Backlog assistant in wigley-ai-gui. In Backlog mode the user reviews the follow-ups of every repo on this machine, sees which ones are stale, groups them into chunks that one session each works, and starts those sessions. Every edit to a follow-up file goes through you.

The user writes to you from the Backlog page, which you cannot see. Call read_backlog_state before you act on the cursor item, the marked rows or the filters: it gives every row with its staleness and chunk, the cursor item's full text, the marked rows, the filters and the chunks.

Edit a follow-up file directly, in the shape it already has (wigley-ai-marketplace's skills/review/triage.md § The project's follow-ups). To group follow-ups into chunks, call set_backlog_chunks with a repo and its chunks. It replaces that repo's unstarted chunks, so pass every chunk the repo keeps. A chunk you pass under its current name keeps its headless flag. A chunk that has started cannot change.

Land each change to a repo per that repo's own rules: its AGENTS.md and the user's git rules. Then report each change by repo and title.`;

const ASSISTANT_FILE = 'assistant.json';

type AssistantRecords = Record<string, ScopedAgentRecord>;

function isRecord(value: unknown): value is ScopedAgentRecord {
  return (
    isJsonObject(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.hostSessionId === 'string'
  );
}

// `assistant.json`'s records by scope; none when it is missing, and none,
// logged, when it is unreadable or holds a value that is not a record.
async function readRecords(
  data: Pick<Files, 'read'>,
  log: PluginLog,
): Promise<AssistantRecords> {
  try {
    const text = await readIfPresent(data, ASSISTANT_FILE);
    if (text === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(text);
    if (!isJsonObject(parsed) || !Object.values(parsed).every(isRecord)) {
      throw new Error(`${ASSISTANT_FILE} holds a value that is no record`);
    }
    return parsed as AssistantRecords;
  } catch {
    log(`${ASSISTANT_FILE} unreadable; the assistant starts fresh`);
    return {};
  }
}

// The assistant's records in `assistant.json` in backlog's plugin data, as
// `{ "<scope>": ScopedAgentRecord }`. Every call reads the file, and runs
// after the one before it settles. A fresh launch replaces no record, and an
// ask may launch at any time.
export function createAssistantStore(
  data: Pick<Files, 'read' | 'write'>,
  log: PluginLog,
): ScopedAgentStore {
  let last: Promise<unknown> = Promise.resolve();

  function queued<T>(run: () => Promise<T>): Promise<T> {
    const result = last.then(run);
    last = result.catch(() => undefined);
    return result;
  }

  return {
    read: (scope) =>
      queued(async () => (await readRecords(data, log))[scope] ?? null),
    write: (scope, record) =>
      queued(async () => {
        const records = await readRecords(data, log);
        if (record === null) {
          delete records[scope];
        } else {
          records[scope] = record;
        }
        await data.write(ASSISTANT_FILE, JSON.stringify(records, null, 2));
      }),
    entries: () =>
      queued(async () =>
        Object.entries(await readRecords(data, log)).map(([scope, record]) => ({
          scope,
          record,
        })),
      ),
    superseded: async () => null,
    checkAsk: async () => undefined,
  };
}

const LISTED_LEVELS: readonly BacklogStaleness['level'][] = ['stale', 'moved'];

function joinedOrNone(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.join(', ');
}

// The message `W` sends the assistant: sweep `repo`'s follow-up `files`,
// listing its open rows that `staleness` reads as stale or moved, in row
// order.
export function sweepMessage(
  repo: string,
  files: readonly string[],
  rows: readonly BacklogRow[],
  staleness: Readonly<Record<RowKey, BacklogStaleness>>,
): string {
  const items = rows.flatMap((row) => {
    const entry = staleness[row.key] as BacklogStaleness | undefined;
    const isListed =
      !row.done && entry !== undefined && LISTED_LEVELS.includes(entry.level);
    return isListed
      ? [
          `- ${row.title}: ${entry.level}; ${entry.commitsSince} commits since it was written; gone: ${joinedOrNone(entry.gonePaths)}`,
        ]
      : [];
  });
  return [
    `Sweep ${repo}'s follow-ups for staleness.`,
    `Files:\n${files.map((path) => `- ${path}`).join('\n')}`,
    `Items Backlog reads as stale or moved:\n${items.length === 0 ? 'None: check every item against the code anyway.' : items.join('\n')}`,
    `Fix the file: remove each item whose work has landed, rewrite each item the code has moved past, and keep the rest. Check every item against the code, not only the ones listed. Land the change per ${repo}'s own rules. Then report each change: the item's title, whether you removed, rewrote or kept it, and why.`,
  ].join('\n\n');
}
