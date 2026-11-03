import { describe, expect, it } from 'vitest';
import type { ChatEntry, ChatEntryKind } from '../../../contracts/agent';
import { workingInput } from './working-turn';

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
  }
}

// Each spec is `<kind>:<id>@<at>`, with an optional `!` after the kind for an
// entry still open: a streaming assistant or thinking, a tool with no result,
// a permission with no answer.
function entries(...specs: string[]): ChatEntry[] {
  return specs.map((spec) => {
    const [kindAndId, at] = spec.split('@');
    const [kindMark, id] = kindAndId.split(':');
    const open = kindMark.endsWith('!');
    const kind = kindMark.replace('!', '') as ChatEntryKind;
    const built = entry(kind, id, Number(at));
    if (!open) {
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
  ])('workingInput state with $given → $expected', ({ list, expected }) => {
    expect(workingInput(list, 900).state).toBe(expected);
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
      given: 'no entries',
      list: [],
      now: 500,
      expected: { startedAt: 500, steps: [], now: 500 },
    },
  ])(
    'workingInput bounds with $given → $expected',
    ({ list, now, expected }) => {
      const input = workingInput(list, now);
      expect({
        startedAt: input.startedAt,
        steps: input.steps.map((step) => step.id),
        now: input.now,
      }).toEqual(expected);
    },
  );
});
