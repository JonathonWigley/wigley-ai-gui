export type PaneDirection = 'left' | 'right' | 'up' | 'down';

export const PANE_DIRECTIONS: readonly PaneDirection[] = [
  'left',
  'right',
  'up',
  'down',
];

// A divider between two panes that the resize keys move one step. `nudge`
// returns false, moving nothing, when the direction's axis is not the
// divider's own (a side-by-side split given up or down) or the divider has no
// layout box (its split stacked or its start pane hidden), so the press goes
// on to the next divider; a divider at a limit or mid-drag stays and still
// returns true.
export interface ResizeTarget {
  nudge(direction: PaneDirection): boolean;
}

// A view's own panes that the focus keys move between. `move` focuses the pane
// that way and returns true, or returns false at the view's edge. The core
// calls it only while no scope is pushed.
export interface FocusTarget {
  move(direction: PaneDirection): boolean;
}

// The panes around the view, set by the mode that tiles them and kept across
// scope changes until it sets null. A press the view's own target turns down
// goes to these, a focus press only while no scope is pushed, and a resize
// they turn down goes on to the side bar.
export interface OuterPanes {
  focus: FocusTarget;
  resize: ResizeTarget;
}

// The core's pane resize commands.
export const PANE_RESIZE_COMMANDS = {
  left: 'panes.resizePaneLeft',
  right: 'panes.resizePaneRight',
  up: 'panes.resizePaneUp',
  down: 'panes.resizePaneDown',
} as const;

// The core's pane focus commands.
export const PANE_FOCUS_COMMANDS = {
  left: 'panes.focusLeft',
  right: 'panes.focusRight',
  up: 'panes.focusUp',
  down: 'panes.focusDown',
} as const;
