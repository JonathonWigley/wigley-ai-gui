export type ResizeDirection = 'left' | 'right';

// A divider between two panes that the resize keys move one step. A divider
// that cannot move (stacked panes, a pane at its least width) stays.
export interface ResizeTarget {
  nudge(direction: ResizeDirection): void;
}

// The core's pane resize commands; `up` and `down` have no default bind.
export const PANE_RESIZE_COMMANDS = {
  left: 'panes.resizePaneLeft',
  right: 'panes.resizePaneRight',
  up: 'panes.resizePaneUp',
  down: 'panes.resizePaneDown',
} as const;
