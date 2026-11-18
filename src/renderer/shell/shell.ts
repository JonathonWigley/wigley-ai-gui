import type { Timers } from '../../contracts/ambient';
import type { Disposable } from '../../contracts/disposable';
import type { ResizeTarget } from '../../contracts/panes';
import type {
  AlignedArea,
  Alignment,
  Area,
  AreaName,
  ContributeOptions,
  KeyHints,
  RightBarArea,
  RightBarOptions,
  ShellLayout,
} from '../../contracts/plugin';
import type { UiState } from '../../contracts/ui-state';
import { createListeners } from '../../shared/listeners';
import { blurFocusedElement } from '../../shared/page/dom';
import { NO_ANCHOR } from '../../shared/page/ui/key-anchors';
import { createSplitDivider } from '../../shared/page/ui/split';
import { clampSplitWidth } from '../../shared/page/ui/split-width';
import type { RightBarStop } from '../pane-targets';
import type { SideBarLayout } from './modes';

const AREA_NAMES: readonly AreaName[] = [
  'titleBar',
  'activityBar',
  'sideBar',
  'main',
  'rightBar',
  'panel',
  'statusBar',
  'overlay',
];

export const ALIGNMENTS: readonly Alignment[] = ['start', 'center', 'end'];

const ALIGN_RANKS: Record<Alignment, number> = {
  start: 0,
  center: 1,
  end: 2,
};

// Where a contribution sorts in its area: `sequence` counts the area's
// contributions from 0 in the order they were made.
export interface Placement {
  align: Alignment;
  order: number;
  sequence: number;
}

export function placementOf(
  options: ContributeOptions | undefined,
  sequence: number,
): Placement {
  return {
    align: options?.align ?? 'start',
    order: options?.order ?? 0,
    sequence,
  };
}

// Orders by alignment group (`start`, `center`, `end`), then `order`
// ascending, then `sequence` ascending.
export function comparePlacements(a: Placement, b: Placement): number {
  return (
    ALIGN_RANKS[a.align] - ALIGN_RANKS[b.align] ||
    a.order - b.order ||
    a.sequence - b.sequence
  );
}

// The index in `sorted`, a list kept in `comparePlacements` order, at which
// `placement` goes: before the first entry that sorts after it, or
// `sorted.length` when none does.
export function insertionIndex(
  sorted: readonly { placement: Placement }[],
  placement: Placement,
): number {
  const next = sorted.findIndex(
    (entry) => comparePlacements(entry.placement, placement) > 0,
  );
  return next === -1 ? sorted.length : next;
}

// The first entry of `sorted` from `index` on whose alignment `inTrack` holds,
// or `undefined` when none does. A layout may point alignments that do not
// sort next to each other at one track.
export function nextInTrack<Entry extends { placement: Placement }>(
  sorted: readonly Entry[],
  index: number,
  inTrack: (align: Alignment) => boolean,
): Entry | undefined {
  return sorted.slice(index).find((entry) => inTrack(entry.placement.align));
}

// The shell's areas: every area takes `ContributeOptions`, and the right bar
// `RightBarOptions`, whose `focus` makes the contribution a stop for the
// core's focus keys.
export type ShellAreas = Record<Exclude<AreaName, 'rightBar'>, Area> & {
  rightBar: RightBarArea;
};

// The window's shell: `areas` are the areas contributions go to, kept across
// layouts. `setLayout` places them by `layout`, moving every contribution into
// it, and returns the `Disposable` that restores the layout the shell was
// mounted with, which does nothing once another `setLayout` replaced `layout`;
// each area's element keeps its scroll across the swap; a layout that throws
// or misses an area leaves the previous one mounted and rethrows.
// `layOutSideBar` shows or hides the side bar area and sets its
// `data-side-bar`. `setChromeLayout` names the user's shell layout on the
// chrome areas' elements (`data-layout`, with `data-layout-owner="shell"`),
// kept across every later mount, so the layout's CSS restyles their frames.
// `sideBarDivider` is the side bar's resize divider, which moves only while
// the side bar is beside the content; the right bar resizes by its handle's
// drag alone. `reloadBarOpenWidths` reads the `sidebar-width` and
// `rightbar-width` tokens again, after a theme is applied, and redraws each
// bar at its token while the user has stored no width for it.
// `rightBarStops` lists one `RightBarStop` per right-bar contribution that
// passed `focus`, in the right bar's drawn order, top to bottom; a stop's
// `left` runs the contribution's, then blurs the focused element when the
// contribution still holds it. A stop's contribution `dispose` takes it out
// of that list, then tells each
// `onRightBarStopRemoved` listener once. `rightBarHolds` is whether `node` is
// in the right bar's element. `dispose` disposes both dividers, stops
// watching the root's width and removes both handles.
export interface Shell {
  areas: ShellAreas;
  rightBarStops(): readonly RightBarStop[];
  onRightBarStopRemoved(listener: (stop: RightBarStop) => void): Disposable;
  rightBarHolds(node: Node): boolean;
  setLayout(layout: ShellLayout): Disposable;
  layOutSideBar(layout: SideBarLayout): void;
  setChromeLayout(name: string): void;
  sideBarDivider: ResizeTarget;
  reloadBarOpenWidths(): void;
  dispose(): void;
}

