export type PaneDirection = 'left' | 'right' | 'up' | 'down';

// A divider between two panes that the resize keys move one step. `nudge`
// returns false only when the direction's axis is not the divider's own (a
// side-by-side split given up or down); a divider at a limit or with no layout
// box stays and still returns true.
export interface ResizeTarget {
  nudge(direction: PaneDirection): boolean;
}

// A view's own panes that the focus keys move between. `move` focuses the pane
// that way and returns true, or returns false at the view's edge.
export interface FocusTarget {
  move(direction: PaneDirection): boolean;
}

// The panes around the view, set by the mode that tiles them and kept across
// scope changes until it sets null. A press the view's own target turns down
// goes to these, and a resize they turn down goes on to the side bar.
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
