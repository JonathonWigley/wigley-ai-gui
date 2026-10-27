import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type { AnchorOptions } from '../../keys/contract';
import { activeForm } from '../../../shared/page/session-forms';
import { installFakeDom } from '../../../shared/page/test-dom';
import type { PrimerEntry } from '../contract';
import { reviewFooter, reviewTallies, talliesText } from './primer-review';
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

describe('review footer', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reviewFooter anchors Back, Cancel primer and Send in the review scope', () => {
    const anchored: [CommandId, AnchorOptions | undefined][] = [];

    reviewFooter({
      keys: {
        anchor: (_element, command, options) => {
          anchored.push([command, options]);
          return { dispose: () => undefined };
        },
      },
      run: () => undefined,
    });

    expect(anchored).toEqual([
      ['primer.closeReview', { scope: 'primer.review' }],
      ['primer.askCancel', { scope: 'primer.review' }],
      ['primer.submit', { scope: 'primer.review' }],
    ]);
  });
});
