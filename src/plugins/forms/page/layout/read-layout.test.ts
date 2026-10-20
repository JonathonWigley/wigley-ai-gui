import { describe, expect, it } from 'vitest';
import { readLayout } from './read-layout';

const card = () => ({ element: {} as HTMLElement });

describe('readLayout', () => {
  it('readLayout_MissingNoticeCard_ThrowsNamingIt', () => {
    const module = { default: { cards: { question: card, finding: card } } };

    expect(() => readLayout(module, 'mine')).toThrow(
      'layout mine: cards.notice is missing or not a function',
    );
  });

  it('readLayout_NoDefaultExport_Throws', () => {
    expect(() => readLayout({}, 'mine')).toThrow(
      'layout mine: the default export is missing or not an object',
    );
  });

  it('readLayout_HeadNotFunction_Throws', () => {
    const module = {
      default: {
        cards: { question: card, finding: card, notice: card },
        head: 'banner',
      },
    };

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
