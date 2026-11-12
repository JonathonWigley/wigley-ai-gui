import { errorText } from '../../../shared/error-text';
import {
  isJsonObject,
  isStringArray,
  type JsonObject,
} from '../../../shared/json';
import {
  type AgentSession,
  errorResult,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import type {
  BacklogChunk,
  BacklogPlace,
  BacklogStaleness,
  RowKey,
} from '../contract';
import { isReady } from '../ready';
import type { ChunkPlan, ChunkStore } from './chunk-store';
import type { BacklogRow } from './rows';

export const READ_BACKLOG_STATE_TOOL: ToolDefinition = {
  name: 'read_backlog_state',
  description:
    "Read what the user sees in Backlog: every follow-up row across the repos with its staleness and chunk, the cursor item's full text, the marked rows, the filters and the chunks. Only the Backlog assistant session may call it.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

export const SET_BACKLOG_CHUNKS_TOOL: ToolDefinition = {
  name: 'set_backlog_chunks',
  description:
    "Replace one repo's unstarted chunks in Backlog. Each chunk is a name and the titles of that repo's follow-ups that one session works. Started chunks stay. Pass every chunk the repo keeps; an empty list removes the repo's unstarted chunks. Only the Backlog assistant session may call it.",
  inputSchema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: "The repo, as Backlog's repo column shows it.",
      },
      chunks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: "The chunk's name." },
            titles: {
              type: 'array',
              items: { type: 'string' },
              description:
                "The follow-ups' titles, exactly as the file has them.",
            },
          },
          required: ['name', 'titles'],
          additionalProperties: false,
        },
        description: 'Every unstarted chunk the repo keeps.',
      },
    },
    required: ['repo', 'chunks'],
    additionalProperties: false,
  },
};

// The Backlog page's place as the assistant reads it: `repo` the repo filter,
// null for every repo; `marked` the marked rows' keys.
export interface AssistantPlace {
  selectedKey: RowKey | null;
  repo: string | null;
  filter: string;
  marked: RowKey[];
  isReadyOnly: boolean;
  isChunkedHidden: boolean;
  isStaleFirst: boolean;
  isDoneShown: boolean;
}

// Null when the page never opened Backlog.
export function assistantPlace(
  place: BacklogPlace | undefined,
): AssistantPlace | null {
  if (place === undefined) {
    return null;
  }
  return {
    selectedKey: place.selectedKey,
    repo: place.repo,
    filter: place.filter,
    marked: place.marked,
    isReadyOnly: place.isReadyOnly,
    isChunkedHidden: place.isChunkedHidden,
    isStaleFirst: place.isStaleFirst,
    isDoneShown: place.isDoneShown,
  };
}

// `scopeOf` names the assistant's scope for its session, null for any other
// session. `rows` are the last load's rows, `staleness` every entry read so
// far, and `place` the page's place.
export interface BacklogToolsDeps {
  scopeOf(session: AgentSession): Promise<string | null>;
  rows(): Promise<BacklogRow[]>;
  staleness(): Record<RowKey, BacklogStaleness>;
  chunks: Pick<ChunkStore, 'chunks' | 'replaceUnstarted'>;
  place(): AssistantPlace | null;
}

const NO_CHUNK = '—';

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function joinedOrNone(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.join(', ');
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|');
}

function rowName(row: BacklogRow): string {
  return `${row.repo} / ${row.title}`;
}

function chunkOfRow(
  chunks: readonly BacklogChunk[],
  row: BacklogRow,
): BacklogChunk | undefined {
  return chunks.find(
    (chunk) => chunk.repo === row.repo && chunk.titles.includes(row.title),
  );
}

