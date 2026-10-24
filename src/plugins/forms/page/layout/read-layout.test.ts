import { describe, expect, it } from 'vitest';
import { readLayout } from './read-layout';

const card = () => ({ element: {} as HTMLElement });

describe('readLayout', () => {
  it('readLayout_OnlyFindingCard_ReturnsIt', () => {
    const layout = { cards: { finding: card } };

    expect(readLayout({ default: layout }, 'mine')).toBe(layout);
  });

  it('readLayout_EmptyLayout_ReturnsIt', () => {
    const layout = {};

    expect(readLayout({ default: layout }, 'mine')).toBe(layout);
  });

  it('readLayout_CardNotFunction_Throws', () => {
    const module = { default: { cards: { finding: card, notice: 'plain' } } };

    expect(() => readLayout(module, 'mine')).toThrow(
      'layout mine: cards.notice is not a function',
    );
  });

  it('readLayout_UnknownCardKind_Throws', () => {
    const module = { default: { cards: { findng: card } } };

    expect(() => readLayout(module, 'mine')).toThrow(
      'layout mine: cards.findng is not a card kind',
    );
  });

  it('readLayout_UnknownPart_Throws', () => {
    const module = { default: { rails: () => undefined } };

    expect(() => readLayout(module, 'mine')).toThrow(
      'layout mine: rails is not a layout part',
    );
  });

  it('readLayout_CardsNotObject_Throws', () => {
    const module = { default: { cards: 'all' } };

    expect(() => readLayout(module, 'mine')).toThrow(
      'layout mine: cards is not an object',
    );
  });

  it('readLayout_NoDefaultExport_Throws', () => {
    expect(() => readLayout({}, 'mine')).toThrow(
      'layout mine: the default export is missing or not an object',
    );
  });

  it('readLayout_HeadNotFunction_Throws', () => {
    const module = { default: { cards: { question: card }, head: 'banner' } };

    expect(() => readLayout(module, 'mine')).toThrow(
      'layout mine: head is not a function',
    );
  });

  it('readLayout_ValidModule_ReturnsItsDefault', () => {
    const layout = {
      cards: { question: card, finding: card, notice: card },
      head: () => undefined,
    };

    expect(readLayout({ default: layout }, 'mine')).toBe(layout);
  });
});
