import { describe, expect, it } from 'vitest';
import {
  type ChatEntry,
  type ChatEntryKind,
  MAIN_AGENT_ID,
} from '../../../contracts/agent';
import { cursorStops, type ListRow, listRows, runIdOf } from './activity-runs';

function entry(kind: ChatEntryKind, id: string, at = 1000): ChatEntry {
  switch (kind) {
    case 'user':
      return { kind, id, at, text: 'ask', images: [], delivery: null, raw: [] };
    case 'assistant':
    case 'thinking':
      return { kind, id, at, text: 'text', streaming: false, raw: [] };
    case 'tool':
      return {
        kind,
        id,
        at,
        agentId: MAIN_AGENT_ID,
        toolUseId: `use-${id}`,
        name: 'Read',
        input: {},
        summary: 'Read a file',
        result: null,
        raw: [],
      };
    case 'permission':
      return {
        kind,
        id,
        at,
        toolName: 'Bash',
        input: {},
        answer: null,
        raw: [],
      };
    case 'result':
      return {
        kind,
        id,
        at,
        stopReason: 'end_turn',
        costUsd: null,
        durationMs: null,
        raw: [],
      };
    case 'notice':
      return { kind, id, at, text: 'note', tone: 'info', raw: [] };
    case 'raw':
      return { kind, id, at, raw: [] };
    case 'compaction':
      return {
        kind,
        id,
        at,
        trigger: 'app',
        beforeTokens: null,
        afterTokens: null,
        durationMs: null,
        raw: [],
      };
  }
}

// Each spec is `<kind>:<id>` or `<kind>:<id>@<at>`.
function entries(...specs: string[]): ChatEntry[] {
  return specs.map((spec) => {
    const [kindAndId, at] = spec.split('@');
    const [kind, id] = kindAndId.split(':');
    return entry(
      kind as ChatEntryKind,
      id,
      at === undefined ? 1000 : Number(at),
    );
  });
}

function rowLabel(row: ListRow): string {
  return row.kind === 'entry'
    ? `entry:${row.entry.id}`
    : `run:${row.runId}:${row.live}`;
}

describe('activity runs', () => {
  it.each([
    {
      given: 'steps between a user and an assistant message',
      list: entries('user:u', 'tool:t', 'thinking:k', 'assistant:a'),
      working: true,
      expected: ['entry:u', 'run:activity:t:false', 'entry:a'],
    },
    {
      given: 'a permission between two runs while working',
      list: entries('tool:t1', 'permission:p', 'tool:t2'),
      working: true,
      expected: ['run:activity:t1:false', 'entry:p', 'run:activity:t2:true'],
    },
    {
      given: 'a run ended by a result while working',
      list: entries('tool:t', 'result:r'),
      working: true,
      expected: ['run:activity:t:false', 'entry:r'],
    },
    {
      given: 'a raw entry alone, not working',
      list: entries('raw:w'),
      working: false,
      expected: ['run:activity:w:false'],
    },
    {
      given: 'no steps',
      list: entries('user:u', 'assistant:a'),
      working: true,
      expected: ['entry:u', 'entry:a'],
    },
  ])('listRows of $given → $expected', ({ list, working, expected }) => {
    expect(listRows(list, working).map(rowLabel)).toEqual(expected);
  });

  it.each([
    {
      given: 'a user message before and an assistant message after',
      list: entries(
        'user:u@1000',
        'tool:t1@3000',
        'tool:t2@9000',
        'assistant:a@43000',
      ),
      working: true,
      expected: { startedAt: 1000, endedAt: 43000 },
    },
    {
      given: 'a run that opens the list',
      list: entries('tool:t1@3000', 'thinking:k@9000', 'assistant:a@43000'),
      working: true,
      expected: { startedAt: 3000, endedAt: 43000 },
    },
    {
      given: 'a live run',
      list: entries('user:u@1000', 'tool:t1@3000', 'tool:t2@9000'),
      working: true,
      expected: { startedAt: 1000, endedAt: null },
    },
    {
      given: 'a finished run that is the last row',
      list: entries('user:u@1000', 'tool:t1@3000', 'tool:t2@9000'),
      working: false,
      expected: { startedAt: 1000, endedAt: 9000 },
    },
    {
      given: 'a permission before the run',
      list: entries(
        'user:u@1000',
        'permission:p@5000',
        'tool:t1@7000',
        'result:r@20000',
      ),
      working: true,
      expected: { startedAt: 5000, endedAt: 20000 },
    },
  ])(
    'listRows times a run with $given → $expected',
    ({ list, working, expected }) => {
      const run = listRows(list, working).find((row) => row.kind === 'run');
      expect(run).toMatchObject(expected);
    },
  );

  const twoRuns = listRows(
    entries(
      'user:u',
      'tool:t1',
      'raw:w',
      'assistant:a',
      'thinking:k',
      'tool:t2',
    ),
    false,
  );

  it.each([
    {
      given: 'a closed run',
      rows: listRows(
        entries('user:u', 'tool:t1', 'raw:w', 'assistant:a'),
        false,
      ),
      open: [],
      expected: ['u', 'activity:t1', 'a'],
    },
    {
      given: 'an open run',
      rows: listRows(
        entries('user:u', 'tool:t1', 'raw:w', 'assistant:a'),
        false,
      ),
      open: [runIdOf('t1')],
      expected: ['u', 'activity:t1', 't1', 'w', 'a'],
    },
    {
      given: 'a turn divider and a compaction divider',
      rows: listRows(
        entries('user:u', 'result:r', 'compaction:c', 'assistant:a'),
        false,
      ),
      open: [],
      expected: ['u', 'a'],
    },
    {
      given: 'two runs, the second open',
      rows: twoRuns,
      open: [runIdOf('k')],
      expected: ['u', 'activity:t1', 'a', 'activity:k', 'k', 't2'],
    },
    {
      given: 'blocks on messages, a divider and a notice between',
      rows: listRows(
        entries('user:u', 'assistant:a', 'result:r', 'notice:n', 'assistant:b'),
        false,
      ),
      open: [],
      blocks: [
        ['u', 1],
        ['a', 3],
        ['r', 2],
        ['b', 0],
      ] as const,
      expected: ['u#0', 'a#0', 'a#1', 'a#2', 'n', 'b'],
    },
    {
      given: 'an open run with an entry of blocks after it',
      rows: listRows(entries('tool:t1', 'assistant:a'), false),
      open: [runIdOf('t1')],
      blocks: [['a', 2]] as const,
      expected: ['activity:t1', 't1', 'a#0', 'a#1'],
    },
  ])(
    'cursorStops of $given → $expected',
    ({ rows, open, blocks, expected }) => {
      expect(cursorStops(rows, new Set(open), new Map(blocks))).toEqual(
        expected,
      );
    },
  );
});
