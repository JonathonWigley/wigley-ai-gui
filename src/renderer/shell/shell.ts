import type { Disposable } from '../../contracts/disposable';
import type {
  AlignedArea,
  Alignment,
  Area,
  AreaName,
  ContributeOptions,
  ShellLayout,
} from '../../contracts/plugin';
import type { SideBarLayout } from './modes';

const AREA_NAMES: readonly AreaName[] = [
  'titleBar',
  'activityBar',
  'sideBar',
  'main',
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
// `data-side-bar`. `setChromeLayout` names the user's shell layout on the four
// chrome areas' elements (`data-layout`, with `data-layout-owner="shell"`),
// kept across every later mount, so the layout's CSS restyles their frames.
export interface Shell {
  areas: Record<AreaName, Area>;
  setLayout(layout: ShellLayout): Disposable;
  layOutSideBar(layout: SideBarLayout): void;
  setChromeLayout(name: string): void;
}

// The areas whose frames a user shell layout restyles.
const CHROME_AREAS: readonly AreaName[] = [
  'titleBar',
  'activityBar',
  'sideBar',
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

function areaScrolls(
  mounted: Record<AreaName, MountedArea>,
): Record<AreaName, number> {
  const scrolls = {} as Record<AreaName, number>;
  for (const name of AREA_NAMES) {
    scrolls[name] = mounted[name].element.scrollTop;
  }
  return scrolls;
}

function restoreAreaScrolls(
  mounted: Record<AreaName, MountedArea>,
  scrolls: Record<AreaName, number>,
): void {
  for (const name of AREA_NAMES) {
    mounted[name].element.scrollTop = scrolls[name];
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
// the first call.
export function mountShell(root: HTMLElement, layout: ShellLayout): Shell {
  const initialLayout = layout;
  let currentLayout = layout;
  // Counts layout replacements, so a restore knows whether its layout is
  // still the one mounted.
  let generation = 0;
  let mounted = mountLayout(root, layout);
  let sideBarLayout: SideBarLayout = 'hidden';
  let chromeLayout = 'default';
  const contributions = {} as Record<AreaName, Contribution[]>;
  const statusBarHeight = createStatusBarHeight();

  const applyHidden = (name: AreaName) => {
    mounted[name].element.hidden =
      name === 'sideBar'
        ? sideBarLayout === 'hidden'
        : contributions[name].length === 0;
  };

  const applySideBar = () => {
    mounted.sideBar.element.dataset.sideBar = sideBarLayout;
    applyHidden('sideBar');
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
    applySideBar();
    applyChromeLayout();
    statusBarHeight.observe(mounted.statusBar.element);
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
        applyHidden(name);
        let isDisposed = false;
        return {
          dispose() {
            if (isDisposed) {
              return;
            }
            isDisposed = true;
            live.splice(live.indexOf(contribution), 1);
            element.remove();
            applyHidden(name);
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

  // Each area's scroll is read before the remount detaches its element, and
  // set on the new element once its contributions are back in it.
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
    },
    setChromeLayout(name) {
      chromeLayout = name;
      applyChromeLayout();
    },
  };
}
