import { describe, expect, it } from 'vitest';
import { parseRound } from './round';
import { RoundError } from './round-error';
import { FORMS_TOOLS } from './tool-definitions';

interface ArraySchema {
  maxItems?: number;
  items: { required: string[] };
}

function itemListSchema(argsKey: string): ArraySchema {
  const tool = FORMS_TOOLS.find((each) => each.name === 'ask_round');
  if (tool === undefined) {
    throw new Error('FORMS_TOOLS has no ask_round');
  }
  const properties = tool.inputSchema.properties as Record<string, unknown>;
  return properties[argsKey] as ArraySchema;
}

function roundWith(argsKey: string, items: unknown[]): unknown {
  return { heading: 'H', [argsKey]: items };
}

describe('FORMS_TOOLS ask_round schema', () => {
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

      expect(schema.maxItems).toBeUndefined();
      expect(() => parseRound(roundWith(argsKey, many))).not.toThrow();
      expect(() =>
        parseRound(roundWith(argsKey, [{ ...item, unpublished: 1 }])),
      ).toThrow(RoundError);
      for (const field of schema.items.required) {
        const missing: Record<string, unknown> = { ...item };
        delete missing[field];

        expect(() => parseRound(roundWith(argsKey, [missing])), field).toThrow(
          RoundError,
        );
      }
    },
  );
});
