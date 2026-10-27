import { describe, expect, it } from 'vitest';
import { activeForm } from '../../../shared/page/session-forms';
import type { PrimerEntry } from '../contract';
import { reviewTallies, talliesText } from './primer-review';
import { initialState, type OpenPrimer } from './primer-state';
import { presentedPrimer, primerEntry, primerItem } from './test-primers';

function primerWith(entries: PrimerEntry[]): OpenPrimer {
  const primer = activeForm(
    initialState([presentedPrimer('p1', { entries })], 'p1-session'),
  );
  if (primer === null) {
    throw new Error('No primer is active');
  }
  return primer;
}

// `count` items, the first `included` of them included.
function items(count: number, included: number) {
  return Array.from({ length: count }, (_, i) =>
    primerItem(`item ${i + 1}`, { include: i < included }),
  );
}

describe('review tallies', () => {
  it('talliesText_FourTasksTwelveItemsNineIncluded_CountsEveryNeedAndItem', () => {
    const primer = primerWith([
      primerEntry('1', 'primer', { need: 'yes', items: items(4, 3) }),
      primerEntry('2', 'primer', { need: 'yes', items: items(3, 3) }),
      primerEntry('s1', 'standing', { need: 'no', items: items(3, 1) }),
      primerEntry('extra-1', 'extra', { need: 'unclear', items: items(2, 2) }),
    ]);

    expect(talliesText(reviewTallies(primer))).toBe(
      '2 needed, 1 not needed, 1 unclear. 9 of 12 items included.',
    );
  });

  it('reviewTallies_NoItems_CountsZeroItems', () => {
    const primer = primerWith([
      primerEntry('1', 'primer', { need: 'yes' }),
      primerEntry('s1', 'standing', { need: 'unclear' }),
    ]);

    expect(reviewTallies(primer)).toEqual({
      yes: 1,
      no: 0,
      unclear: 1,
      included: 0,
      items: 0,
    });
  });
});
