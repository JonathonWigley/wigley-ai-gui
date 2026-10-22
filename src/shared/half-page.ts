import type { HalfPageScroll } from '../contracts/editor';

// The part of an element a vertical scroll reads and sets.
interface Scroller {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

// Scrolls `scroller` by half its visible height, down for 1 and up for -1.
export function scrollHalfPage(
  scroller: Scroller,
  direction: 1 | -1,
): HalfPageScroll {
  const before = scroller.scrollTop;
  scroller.scrollTop += (direction * scroller.clientHeight) / 2;
  return {
    moved: scroller.scrollTop !== before,
    atEnd: isScrolledToEnd(scroller, direction),
  };
}

// At the bottom for 1 and the top for -1, within 1px, since `scrollTop` can
// land on a fraction.
export function isScrolledToEnd(
  scroller: Scroller,
  direction: 1 | -1,
): boolean {
  return direction === 1
    ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1
    : scroller.scrollTop <= 1;
}

// The log text for a half-page scroll of `what`, e.g. `scrolled the
// transcript up half a page to the top`, or `CLAUDE.md did not scroll down`.
export function halfPageText(
  what: string,
  direction: 1 | -1,
  scroll: HalfPageScroll,
): string {
  const way = direction === 1 ? 'down' : 'up';
  if (!scroll.moved) {
    return `${what} did not scroll ${way}`;
  }
  const end = direction === 1 ? 'bottom' : 'top';
  return `scrolled ${what} ${way} half a page${scroll.atEnd ? ` to the ${end}` : ''}`;
}
