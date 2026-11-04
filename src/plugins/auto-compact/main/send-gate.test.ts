import { describe, expect, it } from 'vitest';
import {
  type AgentEvent,
  MAIN_AGENT_ID,
  type UsageAgentEvent,
} from '../../../contracts/agent';
import { type LatestUsage, sendGateVerdict, withAgentEvent } from './send-gate';

const NOW = 1_000_000;
const MIN_TOKENS = 150000;

function usage(
  contextTokens: number,
  cacheExpiresAt: number | null,
  at = 900_000,
  agentId = MAIN_AGENT_ID,
): UsageAgentEvent {
  return {
    type: 'usage',
    agentId,
    at,
    contextTokens,
    contextWindow: 1_000_000,
    autocompact: { configured: null, reported: null },
    cacheExpiresAt,
    spendUsd: null,
  };
}

const cold = (tokens: number, at = 900_000) => usage(tokens, 999_000, at);
const warm = (tokens: number, at = 900_000) => usage(tokens, 1_001_000, at);

function compactionEnded(
  outcome: 'done' | 'failed' | 'interrupted',
  trigger: 'app' | 'manual' | 'harness' = 'app',
): AgentEvent {
  return {
    type: 'compactionEnded',
    at: 950_000,
    trigger,
    outcome,
    beforeTokens: null,
    durationMs: null,
  };
}

const HELD = { action: 'compact', reason: 'auto · cache cold · 182k' };

interface SendGateRow {
  case: string;
  events: [string, AgentEvent][];
  minTokens?: number;
  ask?: string;
  text?: string;
  expected: { action: string; reason: string } | null;
}

const ROWS: SendGateRow[] = [
  { case: 'ColdAbove', events: [['h1', cold(182_400)]], expected: HELD },
  {
    case: 'ColdAtNow',
    events: [['h1', usage(200_000, NOW)]],
    expected: { action: 'compact', reason: 'auto · cache cold · 200k' },
  },
  { case: 'Warm', events: [['h1', warm(182_400)]], expected: null },
  { case: 'ColdBelow', events: [['h1', cold(120_000)]], expected: null },
  { case: 'ColdAtThreshold', events: [['h1', cold(150_000)]], expected: null },
  {
    case: 'NullExpiry',
    events: [['h1', usage(182_400, null)]],
    expected: null,
  },
  { case: 'NoUsage', events: [], expected: null },
  {
    case: 'MinTokensZero',
    events: [['h1', cold(182_400)]],
    minTokens: 0,
    expected: null,
  },
  {
    case: 'SubagentUsageIgnored',
    events: [
      ['h1', cold(182_400)],
      ['h1', usage(10_000, 1_001_000, 950_000, 'fake-agent-1-1')],
    ],
    expected: HELD,
  },
  {
    case: 'OlderEventIgnored',
    events: [
      ['h1', cold(182_400, 900_000)],
      ['h1', warm(50_000, 800_000)],
    ],
    expected: HELD,
  },
  {
    case: 'NewerEventReplaces',
    events: [
      ['h1', cold(182_400, 900_000)],
      ['h1', cold(40_000, 950_000)],
    ],
    expected: null,
  },
  {
    case: 'EqualAtReplaces',
    events: [
      ['h1', cold(182_400, 900_000)],
      ['h1', cold(40_000, 900_000)],
    ],
    expected: null,
  },
  {
    case: 'SessionEndedKeeps',
    events: [
      ['h1', cold(182_400)],
      ['h1', { type: 'sessionEnded', at: 950_000 }],
    ],
    expected: HELD,
  },
  {
    case: 'CompactionEndedDropsDone',
    events: [
      ['h1', cold(182_400)],
      ['h1', compactionEnded('done')],
    ],
    expected: null,
  },
  {
    case: 'CompactionEndedDropsDoneAnyTrigger',
    events: [
      ['h1', cold(182_400)],
      ['h1', compactionEnded('done', 'harness')],
    ],
    expected: null,
  },
  {
    case: 'CompactionEndedDropsOnlyItsSession',
    events: [
      ['h1', cold(182_400)],
      ['h2', cold(300_000)],
      ['h2', compactionEnded('done')],
    ],
    expected: HELD,
  },
  {
    case: 'CompactionDoneThenLaterReplyRefills',
    events: [
      ['h1', cold(182_400)],
      ['h1', compactionEnded('done')],
      ['h1', cold(300_000, 960_000)],
    ],
    expected: { action: 'compact', reason: 'auto · cache cold · 300k' },
  },
  {
    case: 'CompactionDoneNoUsageAfter_StaysEmpty',
    events: [
      ['h1', cold(182_400)],
      ['h1', compactionEnded('done')],
      ['h1', { type: 'turnEnded', at: 960_000 }],
      ['h1', { type: 'sessionEnded', at: 970_000 }],
    ],
    expected: null,
  },
  {
    case: 'CompactionEndedFailedKeeps',
    events: [
      ['h1', cold(182_400)],
      ['h1', compactionEnded('failed')],
    ],
    expected: HELD,
  },
  {
    case: 'CompactionEndedInterruptedKeeps',
    events: [
      ['h1', cold(182_400)],
      ['h1', compactionEnded('interrupted')],
    ],
    expected: HELD,
  },
  {
    case: 'AfterClearNewHostId',
    events: [['h1', cold(182_400)]],
    ask: 'h2',
    expected: null,
  },
  {
    case: 'SlashCommand_NotHeld',
    events: [['h1', cold(200_000)]],
    text: '/compact',
    expected: null,
  },
  {
    case: 'SlashCommandAfterSpace_NotHeld',
    events: [['h1', cold(200_000)]],
    text: '  \n/compact',
    expected: null,
  },
  {
    case: 'SlashInsideText_Held',
    events: [['h1', cold(182_400)]],
    text: 'read src/main',
    expected: HELD,
  },
];

