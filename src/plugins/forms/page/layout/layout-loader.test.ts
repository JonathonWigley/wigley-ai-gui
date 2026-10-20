import { describe, expect, it } from 'vitest';
import type { LayoutChoice } from '../../contract';
import { layoutUrls, readLayout } from './layout-loader';

const card = () => ({ element: {} as HTMLElement });

function choice(hasCss: boolean): LayoutChoice {
  return {
    name: 'mine',
    revision: 4,
    hasCss,
    builtIn: false,
    reason: 'cycled',
  };
}

function recordingDataUrl() {
  const calls: [string, number][] = [];
  const dataUrl = (path: string, revision: number) => {
    calls.push([path, revision]);
    return `url:${path}@${revision}`;
  };
  return { calls, dataUrl };
}

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
      'layout mine: head is missing or not a function',
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

describe('layoutUrls', () => {
  it('layoutUrls_WithCss_BuildsBothWithRevision', () => {
    const { calls, dataUrl } = recordingDataUrl();

    const urls = layoutUrls(choice(true), dataUrl);

    expect(calls).toEqual([
      ['layouts/mine/layout.js', 4],
      ['layouts/mine/layout.css', 4],
    ]);
    expect(urls).toEqual({
      script: 'url:layouts/mine/layout.js@4',
      style: 'url:layouts/mine/layout.css@4',
    });
  });

  it('layoutUrls_WithoutCss_StyleNull', () => {
    const { dataUrl } = recordingDataUrl();

    expect(layoutUrls(choice(false), dataUrl)).toEqual({
      script: 'url:layouts/mine/layout.js@4',
      style: null,
    });
  });
});
