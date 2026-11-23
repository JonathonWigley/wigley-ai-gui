import { describe, expect, it } from 'vitest';
import { DESIGN_PLAN_FORMAT, DESIGN_SOURCE } from './fixtures.test-support';
import { planFormatReader } from './plan-format-reader';

// The design's `planFormat` with `fields` over it.
function withFields(fields: Record<string, unknown>): unknown {
  return { ...structuredClone(DESIGN_PLAN_FORMAT), ...fields };
}

describe('planFormatReader', () => {
  it('Read_TheDesignPlanFormat_Passes', () => {
    expect(planFormatReader.read(DESIGN_PLAN_FORMAT, DESIGN_SOURCE)).toEqual({
      ok: true,
      value: DESIGN_PLAN_FORMAT,
    });
  });

  it('Read_AnEmptySection_PassesForTheDefaults', () => {
    expect(planFormatReader.read({}, DESIGN_SOURCE)).toEqual({
      ok: true,
      value: {},
    });
  });

  it.each([
    { name: 'not an object', section: ['plan.md'], reason: /^not an object$/ },
    {
      name: 'a pattern that does not compile',
      section: withFields({ groupHeading: { pattern: '(', title: 'W' } }),
      reason: /^\.groupHeading\.pattern: does not compile: /,
    },
    {
      name: 'a folder that is not a string',
      section: withFields({ folder: 3 }),
      reason: /^\.folder: not a string$/,
    },
    {
      name: 'a link that is not bareMd',
      section: withFields({
        taskDocs: { ...DESIGN_PLAN_FORMAT.taskDocs, link: 'wiki' },
      }),
      reason: /^\.taskDocs\.link: not bareMd$/,
    },
    {
      name: 'a fractional statusLines',
      section: withFields({
        taskDocs: { ...DESIGN_PLAN_FORMAT.taskDocs, statusLines: 1.5 },
      }),
      reason: /^\.taskDocs\.statusLines: not a positive whole number$/,
    },
  ])('Read_$name_IsRefused', ({ section, reason }) => {
    const result = planFormatReader.read(section, DESIGN_SOURCE);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.reasons).toEqual([
      expect.stringMatching(reason),
    ]);
  });
});
