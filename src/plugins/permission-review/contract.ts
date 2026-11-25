// The permission-review plugin's slot.

import type { KeyedSlotKey } from '../../contracts/state';

export type ReviewVerdict = 'approve' | 'deny';
export type ReviewRisk = 'low' | 'medium' | 'high';

// One request's review: `reviewing` while the ask runs, `done` with the
// reviewer's summary and verdict, or `unavailable` with why there is none.
export type Review =
  | { state: 'reviewing' }
  | {
      state: 'done';
      summary: string;
      verdict: ReviewVerdict;
      risk: ReviewRisk;
    }
  | { state: 'unavailable'; reason: string };

// Each request's review, by `chatReviewKey` for a chat permission entry and
// `confirmReviewKey` for a forms confirm round, until its request goes.
export const permissionReviewsSlot: KeyedSlotKey<
  Review,
  'main',
  'permission-review'
> = {
  id: 'permission-review.reviews',
  process: 'main',
  kind: 'keyed',
};

export function chatReviewKey(sessionId: string, entryId: string): string {
  return `${sessionId}/${entryId}`;
}

export function confirmReviewKey(roundId: string): string {
  return `confirm/${roundId}`;
}
