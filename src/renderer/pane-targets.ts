import type {
  FocusTarget,
  OuterPanes,
  PaneDirection,
  ResizeTarget,
} from '../contracts/panes';

// The targets the core's pane commands go to. A resize asks the view's
// resize target, then the outer panes', then `sideBar`; a focus asks the
// view's focus target, then the outer panes'. Each stops at the first that
// returns true and logs when none does. `dropViewTargets` forgets the view's
// two targets and keeps the outer panes, which stay until
// `setOuterPanes(null)`.
export interface PaneTargets {
  setResizeTarget(target: ResizeTarget | null): void;
  setFocusTarget(target: FocusTarget | null): void;
  setOuterPanes(panes: OuterPanes | null): void;
  dropViewTargets(): void;
  resize(direction: PaneDirection): void;
  focus(direction: PaneDirection): void;
}

export function createPaneTargets(
  sideBar: ResizeTarget,
  log: (message: string) => void,
): PaneTargets {
  let resizeTarget: ResizeTarget | null = null;
  let focusTarget: FocusTarget | null = null;
  let outerPanes: OuterPanes | null = null;
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
    dropViewTargets() {
      resizeTarget = null;
      focusTarget = null;
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
      const moved =
        (focusTarget?.move(direction) ?? false) ||
        (outerPanes?.focus.move(direction) ?? false);
      if (!moved) {
        log(`no pane ${direction}`);
      }
    },
  };
}
