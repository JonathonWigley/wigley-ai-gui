import { describe, expect, it } from 'vitest';
import { pickLayout } from './pick';

interface TestLayout {
  card?: true;
}

const DEFAULT: TestLayout = { card: true };
const PLAIN: TestLayout = {};
const CARDED: TestLayout = { card: true };
const LATE: TestLayout = { card: true };

const LOADED = new Map<string, TestLayout>([
  ['default', DEFAULT],
  ['plain', PLAIN],
  ['carded', CARDED],
  ['late', LATE],
]);

const definesCard = (layout: TestLayout) => layout.card === true;

describe('pickLayout', () => {
  it.each([
    {
      row: 'first defining name wins',
      chain: ['plain', 'carded', 'late', 'default'],
      picked: { name: 'carded', layout: CARDED },
    },
    {
      row: 'unloaded name skipped',
      chain: ['ghost', 'late', 'default'],
      picked: { name: 'late', layout: LATE },
    },
    {
      row: 'a name after default never reached',
      chain: ['plain', 'default', 'carded'],
      picked: { name: 'default', layout: DEFAULT },
    },
    {
      row: 'nothing defines',
      chain: ['plain', 'ghost'],
      picked: { name: 'default', layout: DEFAULT },
    },
  ])('pickLayout_$row', ({ chain, picked }) => {
    const pick = pickLayout(chain, LOADED, definesCard);

    expect(pick.name).toBe(picked.name);
    expect(pick.layout).toBe(picked.layout);
  });

  it('pickLayout_LayoutsLackDefault_Throws', () => {
    const loaded = new Map([['carded', CARDED]]);

    expect(() => pickLayout(['carded'], loaded, definesCard)).toThrow(
      'layout default is not loaded',
    );
  });
});