function viewSection(
  place: AssistantPlace | null,
  cursor: BacklogRow | undefined,
  rows: readonly BacklogRow[],
): string {
  if (place === null) {
    return '## View\n\nThe Backlog page has not been opened.';
  }
  const marked = place.marked.flatMap((key) => {
    const row = rows.find((candidate) => candidate.key === key);
    return row === undefined ? [] : [rowName(row)];
  });
  return [
    '## View',
    '',
    `- Cursor: ${cursor === undefined ? 'none' : rowName(cursor)}`,
    `- Marked: ${marked.length === 0 ? 'none' : marked.join('; ')}`,
    `- Repo filter: ${place.repo ?? 'all repos'}`,
    `- Text filter: ${place.filter === '' ? 'none' : `"${place.filter}"`}`,
    `- Ready only: ${yesNo(place.isReadyOnly)} · Chunked hidden: ${yesNo(place.isChunkedHidden)} · Stale first: ${yesNo(place.isStaleFirst)} · Done shown: ${yesNo(place.isDoneShown)}`,
  ].join('\n');
}

function cursorStalenessLine(entry: BacklogStaleness | undefined): string {
  if (entry === undefined) {
    return 'Staleness: not read yet.';
  }
  const written = entry.writtenAt?.slice(0, 10) ?? 'unknown';
  return `Staleness: ${entry.level}; written ${written}; ${entry.commitsSince} commits since; gone: ${joinedOrNone(entry.gonePaths)}; named: ${joinedOrNone(entry.namedPaths)}`;
}

// The cursor item's heading, facts, one line and body; an empty one line or
// body is left out.
function cursorSection(
  row: BacklogRow,
  entry: BacklogStaleness | undefined,
): string {
  const facts = [
    `Repo: ${row.repo} · File: ${row.path}:${row.line} · Tags: ${joinedOrNone(row.tags)}`,
    cursorStalenessLine(entry),
  ].join('\n');
  return ['## Cursor item', `### ${row.title}`, facts, row.oneLine, row.body]
    .filter((part) => part !== '')
    .join('\n\n');
}

function chunkLine(chunk: BacklogChunk): string {
  const started =
    chunk.sessionId === null
      ? 'not started'
      : `started: session ${chunk.sessionId}`;
  const headless = chunk.headless ? ', headless' : '';
  return `- ${chunk.name} (${chunk.repo}), ${started}${headless}: ${chunk.titles.join('; ')}`;
}

function chunksSection(chunks: readonly BacklogChunk[]): string {
  const lines =
    chunks.length === 0 ? ['None.'] : chunks.map((chunk) => chunkLine(chunk));
  return ['## Chunks', '', ...lines].join('\n');
}

function stalenessCell(entry: BacklogStaleness | undefined): string {
  return entry === undefined
    ? 'not read yet'
    : `${entry.level} (${entry.commitsSince} since, ${entry.gonePaths.length} gone)`;
}

// The open rows, and the done rows when the place shows them, as one table per
// repo in row order; `None.` when no row shows.
function rowsSection(
  rows: readonly BacklogRow[],
  staleness: Readonly<Record<RowKey, BacklogStaleness>>,
  chunks: readonly BacklogChunk[],
  isDoneShown: boolean,
): string {
  const shown = rows.filter((row) => isDoneShown || !row.done);
  if (shown.length === 0) {
    return '## Rows\n\nNone.';
  }
  const byRepo = new Map<string, BacklogRow[]>();
  for (const row of shown) {
    const repoRows = byRepo.get(row.repo) ?? [];
    repoRows.push(row);
    byRepo.set(row.repo, repoRows);
  }
  const tables = [...byRepo].map(([repo, repoRows]) =>
    [
      `### ${repo}`,
      '',
      '| Title | Ready | Staleness | Chunk |',
      '|---|---|---|---|',
      ...repoRows.map((row) => {
        const chunk = chunkOfRow(chunks, row);
        return `| ${cell(row.title)} | ${yesNo(isReady(row.tags))} | ${stalenessCell(staleness[row.key])} | ${chunk === undefined ? NO_CHUNK : cell(chunk.name)} |`;
      }),
    ].join('\n'),
  );
  return ['## Rows', ...tables].join('\n\n');
}

