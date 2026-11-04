# 03 — Workflow side pane part

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow/layouts/layout.d.ts` · modify `src/plugins/workflow/layouts/default/layout.js` · modify `src/plugins/workflow/layouts/default/layout.css` · modify `src/plugins/workflow/page/workflow.css` · modify `src/plugins/workflow/page/workflow-view.ts` · modify `src/plugins/workflow/page/layout/workflow-kit.ts` · modify `src/plugins/workflow/page/layout/workflow-parts.ts` · modify `src/plugins/workflow/page/layout/read-workflow-layout.ts` · test `src/plugins/workflow/page/workflow-view.test.ts` · test `src/plugins/workflow/layouts/default/layout.test.ts` · test `src/plugins/workflow/page/layout/read-workflow-layout.test.ts`
Consumes:  `StageStatus`, `statusText`, `PageStage.status`, `PageStage.statusLine`, `PageStage.runsTasks` ← 02
Produces:  in `src/plugins/workflow/layouts/layout.d.ts`:
           `export type MarkState = StageStatus | 'pending'`
           `export interface SideTaskInput { text: string; state: MarkState }`
           `export interface SideWaveInput { title: string; tasks: readonly SideTaskInput[] }`
           `export interface SidePaneInput extends StripInput { planTitle: string; checked: number; total: number; finishedWaves: readonly SideWaveInput[]; finishedOpen: boolean; currentWave: SideWaveInput | null; laterWaves: readonly SideWaveInput[] }`
           `Layout.sidePane?(parent: HTMLElement, input: SidePaneInput, kit: WorkflowKit): WorkflowPart`
           `WorkflowKit.statusMark(parent: HTMLElement, state: MarkState): HTMLElement`
           `WorkflowKit.finishedFold(parent: HTMLElement, text: string, open: boolean): HTMLButtonElement`
           in `src/plugins/workflow/page/workflow-view.ts` on `WorkflowView`:
           `sidePart: ContributedPart` with id `workflow.sidePane`
           `setSidePaneHidden(hidden: boolean): void`
           `toggleFinishedWaves(sessionId: string): void`
Decisions:
- `StepInput.state` becomes `MarkState`. `current` and `ahead` are removed.
- Step state: a step before the flow's step is `done`. The flow's step takes the stage's `status`. A later step is `pending`. Idle leaves every step `pending`.
- `ChipInput` gains `status: StageStatus | null` and `statusText: string`.
- `StripInput` gains `status: StageStatus | null`, `statusText: string`, `statusLine: string` and `hasPlan: boolean`. `hasPlan` is `flow.progress !== null`.
- The default chip draws `kit.tag(chip, input.statusText, 'accent')`, then the countdown. It keeps the accent tone in every state.
- `statusMark` draws a `span.workflow-mark` with `data-state` and a codicon: `pending` → `circle-large`, `running` → `loading`, `ready` → `play-circle`, `paused` → `debug-pause`, `done` → `pass-filled`.
- `kit.stepper` draws, per step, a `li.workflow-step` with `data-state`, a `statusMark`, a `span.workflow-step-label` and a `span.workflow-step-status` that reads the state.
- `workflow.css`: `.workflow-step-status` is `display: none` by default. Colours: `running` uses `--wg-status-running`, `ready` uses `--wg-accent`, `paused` uses `--wg-status-warning`, `done` uses `--wg-status-success`, `pending` uses `--wg-fg-tertiary`. A `running` mark pulses in opacity.
- The default strip draws, in this order: a `statusMark` of `input.status` when it is not null, `input.statusLine`, the stepper when `input.hasPlan` is false, the countdown, then only the main action (`input.actions.find(action => action.main)`). The strip's main action keeps its key hint.
- The default `sidePane` draws, in this order, in `div.workflow-side-pane`:
  - a `statusMark` and `input.statusLine`
  - `input.detail`
  - the stepper, with `.workflow-side-pane .workflow-step-status { display: block; }` and each step as a column: mark, label, status
  - a progress bar, width `checked / total` (0 when `total` is 0)
  - a scrolling list: the fold row when `finishedWaves` is not empty, the finished waves' tasks when `finishedOpen`, the current wave's title and tasks, then under an `Up next` header one line per later wave
  - a later wave's line reads its title, then its one task's text, or `<n> tasks` when it holds more than one
  - the actions row: every action through `kit.actionButton`; the row is left out when `actions` is empty
- `.workflow-side-pane`: `width: 264px`, `height: 100%`, a left border in `--wg-border-default`, background `--wg-card-background`.
- The fold row's text is `<n> waves · <m> done`, with `1 wave` for one. `<m>` counts the tasks in the finished waves. It starts with `▸`, or `▾` while open.
- Wave grouping, in file order over the groups `waves()` builds today: a group with every task done is finished. The first other group is the current wave. The rest are later. A task under no wave heading sits in its `Tasks` group and follows the same rule.
- Task state: a done task is `done`. An open task in the current wave takes the stage's `status` when the stage has `runsTasks`, else `pending`. Every other open task is `pending`.
- The view draws no pane for idle, for `flow.progress === null`, or while hidden. A wrapper with no pane stays empty, so chat's CSS hides the holder.
- `setSidePaneHidden` stores the value and redraws the held `sidePane` parts. It does not read or write `uiState`. Task 04 owns that.
- `toggleFinishedWaves` flips the session's value in a `Set` held by the view and redraws that session's held parts. `forget` drops the session's value. It runs in the preview too, because it changes only what the pane shows.
- `finishedFold` calls the part's `RunCommand` with `toggleFinishedWaves`. `runFor` handles that command before its preview check and before its stage action lookup.
- `sidePane` joins `PartKind`, `LAYOUT_PARTS` and `WorkflowParts`, and it falls back to `default` as the other parts do.
- The Flow tab stays in this task and keeps its `PlanWaveInput` input. It draws the new `StepInput.state`. Task 04 removes it.
- Rewrite the header comment of `layout.d.ts` for each changed part.
GIVEN each stage and busy value WHEN the strip's input builds THEN the steps carry the pinned states
GIVEN a plan with waves 1 and 2 done, wave 3 open, waves 4 and 5 open WHEN the side pane's input builds THEN finished is waves 1, 2, current is wave 3, later is waves 4, 5
GIVEN make and busy WHEN the input builds THEN wave 3's done task is `done`, its open task is `running`, and wave 4's task is `pending`
GIVEN make and not busy THEN the open task in wave 3 is `paused`; GIVEN review and busy THEN it is `pending`
GIVEN a done wave after an open wave WHEN the input builds THEN that wave is finished
GIVEN boxes under no wave heading, some open WHEN the input builds THEN the `Tasks` group is the current wave
GIVEN idle, or a null progress, or `setSidePaneHidden(true)` WHEN the part draws THEN nothing draws; GIVEN `setSidePaneHidden(false)` THEN the pane draws again
GIVEN `toggleFinishedWaves('a')` WHEN session `a` draws THEN `finishedOpen` is true, and session `b` keeps false
Tests:     in `workflow-view.test.ts`, change the existing stepper table to the new states (`Review:pending`, `Close:pending`, and so on), with rows for `planReady` → `Feature:done`, `Make:ready`; make busy → `Make:running`; make not busy → `Make:paused`; closed → `Close:done`.
           Add one table `side pane groups the plan and states its tasks` with the wave and task rows above; assert the whole `finishedWaves`, `currentWave`, `laterWaves` values.
           Add `side pane draws only with a plan and while shown` for the idle, null-progress and hidden rows.
           Add `the fold is kept per session` for the toggle.
           In `layout/default/layout.test.ts`: the strip draws the stepper only with no plan, and draws one action; the chip's tag reads `Make · running`; a later wave's line reads its task text for one task and `2 tasks` for two.
           In `read-workflow-layout.test.ts`: add `sidePane` to the existing accepted part row.
Done when: `npm run typecheck` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

