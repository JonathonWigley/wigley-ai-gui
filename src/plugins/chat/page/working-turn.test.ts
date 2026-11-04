import { describe, expect, it } from 'vitest';
import {
  type ChatEntry,
  type ChatEntryKind,
  MAIN_AGENT_ID,
} from '../../../contracts/agent';
import type { SessionCompaction } from '../contract';
import type { WorkingState } from '../layouts/layout';
import { doneInput, workingInput } from './working-turn';

const SUBAGENT_ID = 'agent-1';

function entry(kind: ChatEntryKind, id: string, at: number): ChatEntry {
  switch (kind) {
    case 'user':
      return { kind, id, at, text: 'ask', images: [], raw: [] };
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
        result: { text: 'done', isError: false },
        raw: [],
      };
    case 'permission':
      return {
        kind,
        id,
        at,
        toolName: 'Bash',
        input: {},
        answer: { allowed: true, reason: null },
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

// Each spec is `<kind>:<id>@<at>`, with an optional `!` after the kind for an
// entry still open (a streaming assistant or thinking, a tool with no result,
// a permission with no answer) and `~` for a subagent's tool. A result may add
// `$<cost>` and `/<stop reason>` after its time.
function entries(...specs: string[]): ChatEntry[] {
  return specs.map((spec) => {
    const match = /^(\w+)(!?)(~?):(\w+)@(\d+)(?:\$([\d.]+))?(?:\/(\w+))?$/.exec(
      spec,
    );
    if (match === null) {
      throw new Error(`bad spec ${spec}`);
    }
    const [, kindName, open, subagent, id, at, cost, stopReason] = match;
    const kind = kindName as ChatEntryKind;
    const built = entry(kind, id, Number(at));
    if (built.kind === 'tool' && subagent !== '') {
      built.agentId = SUBAGENT_ID;
    }
    if (built.kind === 'result') {
      built.costUsd = cost === undefined ? null : Number(cost);
      built.stopReason = stopReason ?? built.stopReason;
    }
    if (open === '') {
      return built;
    }
    switch (built.kind) {
      case 'assistant':
      case 'thinking':
        return { ...built, streaming: true };
      case 'tool':
        return { ...built, result: null };
      case 'permission':
        return { ...built, answer: null };
      default:
        throw new Error(`${kind} has no open form`);
    }
  });
}

describe('workingInput', () => {
  it.each([
    {
      given: 'an unanswered permission and a running tool',
      list: entries('user:u@100', 'tool!:t@110', 'permission!:p@120'),
      expected: 'waiting',
    },
    {
      given: 'a running tool only',
      list: entries('user:u@100', 'tool!:t@110', 'permission:p@120'),
      expected: 'working',
    },
    {
      given: 'a streaming assistant last',
      list: entries('user:u@100', 'tool:t@110', 'assistant!:a@120'),
      expected: 'writing',
    },
    {
      given: 'a streaming thinking last',
      list: entries('user:u@100', 'assistant!:a@110', 'thinking!:k@120'),
      expected: 'thinking',
    },
    {
      given: 'a finished assistant last',
      list: entries('user:u@100', 'assistant:a@110'),
      expected: 'thinking',
    },
    {
      given: 'only the user entry',
      list: entries('user:u@100'),
      expected: 'thinking',
    },
    {
      given: 'a running tool before the last user entry',
      list: entries('user:u1@100', 'tool!:t@110', 'user:u2@120'),
      expected: 'thinking',
    },
    {
      given: "a finished main tool and a subagent's running tool",
      list: entries('user:u@100', 'tool:a@110', 'tool!~:s@120'),
      expected: 'thinking',
    },
  ])('workingInput state with $given → $expected', ({ list, expected }) => {
    expect(workingInput(list, 900, null).state).toBe(expected);
  });

  it.each([
    {
      given: 'a second user turn',
      list: entries(
        'user:u1@100',
        'tool:a@110',
        'result:r@120',
        'user:u2@150',
        'tool:b@160',
      ),
      now: 900,
      expected: { startedAt: 150, steps: ['b'], now: 900 },
    },
    {
      given: 'a turn Claude started',
      list: entries(
        'user:u@100',
        'tool:a@110',
        'result:r@120',
        'tool:b@130',
        'thinking:c@140',
      ),
      now: 900,
      expected: { startedAt: 130, steps: ['b', 'c'], now: 900 },
    },
    {
      given: 'no user and no result',
      list: entries('tool:a@100', 'raw:b@110'),
      now: 900,
      expected: { startedAt: 100, steps: ['a', 'b'], now: 900 },
    },
    {
      given: 'every step kind',
      list: entries('user:u@100', 'thinking:a@110', 'raw:b@115', 'tool:c@120'),
      now: 900,
      expected: { startedAt: 100, steps: ['a', 'b', 'c'], now: 900 },
    },
    {
      given: "a subagent's tool between two main tools",
      list: entries('user:u@100', 'tool:a@110', 'tool~:s@115', 'tool:b@120'),
      now: 900,
      expected: { startedAt: 100, steps: ['a', 'b'], now: 900 },
    },
    {
      given: 'no entries',
      list: [],
      now: 500,
      expected: { startedAt: 500, steps: [], now: 500 },
    },
  ])(
    'workingInput bounds with $given → $expected',
    ({ list, now, expected }) => {
      const input = workingInput(list, now, null);
      expect({
        startedAt: input.startedAt,
        steps: input.steps.map((step) => step.id),
        now: input.now,
      }).toEqual(expected);
    },
  );

  it.each<{
    given: string;
    compaction: SessionCompaction | null;
    state: WorkingState;
    label: string | null;
    startedAt: number;
  }>([
    {
      given: 'app',
      compaction: {
        trigger: 'app',
        reason: 'auto · cache cold · 182k',
        startedAt: 700,
      },
      state: 'compacting',
      label: 'auto · cache cold · 182k',
      startedAt: 700,
    },
    {
      given: 'app, no reason',
      compaction: { trigger: 'app', reason: null, startedAt: 700 },
      state: 'compacting',
      label: 'auto',
      startedAt: 700,
    },
    {
      given: 'manual',
      compaction: { trigger: 'manual', reason: null, startedAt: 700 },
      state: 'compacting',
      label: '/compact',
      startedAt: 700,
    },
    {
      given: 'harness',
      compaction: { trigger: 'harness', reason: null, startedAt: 700 },
      state: 'compacting',
      label: 'autocompact',
      startedAt: 700,
    },
    {
      given: 'none',
      compaction: null,
      state: 'working',
      label: null,
      startedAt: 100,
    },
  ])(
    'workingInput_Compaction ($given → $state, $label)',
    ({ compaction, state, label, startedAt }) => {
      const input = workingInput(
        entries('user:u@100', 'tool!:t@110'),
        900,
        compaction,
      );

      expect({
        state: input.state,
        compaction: input.compaction,
        startedAt: input.startedAt,
      }).toEqual({ state, compaction: label, startedAt });
    },
  );
});

describe('doneInput', () => {
  it.each([
    {
      given: 'one result with a cost',
      list: entries('user:u@100', 'tool:a@110', 'result:r@900$0.25'),
      expected: {
        steps: ['a'],
        startedAt: 100,
        endedAt: 900,
        stopReason: 'end_turn',
        costUsd: 0.25,
      },
    },
    {
      given: 'two results, one with a null cost',
      list: entries('user:u@100', 'result:r1@900$0.25', 'result:r2@1500'),
      expected: {
        steps: [],
        startedAt: 100,
        endedAt: 1500,
        stopReason: 'end_turn',
        costUsd: 0.25,
      },
    },
    {
      given: 'two results with costs',
      list: entries('user:u@100', 'result:r1@900$0.25', 'result:r2@1500$0.5'),
      expected: {
        steps: [],
        startedAt: 100,
        endedAt: 1500,
        stopReason: 'end_turn',
        costUsd: 0.75,
      },
    },
    {
      given: 'every cost null',
      list: entries('user:u@100', 'result:r1@900', 'result:r2@1500'),
      expected: {
        steps: [],
        startedAt: 100,
        endedAt: 1500,
        stopReason: 'end_turn',
        costUsd: null,
      },
    },
    {
      given: 'a last stop reason of max_tokens',
      list: entries(
        'user:u@100',
        'result:r1@900$0.25/success',
        'result:r2@1500/max_tokens',
      ),
      expected: {
        steps: [],
        startedAt: 100,
        endedAt: 1500,
        stopReason: 'max_tokens',
        costUsd: 0.25,
      },
    },
    {
      given: 'no user entry',
      list: entries('tool:a@200', 'raw:b@210', 'result:r@900$0.25'),
      expected: {
        steps: ['a', 'b'],
        startedAt: 200,
        endedAt: 900,
        stopReason: 'end_turn',
        costUsd: 0.25,
      },
    },
    {
      given: 'no result after the last user entry',
      list: entries('user:u1@100', 'result:r@900$0.25', 'user:u2@1000'),
      expected: null,
    },
    {
      given: "a subagent's tool in the turn",
      list: entries(
        'user:u@100',
        'tool:a@110',
        'tool~:s@115',
        'thinking:c@120',
        'result:r@900',
      ),
      expected: {
        steps: ['a', 'c'],
        startedAt: 100,
        endedAt: 900,
        stopReason: 'end_turn',
        costUsd: null,
      },
    },
    {
      given: 'a result before the last one, the live turn starting after it',
      list: entries(
        'user:u@100',
        'result:r1@900$0.25',
        'tool:a@1000',
        'result:r2@1500$0.5',
      ),
      expected: {
        steps: ['a'],
        startedAt: 100,
        endedAt: 1500,
        stopReason: 'end_turn',
        costUsd: 0.75,
      },
    },
  ])('doneInput ($given)', ({ list, expected }) => {
    const input = doneInput(list);
    expect(
      input === null
        ? null
        : {
            steps: input.steps.map((step) => step.id),
            startedAt: input.startedAt,
            endedAt: input.endedAt,
            stopReason: input.stopReason,
            costUsd: input.costUsd,
          },
    ).toEqual(expected);
  });
});
