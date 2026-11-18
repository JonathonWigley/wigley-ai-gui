import type {
  FocusTarget,
  OuterPanes,
  PaneDirection,
  ResizeTarget,
} from '../contracts/panes';
import type { BarName } from '../contracts/plugin';
import type { ScopeStack } from './key-scope';

// One left-bar or right-bar contribution that passed `focus`: a stop for the
// core's focus keys. `focus` hands it the keys; `left` tells it its turn
// ended; `keepsTurn` returning true keeps its turn through a base scope change.
export interface BarStop {
  focus(): void;
  left?(): void;
  keepsTurn?(): boolean;
}

// The areas past main's edges, as the core's focus keys reach them.
// `focusSideBar` hands the shown mode's side bar the keys and returns true, or
// returns false when the side bar is hidden or the mode gives no
// `focusSideBar`; `focusMain` gives main's last pane its keys back;
// `barStops` lists a bar's stops in drawn order, top to bottom.
export interface PaneAreas {
  focusSideBar(): boolean;
  focusMain(): void;
  barStops(bar: BarName): readonly BarStop[];
}

// The targets the core's pane commands go to. A resize asks the view's
// resize target, then the outer panes', then `sideBar`, stops at the first
// that returns true and logs when none does. A focus while `isScopePushed()`
// asks nothing and logs; a resize goes through. Otherwise a focus goes by the
// area holding the keys, main until a move past main's edge:
// - main asks the view's focus target, then the outer panes'; at main's left
//   edge `areas.focusSideBar`, else the first left-bar stop; at its right edge
//   the first right-bar stop (`focus in the side bar`, `focus in the left
//   bar`, `focus in the right bar`).
// - the side bar goes right to `areas.focusMain` (`focus back in main`), and
//   left to the first left-bar stop.
// - a left-bar stop goes right to `areas.focusSideBar`, else to
//   `areas.focusMain`; a right-bar stop goes left to `areas.focusMain`; a stop
//   goes down or up to the next or previous stop in its own bar.
// Any other move logs `no pane <direction>`. A move into an area writes the
// area after the hook it calls, whose own base scope change resets it; a move
// back to main writes it before `focusMain`.
// `baseChanged` runs on every base scope change: it forgets the view's two
// targets, keeping the outer panes until `setOuterPanes(null)`, and gives the
// keys back to main without calling `focusMain`, so a click into main ends an
// area's turn; a held stop whose `keepsTurn` returns true keeps its turn.
// `stopRemoved` ends the turn of the stop holding the keys, with `focusMain`;
// another stop's removal does nothing. `sideBarOpened` holds the side bar as
// the area, for a narrow mode's side bar opened over main.
// `focusMovedTo` hears the DOM focus land on an element in `bar`, or outside
// both bars for null: while a stop of another bar holds the keys, it gives the
// area back to main, then, once `defer` runs, calls `focusMain` unless a base
// scope change came first (the element's view set its own) or a scope is
// pushed. `focusDroppedFrom` hears it leave `bar` for no element: the turn of
// that bar's stop ends with `focusMain`. While `isScopePushed()` both do
// nothing, the pushed scope's overlay holding the DOM focus over the stop's
// turn, and `stopRemoved` ends the turn but owes main `focusMain`:
// `pushedScopesClosed` pays it once `defer` runs with no scope pushed, unless
// a base change came first and dropped it (a base change pops an overlay
// before `baseChanged` hears it, so the debt cannot be paid inside the pop).
// Every end of a stop's turn calls its `left`. `release` empties every slot
// holding `target`, by identity, and leaves a slot holding anything else.
export interface PaneTargets {
  setResizeTarget(target: ResizeTarget | null): void;
  setFocusTarget(target: FocusTarget | null): void;
  setOuterPanes(panes: OuterPanes | null): void;
  baseChanged(): void;
  stopRemoved(stop: BarStop): void;
  sideBarOpened(): void;
  focusMovedTo(bar: BarName | null): void;
  focusDroppedFrom(bar: BarName): void;
  pushedScopesClosed(): void;
  release(target: ResizeTarget | FocusTarget | OuterPanes): void;
  resize(direction: PaneDirection): void;
  focus(direction: PaneDirection): void;
}

type FocusArea = 'main' | 'side' | BarName;

// The words each bar's log lines name it by.
const BAR_LABELS: Record<BarName, string> = {
  leftBar: 'left bar',
  rightBar: 'right bar',
};

// The direction that leaves each bar toward main.
const BAR_EXITS: Record<BarName, PaneDirection> = {
  leftBar: 'right',
  rightBar: 'left',
};

