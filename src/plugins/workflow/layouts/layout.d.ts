// The workflow layout contract: what a layout in `layouts/<owner>/<name>/layout.js` draws a session's place in its
// workflow with, `<owner>` being the plugin that holds the workflow. The app draws three parts for a session:
// - `chip`, under the session's row in the side bar, in the row part's wrapper: the workflow's badge, the stage's label
//   and status as one tag, and the countdown. Its input also carries the detail and the main action. An idle session
//   draws no chip.
// - `strip`, above the Chat tab's composer, in the composer part's wrapper: the stepper's trail while it shows the
//   stage; for a stage outside it, the status mark and status line, with the trail until the session has a checklist.
//   Then the countdown and the main action. Its input also carries the detail and every action. An idle session draws
//   no strip.
// - `sidePane`, beside the Chat tab's transcript, in the side part's wrapper: the status mark and line, the detail, a
//   progress bar, the checklist (a layout picks how its groups read: a fold of the finished ones, a flat list) and every
//   action of the stage. An idle session, a session with no checklist, and a hidden pane draw no pane. The app does not
//   draw it again for the countdown, so a pane that shows the countdown updates on the next flow push.
// A session with no workflow draws none of these.
// The app sets `data-layout-owner="<owner>"` and `data-layout="<name>"` on the element each part returns, `<name>`
// being the layout that drew it, so `[data-layout-owner="<owner>"][data-layout="<name>"] …` in a layout's CSS selects
// only its own parts.
//
// The app keeps:
// - each session's stage and flow, which main folds from the agent's events and writes on each change;
// - the workflow commands and their keys, and what each runs;
// - the session each button runs for: a part's buttons run for the session it draws, whether or not that session is
//   selected; only keys act on the selected session;
// - the countdown's ticking and its text: while a chip or a strip shows one, the app draws those parts again once a
//   second;
// - whether the side pane shows, each session's finished-groups fold, and the scroll of the list `kit.sideList` draws.
import type {
  BaseKit,
  ButtonVariant,
} from '../../../shared/page/layout-host/kit';

// What a stage is doing now; null on an input for a stage with no status.
export type StageStatus = 'running' | 'paused' | 'ready' | 'done';

// What a mark shows: a stage's status, or `pending` for a step or an item not reached.
export type MarkState = StageStatus | 'pending';

// One stage in the stepper: done before the session's stage, the stage's status at it, pending after it. A stage added
// with `inStepper: false` leaves every step pending. Stages sharing a step take one place: the one the session is in,
// otherwise the last of them. `progress` is what follows the current step's label, its separator included (` 3/9`, ` · round 2`); '' on every other step.
export interface StepInput {
  id: string;
  label: string;
  state: MarkState;
  progress: string;
}

// One action the stage offers: the workflow command it runs (`ship`), its button text, whether it can run
// now (an action may be disabled while the session is busy), and whether it is the stage's main action, the one
// `<Leader>ww` runs.
export interface ActionInput {
  command: string;
  label: string;
  enabled: boolean;
  main: boolean;
}

// `badge` is the workflow's letter (`L`), `workflowLabel` its word (`Light`), `stage` the stage's id (`build`), `label`
// its word (`Build`), `status` what it is doing, `statusText` the two as one (`Build · running`), `detail` its line
// (`3/7 · Claim grants`, or ''), `countdown` the seconds left (`9s`) or null, `mainAction` the stage's main
// action, null when it has none, and `onRowLabel` whether the row's own label already says the stage's state.
export interface ChipInput {
  badge: string;
  workflowLabel: string;
  stage: string;
  label: string;
  status: StageStatus | null;
  statusText: string;
  detail: string;
  countdown: string | null;
  mainAction: ActionInput | null;
  onRowLabel: boolean;
}

// The stage's fields as ChipInput, with `statusLine` the status text and the stage's progress (`Build · running 3/9`),
// every step of the stepper, every action of the stage, the main action first, and `hasChecklist`, whether the session
// has a checklist.
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
  hasChecklist: boolean;
}

// One item of the checklist in the side pane: its text and its mark. A done item is `done`; an open item in the current
// group shows the stage's status while the stage runs tasks; every other open item is `pending`.
export interface SideItemInput {
  text: string;
  state: MarkState;
}

// One group of the checklist: its title (`Tasks`) and its items, in order.
export interface SideGroupInput {
  title: string;
  items: readonly SideItemInput[];
}

// As StripInput, with the checklist's title ('' for none), `checked` of its `total` items done, and its groups in order:
// `finishedGroups` each with every item done, `currentGroup` the first other, null when every group is finished, and
// `laterGroups` the rest. `finishedOpen` is whether the session's finished groups are unfolded.
export interface SidePaneInput extends StripInput {
  checklistTitle: string;
  checked: number;
  total: number;
  finishedGroups: readonly SideGroupInput[];
  finishedOpen: boolean;
  currentGroup: SideGroupInput | null;
  laterGroups: readonly SideGroupInput[];
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
  // `ol.workflow-stepper`: one `li.workflow-step` per step, carrying `data-state`, holding a `span.workflow-step-label`
  // reading the step's label and progress: a trail of words, `›` between them. The word's colour and weight show its
  // state, and a running word pulses.
  stepper(parent: HTMLElement, steps: readonly StepInput[]): HTMLElement;
  // `span.workflow-badge` reading `letter`, titled `label`, in the colour of the drawing plugin's `badge` theme token.
  badge(parent: HTMLElement, letter: string, label: string): HTMLElement;
  // `span.ui-tag.workflow-stage-tag` reading `label`, carrying `status` as `data-state`: in `status-running` and
  // pulsing while running, `success` opening on a check when done, neutral while paused, ready or with no status. A
  // redraw of a showing tag never jumps the pulse.
  stageTag(
    parent: HTMLElement,
    label: string,
    status: StageStatus | null,
  ): HTMLElement;
  // `span.workflow-countdown` reading `text`, in tabular numerals.
  countdown(parent: HTMLElement, text: string): HTMLElement;
  // `span.workflow-mark`, carrying `data-state`: one codicon per state, in that state's colour. A running mark, a filled
  // circle, pulses,
  // and a redraw of a showing mark never jumps the pulse.
  statusMark(parent: HTMLElement, state: MarkState): HTMLElement;
  // `button.workflow-finished-fold` reading `▸ <text>`, or `▾ <text>` while `open`, with `aria-expanded` and the key of
  // `workflow.toggleFinishedWaves`. A click opens or folds the finished groups of the session the part draws.
  finishedFold(
    parent: HTMLElement,
    text: string,
    open: boolean,
  ): HTMLButtonElement;
  // `div.workflow-side-list`: the side pane's scrolling list, which takes the height the pane leaves it, at least two
  // rows or its own height when it holds less. The app keeps its scroll across each draw, and while the pane has no
  // layout box.
  sideList(parent: HTMLElement): HTMLElement;
}

// What a part returns: its root, appended to `parent`.
export interface WorkflowPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the owning plugin's `layout` setting and `default`; a part
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
