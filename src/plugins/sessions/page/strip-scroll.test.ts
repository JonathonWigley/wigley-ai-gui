import { describe, expect, it } from 'vitest';
import { scrollLeftShowing } from './strip-scroll';

// A box at `left` on the page, `width` wide; the rest of DOMRect unused.
const box = (left: number, width: number) => ({ left, width }) as DOMRect;

describe('strip-scroll', () => {
  // The strip sits at page x 100, 200 wide, scrolled 300 in: it shows
  // content 300 to 500.
  it.each([
    {
      name: 'a tab off the left edge scrolls to its start',
      tabLeft: 50,
      expected: 250,
    },
    {
      name: 'a tab off the right edge scrolls to show its end',
      tabLeft: 280,
      expected: 340,
    },
    {
      name: 'a tab in view keeps the scroll',
      tabLeft: 150,
      expected: 300,
    },
  ])('scrollLeftShowing: $name', ({ tabLeft, expected }) => {
    const strip = {
      getBoundingClientRect: () => box(100, 200),
      scrollLeft: 300,
      clientWidth: 200,
    };
    const tab = { getBoundingClientRect: () => box(tabLeft, 60) };

    expect(scrollLeftShowing(strip, tab)).toBe(expected);
  });
});
