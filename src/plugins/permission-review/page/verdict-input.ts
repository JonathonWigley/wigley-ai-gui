import type { Review } from '../contract';
import type { VerdictInput } from '../layouts/layout';

const capitalised = (word: string) =>
  `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

// The layout's input for a request's review; null for no review, which draws
// nothing.
export function verdictInput(review: Review | null): VerdictInput | null {
  if (review === null) {
    return null;
  }
  switch (review.state) {
    case 'reviewing':
      return {
        state: 'reviewing',
        heading: 'Reviewing…',
        detail: null,
        verdict: null,
        risk: null,
      };
    case 'done':
      return {
        state: 'done',
        heading: `${capitalised(review.verdict)} · ${review.risk} risk`,
        detail: review.summary,
        verdict: review.verdict,
        risk: review.risk,
      };
    case 'unavailable':
      return {
        state: 'unavailable',
        heading: 'Review unavailable',
        detail: review.reason,
        verdict: null,
        risk: null,
      };
  }
}
