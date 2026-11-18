// The demo layout contract: what a layout in `layouts/demo/<name>/layout.js` draws the Demo panel's step list and the
// caption with. While the demo runs, the app draws one `steps` into the Demo panel at the top of the left bar and one
// `caption` into the status bar's centre. The app sets `data-layout-owner="demo"` and `data-layout="<name>"` on the
// element each part returns, `<name>` being the layout that drew it, so `[data-layout-owner="demo"][data-layout="<name>"]
// …` in a layout's CSS selects only its own parts.
//
// The app keeps:
// - the left-bar slot, contributed while the panel is shown (`Space d d`), and the status-bar slot, contributed while
//   the demo runs;
// - the step agent's pane, below the step list in the panel;
// - the keys and the focus: Alt+h past the side bar's left edge (main's while no side bar shows) gives the panel the
//   keys, `j`/`k` walk a cursor over the steps, Enter goes to the cursor's step and `i` moves the keys into the step
//   agent's pane; the layout adds `is-cursor` to the row whose `isCursor` is true, and the app scrolls the first
//   `.is-cursor` into view;
// - the cursor, the current step and beat, and autoplay;
// - every redraw: on each move, each step registered or removed, each cursor move, each settings change and each
//   layouts set.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One beat under the current step, by its name; `isCurrent` on the beat shown.
export interface BeatRowInput {
  name: string;
  isCurrent: boolean;
}

// One step. `beats` lists the beats only under the current step; it is empty on every other row.
export interface StepRowInput {
  id: string;
  title: string;
  isCurrent: boolean;
  isCursor: boolean;
  beats: BeatRowInput[];
}

// One section that holds a step, its steps in run order.
export interface StepSectionInput {
  title: string;
  steps: StepRowInput[];
}

// The panel's step list: the sections that hold a step, in run order. `realShown` is true while the user's real
// sessions show beside the Demo section (`Space d h`).
export interface StepListInput {
  sections: StepSectionInput[];
  autoplay: boolean;
  realShown: boolean;
}

// The caption for the current step: its number in run order from 1, of `stepCount`.
export interface CaptionInput {
  title: string;
  caption: string;
  stepNumber: number;
  stepCount: number;
  autoplay: boolean;
}

// The kit each part gets.
export interface DemoKit extends BaseKit {}

// What a part returns: its root, appended to `parent`.
export interface DemoPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `demo.layout` setting and `default`; a part that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
export interface Layout {
  steps?(parent: HTMLElement, input: StepListInput, kit: DemoKit): DemoPart;
  caption?(parent: HTMLElement, input: CaptionInput, kit: DemoKit): DemoPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