function isBar(area: FocusArea): area is BarName {
  return area === 'leftBar' || area === 'rightBar';
}

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
  let heldStop: BarStop | null = null;
  // Set when a held stop was removed under a pushed scope: main's pane gets
  // the keys back once no scope is pushed and no base change came first.
  let isMainOwed = false;
  // Set while a turn ended by focus landing outside its bar waits to see
  // whether the element's view sets its own base scope.
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

  // Gives the keys back to main from the side bar or a bar stop. The area is
  // written first, so the DOM focus leaving a bar inside `focusMain` finds
  // main already holding it.
  const backToMain = () => {
    endStopTurn();
    areas.focusMain();
    log('focus back in main');
  };

  // Hands `stop` of `bar` the keys, ending the held stop's turn first.
  const enterStop = (bar: BarName, stop: BarStop) => {
    endStopTurn();
    stop.focus();
    area = bar;
    heldStop = stop;
    log(`focus in the ${BAR_LABELS[bar]}`);
  };

  // Hands `bar`'s first stop the keys and returns true, or returns false when
  // the bar has none.
  const enterBar = (bar: BarName) => {
    const [first] = areas.barStops(bar);
    if (first === undefined) {
      return false;
    }
    enterStop(bar, first);
    return true;
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
    const bar: BarName | null =
      direction === 'left'
        ? 'leftBar'
        : direction === 'right'
          ? 'rightBar'
          : null;
    if (bar === null || !enterBar(bar)) {
      log(`no pane ${direction}`);
    }
  };

  const focusFromSide = (direction: PaneDirection) => {
    if (direction === 'right') {
      backToMain();
      return;
    }
    if (direction !== 'left' || !enterBar('leftBar')) {
      log(`no pane ${direction}`);
    }
  };

  // Leaves the left bar for the side bar while it shows, else for main.
  const leaveLeftBar = () => {
    endStopTurn();
    if (areas.focusSideBar()) {
      area = 'side';
      log('focus in the side bar');
      return;
    }
    areas.focusMain();
    log('focus back in main');
  };

  const focusFromBar = (bar: BarName, direction: PaneDirection) => {
    if (direction === BAR_EXITS[bar]) {
      if (bar === 'leftBar') {
        leaveLeftBar();
      } else {
        backToMain();
      }
      return;
    }
    const stops = areas.barStops(bar);
    const index = heldStop === null ? -1 : stops.indexOf(heldStop);
    const step = direction === 'down' ? 1 : direction === 'up' ? -1 : 0;
    const next = step === 0 ? undefined : stops[index + step];
    if (next === undefined) {
      log(`no pane ${direction}`);
      return;
    }
    enterStop(bar, next);
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
      if (heldStop?.keepsTurn?.() !== true) {
        endStopTurn();
      }
    },
    stopRemoved(stop) {
      if (heldStop !== stop) {
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
    focusMovedTo(bar) {
      if (!isBar(area) || area === bar || isScopePushed()) {
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
    focusDroppedFrom(bar) {
      if (area === bar && !isScopePushed()) {
        backToMain();
      }
    },
    pushedScopesClosed() {
      if (!isMainOwed) {
        return;
      }
      defer(() => {
        if (isMainOwed && !isScopePushed()) {
          isMainOwed = false;
          areas.focusMain();
          log('focus back in main');
        }
      });
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
      } else if (isBar(area)) {
        focusFromBar(area, direction);
      } else {
        focusFromMain(direction);
      }
    },
  };
}

// Runs `targets.baseChanged` on every base scope change, and
// `targets.pushedScopesClosed` on each change of the current scope that leaves
// none pushed.
export function listenToScopes(
  scopes: Pick<ScopeStack, 'onBaseChange' | 'onChange' | 'anyPushed'>,
  targets: Pick<PaneTargets, 'baseChanged' | 'pushedScopesClosed'>,
): void {
  // Targets a view set under the previous base belong to a view no longer in
  // force, and the base change ends an area's turn.
  scopes.onBaseChange(() => targets.baseChanged());
  scopes.onChange(() => {
    if (!scopes.anyPushed()) {
      targets.pushedScopesClosed();
    }
  });
}

// Tells `targets` where the DOM focus goes, as `barHolding` places each event
// target in a bar or in neither (null): a `focusin` runs `focusMovedTo` with
// the target's bar; a `focusout` from inside a bar with no `relatedTarget`
// runs `focusDroppedFrom` with that bar once `defer` runs, only if the focus
// then sits on the body or nothing. A window blur has no `relatedTarget`
// either but keeps `activeElement`, so it runs nothing.
export function listenToBarFocus(
  document: Document,
  barHolding: (target: EventTarget) => BarName | null,
  defer: (run: () => void) => void,
  targets: Pick<PaneTargets, 'focusMovedTo' | 'focusDroppedFrom'>,
): void {
  const barOf = (target: EventTarget | null) =>
    target === null ? null : barHolding(target);
  document.addEventListener('focusin', (event) => {
    targets.focusMovedTo(barOf(event.target));
  });
  document.addEventListener('focusout', (event) => {
    const bar = barOf(event.target);
    if (event.relatedTarget !== null || bar === null) {
      return;
    }
    defer(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        targets.focusDroppedFrom(bar);
      }
    });
  });
}
