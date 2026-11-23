import { describe, expect, it } from 'vitest';
import {
  SAMPLE_PLAN_FORMAT,
  SAMPLE_SOURCE,
} from './sample-fixtures.test-support';
import { planFormatReader } from './plan-format-reader';

// The design's `planFormat` with `fields` over it.
function withFields(fields: Record<string, unknown>): unknown {
  return { ...structuredClone(SAMPLE_PLAN_FORMAT), ...fields };
}

describe('planFormatReader', () => {
  it('Read_TheDesignPlanFormat_Passes', () => {
    expect(planFormatReader.read(SAMPLE_PLAN_FORMAT, SAMPLE_SOURCE)).toEqual({
      ok: true,
      value: SAMPLE_PLAN_FORMAT,
    });
  });

  it('Read_AnEmptySection_PassesForTheDefaults', () => {
    expect(planFormatReader.read({}, SAMPLE_SOURCE)).toEqual({
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
        taskDocs: { ...SAMPLE_PLAN_FORMAT.taskDocs, link: 'wiki' },
      }),
      reason: /^\.taskDocs\.link: not bareMd$/,
    },
    {
      name: 'a fractional statusLines',
      section: withFields({
        taskDocs: { ...SAMPLE_PLAN_FORMAT.taskDocs, statusLines: 1.5 },
      }),
      reason: /^\.taskDocs\.statusLines: not a positive whole number$/,
    },
  ])('Read_$name_IsRefused', ({ section, reason }) => {
    const result = planFormatReader.read(section, SAMPLE_SOURCE);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.reasons).toEqual([
      expect.stringMatching(reason),
    ]);
  });
});
