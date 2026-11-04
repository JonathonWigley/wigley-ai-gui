# 04 — Wire the pane and remove the Flow tab

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow/page/start.ts` · modify `src/plugins/workflow/page/workflow-view.ts` · modify `src/plugins/workflow/page/preview.ts` · modify `src/plugins/workflow/page/layout/workflow-parts.ts` · modify `src/plugins/workflow/page/layout/read-workflow-layout.ts` · modify `src/plugins/workflow/layouts/layout.d.ts` · modify `src/plugins/workflow/layouts/default/layout.js` · modify `src/plugins/workflow/layouts/default/layout.css` · modify `src/plugins/workflow/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/workflow/contract.ts` · modify `src/plugins/workflow/flow.ts` · modify `src/plugins/workflow/main/flow-store.ts` · modify `src/plugins/workflow/main/selftest-script.ts` · delete `src/plugins/workflow/page/flow-tab.ts` · delete `src/plugins/workflow/page/flow-tab.test.ts` · test `src/plugins/workflow/page/preview.test.ts` · test `src/plugins/workflow/page/workflow-view.test.ts` · test `src/plugins/workflow/layouts/default/layout.test.ts` · test `src/plugins/workflow/page/layout/read-workflow-layout.test.ts` · test every test file that names `hasLeftIdle`
Consumes:  `addSidePart(part: ChatSidePart): Disposable` ← 01
           `sidePart`, `setSidePaneHidden(hidden: boolean): void`, `toggleFinishedWaves(sessionId: string): void` ← 03
Produces:  commands `workflow.toggleSidePane` and `workflow.toggleFinishedWaves` in `src/plugins/workflow/manifest.ts`
           binds `<Leader>ws` → `workflow.toggleSidePane` and `<Leader>wf` → `workflow.toggleFinishedWaves`, scope `any`, in `src/plugins/keymap.ts`
Decisions:
- `start.ts` calls `chat.addSidePart(view.sidePart)` beside `chat.addComposerPart(view.stripPart)`.
- The `uiState` key is `sidePaneHidden`. A stored `true` hides the pane. `start.ts` reads it once before the first draw and calls `view.setSidePaneHidden`.
- `toggleSidePane` flips the value, writes it to `services.uiState`, calls `view.setSidePaneHidden`, and logs `[workflow] side pane hidden` or `[workflow] side pane shown`.
- `toggleFinishedWaves` runs on the selected session, through `sessions.selectedSessionId()`. With no selected session it logs `no selected session for toggleFinishedWaves` and returns.
- Manifest labels: `toggleSidePane` → `show or hide the side pane`, `toggleFinishedWaves` → `open or fold finished waves`, both in the group the other `<Leader>w` commands use, `runsIn: 'page'`.
- Remove these:
  - `flow-tab.ts`, `createFlowTabs` and every use in `start.ts`
  - `view.drawFlowTab`, the `flowTab` part kind, `flowTabInput`, `Layout.flowTab`, `FlowTabInput`, `PlanTaskInput`, `PlanWaveInput`, the `waves()` input shape where nothing else reads it, and `FLOW_TAB_SCOPE`
  - `WorkflowViewDeps.stripBuilt`
  - the default layout's `flowTab` and the CSS only it uses
  - the `flow` scope, `lineDown`, `lineUp`, `halfPageDown`, `halfPageUp` in the manifest and `start.ts`, and their four binds in `keymap.ts`
  - `scrollFlowTab` and its imports
  - `SessionFlow.hasLeftIdle` in `contract.ts`, `flow.ts`, `flow-store.ts` and `preview.ts`
- `flow-store.ts` stops checking `hasLeftIdle`. A saved flow that still holds the field still loads. The field is not written again.
- The manifest's layout setting description reads: `The layout that draws the status chip, the composer strip and the side pane: a folder in the layouts/workflow folder, or default.`
- `createFlowTabs` drew the Flow tab only after a chat strip built. The side part does not need that wait.
- `preview.ts`: `PREVIEW_STAGES` becomes `PREVIEW_SAMPLES: readonly { stage: StageId; busy: boolean; countdown: boolean }[]`, in this order: idle, primer busy, feature not busy, planReady, planReady with the countdown, make busy, make not busy, review busy, closed. `busy` sets `turnRunning`. The planReady, closed and idle samples have `busy: false`. `COUNTDOWN_INDEX` is removed. The `closed` dep redraws the session's own flow only. `showFlow` is `view.setFlow`.
- `selftest-script.ts`: remove `TAB_STEPS` and its use. In the `feature to plan ready` group add these steps after plan ready shows: a screenshot `side-pane-plan-ready`; keys `<Leader>ws` expecting `[workflow] side pane hidden`, with a screenshot `side-pane-hidden`; keys `<Leader>ws` expecting `[workflow] side pane shown`.
GIVEN a stored `sidePaneHidden: true` WHEN the page starts THEN the pane draws nothing until `<Leader>ws`
GIVEN `<Leader>ws` WHEN pressed twice THEN `uiState` holds true, then false
GIVEN each sample WHEN the preview steps through THEN the sample flow holds its stage and busy value, and only the countdown sample has a countdown
Tests:     in `preview.test.ts`, replace the real Flow tabs fixture with a recording `showFlow`, and change the existing sample test to a table over `PREVIEW_SAMPLES`' stage, `turnRunning` and whether `countdownEndsAt` is set. Remove rows that assert Flow tab adds.
           In `workflow-view.test.ts`, `layout.test.ts` and `read-workflow-layout.test.ts`, remove the Flow tab cases and move any rule they alone pin to the side pane's tests.
           In every test file that names `hasLeftIdle`, remove the field from its fixtures. A test whose only claim is that field is deleted.
           The `uiState` toggle is proved by the self-test steps above, because `start.ts` has no unit seam.
Done when: `grep -rnE 'flowTab|FlowTab|Flow tab|hasLeftIdle|workflow\.flow|lineDown' src/plugins/workflow src/plugins/keymap.ts` prints nothing; `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

