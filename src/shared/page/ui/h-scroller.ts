import './h-scroller.css';
import { element } from '../dom';
import {
  chevronStates,
  type ItemSpan,
  revealTarget,
  type ScrollDirection,
  type ScrollView,
  stepTarget,
} from './h-scroller-steps';
import { iconButton } from './icon-button';

// `element` is the root: a back chevron, `track` and a forward chevron. The
// owner appends items to `track` and calls `refresh` after it adds, removes or
// resizes them; a chevron click scrolls by one item. `reveal` scrolls `item`
// fully into view, or, while the track is not laid out, keeps it for the next
// `refresh` that finds a layout. `dispose` stops watching the track; the owner
// removes `element`.
export interface HScroller {
  element: HTMLElement;
  track: HTMLElement;
  reveal(item: HTMLElement): void;
  refresh(): void;
  dispose(): void;
}

export function createHScroller(): HScroller {
  const root = element('div', 'ui-h-scroller');
  root.dataset.overflow = 'false';
  const track = element('div', 'ui-h-scroller-track');
  const step = (direction: ScrollDirection) =>
    scrollTrack(
      track,
      stepTarget(itemSpans(track), viewOf(track), direction),
      'smooth',
    );
  const back = chevron('chevron-left', 'Scroll back', () => step('back'));
  const forward = chevron('chevron-right', 'Scroll forward', () =>
    step('forward'),
  );
  root.append(back, track, forward);

  let pendingReveal: HTMLElement | null = null;

  const showOverflow = () => {
    root.dataset.overflow = String(chevronStates(viewOf(track)).overflows);
  };
  // Back and forward are read after `data-overflow` has shown or hidden the
  // chevrons, so they measure the track at its new width.
  const showChevronStates = () => {
    showOverflow();
    const states = chevronStates(viewOf(track));
    back.classList.toggle('is-no-target', !states.back);
    forward.classList.toggle('is-no-target', !states.forward);
  };
  const refresh = () => {
    if (pendingReveal !== null && track.clientWidth > 0) {
      const item = pendingReveal;
      pendingReveal = null;
      if (item.parentElement === track) {
        showOverflow();
        scrollTrack(
          track,
          revealTarget(spanOf(item), viewOf(track)),
          'instant',
        );
      }
    }
    showChevronStates();
  };

  track.addEventListener('scroll', refresh);
  const observer = new ResizeObserver(refresh);
  observer.observe(track);

  return {
    element: root,
    track,
    reveal(item) {
      if (track.clientWidth === 0) {
        pendingReveal = item;
        return;
      }
      pendingReveal = null;
      scrollTrack(track, revealTarget(spanOf(item), viewOf(track)), 'smooth');
    },
    refresh,
    dispose() {
      observer.disconnect();
      track.removeEventListener('scroll', refresh);
      pendingReveal = null;
    },
  };
}

function chevron(
  iconName: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = iconButton(iconName, label, onClick, 'sm');
  node.classList.add('ui-h-scroller-chevron', 'is-no-target');
  return node;
}

function viewOf(track: HTMLElement): ScrollView {
  return {
    scrollLeft: track.scrollLeft,
    clientWidth: track.clientWidth,
    scrollWidth: track.scrollWidth,
  };
}

// The track is positioned, so an item's `offsetLeft` runs from its content
// start.
function spanOf(item: HTMLElement): ItemSpan {
  return { start: item.offsetLeft, end: item.offsetLeft + item.offsetWidth };
}

function itemSpans(track: HTMLElement): ItemSpan[] {
  return Array.from(track.children, (child) => spanOf(child as HTMLElement));
}

// Every scroll jumps under reduced motion.
function scrollTrack(
  track: HTMLElement,
  left: number,
  behavior: 'smooth' | 'instant',
): void {
  const reducesMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  track.scrollTo({ left, behavior: reducesMotion ? 'instant' : behavior });
}
