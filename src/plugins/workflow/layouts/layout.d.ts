// The workflow layout contract: what a layout in `layouts/workflow/<name>/layout.js` draws each session's place in
// the user's wigley workflow with. The app draws three parts for a session:
// - `chip`, under the session's row in the side bar, in the row part's wrapper: the stage, its detail, the countdown
//   and the main action's button. An idle session draws no chip.
// - `strip`, above the Chat tab's composer, in the composer part's wrapper: the stepper with the current stage lit,
//   the detail, the countdown and the stage's buttons. An idle session draws no strip.
// - `flowTab`, in the session's Flow tab: the stage's label, the stepper, the stage's detail (the plan's title in it),
//   the plan's checklist by wave (or, with no plan, a `No plan yet` empty state) and every action of the stage.
// The app sets `data-layout-owner="workflow"` and `data-layout="<name>"` on the element each part returns, `<name>`
// being the layout that drew it, so `[data-layout-owner="workflow"][data-layout="<name>"] …` in a layout's CSS
// selects only its own parts.
//
// The app keeps:
// - each session's stage and flow, which main folds from the agent's events and pushes on each change;
// - the workflow commands and their keys (`<Leader>w…`), and what each runs;
// - the session each button runs for: a part's buttons run for the session it draws, whether or not that session is
//   selected; only keys act on the selected session;
// - the countdown's ticking and its text: while one shows, the app draws the parts again once a second;
// - the Flow tab's status line (the stage's label, and the countdown while one shows) and its scrolling.
import type {
  BaseKit,
  ButtonVariant,
} from '../../../shared/page/layout-host/kit';

// One stage in the stepper: done before the session's stage, current at it, ahead after it. Idle is not in the
// stepper, so in idle every step is ahead.
export interface StepInput {
  id: string;
  label: string;
  state: 'done' | 'current' | 'ahead';
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

// `stage` is the stage's id (`make`), `label` its word (`Make`), `detail` its line (`3/7 · wave 2 · Claim grants`, the
// plan's title in it from feature on once a plan is read, or ''), `countdown` the auto-start's seconds left (`9s`) or
// null, and `mainAction` the stage's main action, null when it has none.
export interface ChipInput {
  stage: string;
  label: string;
  detail: string;
  countdown: string | null;
  mainAction: ActionInput | null;
}

// As ChipInput, with every step of the stepper and every action of the stage, the main action first.
export interface StripInput {
  stage: string;
  label: string;
  detail: string;
  countdown: string | null;
  steps: readonly StepInput[];
  actions: readonly ActionInput[];
}

// One box of the plan's `## Tasks`: its text, and whether it is ticked.
export interface PlanTaskInput {
  text: string;
  done: boolean;
}

// The boxes under one `### Wave N` (`Wave 2`), or those under no wave heading (`Tasks`), in file order; `current` is
// the wave of the first open box under a wave heading.
export interface PlanWaveInput {
  title: string;
  tasks: readonly PlanTaskInput[];
  current: boolean;
}

// As StripInput, with the plan's title (null before a plan is read, '' for a read plan with no title) and its
// checklist by wave, empty before a plan is read.
export interface FlowTabInput {
  stage: string;
  label: string;
  detail: string;
  countdown: string | null;
  planTitle: string | null;
  steps: readonly StepInput[];
  waves: readonly PlanWaveInput[];
  actions: readonly ActionInput[];
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
  // `ol.workflow-stepper`: one `li.workflow-step` per step, carrying `data-state` and the step's label.
  stepper(parent: HTMLElement, steps: readonly StepInput[]): HTMLElement;
  // `span.workflow-countdown` reading `text`, in tabular numerals.
  countdown(parent: HTMLElement, text: string): HTMLElement;
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
  flowTab?(
    parent: HTMLElement,
    input: FlowTabInput,
    kit: WorkflowKit,
  ): WorkflowPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
