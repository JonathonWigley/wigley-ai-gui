import { describe, expect, it, vi } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import type { AgentSession, ToolResult } from '../../sessions/contract';
import type {
  BacklogChunk,
  BacklogPlace,
  BacklogStaleness,
  RowKey,
} from '../contract';
import { AGENT_READY } from '../ready';
import { rowKey } from '../row-key';
import {
  type AssistantPlace,
  assistantPlace,
  type BacklogToolsDeps,
  backlogStateText,
  startBacklogTools,
} from './backlog-tools';
import { createChunkStore } from './chunk-store';
import type { BacklogRow } from './rows';

const FOLLOWUPS = '/dev/r/docs/features/followups.md';
const SESSION: AgentSession = {
  id: 'row-1',
  info: { sessionId: 'h-1', projectDir: '/home/me', harness: null },
};
const CONTEXT = { toolUseId: null, signal: new AbortController().signal };

function row(
  repo: string,
  title: string,
  fields: Partial<BacklogRow> = {},
): BacklogRow {
  return {
    key: rowKey(repo, title),
    repo,
    title,
    oneLine: `${title} gist`,
    tags: [],
    body: `${title} body.`,
    done: false,
    path: FOLLOWUPS,
    line: 1,
    homeRoot: '/dev/r/docs/features',
    repoFolder: '/dev/r',
    ...fields,
  };
}

function chunk(
  name: string,
  titles: string[],
  fields: Partial<BacklogChunk> = {},
): BacklogChunk {
  return {
    id: name,
    repo: 'r',
    name,
    titles,
    headless: false,
    sessionId: null,
    ...fields,
  };
}

const A = row('r', 'A', { tags: [AGENT_READY, 'ui'], line: 7 });
const B = row('r', 'B');
const DONE = row('r', 'Done', { done: true });
const S1 = row('s', 'S1');
const ROWS = [A, B, DONE, S1];

const ENTRIES: Record<RowKey, BacklogStaleness> = {
  [A.key]: {
    writtenAt: '2026-10-01T10:00:00+00:00',
    commitsSince: 2,
    lastCommit: null,
    namedPaths: ['src/a.ts', 'src/b.ts'],
    gonePaths: [],
    level: 'moved',
  },
  [B.key]: {
    writtenAt: '2026-09-01T10:00:00+00:00',
    commitsSince: 0,
    lastCommit: null,
    namedPaths: [],
    gonePaths: [],
    level: 'fresh',
  },
};

const PLACE: AssistantPlace = {
  selectedKey: A.key,
  repo: null,
  filter: '',
  marked: [B.key],
  isReadyOnly: false,
  isChunkedHidden: false,
  isStaleFirst: false,
  isDoneShown: false,
};

const FULL_TEXT = [
  '# Backlog',
  '',
  '## View',
  '',
  '- Cursor: r / A',
  '- Marked: r / B',
  '- Repo filter: all repos',
  '- Text filter: none',
  '- Ready only: no · Chunked hidden: no · Stale first: no · Done shown: no',
  '',
  '## Cursor item',
  '',
  '### A',
  '',
  `Repo: r · File: ${FOLLOWUPS}:7 · Tags: agent-ready, ui`,
  'Staleness: moved; written 2026-10-01; 2 commits since; gone: none; named: src/a.ts, src/b.ts',
  '',
  'A gist',
  '',
  'A body.',
  '',
  '## Chunks',
  '',
  '- First (r), not started: A',
  '',
  '## Rows',
  '',
  '### r',
  '',
  '| Title | Ready | Staleness | Chunk |',
  '|---|---|---|---|',
  '| A | yes | moved (2 since, 0 gone) | First |',
  '| B | no | fresh (0 since, 0 gone) | — |',
  '',
  '### s',
  '',
  '| Title | Ready | Staleness | Chunk |',
  '|---|---|---|---|',
  '| S1 | no | not read yet | — |',
].join('\n');

// Tool deps over fixed rows, entries and chunks, each read a spy; `scope` is
// what `scopeOf` answers.
function depsOver({
  rows = ROWS,
  loadedRows = rows,
  chunks = [chunk('First', ['A'])],
  place = PLACE,
  scope = 'global',
}: {
  rows?: BacklogRow[];
  loadedRows?: BacklogRow[];
  chunks?: BacklogChunk[];
  place?: AssistantPlace | null;
  scope?: string | null;
} = {}) {
  return {
    scopeOf: vi.fn(async () => scope),
    rows: vi.fn(async () => rows),
    loadRows: vi.fn(async () => loadedRows),
    staleness: vi.fn(() => ENTRIES),
    chunks: {
      chunks: vi.fn(async () => chunks),
      replaceUnstarted: vi.fn(async () => chunks),
    },
    place: vi.fn(() => place),
  } satisfies BacklogToolsDeps;
}

function textOf(result: ToolResult): string {
  return result.content.map((part) => part.text).join('');
}

