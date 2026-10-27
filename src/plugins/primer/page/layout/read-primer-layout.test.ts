import { describe, expect, it } from 'vitest';
import defaultLayout from '../../layouts/default/layout.js';
import { readPrimerLayout } from './read-primer-layout';

const part = () => ({ element: {} as HTMLElement });

describe('readPrimerLayout', () => {
  it.each([
    { case: 'no default export', module: {}, key: 'default export' },
    {
      case: 'a default that is no object',
      module: { default: 3 },
      key: 'default export',
    },
    {
      case: 'a key that is no part',
      module: { default: { head: part } },
      key: 'head',
    },
    {
      case: 'a cards key that is no card',
      module: { default: { cards: { question: part } } },
      key: 'cards.question',
    },
    {
      case: 'a pane that is no function',
      module: { default: { rail: 1 } },
      key: 'rail',
    },
    {
      case: 'a card that is no function',
      module: { default: { cards: { task: 'x' } } },
      key: 'cards.task',
    },
  ])(
    'readPrimerLayout_InvalidShape_ThrowsNamingTheKey ($case)',
    ({ module, key }) => {
      expect(() => readPrimerLayout(module, 'mine')).toThrow(
        new RegExp(`^layout mine: .*${key.replace('.', '\\.')}`),
      );
    },
  );

  it('readPrimerLayout_PartialLayout_ReturnsIt', () => {
    const layout = { cards: { item: part } };

    expect(readPrimerLayout({ default: layout }, 'mine')).toBe(layout);
  });

  it('readPrimerLayout_DefaultLayout_Reads', () => {
    expect(readPrimerLayout({ default: defaultLayout }, 'default')).toBe(
      defaultLayout,
    );
  });
});
