import type {
  FocusTarget,
  OuterPanes,
  PaneDirection,
  ResizeTarget,
} from '../contracts/panes';

// One right-bar contribution that passed `focus`: a stop for the core's focus
// keys. `focus` hands it the keys; `left` tells it its turn ended.
export interface RightBarStop {
  focus(): void;
  left?(): void;
}

// The areas past main's edges, as the core's focus keys reach them.
// `focusSideBar` hands the shown mode's side bar the keys and returns true, or
// returns false when the side bar is hidden or the mode gives no
// `focusSideBar`; `focusMain` gives main's last pane its keys back;
// `rightBarStops` lists the right bar's stops in drawn order, top to bottom.
export interface PaneAreas {
  focusSideBar(): boolean;
  focusMain(): void;
  rightBarStops(): readonly RightBarStop[];
}

// The targets the core's pane commands go to. A resize asks the view's
// resize target, then the outer panes', then `sideBar`, stops at the first
// that returns true and logs when none does. A focus while `isScopePushed()`
// asks nothing and logs; a resize goes through. Otherwise a focus goes by the
// area holding the keys, main until a move past main's edge:
// - main asks the view's focus target, then the outer panes'; at main's left
//   edge `areas.focusSideBar`, at its right edge the first right-bar stop
//   (`focus in the side bar`, `focus in the right bar`).
// - the side bar goes right to `areas.focusMain` (`focus back in main`).
// - a right-bar stop goes left to `areas.focusMain`, and down or up to the
//   next or previous stop.
// Any other move logs `no pane <direction>`. A move into an area writes the
// area after the hook it calls, whose own base scope change resets it; a move
// back to main writes it before `focusMain`.
// `baseChanged` runs on every base scope change: it forgets the view's two
// targets, keeping the outer panes until `setOuterPanes(null)`, and gives the
// keys back to main without calling `focusMain`, so a click into main ends an
// area's turn. `stopRemoved` ends the turn of the stop holding the keys, with
// `focusMain`; another stop's removal does nothing. `sideBarOpened` holds the
// side bar as the area, for a narrow mode's side bar opened over main.
// `focusLeftRightBar` hears the DOM focus land on an element outside the right
// bar: while a stop holds the keys, it gives the area back to main, then, once
// `defer` runs, calls `focusMain` unless a base scope change came first (the
// element's view set its own) or a scope is pushed. `focusDroppedFromRightBar` hears
// it leave the right bar for no element: the stop's turn ends with
// `focusMain`. While `isScopePushed()` both do nothing, the pushed scope's
// overlay holding the DOM focus over the stop's turn, and `stopRemoved` ends
// the turn but holds `focusMain` until `pushedScopesClosed` runs with no scope
// pushed; a base change first drops it. Every end of a stop's turn calls its
// `left`. `release` empties every slot holding `target`, by identity, and
// leaves a slot holding anything else.
export interface PaneTargets {
  setResizeTarget(target: ResizeTarget | null): void;
  setFocusTarget(target: FocusTarget | null): void;
  setOuterPanes(panes: OuterPanes | null): void;
  baseChanged(): void;
  stopRemoved(stop: RightBarStop): void;
  sideBarOpened(): void;
  focusLeftRightBar(): void;
  focusDroppedFromRightBar(): void;
  pushedScopesClosed(): void;
  release(target: ResizeTarget | FocusTarget | OuterPanes): void;
  resize(direction: PaneDirection): void;
  focus(direction: PaneDirection): void;
}

type FocusArea = 'main' | 'side' | 'right';

