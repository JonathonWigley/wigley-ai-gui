import type { Timers } from '../../contracts/ambient';
import type { CommandId } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type { ResizeTarget } from '../../contracts/panes';
import type {
  AlignedArea,
  Alignment,
  Area,
  AreaName,
  ContributeOptions,
  ShellLayout,
} from '../../contracts/plugin';
import type { UiState } from '../../contracts/ui-state';
import type { BaseKitDeps } from '../../shared/page/layout-host/base-kit';
import type { AnchorNamer } from '../../shared/page/ui/key-anchors';
import { createSplitDivider } from '../../shared/page/ui/split';
import { clampSplitWidth } from '../../shared/page/ui/split-width';
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
// the side bar is beside the content; `rightBarDivider` the right bar's, which
// moves only while the right bar is beside main. `reloadBarOpenWidths` reads
// the `sidebar-width` and `rightbar-width` tokens again, after a theme is
// applied, and redraws each bar at its token while the user has stored no
// width for it. `setKeys` anchors both handles' resize prompts through `keys`,
// again on each call. `dispose` disposes both dividers, stops watching the
// root's width and removes both handles.
export interface Shell {
  areas: Record<AreaName, Area>;
  setLayout(layout: ShellLayout): Disposable;
  layOutSideBar(layout: SideBarLayout): void;
  setChromeLayout(name: string): void;
  sideBarDivider: ResizeTarget;
  rightBarDivider: ResizeTarget;
  reloadBarOpenWidths(): void;
  setKeys(keys: BaseKitDeps['keys']): void;
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
// so a bar divider's `reloadWidth` takes up a reloaded token; writes go
// through.
function openWidthState(uiState: UiState, openWidth: () => number): UiState {
  return {
    get(key) {
      const stored = uiState.get(key);
      return Number.isFinite(stored) ? stored : openWidth();
    },
    set: (key, value) => uiState.set(key, value),
  };
}

// An anchor function that anchors through the keys `setKeys` hands it, nothing
// before the first; each `setKeys` disposes every live anchor and anchors it
// again through the new keys.
function createForwardingAnchor(): {
  anchor: AnchorNamer<never>;
  setKeys(keys: BaseKitDeps['keys']): void;
} {
  interface Forwarded {
    element: HTMLElement;
    command: CommandId;
    live: Disposable | null;
  }
  const forwarded = new Set<Forwarded>();
  let keys: BaseKitDeps['keys'] | null = null;
  return {
    anchor(element, command) {
      const entry: Forwarded = {
        element,
        command,
        live: keys?.anchor(element, command) ?? null,
      };
      forwarded.add(entry);
      return {
        dispose() {
          entry.live?.dispose();
          entry.live = null;
          forwarded.delete(entry);
        },
      };
    },
    setKeys(next) {
      keys = next;
      for (const entry of forwarded) {
        entry.live?.dispose();
        entry.live = next.anchor(entry.element, entry.command);
      }
    },
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

interface Contribution {
  element: HTMLElement;
  placement: Placement;
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
// computes it. Beside, the side bar draws no wider than leaves the main area
// its least width; over the content, no wider than reaches the window's
// edge; each kept as `root` resizes, while `uiState` keeps the user's width.
// The right bar sits on main's right, hidden while it holds no contribution.
// Its width is `--shell-right-bar-width` on `root`, which its handle
// `div.shell-right-bar-handle`, a child of `root` shown only while the right
// bar is beside, drags from its start edge and stores under `right-bar-width`;
// with none stored it opens at the `rightbar-width` token. Shown in a span
// with room for its least width and main's, it sits beside main
// (`data-right-bar="beside"`), drawn no wider than leaves main its least
// width; in a narrower span it lies over main's end (`data-right-bar="over"`)
// at its least width, no wider than the span; hidden, it draws its width
// unclamped. The side bar draws first, so it gives way first when the window
// is too narrow for both bars.
export function mountShell(
  root: HTMLElement,
  layout: ShellLayout,
  uiState: UiState,
  timers: Timers,
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

  const createArea = (name: AreaName): Area => {
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
        const contribution = { element, placement };
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
          },
        };
      },
    };
  };

  const areas = {} as Record<AreaName, Area>;
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
  // The span the side bar and main share; the handle takes no layout space.
  const measureSideBar = () => {
    const { left } = mounted.sideBar.element.getBoundingClientRect();
    const { right } = mounted.main.element.getBoundingClientRect();
    return { left, span: right - left };
  };
  // The last width the divider showed; beside, it is drawn leaving main its
  // least width; over the content, which it squeezes none of, no wider than
  // the span to main's end, the window's edge.
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

  const rightBarLimits = {
    initial: rightBarOpen,
    min: RIGHT_BAR_MIN,
    endMin: MAIN_MIN,
  };
  // The span main and the right bar share, from main's left edge.
  const measureRightBar = () => {
    const { left } = mounted.main.element.getBoundingClientRect();
    const { right } = mounted.rightBar.element.getBoundingClientRect();
    return { left, span: right - left };
  };
  // The last width the divider showed; shown beside, it is drawn leaving main
  // its least width; over main, which it squeezes none of, at its least width
  // and no wider than the span.
  let rightBarWidth = rightBarOpen;
  const drawRightBarWidth = () => {
    const { hidden } = mounted.rightBar.element;
    const { span } = measureRightBar();
    const clamped = clampSplitWidth(rightBarWidth, rightBarLimits, span);
    isRightBarOver = !hidden && span < RIGHT_BAR_MIN + MAIN_MIN;
    applyRightBar();
    const drawn = hidden
      ? rightBarWidth
      : isRightBarOver
        ? Math.min(clamped, span)
        : clamped;
    root.style.setProperty('--shell-right-bar-width', String(drawn));
  };

  const drawBarWidths = () => {
    drawSideBarWidth();
    drawRightBarWidth();
  };

  const promptAnchor = createForwardingAnchor();
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
    anchor: promptAnchor.anchor,
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
      drawRightBarWidth();
    },
    anchor: promptAnchor.anchor,
    timers,
  });
  const rootWidth = new ResizeObserver(() => drawBarWidths());
  rootWidth.observe(root);

  // Each area's scroll is read before the remount detaches its element, and
  // set on the new element once its contributions are back in it, an area at
  // its end kept at the end.
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
  };

  return {
    areas,
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
    rightBarDivider,
    reloadBarOpenWidths() {
      sideBarOpen = sideBarOpenWidth();
      rightBarOpen = rightBarOpenWidth();
      sideBarDivider.reloadWidth();
      rightBarDivider.reloadWidth();
    },
    setKeys: (keys) => promptAnchor.setKeys(keys),
    dispose() {
      sideBarDivider.dispose();
      rightBarDivider.dispose();
      rootWidth.disconnect();
      sideBarHandle.remove();
      rightBarHandle.remove();
    },
  };
}
