import type { Timers } from '../../contracts/ambient';
import type { Disposable } from '../../contracts/disposable';
import type { ResizeTarget } from '../../contracts/panes';
import type {
  AlignedArea,
  Alignment,
  Area,
  AreaName,
  BarArea,
  BarName,
  BarOptions,
  ContributeOptions,
  KeyHints,
  ShellLayout,
} from '../../contracts/plugin';
import type { UiState } from '../../contracts/ui-state';
import { createListeners } from '../../shared/listeners';
import { blurFocusedElement } from '../../shared/page/dom';
import { NO_ANCHOR } from '../../shared/page/ui/key-anchors';
import {
  createSplitDivider,
  type SplitDivider,
} from '../../shared/page/ui/split';
import {
  clampSplitWidth,
  type SplitLimits,
} from '../../shared/page/ui/split-width';
import type { BarStop } from '../pane-targets';
import type { SideBarLayout } from './modes';

const AREA_NAMES: readonly AreaName[] = [
  'titleBar',
  'activityBar',
  'leftBar',
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

// The shell's areas: every area takes `ContributeOptions`, and the left and
// right bars `BarOptions`, whose `focus` makes the contribution a stop for the
// core's focus keys.
export type ShellAreas = Record<Exclude<AreaName, BarName>, Area> &
  Record<BarName, BarArea>;

const BAR_NAMES: readonly BarName[] = ['leftBar', 'rightBar'];

function isBarName(name: AreaName): name is BarName {
  return name === 'leftBar' || name === 'rightBar';
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
// `isSideBarCrowded` is whether the shown left bar would lie over a side bar
// beside it at its least width, whatever the side bar's layout; the core then
// keeps the side bar off beside, as in a narrow window.
// `onSideBarCrowdedChanged` tells each listener when that changes, after the
// bars are drawn.
// `sideBarDivider` is the side bar's resize divider, which moves only while
// the side bar is beside the content; the left and right bars resize by their
// handles' drag alone. `reloadBarOpenWidths` reads the `sidebar-width`,
// `leftbar-width` and `rightbar-width` tokens again, after a theme is applied,
// and redraws each bar at its token while the user has stored no width for
// it. `barStops` lists one `BarStop` per contribution to `bar` that passed
// `focus`, in the bar's drawn order, top to bottom; a stop's `left` runs the
// contribution's, then blurs the focused element when the contribution still
// holds it, and a stop has `keepsTurn` only when its contribution passed one.
// A stop's contribution `dispose` takes it out of that list, then tells each
// `onBarStopRemoved` listener once. `barHolding` is the bar whose element
// holds `node`, or null when neither does. `togglePin` pins the activity bar
// open or unpins it, logging `activity bar pinned` or `activity bar unpinned`
// and keeping the pin in `uiState`, then tells each `onPinnedChanged`
// listener; `isPinned` is the pin, set or not. `activityBarNarrowChanged`
// hears the window cross the 680 px breakpoint (`SIDE_BAR_OVER_QUERY`): while
// narrow the pin stays set but does not apply, the bar lying collapsed and
// peeking on hover. `dispose` disposes every bar divider, stops watching the
// root's width, removes every handle and stops the activity bar's peek.
export interface Shell {
  areas: ShellAreas;
  barStops(bar: BarName): readonly BarStop[];
  onBarStopRemoved(listener: (stop: BarStop) => void): Disposable;
  barHolding(node: Node): BarName | null;
  setLayout(layout: ShellLayout): Disposable;
  layOutSideBar(layout: SideBarLayout): void;
  setChromeLayout(name: string): void;
  isSideBarCrowded(): boolean;
  onSideBarCrowdedChanged(listener: (isCrowded: boolean) => void): Disposable;
  sideBarDivider: ResizeTarget;
  reloadBarOpenWidths(): void;
  togglePin(): void;
  isPinned(): boolean;
  onPinnedChanged(listener: (pinned: boolean) => void): Disposable;
  activityBarNarrowChanged(isNarrow: boolean): void;
  dispose(): void;
}

// The side bar's least width, and the least width every bar leaves the main
// area.
const SIDE_BAR_MIN = 160;
const MAIN_MIN = 320;

// The side bar's open width when its width token is no pixel length.
const SIDE_BAR_FALLBACK_WIDTH = 256;

// The `uiState` key the activity bar's pin is kept under.
const PINNED_KEY = 'activity-bar-pinned';

// The activity bar's peek delay in ms when its token is no duration.
const PEEK_FALLBACK_DELAY = 300;

// What sets a left or right bar's width: its least width `min`, its open
// width `token` and the `fallback` taken when that token is no pixel length,
// the `uiState` key the user's width is stored under, the property on the
// root its drawn width goes in, its handle's class, and which pane of its
// span the bar is, so the handle sits on its edge toward main.
interface BarSpec {
  min: number;
  token: string;
  fallback: number;
  stateKey: string;
  widthProperty: string;
  handleClass: string;
  sizedPane: 'start' | 'end';
}

const BAR_SPECS: Record<BarName, BarSpec> = {
  leftBar: {
    min: 200,
    token: '--wg-leftbar-width',
    fallback: 300,
    stateKey: 'left-bar-width',
    widthProperty: '--shell-left-bar-width',
    handleClass: 'shell-left-bar-handle',
    sizedPane: 'start',
  },
  rightBar: {
    min: 200,
    token: '--wg-rightbar-width',
    fallback: 300,
    stateKey: 'right-bar-width',
    widthProperty: '--shell-right-bar-width',
    handleClass: 'shell-right-bar-handle',
    sizedPane: 'end',
  },
};

// A left or right bar's state: its open width, the last width its divider
// showed, whether it lies over main, and its handle.
interface Bar {
  spec: BarSpec;
  open: number;
  width: number;
  isOver: boolean;
  handle: HTMLElement;
}

// A bar opening at its token as `root` computes it, with a new handle.
function createBar(root: HTMLElement, spec: BarSpec): Bar {
  const open = openWidthToken(root, spec.token, spec.fallback);
  const handle = document.createElement('div');
  handle.className = spec.handleClass;
  return { spec, open, width: open, isOver: false, handle };
}

// How a shown left or right bar draws in a span: beside main, no wider than
// leaves main its least width; over main, which it squeezes none of, at its
// least width and no wider than the span; hidden, at `width` unclamped.
// `taken` is the width it takes from the span the side bar shares with main.
interface BarDraw {
  isOver: boolean;
  drawn: number;
  taken: number;
}

function drawBar(
  width: number,
  limits: SplitLimits,
  span: number,
  isHidden: boolean,
): BarDraw {
  if (isHidden) {
    return { isOver: false, drawn: width, taken: 0 };
  }
  const clamped = clampSplitWidth(width, limits, span);
  const isOver = span < limits.min + MAIN_MIN;
  return isOver
    ? { isOver, drawn: Math.min(clamped, span), taken: limits.min }
    : { isOver, drawn: clamped, taken: clamped };
}

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

// The ms of the `activitybar-peek-delay` token as `root` computes it, written
// in `ms` or `s`; any other value takes the fallback.
function peekDelayToken(root: HTMLElement): number {
  const token = getComputedStyle(root)
    .getPropertyValue('--wg-activitybar-peek-delay')
    .trim();
  const match = /^((?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/.exec(token);
  if (match === null) {
    return PEEK_FALLBACK_DELAY;
  }
  const amount = parseFloat(match[1]);
  return match[2] === 's' ? amount * 1000 : amount;
}

// The mark `keepPeekOnClick` sets: a click inside a marked element leaves the
// activity bar's peek as it is.
const PEEK_KEEPER = '[data-keeps-peek]';

// Marks `element`, an app-owned part of the activity bar, so a click inside it
// does not end the bar's peek.
export function keepPeekOnClick(element: HTMLElement): void {
  element.dataset.keepsPeek = '';
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
  'leftBar',
  'sideBar',
  'rightBar',
  'statusBar',
];

// `stop` is set on a left-bar or right-bar contribution that passed `focus`.
interface Contribution {
  element: HTMLElement;
  placement: Placement;
  stop?: BarStop;
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
// computes it. The left bar sits between the activity bar and the side bar,
// and the right bar on main's right, each hidden while it holds no
// contribution. Each bar's width is its `BarSpec`'s `widthProperty` on
// `root` (`--shell-left-bar-width`, `--shell-right-bar-width`), which its
// handle (`div.shell-left-bar-handle`, `div.shell-right-bar-handle`), a child
// of `root` shown only while the bar is beside, drags from its edge toward
// main and stores under its `stateKey` (`left-bar-width`, `right-bar-width`);
// with none stored it opens at its token (`leftbar-width`, `rightbar-width`).
// In a window too narrow for every bar beside main, the side bar gives way
// first, then the left bar: the right bar is measured against the side bar
// and the left bar at their least widths, the left bar against the side bar
// at its least width and the width the right bar takes (each none unless
// shown), and the side bar gets what is left; once even the side bar's least
// width would put the left bar over, the side bar is crowded
// (`isSideBarCrowded`). Shown in a span with room for
// its least width and main's, a left or right bar sits beside main
// (`data-left-bar` or `data-right-bar` `beside`), drawn no wider than leaves
// main its least width; in a narrower span it lies over (`over`) at its least
// width, no wider than the span, the left bar against the activity bar and
// the right bar on main's end, as `shell.css` lays them; hidden, it draws its
// width unclamped. Beside, the side bar draws no wider than leaves main its
// least width beside the other bars, each taking its least width while over
// main; over the content, no wider than reaches them. Each bar's drawn width
// is kept as `root` resizes, while `uiState` keeps the user's width.
// The activity bar's column is `--shell-activity-bar-width` on `root`, its
// `activitybar-width` token, or `activitybar-expanded-width` while its pin
// applies: set (`activity-bar-pinned` in `uiState`, read at the mount) and
// the window not narrow. The app keeps the bar's state on its area element,
// across every mount: `is-pinned` while the pin applies, `is-peeking` while it
// peeks, and `is-expanded` while either holds. The pointer entering a bar that
// is not expanded peeks it after the `activitybar-peek-delay` token, read as
// the wait starts through `timers` (at once for 0), logging `activity bar
// peeked`; leaving it, or a click in it outside an element marked by
// `keepPeekOnClick`, ends the wait or the peek. A peek never changes the
// column, so nothing beside the bar moves.
export function mountShell(
  root: HTMLElement,
  layout: ShellLayout,
  uiState: UiState,
  timers: Timers,
  keys: KeyHints,
  log: (message: string) => void,
): Shell {
  const initialLayout = layout;
  let currentLayout = layout;
  // Counts layout replacements, so a restore knows whether its layout is
  // still the one mounted.
  let generation = 0;
  const sideBarOpenWidth = () =>
    openWidthToken(root, '--wg-sidebar-width', SIDE_BAR_FALLBACK_WIDTH);
  let sideBarOpen = sideBarOpenWidth();
  let mounted = mountLayout(root, layout);
  let sideBarLayout: SideBarLayout = 'hidden';
  let chromeLayout = 'default';
  const contributions = {} as Record<AreaName, Contribution[]>;
  const statusBarHeight = createStatusBarHeight();
  const sideBarHandle = document.createElement('div');
  sideBarHandle.className = 'shell-side-bar-handle';
  const bars: Record<BarName, Bar> = {
    leftBar: createBar(root, BAR_SPECS.leftBar),
    rightBar: createBar(root, BAR_SPECS.rightBar),
  };
  const isBarShown = (name: BarName) => !mounted[name].element.hidden;

  const applyHidden = (name: AreaName) => {
    const { element } = mounted[name];
    element.hidden =
      name === 'sideBar'
        ? sideBarLayout === 'hidden'
        : contributions[name].length === 0;
    if (isBarName(name)) {
      applyBar(name);
    }
  };

  const applyBar = (name: BarName) => {
    const { element } = mounted[name];
    const bar = bars[name];
    element.dataset[name] = bar.isOver ? 'over' : 'beside';
    bar.handle.hidden = element.hidden || bar.isOver;
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

  // The activity bar's pin, whether the window is narrow, whether the bar
  // peeks, and the wait before a peek, null while none runs.
  let isPinned = uiState.get(PINNED_KEY) === true;
  let isBarNarrow = false;
  let isPeeking = false;
  let peekWait: number | null = null;
  let listenedBar: HTMLElement | null = null;
  const pinnedChanged = createListeners<boolean>();
  const isPinApplied = () => isPinned && !isBarNarrow;

  const applyActivityBar = () => {
    const pinApplied = isPinApplied();
    const { classList } = mounted.activityBar.element;
    classList.toggle('is-pinned', pinApplied);
    classList.toggle('is-peeking', isPeeking);
    classList.toggle('is-expanded', pinApplied || isPeeking);
    root.style.setProperty(
      '--shell-activity-bar-width',
      pinApplied
        ? 'var(--wg-activitybar-expanded-width)'
        : 'var(--wg-activitybar-width)',
    );
  };

  const clearPeekWait = () => {
    if (peekWait !== null) {
      timers.clear(peekWait);
      peekWait = null;
    }
  };

  const peek = () => {
    peekWait = null;
    isPeeking = true;
    applyActivityBar();
    log('activity bar peeked');
  };

  const endPeek = () => {
    clearPeekWait();
    if (isPeeking) {
      isPeeking = false;
      applyActivityBar();
    }
  };

  const armPeek = () => {
    if (isPinApplied() || isPeeking) {
      return;
    }
    clearPeekWait();
    const delay = peekDelayToken(root);
    if (delay === 0) {
      peek();
    } else {
      peekWait = timers.set(peek, delay);
    }
  };

  const endPeekOnClick = (event: Event) => {
    const isInKeeper = (event.target as Element).closest(PEEK_KEEPER) !== null;
    if (!isInKeeper) {
      endPeek();
    }
  };

  const unlistenToBar = () => {
    listenedBar?.removeEventListener('pointerenter', armPeek);
    listenedBar?.removeEventListener('pointerleave', endPeek);
    listenedBar?.removeEventListener('click', endPeekOnClick);
    listenedBar = null;
  };

  // Moves the pointer listeners to the mounted bar element.
  const listenToBar = () => {
    unlistenToBar();
    listenedBar = mounted.activityBar.element;
    listenedBar.addEventListener('pointerenter', armPeek);
    listenedBar.addEventListener('pointerleave', endPeek);
    listenedBar.addEventListener('click', endPeekOnClick);
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
    root.append(sideBarHandle, ...BAR_NAMES.map((name) => bars[name].handle));
    applySideBar();
    applyChromeLayout();
    clearPeekWait();
    isPeeking = false;
    listenToBar();
    applyActivityBar();
    statusBarHeight.observe(mounted.statusBar.element);
  };

  // Hides `name`'s element while it holds nothing, except the side bar, which
  // only `layOutSideBar` shows or hides; a left or right bar showing or hiding
  // redraws every bar, since the span each shares with main changed.
  const updateHidden = (name: AreaName) => {
    const wasHidden = mounted[name].element.hidden;
    applyHidden(name);
    const barToggled =
      isBarName(name) && mounted[name].element.hidden !== wasHidden;
    if (barToggled) {
      drawBarWidths();
    }
  };

  const stopsRemoved = createListeners<BarStop>();

  // A stop for a left-bar or right-bar contribution that passed `focus`. Its
  // `left` runs the contribution's own, then blurs the focused element when
  // `element` still holds it, so a turn the contribution did not end keeps no
  // caret. It carries the contribution's `keepsTurn` when one was passed.
  const stopFor = (
    name: AreaName,
    element: HTMLElement,
    options: BarOptions | undefined,
  ): BarStop | undefined => {
    const focus = options?.focus;
    if (!isBarName(name) || focus === undefined) {
      return undefined;
    }
    const stop: BarStop = {
      focus,
      left() {
        options?.left?.();
        if (element.contains(document.activeElement)) {
          blurFocusedElement();
        }
      },
    };
    const keepsTurn = options?.keepsTurn;
    if (keepsTurn !== undefined) {
      stop.keepsTurn = keepsTurn;
    }
    return stop;
  };

  const createArea = (name: AreaName): BarArea => {
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

  const areas = {} as Record<AreaName, BarArea>;
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
  const barLimits = (bar: Bar): SplitLimits => ({
    initial: bar.open,
    min: bar.spec.min,
    endMin: MAIN_MIN,
  });
  // The edges of the span the left bar, the side bar, main and the right bar
  // share: the start of the leftmost of the left bar, the side bar and main
  // that shows, to the right bar's end, main's while the right bar is hidden.
  // Neither moves with a bar's width or layout, since an over left bar starts
  // where its collapsed column did and an over right bar lies in main's
  // column; the handles take no layout space.
  const measureBarSpan = () => {
    const main = mounted.main.element.getBoundingClientRect();
    const starts = [main.left];
    if (sideBarLayout !== 'hidden') {
      starts.push(mounted.sideBar.element.getBoundingClientRect().left);
    }
    if (isBarShown('leftBar')) {
      starts.push(mounted.leftBar.element.getBoundingClientRect().left);
    }
    const right = isBarShown('rightBar')
      ? mounted.rightBar.element.getBoundingClientRect().right
      : main.right;
    return { left: Math.min(...starts), right };
  };
  const sideBarLeast = () => (sideBarLayout === 'beside' ? SIDE_BAR_MIN : 0);
  // The span main and the right bar share with the side bar, taking
  // `sideLeast`, and the left bar at its least width, ending at the right
  // bar's end.
  const measureRightBar = (sideLeast = sideBarLeast()) => {
    const { left, right } = measureBarSpan();
    const leftBarLeast = isBarShown('leftBar') ? BAR_SPECS.leftBar.min : 0;
    const span = right - left - sideLeast - leftBarLeast;
    return { left: right - span, span };
  };
  const drawRightBar = (sideLeast = sideBarLeast()) =>
    drawBar(
      bars.rightBar.width,
      barLimits(bars.rightBar),
      measureRightBar(sideLeast).span,
      !isBarShown('rightBar'),
    );
  // The span the left bar shares with main, the side bar, taking `sideLeast`,
  // and the width the right bar takes, starting at the left bar's start.
  const measureLeftBar = (sideLeast = sideBarLeast()) => {
    const { left, right } = measureBarSpan();
    const span = right - left - sideLeast - drawRightBar(sideLeast).taken;
    return { left, span };
  };
  const drawLeftBar = (sideLeast = sideBarLeast()) =>
    drawBar(
      bars.leftBar.width,
      barLimits(bars.leftBar),
      measureLeftBar(sideLeast).span,
      !isBarShown('leftBar'),
    );
  // Whether a side bar beside at its least width would put the left bar over
  // it; measured whatever the side bar's layout, so laying the side bar out by
  // it cannot flip it back.
  let isSideBarCrowded = false;
  const crowdedChanged = createListeners<boolean>();
  const updateSideBarCrowded = () => {
    const next = drawLeftBar(SIDE_BAR_MIN).isOver;
    if (next !== isSideBarCrowded) {
      isSideBarCrowded = next;
      crowdedChanged.tell(next);
    }
  };
  // The span the side bar and main share, less the widths the left and right
  // bars take from it.
  const measureSideBar = () => {
    const { left, right } = measureBarSpan();
    const leftBar = drawLeftBar();
    const leftBarBeside = leftBar.isOver ? 0 : leftBar.taken;
    const taken = leftBar.taken + drawRightBar().taken;
    return { left: left + leftBarBeside, span: right - left - taken };
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
  const showBarDraw = (name: BarName, draw: BarDraw) => {
    const bar = bars[name];
    bar.isOver = draw.isOver;
    applyBar(name);
    root.style.setProperty(bar.spec.widthProperty, String(draw.drawn));
  };

  // No bar's measure reads another's drawn width or layout, so one pass ends
  // settled; a crowding listener that lays the side bar out again redraws in
  // a pass of its own.
  const drawBarWidths = () => {
    showBarDraw('rightBar', drawRightBar());
    showBarDraw('leftBar', drawLeftBar());
    drawSideBarWidth();
    updateSideBarCrowded();
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
  const barMeasures: Record<BarName, () => { left: number; span: number }> = {
    leftBar: measureLeftBar,
    rightBar: measureRightBar,
  };
  const createBarDivider = (name: BarName): SplitDivider => {
    const bar = bars[name];
    return createSplitDivider({
      ...barLimits(bar),
      uiState: openWidthState(uiState, () => bar.open),
      stateKey: bar.spec.stateKey,
      sizedPane: bar.spec.sizedPane,
      handle: bar.handle,
      measure: barMeasures[name],
      show(width) {
        bar.width = width;
        drawBarWidths();
      },
      anchor: NO_ANCHOR,
      timers,
    });
  };
  const barDividers: Record<BarName, SplitDivider> = {
    leftBar: createBarDivider('leftBar'),
    rightBar: createBarDivider('rightBar'),
  };
  const rootWidth = new ResizeObserver(() => drawBarWidths());
  rootWidth.observe(root);

  // The root's observer does not see the activity bar's column change, so a
  // pin applying or lifting draws every bar again. An applied pin ends a peek.
  const applyPin = () => {
    if (isPinApplied()) {
      endPeek();
    }
    applyActivityBar();
    drawBarWidths();
  };
  applyPin();

  // Each area's scroll is read before the remount detaches its element, and
  // set on the new element once its contributions are back in it, an area at
  // its end kept at the end; every bar is measured again in the new layout.
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
    barStops: (bar) =>
      contributions[bar].flatMap((contribution) =>
        contribution.stop === undefined ? [] : [contribution.stop],
      ),
    onBarStopRemoved: (listener) => stopsRemoved.add(listener),
    barHolding: (node) =>
      BAR_NAMES.find((name) => mounted[name].element.contains(node)) ?? null,
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
    isSideBarCrowded: () => isSideBarCrowded,
    onSideBarCrowdedChanged: (listener) => crowdedChanged.add(listener),
    sideBarDivider,
    reloadBarOpenWidths() {
      sideBarOpen = sideBarOpenWidth();
      sideBarDivider.reloadWidth();
      for (const name of BAR_NAMES) {
        const bar = bars[name];
        bar.open = openWidthToken(root, bar.spec.token, bar.spec.fallback);
        barDividers[name].reloadWidth();
      }
    },
    togglePin() {
      isPinned = !isPinned;
      uiState.set(PINNED_KEY, isPinned);
      log(isPinned ? 'activity bar pinned' : 'activity bar unpinned');
      applyPin();
      pinnedChanged.tell(isPinned);
    },
    isPinned: () => isPinned,
    onPinnedChanged: (listener) => pinnedChanged.add(listener),
    activityBarNarrowChanged(next) {
      isBarNarrow = next;
      applyPin();
    },
    dispose() {
      clearPeekWait();
      unlistenToBar();
      sideBarDivider.dispose();
      rootWidth.disconnect();
      sideBarHandle.remove();
      for (const name of BAR_NAMES) {
        barDividers[name].dispose();
        bars[name].handle.remove();
      }
    },
  };
}