export function createPaneTargets(
  sideBar: ResizeTarget,
  isScopePushed: () => boolean,
  log: (message: string) => void,
  areas: PaneAreas,
  defer: (run: () => void) => void,
): PaneTargets {
  let resizeTarget: ResizeTarget | null = null;
  let focusTarget: FocusTarget | null = null;
  let outerPanes: OuterPanes | null = null;
  let area: FocusArea = 'main';
  let heldStop: RightBarStop | null = null;
  // Set when a held stop was removed under a pushed scope: main's pane gets
  // the keys back once no scope is pushed.
  let isMainOwed = false;
  // Set while a turn ended by focus landing outside the right bar waits to
  // see whether the element's view sets its own base scope.
  let isAwaitingView = false;

  // Ends the held stop's turn, if any, and gives main the area; the caller
  // decides whether main's pane gets the keys back.
  const endStopTurn = () => {
    const stop = heldStop;
    area = 'main';
    heldStop = null;
    isMainOwed = false;
    isAwaitingView = false;
    stop?.left?.();
  };

  // Gives the keys back to main from the side bar or a right-bar stop. The
  // area is written first, so the DOM focus leaving the right bar inside
  // `focusMain` finds main already holding it.
  const backToMain = () => {
    endStopTurn();
    areas.focusMain();
    log('focus back in main');
  };

  // Hands `stop` the keys, ending the held stop's turn first.
  const enterStop = (stop: RightBarStop) => {
    endStopTurn();
    stop.focus();
    area = 'right';
    heldStop = stop;
    log('focus in the right bar');
  };

  const focusFromMain = (direction: PaneDirection) => {
    const moved =
      (focusTarget?.move(direction) ?? false) ||
      (outerPanes?.focus.move(direction) ?? false);
    if (moved) {
      return;
    }
    if (direction === 'left' && areas.focusSideBar()) {
      area = 'side';
      log('focus in the side bar');
      return;
    }
    const stops = direction === 'right' ? areas.rightBarStops() : [];
    if (stops.length > 0) {
      enterStop(stops[0]);
      return;
    }
    log(`no pane ${direction}`);
  };

  const focusFromSide = (direction: PaneDirection) => {
    if (direction === 'right') {
      backToMain();
      return;
    }
    log(`no pane ${direction}`);
  };

  const focusFromRight = (direction: PaneDirection) => {
    if (direction === 'left') {
      backToMain();
      return;
    }
    const stops = areas.rightBarStops();
    const index = heldStop === null ? -1 : stops.indexOf(heldStop);
    const step = direction === 'down' ? 1 : direction === 'up' ? -1 : 0;
    const next = step === 0 ? undefined : stops[index + step];
    if (next === undefined) {
      log(`no pane ${direction}`);
      return;
    }
    enterStop(next);
  };

  return {
    setResizeTarget(target) {
      resizeTarget = target;
    },
    setFocusTarget(target) {
      focusTarget = target;
    },
    setOuterPanes(panes) {
      outerPanes = panes;
    },
    baseChanged() {
      resizeTarget = null;
      focusTarget = null;
      isAwaitingView = false;
      endStopTurn();
    },
    stopRemoved(stop) {
      if (area !== 'right' || heldStop !== stop) {
        return;
      }
      if (isScopePushed()) {
        endStopTurn();
        isMainOwed = true;
      } else {
        backToMain();
      }
    },
    sideBarOpened() {
      endStopTurn();
      area = 'side';
      log('focus in the side bar');
    },
    focusLeftRightBar() {
      if (area !== 'right' || isScopePushed()) {
        return;
      }
      endStopTurn();
      log('focus back in main');
      isAwaitingView = true;
      defer(() => {
        if (isAwaitingView && !isScopePushed()) {
          areas.focusMain();
        }
        isAwaitingView = false;
      });
    },
    focusDroppedFromRightBar() {
      if (area === 'right' && !isScopePushed()) {
        backToMain();
      }
    },
    pushedScopesClosed() {
      if (isMainOwed && !isScopePushed()) {
        isMainOwed = false;
        areas.focusMain();
        log('focus back in main');
      }
    },
    release(target) {
      if (resizeTarget === target) {
        resizeTarget = null;
      }
      if (focusTarget === target) {
        focusTarget = null;
      }
      if (outerPanes === target) {
        outerPanes = null;
      }
    },
    resize(direction) {
      const resized =
        (resizeTarget?.nudge(direction) ?? false) ||
        (outerPanes?.resize.nudge(direction) ?? false) ||
        sideBar.nudge(direction);
      if (!resized) {
        log(`no pane divider runs ${direction}`);
      }
    },
    focus(direction) {
      if (isScopePushed()) {
        log(`no pane ${direction} while a scope is pushed`);
        return;
      }
      if (area === 'side') {
        focusFromSide(direction);
      } else if (area === 'right') {
        focusFromRight(direction);
      } else {
        focusFromMain(direction);
      }
    },
  };
}
