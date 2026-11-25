import { describe, expect, it } from 'vitest';
import type { Review } from '../contract';
import type { VerdictInput } from '../layouts/layout';
import { verdictInput } from './verdict-input';

describe('verdictInput', () => {
  it.each<{
    case: string;
    review: Review | null;
    expected: VerdictInput | null;
  }>([
    { case: 'NoReview_Null', review: null, expected: null },
    {
      case: 'Reviewing_HeadingOnly',
      review: { state: 'reviewing' },
      expected: {
        state: 'reviewing',
        heading: 'Reviewing…',
        detail: null,
        verdict: null,
        risk: null,
      },
    },
    {
      case: 'DoneApproveLow_VerdictAndRiskWithSummary',
      review: {
        state: 'done',
        summary: 'Reads one file in the project.',
        verdict: 'approve',
        risk: 'low',
      },
      expected: {
        state: 'done',
        heading: 'Approve · low risk',
        detail: 'Reads one file in the project.',
        verdict: 'approve',
        risk: 'low',
      },
    },
    {
      case: 'DoneDenyMedium_VerdictAndRiskWithSummary',
      review: {
        state: 'done',
        summary: 'Pushes to a shared branch.',
        verdict: 'deny',
        risk: 'medium',
      },
      expected: {
        state: 'done',
        heading: 'Deny · medium risk',
        detail: 'Pushes to a shared branch.',
        verdict: 'deny',
        risk: 'medium',
      },
    },
    {
      case: 'DoneDenyHigh_VerdictAndRiskWithSummary',
      review: {
        state: 'done',
        summary: 'Deletes the home folder.',
        verdict: 'deny',
        risk: 'high',
      },
      expected: {
        state: 'done',
        heading: 'Deny · high risk',
        detail: 'Deletes the home folder.',
        verdict: 'deny',
        risk: 'high',
      },
    },
    {
      case: 'Unavailable_HeadingWithReason',
      review: { state: 'unavailable', reason: 'fake ask failed' },
      expected: {
        state: 'unavailable',
        heading: 'Review unavailable',
        detail: 'fake ask failed',
        verdict: null,
        risk: null,
      },
    },
  ])('$case', ({ review, expected }) => {
    expect(verdictInput(review)).toEqual(expected);
  });
});
