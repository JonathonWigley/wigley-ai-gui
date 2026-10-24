import type { ContentScroll, ScrollStep } from '../contracts/editor';

// The part of an element a vertical scroll reads and sets.
interface Scroller {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

// How far `step` scrolls `scroller`, in pixels: a line is `lineHeightPx`, the
// height of one line of the text it shows.
export function scrollStepPx(
  scroller: Scroller,
  step: ScrollStep,
  lineHeightPx: number,
): number {
  return step === 'line' ? lineHeightPx : scroller.clientHeight / 2;
}

// Scrolls `scroller` by `step`, down for 1 and up for -1.
export function scrollContent(
  scroller: Scroller,
  step: ScrollStep,
  direction: 1 | -1,
  lineHeightPx: number,
): ContentScroll {
  const before = scroller.scrollTop;
  scroller.scrollTop += direction * scrollStepPx(scroller, step, lineHeightPx);
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

const STEP_TEXT: Record<ScrollStep, string> = {
  line: 'a line',
  halfPage: 'half a page',
};

// The log text for a scroll of `what` by `step`, e.g. `scrolled the
// transcript up half a page to the top`, `scrolled CLAUDE.md down a line`, or
// `CLAUDE.md did not scroll down`.
export function scrollText(
  what: string,
  step: ScrollStep,
  direction: 1 | -1,
  scroll: ContentScroll,
): string {
  const way = direction === 1 ? 'down' : 'up';
  if (!scroll.moved) {
    return `${what} did not scroll ${way}`;
  }
  const end = direction === 1 ? 'bottom' : 'top';
  return `scrolled ${what} ${way} ${STEP_TEXT[step]}${scroll.atEnd ? ` to the ${end}` : ''}`;
}