function fold(events: [string, AgentEvent][]): LatestUsage {
  let latest: LatestUsage = new Map();
  for (const [hostSessionId, event] of events) {
    latest = withAgentEvent(latest, hostSessionId, event);
  }
  return latest;
}

describe('send gate', () => {
  it.each(ROWS)('sendGate_$case', (row) => {
    const latest = fold(row.events);
    const verdict = sendGateVerdict(
      latest.get(row.ask ?? 'h1') ?? null,
      row.minTokens ?? MIN_TOKENS,
      row.text ?? 'hello',
      NOW,
    );
    expect(verdict).toEqual(row.expected);
  });

  it.each<{ name: string; hostSessionId: string; event: AgentEvent }>([
    {
      name: 'a subagent usage',
      hostSessionId: 'h1',
      event: usage(10_000, 1_001_000, 950_000, 'fake-agent-1-1'),
    },
    {
      name: 'an older main usage',
      hostSessionId: 'h1',
      event: warm(50_000, 800_000),
    },
    {
      name: 'turnEnded',
      hostSessionId: 'h1',
      event: { type: 'turnEnded', at: 950_000 },
    },
    {
      name: 'sessionEnded for a known host id',
      hostSessionId: 'h1',
      event: { type: 'sessionEnded', at: 950_000 },
    },
    {
      name: 'sessionEnded for an unknown host id',
      hostSessionId: 'h9',
      event: { type: 'sessionEnded', at: 950_000 },
    },
    {
      name: 'a failed compaction',
      hostSessionId: 'h1',
      event: compactionEnded('failed'),
    },
    {
      name: 'a done compaction for an unknown host id',
      hostSessionId: 'h9',
      event: compactionEnded('done'),
    },
  ])(
    'withAgentEvent_NoChange_ReturnsSameMap: $name',
    ({ hostSessionId, event }) => {
      const latest = fold([['h1', cold(182_400)]]);
      expect(withAgentEvent(latest, hostSessionId, event)).toBe(latest);
    },
  );
});
