import { afterEach, describe, expect, it, vi } from 'vitest';
import { textLineHeightPx } from './text-line';

interface FakeStyle {
  lineHeight: string;
  fontSize: string;
  leadingProse?: string;
}

// An element whose computed style is `style`, holding `markdown` as its first
// `.md` block when given.
function fakeElement(style: FakeStyle, markdown?: Element): Element {
  return {
    style,
    querySelector: (selector: string) =>
      selector === '.md' ? (markdown ?? null) : null,
  } as unknown as Element;
}

function stubComputedStyle() {
  vi.stubGlobal('getComputedStyle', (node: { style: FakeStyle }) => ({
    lineHeight: node.style.lineHeight,
    fontSize: node.style.fontSize,
    getPropertyValue: (name: string) =>
      name === '--wg-leading-prose' ? (node.style.leadingProse ?? '') : '',
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('textLineHeightPx', () => {
  it('measures the first markdown block inside the scroller', () => {
    stubComputedStyle();
    const prose = fakeElement({ lineHeight: '21.7px', fontSize: '14px' });
    const scroller = fakeElement(
      { lineHeight: '18.2px', fontSize: '13px' },
      prose,
    );

    expect(textLineHeightPx(scroller)).toBe(21.7);
  });

  it('measures the scroller itself when it holds no markdown', () => {
    stubComputedStyle();
    const scroller = fakeElement({ lineHeight: '18.2px', fontSize: '13px' });

    expect(textLineHeightPx(scroller)).toBe(18.2);
  });

  it('takes the font size times the prose leading for a normal line height', () => {
    stubComputedStyle();
    const scroller = fakeElement({
      lineHeight: 'normal',
      fontSize: '14px',
      leadingProse: '1.5',
    });

    expect(textLineHeightPx(scroller)).toBe(21);
  });

  it('throws for a normal line height with no prose leading', () => {
    stubComputedStyle();
    const scroller = fakeElement({ lineHeight: 'normal', fontSize: '14px' });

    expect(() => textLineHeightPx(scroller)).toThrow('--wg-leading-prose');
  });
});
