// The workflow layout contract: what a layout in `layouts/workflow/<name>/layout.js` draws each session's place in
// the user's wigley workflow with. The app draws three parts for a session:
// - `chip`, under the session's row in the side bar, in the row part's wrapper: the stage's label and status as one
//   tag, and the countdown. Its input also carries the detail and the main action. An idle session draws no chip.
// - `strip`, above the Chat tab's composer, in the composer part's wrapper: the stepper until the session has a plan,
//   the status mark and status line when the stepper does not show the stage, the countdown and the main action. Its
//   input also carries the detail and every action. An idle session draws no strip.
// - `sidePane`, beside the Chat tab's transcript, in the side part's wrapper: the status mark and line, the detail, the
//   stepper, a progress bar, the plan's checklist (finished waves folded, the current wave in full, a line per later
//   wave) and every action of the stage. An idle session, a session with no plan read, and a hidden pane draw no pane.
//   The app does not draw it again for the countdown, so a pane that shows the countdown updates on the next flow push.
// The app sets `data-layout-owner="workflow"` and `data-layout="<name>"` on the element each part returns, `<name>`
// being the layout that drew it, so `[data-layout-owner="workflow"][data-layout="<name>"] …` in a layout's CSS
// selects only its own parts.
//
// The app keeps:
// - each session's stage and flow, which main folds from the agent's events and pushes on each change;
// - the workflow commands and their keys (`<Leader>w…`), and what each runs;
// - the session each button runs for: a part's buttons run for the session it draws, whether or not that session is
//   selected; only keys act on the selected session;
// - the countdown's ticking and its text: while a chip or a strip shows one, the app draws those parts again once a
//   second;
// - whether the side pane shows, each session's finished-waves fold, and the scroll of the list `kit.sideList` draws.
import type {
  BaseKit,
  ButtonVariant,
} from '../../../shared/page/layout-host/kit';

// What a stage is doing now; null on an input for a stage with no status.
export type StageStatus = 'running' | 'paused' | 'ready' | 'done';

// What a mark shows: a stage's status, or `pending` for a step or a task not reached.
export type MarkState = StageStatus | 'pending';

// One stage in the stepper: done before the session's stage, the stage's status at it, pending after it. A stage added
// with `inStepper: false` leaves every step pending. Stages sharing a step take one place: primer and feature the one
// the session is in, otherwise feature; plan ready and make the one the session is in, otherwise make.
export interface StepInput {
  id: string;
  label: string;
  state: MarkState;
}

// One action the stage offers: the workflow command it runs (`clearAndMake`), its button text, whether it can run
// now (Clear & make is disabled while the session is busy), and whether it is the stage's main action, the one
// `<Leader>ww` runs.
export interface ActionInput {
  command: string;
  label: string;
  enabled: boolean;
  main: boolean;
}

// `stage` is the stage's id (`make`), `label` its word (`Make`), `status` what it is doing, `statusText` the two as one
// (`Make · running`), `detail` its line (`3/7 · wave 2 · Claim grants`, the plan's title in it from feature on once a
// plan is read, or ''), `countdown` the auto-start's seconds left (`9s`) or null, and `mainAction` the stage's main
// action, null when it has none.
export interface ChipInput {
  stage: string;
  label: string;
  status: StageStatus | null;
  statusText: string;
  detail: string;
  countdown: string | null;
  mainAction: ActionInput | null;
}

// As ChipInput, with `statusLine` the status text and the stage's progress (`Make · running 3/9`), every step of the
// stepper, every action of the stage, the main action first, and `hasPlan`, whether a plan was read.
export interface StripInput {
  stage: string;
  label: string;
  status: StageStatus | null;
  statusText: string;
  statusLine: string;
  detail: string;
  countdown: string | null;
  steps: readonly StepInput[];
  actions: readonly ActionInput[];
  hasPlan: boolean;
}

// One box of the plan's checklist in the side pane: its text and its mark. A ticked box is `done`; an open box in the
// current wave shows the stage's status while the stage runs tasks; every other open box is `pending`.
export interface SideTaskInput {
  text: string;
  state: MarkState;
}

// The boxes under one `### Wave N` (`Wave 2`), or those under no wave heading (`Tasks`), in file order.
export interface SideWaveInput {
  title: string;
  tasks: readonly SideTaskInput[];
}

// As StripInput, with the plan's title ('' for a plan with no title), `checked` of its `total` boxes ticked, and its
// waves in file order: `finishedWaves` each with every box ticked, `currentWave` the first other, null when every wave
// is finished, and `laterWaves` the rest. `finishedOpen` is whether the session's finished waves are unfolded.
export interface SidePaneInput extends StripInput {
  planTitle: string;
  checked: number;
  total: number;
  finishedWaves: readonly SideWaveInput[];
  finishedOpen: boolean;
  currentWave: SideWaveInput | null;
  laterWaves: readonly SideWaveInput[];
}

// `anchor` false draws no key hint in the button; `variant` replaces the one the action picks.
export interface ActionButtonOptions {
  anchor?: boolean;
  variant?: ButtonVariant;
}

// The kit every workflow part gets.
export interface WorkflowKit extends BaseKit {
  // `button.ui-button` with the action's label, disabled while the action cannot run. Its variant is
  // `options.variant`, else `primary` for the main action and `secondary` for the rest. It draws the action's key
  // inside it (`Space w w` on the main action) unless `options.anchor` is false. A click runs the action for the
  // session the part draws and goes no further, so a chip's button does not also select its row.
  actionButton(
    parent: HTMLElement,
    action: ActionInput,
    options?: ActionButtonOptions,
  ): HTMLButtonElement;
  // `ol.workflow-stepper`: one `li.workflow-step` per step, carrying `data-state`, holding a `statusMark`, a
  // `span.workflow-step-label` and a `span.workflow-step-status` reading the state, which shows only in a rule that
  // sets its `display`.
  stepper(parent: HTMLElement, steps: readonly StepInput[]): HTMLElement;
  // `span.workflow-countdown` reading `text`, in tabular numerals.
  countdown(parent: HTMLElement, text: string): HTMLElement;
  // `span.workflow-mark`, carrying `data-state`: one codicon per state, in that state's colour. A running mark pulses,
  // and a redraw of a showing mark never jumps the pulse.
  statusMark(parent: HTMLElement, state: MarkState): HTMLElement;
  // `button.workflow-finished-fold` reading `▸ <text>`, or `▾ <text>` while `open`, with `aria-expanded` and the key of
  // `workflow.toggleFinishedWaves`. A click opens or folds the finished waves of the session the part draws.
  finishedFold(
    parent: HTMLElement,
    text: string,
    open: boolean,
  ): HTMLButtonElement;
  // `div.workflow-side-list`: the side pane's scrolling list, which takes the height the pane leaves it. The app keeps
  // its scroll across each draw, and while the pane has no layout box.
  sideList(parent: HTMLElement): HTMLElement;
}

// What a part returns: its root, appended to `parent`.
export interface WorkflowPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `workflow.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default`
// instead.
export interface Layout {
  chip?(parent: HTMLElement, input: ChipInput, kit: WorkflowKit): WorkflowPart;
  strip?(
    parent: HTMLElement,
    input: StripInput,
    kit: WorkflowKit,
  ): WorkflowPart;
  sidePane?(
    parent: HTMLElement,
    input: SidePaneInput,
    kit: WorkflowKit,
  ): WorkflowPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
