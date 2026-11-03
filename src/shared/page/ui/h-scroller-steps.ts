// The HScroller's rules, on numbers alone: which chevrons show, and where a
// chevron step or a reveal scrolls the track.

// The track's scroll position and sizes, in CSS pixels.
export interface ScrollView {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

// An item's left and right edges, measured from the track's content start.
export interface ItemSpan {
  start: number;
  end: number;
}

export type ScrollDirection = 'back' | 'forward';

// Absorbs a fractional `scrollLeft` at a zoom other than 100%.
const EDGE_SLACK = 1;

// Whether the track overflows, and whether anything lies further back or
// forward of what shows.
export function chevronStates(view: ScrollView): {
  overflows: boolean;
  back: boolean;
  forward: boolean;
} {
  const { scrollLeft, clientWidth, scrollWidth } = view;
  const overflows = scrollWidth > clientWidth + EDGE_SLACK;
  return {
    overflows,
    back: overflows && scrollLeft > EDGE_SLACK,
    forward: overflows && scrollLeft + clientWidth < scrollWidth - EDGE_SLACK,
  };
}

// The `scrollLeft` one item further in `direction`: forward brings the first
// item cut off at the right edge to that edge, or the start of one wider than
// the view first; back brings the last item cut off at the left edge to that
// edge. `scrollLeft` itself when nothing lies further that way.
export function stepTarget(
  items: readonly ItemSpan[],
  view: ScrollView,
  direction: ScrollDirection,
): number {
  const { scrollLeft, clientWidth, scrollWidth } = view;
  if (direction === 'back') {
    const cutOff = items.findLast(
      (item) => item.start < scrollLeft - EDGE_SLACK,
    );
    return cutOff === undefined ? scrollLeft : Math.max(cutOff.start, 0);
  }
  const rightEdge = scrollLeft + clientWidth;
  const cutOff = items.find((item) => item.end > rightEdge + EDGE_SLACK);
  if (cutOff === undefined) {
    return scrollLeft;
  }
  const maxScroll = scrollWidth - clientWidth;
  const isWiderThanView = cutOff.end - cutOff.start > clientWidth;
  const startIsHidden = cutOff.start > scrollLeft + EDGE_SLACK;
  if (isWiderThanView && startIsHidden) {
    return Math.min(cutOff.start, maxScroll);
  }
  return Math.min(cutOff.end - clientWidth, maxScroll);
}

// The `scrollLeft` that shows `item` whole, moving as little as it can; the
// item's start when it is wider than the view.
export function revealTarget(item: ItemSpan, view: ScrollView): number {
  const { scrollLeft, clientWidth, scrollWidth } = view;
  let target = scrollLeft;
  if (item.start < scrollLeft) {
    target = item.start;
  } else if (item.end > scrollLeft + clientWidth) {
    const isWiderThanView = item.end - item.start > clientWidth;
    target = isWiderThanView ? item.start : item.end - clientWidth;
  }
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  return Math.min(Math.max(target, 0), maxScroll);
}