// Each bar's least width, and the least width either leaves the main area.
const SIDE_BAR_MIN = 160;
const RIGHT_BAR_MIN = 200;
const MAIN_MIN = 320;

// Each bar's open width when its width token is no pixel length.
const SIDE_BAR_FALLBACK_WIDTH = 256;
const RIGHT_BAR_FALLBACK_WIDTH = 300;

// A bar's open width: the pixels of the width token `property` as `root`
// computes it. The computed value is the token as written, so a length in any
// other unit (`20rem`) takes `fallback`.
function openWidthToken(
  root: HTMLElement,
  property: string,
  fallback: number,
): number {
  const token = getComputedStyle(root).getPropertyValue(property).trim();
  return /^\d+(\.\d+)?px$/.test(token) ? parseFloat(token) : fallback;
}

// `uiState` with a missing or non-finite stored width read as `openWidth()`,
// so a bar divider's `reloadWidth` takes up a reloaded token; writes and
// subscriptions go through.
function openWidthState(uiState: UiState, openWidth: () => number): UiState {
  return {
    get(key) {
      const stored = uiState.get(key);
      return Number.isFinite(stored) ? stored : openWidth();
    },
    set: (key, value) => uiState.set(key, value),
    on: (key, listener) => uiState.on(key, listener),
  };
}

// The areas whose frames a user shell layout restyles.
const CHROME_AREAS: readonly AreaName[] = [
  'titleBar',
  'activityBar',
  'sideBar',
  'rightBar',
  'statusBar',
];

// `stop` is set on a right-bar contribution that passed `focus`.
interface Contribution {
  element: HTMLElement;
  placement: Placement;
  stop?: RightBarStop;
}

// An area's element and the container each alignment's contributions go in:
// the element itself for all three when the layout did not split the area.
interface MountedArea {
  element: HTMLElement;
  tracks: Record<Alignment, HTMLElement>;
}

// Mounts `layout` in `root`, emptied first, and returns each area's element
// and tracks, throwing when the layout returned no element for an area or for
// one of its tracks.
function mountLayout(
  root: HTMLElement,
  layout: ShellLayout,
): Record<AreaName, MountedArea> {
  root.replaceChildren();
  root.removeAttribute('class');
  const returned = layout.mount(root);
  const mounted = {} as Record<AreaName, MountedArea>;
  for (const name of AREA_NAMES) {
    mounted[name] = mountedArea(name, returned[name]);
  }
  return mounted;
}

// The area the layout returned for `name`, its tracks all the area's element
// when the layout returned an element alone.
function mountedArea(
  name: AreaName,
  returned: HTMLElement | AlignedArea | undefined,
): MountedArea {
  if (returned instanceof HTMLElement) {
    return {
      element: returned,
      tracks: { start: returned, center: returned, end: returned },
    };
  }
  if (!(returned?.element instanceof HTMLElement)) {
    throw new Error(`Shell layout returned no element for ${name}`);
  }
  for (const align of ALIGNMENTS) {
    if (!(returned.tracks?.[align] instanceof HTMLElement)) {
      throw new Error(`Shell layout returned no ${align} track for ${name}`);
    }
  }
  return returned;
}

// An area's scroll: its offset, and whether it was scrolled to its end.
interface AreaScroll {
  top: number;
  isAtEnd: boolean;
}

function areaScrolls(
  mounted: Record<AreaName, MountedArea>,
): Record<AreaName, AreaScroll> {
  const scrolls = {} as Record<AreaName, AreaScroll>;
  for (const name of AREA_NAMES) {
    const { scrollTop, scrollHeight, clientHeight } = mounted[name].element;
    // A scroller at its end can report a fractional scrollTop a pixel short.
    const isAtEnd =
      scrollTop > 0 && scrollTop + clientHeight >= scrollHeight - 1;
    scrolls[name] = { top: scrollTop, isAtEnd };
  }
  return scrolls;
}

