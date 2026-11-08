import { describe, expect, it } from 'vitest';
import { readLayout } from './read-layout';

const card = () => ({ element: {} as HTMLElement });

describe('readLayout', () => {
  it.each([
    { case: 'an empty layout', layout: {} },
    { case: 'only a finding card', layout: { cards: { finding: card } } },
    { case: 'only a rail', layout: { rail: card } },
    { case: 'only a notices pane', layout: { notices: card } },
    {
      case: 'every card kind and a head',
      layout: {
        cards: { question: card, finding: card, notice: card },
        head: () => undefined,
      },
    },
  ])('returns the default export of $case', ({ layout }) => {
    expect(readLayout({ default: layout }, 'mine')).toBe(layout);
  });

  it.each([
    { case: 'no default export', module: {}, names: 'the default export' },
    {
      case: 'a part that is no layout part',
      module: { default: { rails: () => undefined } },
      names: 'rails',
    },
    {
      case: 'cards that are not an object',
      module: { default: { cards: 'all' } },
      names: 'cards',
    },
    {
      case: 'a card kind that is no card kind',
      module: { default: { cards: { findng: card } } },
      names: 'cards.findng',
    },
    {
      case: 'a card that is not a function',
      module: { default: { cards: { finding: card, notice: 'plain' } } },
      names: 'cards.notice',
    },
    {
      case: 'a head that is not a function',
      module: { default: { cards: { question: card }, head: 'banner' } },
      names: 'head',
    },
    {
      case: 'a rail that is not a function',
      module: { default: { rail: 'left' } },
      names: 'rail',
    },
    {
      case: 'a notices pane that is not a function',
      module: { default: { notices: 'list' } },
      names: 'notices',
    },
    {
      case: 'a review that is not a function',
      module: { default: { review: {} } },
      names: 'review',
    },
  ])('throws naming $names for $case', ({ module, names }) => {
    expect(() => readLayout(module, 'mine')).toThrow(
      new RegExp(`mine.*${names}`),
    );
  });
});