async function callTool(
  deps: BacklogToolsDeps,
  name: string,
  args: unknown = {},
): Promise<ToolResult> {
  return startBacklogTools(deps)(SESSION).call(name, args, CONTEXT);
}

describe('backlog tools', () => {
  it.each(['read_backlog_state', 'set_backlog_chunks'])(
    'tools_SessionNotTheAssistant_Refused (%s)',
    async (name) => {
      const deps = depsOver({ scope: null });

      const result = await callTool(deps, name, {
        repo: 'r',
        chunks: [{ name: 'One', titles: ['A'] }],
      });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: `${name} answers only the Backlog assistant session.`,
          },
        ],
        isError: true,
      });
      expect(deps.rows).not.toHaveBeenCalled();
      expect(deps.loadRows).not.toHaveBeenCalled();
      expect(deps.place).not.toHaveBeenCalled();
      expect(deps.chunks.chunks).not.toHaveBeenCalled();
      expect(deps.chunks.replaceUnstarted).not.toHaveBeenCalled();
    },
  );

  it('tools_UnknownName_Rejects', async () => {
    await expect(callTool(depsOver(), 'nope')).rejects.toThrow(
      'no backlog tool "nope"',
    );
  });

  it('readBacklogState_PlaceAndRows_ExactText', async () => {
    const result = await callTool(depsOver(), 'read_backlog_state');

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe(FULL_TEXT);
  });

  it.each([
    {
      name: 'no entry',
      cursor: S1,
      line: 'Staleness: not read yet.',
    },
    {
      name: 'an entry',
      cursor: B,
      line: 'Staleness: fresh; written 2026-09-01; 0 commits since; gone: none; named: none',
    },
  ])(
    'readBacklogState_CursorNotRead_NotReadYetLine ($name)',
    async ({ cursor, line }) => {
      const deps = depsOver({ place: { ...PLACE, selectedKey: cursor.key } });

      const text = textOf(await callTool(deps, 'read_backlog_state'));

      expect(text.split('\n')).toContain(line);
    },
  );

  it('readBacklogState_NoPlace_PageNotOpenedLine', async () => {
    const text = textOf(
      await callTool(depsOver({ place: null }), 'read_backlog_state'),
    );

    expect(text).toContain(
      '# Backlog\n\n## View\n\nThe Backlog page has not been opened.\n\n## Chunks',
    );
    expect(text).not.toContain('## Cursor item');
  });

  it.each<{
    name: string;
    place: Partial<AssistantPlace>;
    present: string[];
    absent: string[];
  }>([
    {
      name: 'done shown adds the done row',
      place: { isDoneShown: true },
      present: [
        '| Done | no | not read yet | — |',
        '- Ready only: no · Chunked hidden: no · Stale first: no · Done shown: yes',
      ],
      absent: [],
    },
    {
      name: 'done hidden leaves the done row out',
      place: {},
      present: [],
      absent: ['| Done | no | not read yet | — |'],
    },
    {
      name: 'a cursor no row has',
      place: { selectedKey: rowKey('r', 'Gone') },
      present: ['- Cursor: none'],
      absent: ['## Cursor item'],
    },
    {
      name: 'no cursor',
      place: { selectedKey: null },
      present: ['- Cursor: none'],
      absent: ['## Cursor item'],
    },
    {
      name: 'a marked key no row has',
      place: { marked: [rowKey('r', 'Gone'), S1.key] },
      present: ['- Marked: s / S1'],
      absent: [],
    },
    {
      name: 'nothing marked',
      place: { marked: [] },
      present: ['- Marked: none'],
      absent: [],
    },
    {
      name: 'a repo filter',
      place: { repo: 'r' },
      present: ['- Repo filter: r'],
      absent: [],
    },
    {
      name: 'a text filter',
      place: { filter: 'chip' },
      present: ['- Text filter: "chip"'],
      absent: [],
    },
    {
      name: 'every flag set',
      place: { isReadyOnly: true, isChunkedHidden: true, isStaleFirst: true },
      present: [
        '- Ready only: yes · Chunked hidden: yes · Stale first: yes · Done shown: no',
      ],
      absent: [],
    },
  ])('backlogStateText_ViewVariants ($name)', ({ place, present, absent }) => {
    const text = backlogStateText({
      rows: ROWS,
      staleness: ENTRIES,
      chunks: [],
      place: { ...PLACE, ...place },
    });

    const lines = text.split('\n');
    for (const line of present) {
      expect(lines).toContain(line);
    }
    for (const line of absent) {
      expect(lines).not.toContain(line);
    }
  });

  it('backlogStateText_NoChunks_NoneLine', () => {
    const text = backlogStateText({
      rows: ROWS,
      staleness: ENTRIES,
      chunks: [],
      place: PLACE,
    });

    expect(text).toContain('## Chunks\n\nNone.\n\n## Rows');
  });

  it('backlogStateText_ChunkLines_StartedHeadlessUnstarted', () => {
    const chunks = [
      chunk('Running', ['A'], { sessionId: 'row-9' }),
      chunk('Later', ['B', 'Done'], { headless: true }),
      chunk('Plain', ['S1'], { repo: 's' }),
    ];

    const text = backlogStateText({
      rows: ROWS,
      staleness: ENTRIES,
      chunks,
      place: PLACE,
    });

    expect(text).toContain(
      [
        '## Chunks',
        '',
        '- Running (r), started: session row-9: A',
        '- Later (r), not started, headless: B; Done',
        '- Plain (s), not started: S1',
      ].join('\n'),
    );
  });

  it('backlogStateText_CellWithPipe_Escaped', () => {
    const piped = row('r', 'A | B');

    const text = backlogStateText({
      rows: [piped],
      staleness: {},
      chunks: [chunk('X|Y', ['A | B'])],
      place: PLACE,
    });

    expect(text.split('\n')).toContain(
      '| A \\| B | no | not read yet | X\\|Y |',
    );
  });

  it.each<{
    name: string;
    args: unknown;
    // The rows a new load gives, when not the last load's.
    loadedRows?: BacklogRow[];
    text: string;
    isError: boolean;
    after: Pick<BacklogChunk, 'name' | 'titles'>[];
  }>([
    {
      name: 'a repo with no rows',
      args: { repo: 'x', chunks: [] },
      text: 'Refused: no follow-ups in x.',
      isError: true,
      after: [{ name: 'Old', titles: ['A'] }],
    },
    {
      name: 'a repo that is no string',
      args: { repo: 5, chunks: [] },
      text: 'Refused: repo must be a string.',
      isError: true,
      after: [{ name: 'Old', titles: ['A'] }],
    },
    {
      name: 'chunks not a list',
      args: { repo: 'r', chunks: 'One' },
      text: 'Refused: chunks must be a list of { name, titles }.',
      isError: true,
      after: [{ name: 'Old', titles: ['A'] }],
    },
    {
      name: 'a chunk whose titles are no list',
      args: { repo: 'r', chunks: [{ name: 'One', titles: 'A' }] },
      text: 'Refused: chunks must be a list of { name, titles }.',
      isError: true,
      after: [{ name: 'Old', titles: ['A'] }],
    },
    {
      name: 'a store refusal',
      args: { repo: 'r', chunks: [{ name: 'One', titles: ['Z'] }] },
      text: 'Refused: No follow-up titled Z in r',
      isError: true,
      after: [{ name: 'Old', titles: ['A'] }],
    },
    {
      name: 'one plan',
      args: { repo: 'r', chunks: [{ name: 'One', titles: ['A', 'B'] }] },
      text: 'Set 1 unstarted chunks for r: One (2).',
      isError: false,
      after: [{ name: 'One', titles: ['A', 'B'] }],
    },
    {
      name: 'a title only a new load holds',
      args: { repo: 'r', chunks: [{ name: 'One', titles: ['Fresh'] }] },
      loadedRows: [...ROWS, row('r', 'Fresh')],
      text: 'Set 1 unstarted chunks for r: One (1).',
      isError: false,
      after: [{ name: 'One', titles: ['Fresh'] }],
    },
    {
      name: 'an empty list',
      args: { repo: 'r', chunks: [] },
      text: 'Set no unstarted chunks for r.',
      isError: false,
      after: [],
    },
  ])(
    'setBacklogChunks_Cases ($name)',
    async ({ args, loadedRows, text, isError, after }) => {
      const data = createMemoryFiles();
      await data.write(
        'chunks.json',
        JSON.stringify({ chunks: [chunk('Old', ['A'])] }),
      );
      const store = createChunkStore({
        data,
        randomHex: () => 'new',
        clock: { now: () => 0 },
        restored: async () => undefined,
        isHeld: () => true,
        log: () => undefined,
        changed: () => undefined,
      });
      const deps = { ...depsOver({ loadedRows }), chunks: store };

      const result = await callTool(deps, 'set_backlog_chunks', args);

      expect(textOf(result)).toBe(text);
      expect(result.isError ?? false).toBe(isError);
      expect(
        (await store.chunks()).map(({ name, titles }) => ({ name, titles })),
      ).toEqual(after);
    },
  );

  it.each<{
    name: string;
    place: BacklogPlace | undefined;
    expected: AssistantPlace | null;
  }>([
    { name: 'never opened', place: undefined, expected: null },
    {
      name: 'every field set',
      place: {
        selectedKey: A.key,
        filter: 'chip',
        repo: 'r',
        marked: [B.key],
        isReadyOnly: true,
        isChunkedHidden: true,
        isStaleFirst: true,
        isDoneShown: true,
        isAssistantShown: true,
      },
      expected: {
        selectedKey: A.key,
        repo: 'r',
        filter: 'chip',
        marked: [B.key],
        isReadyOnly: true,
        isChunkedHidden: true,
        isStaleFirst: true,
        isDoneShown: true,
      },
    },
  ])('assistantPlace_ByPlace ($name)', ({ place, expected }) => {
    expect(assistantPlace(place)).toEqual(expected);
  });
});
