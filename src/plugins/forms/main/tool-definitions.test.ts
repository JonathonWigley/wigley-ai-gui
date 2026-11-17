import { describe, expect, it } from 'vitest';
import { type MainItemKind, RoundError } from '../contract';
import { BUILT_IN_KINDS } from './kinds/formats';
import { POLL_SCHEMA, pollKind } from './kinds/poll-kind.test-support';
import { parseRound } from './round';
import { formsTools } from './tool-definitions';

interface ArraySchema {
  maxItems?: number;
  items: { required: string[] };
}

function askRoundProperties(
  kinds: readonly MainItemKind[],
): Record<string, unknown> {
  const tool = formsTools(kinds).find((each) => each.name === 'ask_round');
  if (tool === undefined) {
    throw new Error('formsTools has no ask_round');
  }
  return tool.inputSchema.properties as Record<string, unknown>;
}

function itemListSchema(argsKey: string): ArraySchema {
  return askRoundProperties(BUILT_IN_KINDS)[argsKey] as ArraySchema;
}

function roundWith(argsKey: string, items: unknown[]): unknown {
  return { heading: 'H', [argsKey]: items };
}

describe('formsTools ask_round schema', () => {
  it.each([
    {
      argsKey: 'notices',
      item: { title: 'Renamed the helper', context: 'One line.' },
    },
    {
      argsKey: 'findings',
      item: {
        title: 'Stale cache',
        origin: 'caused',
        severity: 'important',
        impact: 'Users see stale data after a reload.',
        finding: 'The cache keeps entries after a reload.',
        proof: '- `cache.ts:40` never clears',
        choices: [{ text: 'Fix it now', reason: 'It is one line.' }],
        recommend: 1,
        recommend_action: 'fix_now',
      },
    },
    {
      argsKey: 'questions',
      item: {
        title: 'Naming',
        summary: 'Which name should win?',
        context: 'Two modules do the same thing.',
        choices: ['module_a', 'module_b'],
        recommend: 2,
        rationale: 'module_b is referenced elsewhere.',
      },
    },
  ])(
    'publishes the $argsKey required fields that parseRound enforces, and no item cap',
    ({ argsKey, item }) => {
      const schema = itemListSchema(argsKey);
      const many = Array.from({ length: 61 }, () => item);
      const parse = (args: unknown) => parseRound(BUILT_IN_KINDS, args);

      expect(schema.maxItems).toBeUndefined();
      expect(() => parse(roundWith(argsKey, many))).not.toThrow();
      expect(() =>
        parse(roundWith(argsKey, [{ ...item, unpublished: 1 }])),
      ).toThrow(RoundError);
      for (const field of schema.items.required) {
        const missing: Record<string, unknown> = { ...item };
        delete missing[field];

        expect(() => parse(roundWith(argsKey, [missing])), field).toThrow(
          RoundError,
        );
      }
    },
  );

  it("adds a registered kind's list, with its schema, after the questions", () => {
    const properties = askRoundProperties([...BUILT_IN_KINDS, pollKind]);

    expect(Object.keys(properties).slice(-2)).toEqual(['questions', 'polls']);
    expect(properties.polls).toEqual(POLL_SCHEMA);
  });
});