// An area scrolled to its end goes to the new element's end, whose range can
// differ; any other keeps its offset.
function restoreAreaScrolls(
  mounted: Record<AreaName, MountedArea>,
  scrolls: Record<AreaName, AreaScroll>,
): void {
  for (const name of AREA_NAMES) {
    const { element } = mounted[name];
    const scroll = scrolls[name];
    element.scrollTop = scroll.isAtEnd ? element.scrollHeight : scroll.top;
  }
}

// Keeps `--wg-status-bar-height` on the document root equal to the status
// bar's rendered height, `0px` while it is hidden; `observe` moves it to a new
// status bar element.
function createStatusBarHeight(): { observe(statusBar: HTMLElement): void } {
  let observed: HTMLElement | null = null;
  const publish = () =>
    document.documentElement.style.setProperty(
      '--wg-status-bar-height',
      `${observed?.offsetHeight ?? 0}px`,
    );
  const observer = new ResizeObserver(publish);
  return {
    observe(statusBar) {
      observer.disconnect();
      observed = statusBar;
      publish();
      observer.observe(statusBar);
    },
  };
}

// Builds the window's areas inside `root` by `layout`. Each area keeps its
// contributions sorted, places each one in its alignment's track (the area's
// element when the layout gave the area no tracks) with its alignment as
// `data-align`, and hides the area's element while it holds none;
// the side bar's element shows or hides only by `layOutSideBar`, hidden until
// the first call. The side bar's width is `--shell-side-bar-width` on `root`,
// unitless pixels, which its resize handle `div.shell-side-bar-handle`, a
// child of `root` shown only while the side bar is beside, drags and stores in
// `uiState` under `side-bar-width`; `timers` runs the handle prompts' linger.
// With no width stored, it opens at the `sidebar-width` token as `root`
// computes it. The right bar sits on main's right, hidden while it holds no
// contribution. Its width is `--shell-right-bar-width` on `root`, which its
// handle `div.shell-right-bar-handle`, a child of `root` shown only while the
// right bar is beside, drags from its start edge and stores under
// `right-bar-width`; with none stored it opens at the `rightbar-width` token.
// In a window too narrow for both bars beside main, the side bar gives way
// first: the right bar is measured against the side bar at its least width
// (none unless beside), so the side bar narrows to its least width before the
// right bar narrows to its own. Shown in a span with room for its least width
// and main's, the right bar sits beside main (`data-right-bar="beside"`),
// drawn no wider than leaves main its least width; in a narrower span it lies
// over main's end (`data-right-bar="over"`) at its least width, no wider than
// the span; hidden, it draws its width unclamped. Beside, the side bar draws
// no wider than leaves main its least width beside the right bar, which takes
// its least width while over main; over the content, no wider than reaches
// the right bar. Each bar's drawn width is kept as `root` resizes, while
// `uiState` keeps the user's width.
export function mountShell(
  root: HTMLElement,
  layout: ShellLayout,
  uiState: UiState,
  timers: Timers,
  keys: KeyHints,
): Shell {
  const initialLayout = layout;
  let currentLayout = layout;
  // Counts layout replacements, so a restore knows whether its layout is
  // still the one mounted.
  let generation = 0;
  const sideBarOpenWidth = () =>
    openWidthToken(root, '--wg-sidebar-width', SIDE_BAR_FALLBACK_WIDTH);
  const rightBarOpenWidth = () =>
    openWidthToken(root, '--wg-rightbar-width', RIGHT_BAR_FALLBACK_WIDTH);
  let sideBarOpen = sideBarOpenWidth();
  let rightBarOpen = rightBarOpenWidth();
  let mounted = mountLayout(root, layout);
  let sideBarLayout: SideBarLayout = 'hidden';
  let isRightBarOver = false;
  let chromeLayout = 'default';
  const contributions = {} as Record<AreaName, Contribution[]>;
  const statusBarHeight = createStatusBarHeight();
  const sideBarHandle = document.createElement('div');
  sideBarHandle.className = 'shell-side-bar-handle';
  const rightBarHandle = document.createElement('div');
  rightBarHandle.className = 'shell-right-bar-handle';

  const applyHidden = (name: AreaName) => {
    const { element } = mounted[name];
    element.hidden =
      name === 'sideBar'
        ? sideBarLayout === 'hidden'
        : contributions[name].length === 0;
    if (name === 'rightBar') {
      applyRightBar();
    }
  };

  const applyRightBar = () => {
    const { element } = mounted.rightBar;
    element.dataset.rightBar = isRightBarOver ? 'over' : 'beside';
    rightBarHandle.hidden = element.hidden || isRightBarOver;
  };

  const applySideBar = () => {
    mounted.sideBar.element.dataset.sideBar = sideBarLayout;
    applyHidden('sideBar');
    sideBarHandle.hidden = sideBarLayout !== 'beside';
  };

  const applyChromeLayout = () => {
    for (const name of CHROME_AREAS) {
      const { dataset } = mounted[name].element;
      dataset.layout = chromeLayout;
      dataset.layoutOwner = 'shell';
    }
  };

  const fillElements = () => {
    for (const name of AREA_NAMES) {
      for (const contribution of contributions[name]) {
        mounted[name].tracks[contribution.placement.align].append(
          contribution.element,
        );
      }
      applyHidden(name);
    }
    root.append(sideBarHandle, rightBarHandle);
    applySideBar();
    applyChromeLayout();
    statusBarHeight.observe(mounted.statusBar.element);
  };

  // Hides `name`'s element while it holds nothing, except the side bar, which
  // only `layOutSideBar` shows or hides; the right bar showing or hiding
  // redraws both bars, since the span each shares with main changed.
  const updateHidden = (name: AreaName) => {
    const wasHidden = mounted[name].element.hidden;
    applyHidden(name);
    const rightBarToggled =
      name === 'rightBar' && mounted.rightBar.element.hidden !== wasHidden;
    if (rightBarToggled) {
      drawBarWidths();
    }
  };

  const stopsRemoved = createListeners<RightBarStop>();

  // A stop for a right-bar contribution that passed `focus`. Its `left` runs
  // the contribution's own, then blurs the focused element when `element`
  // still holds it, so a turn the contribution did not end keeps no caret.
  const stopFor = (
    name: AreaName,
    element: HTMLElement,
    options: RightBarOptions | undefined,
  ): RightBarStop | undefined => {
    const focus = options?.focus;
    if (name !== 'rightBar' || focus === undefined) {
      return undefined;
    }
    return {
      focus,
      left() {
        options?.left?.();
        if (element.contains(document.activeElement)) {
          blurFocusedElement();
        }
      },
    };
  };

  const createArea = (name: AreaName): RightBarArea => {
    const live = contributions[name];
    let sequence = 0;
    return {
      contribute(element, options) {
        const placement = placementOf(options, sequence);
        sequence += 1;
        const index = insertionIndex(live, placement);
        const { tracks } = mounted[name];
        const track = tracks[placement.align];
        const following = nextInTrack(
          live,
          index,
          (align) => tracks[align] === track,
        );
        element.dataset.align = placement.align;
        track.insertBefore(element, following?.element ?? null);
        const stop = stopFor(name, element, options);
        const contribution: Contribution = { element, placement, stop };
        live.splice(index, 0, contribution);
        updateHidden(name);
        let isDisposed = false;
        return {
          dispose() {
            if (isDisposed) {
              return;
            }
            isDisposed = true;
            live.splice(live.indexOf(contribution), 1);
            element.remove();
            updateHidden(name);
            if (stop !== undefined) {
              stopsRemoved.tell(stop);
            }
          },
        };
      },
    };
  };

  const areas = {} as Record<AreaName, RightBarArea>;
  for (const name of AREA_NAMES) {
    contributions[name] = [];
    areas[name] = createArea(name);
  }
  fillElements();

  const sideBarLimits = {
    initial: sideBarOpen,
    min: SIDE_BAR_MIN,
    endMin: MAIN_MIN,
  };
  const rightBarLimits = {
    initial: rightBarOpen,
    min: RIGHT_BAR_MIN,
    endMin: MAIN_MIN,
  };
  // The edges of the span the side bar, main and the right bar share: the side
  // bar's start, main's while the side bar is hidden, to the right bar's end,
  // main's while the right bar is hidden. Neither moves with a bar's width or
  // layout; the handles take no layout space.
  const measureBarSpan = () => {
    const main = mounted.main.element.getBoundingClientRect();
    const left =
      sideBarLayout === 'hidden'
        ? main.left
        : mounted.sideBar.element.getBoundingClientRect().left;
    const right = mounted.rightBar.element.hidden
      ? main.right
      : mounted.rightBar.element.getBoundingClientRect().right;
    return { left, right };
  };
  // The span main and the right bar share with the side bar at its least
  // width, ending at the right bar's end.
  const measureRightBar = () => {
    const { left, right } = measureBarSpan();
    const sideBarLeast = sideBarLayout === 'beside' ? SIDE_BAR_MIN : 0;
    const span = right - left - sideBarLeast;
    return { left: right - span, span };
  };
  // The last width the right bar's divider showed, and how it draws: shown
  // beside, leaving main its least width; over main, which it squeezes none
  // of, at its least width and no wider than the span.
  let rightBarWidth = rightBarOpen;
  const layOutRightBar = () => {
    const { hidden } = mounted.rightBar.element;
    const { span } = measureRightBar();
    const clamped = clampSplitWidth(rightBarWidth, rightBarLimits, span);
    const isOver = !hidden && span < RIGHT_BAR_MIN + MAIN_MIN;
    const drawn = hidden
      ? rightBarWidth
      : isOver
        ? Math.min(clamped, span)
        : clamped;
    const taken = hidden ? 0 : isOver ? RIGHT_BAR_MIN : drawn;
    return { isOver, drawn, taken };
  };
  // The span the side bar and main share, less the width the right bar takes
  // from it.
  const measureSideBar = () => {
    const { left, right } = measureBarSpan();
    return { left, span: right - left - layOutRightBar().taken };
  };
  // The last width the side bar's divider showed; beside, it is drawn leaving
  // main its least width; over the content, which it squeezes none of, no
  // wider than the span.
  let sideBarWidth = sideBarOpen;
  const drawSideBarWidth = () => {
    const { span } = measureSideBar();
    const drawn =
      sideBarLayout === 'beside'
        ? clampSplitWidth(sideBarWidth, sideBarLimits, span)
        : sideBarLayout === 'over'
          ? Math.min(sideBarWidth, span)
          : sideBarWidth;
    root.style.setProperty('--shell-side-bar-width', String(drawn));
  };
  const drawRightBarWidth = () => {
    const { isOver, drawn } = layOutRightBar();
    isRightBarOver = isOver;
    applyRightBar();
    root.style.setProperty('--shell-right-bar-width', String(drawn));
  };

  // Neither bar's measure reads the other's drawn width or layout, so one
  // pass ends settled.
  const drawBarWidths = () => {
    drawRightBarWidth();
    drawSideBarWidth();
  };

  const sideBarDivider = createSplitDivider({
    ...sideBarLimits,
    uiState: openWidthState(uiState, () => sideBarOpen),
    stateKey: 'side-bar-width',
    handle: sideBarHandle,
    measure: measureSideBar,
    show(width) {
      sideBarWidth = width;
      drawSideBarWidth();
    },
    anchor: keys.anchor,
    timers,
  });
  const rightBarDivider = createSplitDivider({
    ...rightBarLimits,
    uiState: openWidthState(uiState, () => rightBarOpen),
    stateKey: 'right-bar-width',
    sizedPane: 'end',
    handle: rightBarHandle,
    measure: measureRightBar,
    show(width) {
      rightBarWidth = width;
      drawBarWidths();
    },
    anchor: NO_ANCHOR,
    timers,
  });
  const rootWidth = new ResizeObserver(() => drawBarWidths());
  rootWidth.observe(root);

  // Each area's scroll is read before the remount detaches its element, and
  // set on the new element once its contributions are back in it, an area at
  // its end kept at the end; both bars are measured again in the new layout.
  const replaceLayout = (next: ShellLayout) => {
    const previous = currentLayout;
    const scrolls = areaScrolls(mounted);
    try {
      mounted = mountLayout(root, next);
    } catch (error) {
      mounted = mountLayout(root, previous);
      fillElements();
      restoreAreaScrolls(mounted, scrolls);
      throw error;
    }
    currentLayout = next;
    generation += 1;
    fillElements();
    restoreAreaScrolls(mounted, scrolls);
    drawBarWidths();
  };

  return {
    areas,
    rightBarStops: () =>
      contributions.rightBar.flatMap((contribution) =>
        contribution.stop === undefined ? [] : [contribution.stop],
      ),
    onRightBarStopRemoved: (listener) => stopsRemoved.add(listener),
    rightBarHolds: (node) => mounted.rightBar.element.contains(node),
    setLayout(next) {
      replaceLayout(next);
      const mounted = generation;
      return {
        dispose() {
          if (generation === mounted) {
            replaceLayout(initialLayout);
          }
        },
      };
    },
    layOutSideBar(next) {
      sideBarLayout = next;
      applySideBar();
      drawBarWidths();
    },
    setChromeLayout(name) {
      chromeLayout = name;
      applyChromeLayout();
    },
    sideBarDivider,
    reloadBarOpenWidths() {
      sideBarOpen = sideBarOpenWidth();
      rightBarOpen = rightBarOpenWidth();
      sideBarDivider.reloadWidth();
      rightBarDivider.reloadWidth();
    },
    dispose() {
      sideBarDivider.dispose();
      rightBarDivider.dispose();
      rootWidth.disconnect();
      sideBarHandle.remove();
      rightBarHandle.remove();
    },
  };
}
