import { describe, expect, it } from 'vitest';
import {
  LINE_STEP_PX,
  isScrolledToEnd,
  scrollContent,
  scrollText,
} from './content-scroll';

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

describe('scrollContent', () => {
  it('scrolls a line by the line step', () => {
    const box = scroller(100);

    const scroll = scrollContent(box, 'line', 1);

    expect(box.scrollTop).toBe(100 + LINE_STEP_PX);
    expect(scroll).toEqual({ moved: true, atEnd: false });
  });

  it('scrolls half a page by half the visible height', () => {
    const box = scroller(300);

    const scroll = scrollContent(box, 'halfPage', -1);

    expect(box.scrollTop).toBe(100);
    expect(scroll).toEqual({ moved: true, atEnd: false });
  });

  it('reports the end it reaches', () => {
    const box = scroller(580);

    expect(scrollContent(box, 'line', 1)).toEqual({ moved: true, atEnd: true });
  });

  it('reports no move at the end already', () => {
    const box = scroller(0);

    expect(scrollContent(box, 'line', -1)).toEqual({
      moved: false,
      atEnd: true,
    });
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
  it('names the step and the end reached', () => {
    expect(
      scrollText('CLAUDE.md', 'line', 1, { moved: true, atEnd: false }),
    ).toBe('scrolled CLAUDE.md down a line');
    expect(
      scrollText('the form', 'halfPage', -1, { moved: true, atEnd: true }),
    ).toBe('scrolled the form up half a page to the top');
  });

  it('says when nothing scrolled', () => {
    expect(
      scrollText('the form', 'line', 1, { moved: false, atEnd: true }),
    ).toBe('the form did not scroll down');
  });
});
