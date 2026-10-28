import type { ResizeDirection, ResizeTarget } from '../contracts/panes';

// The divider the core's resize commands move: the target a view set, else
// `sideBar`. `dropTarget` forgets the target, as `setTarget(null)` does.
export interface PaneResize {
  setTarget(target: ResizeTarget | null): void;
  dropTarget(): void;
  // Nudges the target, or the side bar when no target is set.
  resize(direction: ResizeDirection): void;
}

export function createPaneResize(sideBar: ResizeTarget): PaneResize {
  let target: ResizeTarget | null = null;
  return {
    setTarget(next) {
      target = next;
    },
    dropTarget() {
      target = null;
    },
    resize(direction) {
      (target ?? sideBar).nudge(direction);
    },
  };
}