// What the user sees in Backlog, in Markdown, for `read_backlog_state`.
export function backlogStateText(state: {
  rows: readonly BacklogRow[];
  staleness: Readonly<Record<RowKey, BacklogStaleness>>;
  chunks: readonly BacklogChunk[];
  place: AssistantPlace | null;
}): string {
  const { rows, staleness, chunks, place } = state;
  const cursorKey = place?.selectedKey ?? null;
  const cursor =
    cursorKey === null ? undefined : rows.find((row) => row.key === cursorKey);
  const sections = [
    '# Backlog',
    viewSection(place, cursor, rows),
    ...(cursor === undefined
      ? []
      : [cursorSection(cursor, staleness[cursor.key])]),
    chunksSection(chunks),
    rowsSection(rows, staleness, chunks, place?.isDoneShown ?? false),
  ];
  return sections.join('\n\n');
}

function refusedSession(toolName: string): ToolResult {
  return errorResult(`${toolName} answers only the Backlog assistant session.`);
}

async function readBacklogState(
  deps: BacklogToolsDeps,
  session: AgentSession,
): Promise<ToolResult> {
  if ((await deps.scopeOf(session)) === null) {
    return refusedSession(READ_BACKLOG_STATE_TOOL.name);
  }
  const [rows, chunks] = await Promise.all([deps.rows(), deps.chunks.chunks()]);
  return textResult(
    backlogStateText({
      rows,
      staleness: deps.staleness(),
      chunks,
      place: deps.place(),
    }),
  );
}

// The plans `chunks` gives; null when it is not a list of { name, titles }.
function chunkPlans(chunks: unknown): ChunkPlan[] | null {
  const isPlanList =
    Array.isArray(chunks) &&
    chunks.every(
      (chunk) =>
        isJsonObject(chunk) &&
        typeof chunk.name === 'string' &&
        isStringArray(chunk.titles),
    );
  if (!isPlanList) {
    return null;
  }
  return (chunks as ChunkPlan[]).map(({ name, titles }) => ({
    name,
    titles,
  }));
}

function setChunksText(repo: string, set: readonly BacklogChunk[]): string {
  if (set.length === 0) {
    return `Set no unstarted chunks for ${repo}.`;
  }
  const named = set.map((chunk) => `${chunk.name} (${chunk.titles.length})`);
  return `Set ${set.length} unstarted chunks for ${repo}: ${named.join(', ')}.`;
}

async function setBacklogChunks(
  deps: BacklogToolsDeps,
  session: AgentSession,
  args: unknown,
): Promise<ToolResult> {
  if ((await deps.scopeOf(session)) === null) {
    return refusedSession(SET_BACKLOG_CHUNKS_TOOL.name);
  }
  const named: JsonObject = isJsonObject(args) ? args : {};
  const { repo } = named;
  const repoRows =
    typeof repo === 'string'
      ? (await deps.rows()).filter((row) => row.repo === repo)
      : [];
  if (repoRows.length === 0) {
    const shown = typeof repo === 'string' ? repo : JSON.stringify(repo);
    return errorResult(`Refused: no follow-ups in ${shown}.`);
  }
  const repoName = repo as string;
  const plans = chunkPlans(named.chunks);
  if (plans === null) {
    return errorResult('Refused: chunks must be a list of { name, titles }.');
  }
  let after: BacklogChunk[];
  try {
    after = await deps.chunks.replaceUnstarted(
      repoName,
      plans,
      new Set<string>(repoRows.map((row) => row.title)),
    );
  } catch (error) {
    return errorResult(`Refused: ${errorText(error)}`);
  }
  const set = after.filter(
    (chunk) => chunk.repo === repoName && chunk.sessionId === null,
  );
  return textResult(setChunksText(repoName, set));
}

// The `start` backlog hands sessions' `contributeTools` with
// READ_BACKLOG_STATE_TOOL and SET_BACKLOG_CHUNKS_TOOL. Each tool answers only
// the session `scopeOf` knows, reading and writing nothing for any other.
export function startBacklogTools(
  deps: BacklogToolsDeps,
): (session: AgentSession) => ToolSession {
  return (session) => ({
    call(name, args) {
      switch (name) {
        case READ_BACKLOG_STATE_TOOL.name:
          return readBacklogState(deps, session);
        case SET_BACKLOG_CHUNKS_TOOL.name:
          return setBacklogChunks(deps, session, args);
        default:
          return Promise.reject(new Error(`no backlog tool "${name}"`));
      }
    },
    end: () => undefined,
  });
}
