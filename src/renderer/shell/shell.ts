import type { Disposable } from '../../contracts/disposable';
import type {
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

const ALIGN_RANKS: Record<Placement['align'], number> = {
  start: 0,
  center: 1,
  end: 2,
};

// Where a contribution sorts in its area: `sequence` counts the area's
// contributions from 0 in the order they were made.
export interface Placement {
  align: 'start' | 'center' | 'end';
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

// The window's shell: `areas` are the areas contributions go to, kept across
// layouts. `setLayout` places them by `layout`, moving every contribution into
// it, and returns the `Disposable` that restores the layout the shell was
// mounted with, which does nothing once another `setLayout` replaced `layout`;
// a layout that throws or misses an area leaves the previous one mounted and
// rethrows. `layOutSideBar` shows or hides the side bar area and sets its
// `data-side-bar`.
export interface Shell {
  areas: Record<AreaName, Area>;
  setLayout(layout: ShellLayout): Disposable;
  layOutSideBar(layout: SideBarLayout): void;
}

interface Contribution {
  element: HTMLElement;
  placement: Placement;
}

// Mounts `layout` in `root`, emptied first, and returns each area's element,
// throwing when the layout returned none for an area.
function mountLayout(
  root: HTMLElement,
  layout: ShellLayout,
): Record<AreaName, HTMLElement> {
  root.replaceChildren();
  root.removeAttribute('class');
  const elements = layout.mount(root);
  for (const name of AREA_NAMES) {
    if (!(elements[name] instanceof HTMLElement)) {
      throw new Error(`Shell layout returned no element for ${name}`);
    }
  }
  return elements;
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
// contributions sorted, places each one directly in the area's element with
// its alignment as `data-align`, and hides the element while it holds none;
// the side bar's element shows or hides only by `layOutSideBar`, hidden until
// the first call.
export function mountShell(root: HTMLElement, layout: ShellLayout): Shell {
  const initialLayout = layout;
  let currentLayout = layout;
  // Counts layout replacements, so a restore knows whether its layout is
  // still the one mounted.
  let generation = 0;
  let elements = mountLayout(root, layout);
  let sideBarLayout: SideBarLayout = 'hidden';
  const contributions = {} as Record<AreaName, Contribution[]>;
  const statusBarHeight = createStatusBarHeight();

  const applyHidden = (name: AreaName) => {
    elements[name].hidden =
      name === 'sideBar'
        ? sideBarLayout === 'hidden'
        : contributions[name].length === 0;
  };

  const applySideBar = () => {
    elements.sideBar.dataset.sideBar = sideBarLayout;
    applyHidden('sideBar');
  };

  const fillElements = () => {
    for (const name of AREA_NAMES) {
      elements[name].append(
        ...contributions[name].map((contribution) => contribution.element),
      );
      applyHidden(name);
    }
    applySideBar();
    statusBarHeight.observe(elements.statusBar);
  };

  const createArea = (name: AreaName): Area => {
    const live = contributions[name];
    let sequence = 0;
    return {
      contribute(element, options) {
        const placement = placementOf(options, sequence);
        sequence += 1;
        const next = live.findIndex(
          (contribution) =>
            comparePlacements(contribution.placement, placement) > 0,
        );
        element.dataset.align = placement.align;
        const contribution = { element, placement };
        if (next === -1) {
          live.push(contribution);
          elements[name].append(element);
        } else {
          elements[name].insertBefore(element, live[next].element);
          live.splice(next, 0, contribution);
        }
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

  const replaceLayout = (next: ShellLayout) => {
    const previous = currentLayout;
    try {
      elements = mountLayout(root, next);
    } catch (error) {
      elements = mountLayout(root, previous);
      fillElements();
      throw error;
    }
    currentLayout = next;
    generation += 1;
    fillElements();
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
  };
}
