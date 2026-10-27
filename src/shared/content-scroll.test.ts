import { describe, expect, it } from 'vitest';
import {
  isScrolledToEnd,
  scrollContent,
  scrollStepPx,
  scrollText,
} from './content-scroll';

// One line of 14px prose at 1.55 leading.
const LINE_PX = 21.7;

// A scroller that clamps `scrollTop` as an element does.
function scroller(scrollTop: number, scrollHeight = 1000, clientHeight = 400) {
  let top = scrollTop;
  return {
    scrollHeight,
    clientHeight,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.min(Math.max(value, 0), scrollHeight - clientHeight);
    },
  };
}

// A scroller that also rounds `scrollTop` to whole pixels, as an element does
// at a device pixel ratio of 1.
function roundingScroller(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
) {
  const box = scroller(scrollTop, scrollHeight, clientHeight);
  return {
    scrollHeight,
    clientHeight,
    get scrollTop() {
      return box.scrollTop;
    },
    set scrollTop(value: number) {
      box.scrollTop = Math.round(value);
    },
  };
}

describe('scrollContent', () => {
  it('scrolls a line by the line height it is given, in whole pixels', () => {
    const box = scroller(100);

    const scroll = scrollContent(box, 'line', 1, LINE_PX);

    expect(box.scrollTop).toBe(122);
    expect(scroll).toEqual({ moved: true, atEnd: false });
  });

  it('returns to the top after scrolling down and back up a line and half an odd page', () => {
    const box = roundingScroller(0, 2673, 617);

    for (let round = 0; round < 3; round++) {
      scrollContent(box, 'line', 1, LINE_PX);
      scrollContent(box, 'halfPage', 1, LINE_PX);
      scrollContent(box, 'halfPage', -1, LINE_PX);
      const scroll = scrollContent(box, 'line', -1, LINE_PX);

      expect(box.scrollTop).toBe(0);
      expect(scroll).toEqual({ moved: true, atEnd: true });
    }
  });

  it('scrolls half a page by half the visible height', () => {
    const box = scroller(300);

    const scroll = scrollContent(box, 'halfPage', -1, LINE_PX);

    expect(box.scrollTop).toBe(100);
    expect(scroll).toEqual({ moved: true, atEnd: false });
  });

  it('reports the end it reaches', () => {
    const box = scroller(590);

    expect(scrollContent(box, 'line', 1, LINE_PX)).toEqual({
      moved: true,
      atEnd: true,
    });
  });

  it('reports no move at the end already', () => {
    const box = scroller(0);

    expect(scrollContent(box, 'line', -1, LINE_PX)).toEqual({
      moved: false,
      atEnd: true,
    });
  });
});

describe('scrollStepPx', () => {
  it('steps a line by the line height and half a page by half the visible height', () => {
    expect(scrollStepPx(scroller(0), 'line', LINE_PX)).toBe(LINE_PX);
    expect(scrollStepPx(scroller(0), 'halfPage', LINE_PX)).toBe(200);
  });
});

describe('isScrolledToEnd', () => {
  it('counts a fraction within 1px as the end', () => {
    expect(isScrolledToEnd(scroller(599.5), 1)).toBe(true);
    expect(isScrolledToEnd(scroller(0.5), -1)).toBe(true);
    expect(isScrolledToEnd(scroller(300), 1)).toBe(false);
  });
});

describe('scrollText', () => {
  it('names what it scrolled', () => {
    expect(
      scrollText('CLAUDE.md', 'line', 1, { moved: true, atEnd: false }),
    ).toContain('CLAUDE.md');
    expect(
      scrollText('the form', 'halfPage', -1, { moved: true, atEnd: true }),
    ).toContain('the form');
  });

  it('says when nothing scrolled', () => {
    expect(
      scrollText('the form', 'line', 1, { moved: false, atEnd: true }),
    ).toContain('the form');
  });
});
