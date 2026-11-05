# 08 — workflow-medium

Status: not started
Type: Task
Wave: 7 · Depends on: 07
Plan: [plan.md](plan.md)

All paths are relative to the wigley-ai-gui repo root. This task follows [07](07-light.md): each decision in 07 holds with `light` read as `medium`, `Light` as `Medium` and `L` as `M`. Below is only what differs, and each pinned value.

Files:
- create `src/plugins/workflow-medium/manifest.ts`, `contract.ts`, `medium-state.ts`, `main/start.ts`, `main/selftest-script.ts`, `page/start.ts`, `layouts/default/layout.js`, `layouts/default/layout.css`
- create `src/plugins/workflow-medium/stages/{interview,build,review,fix,land,done}/{main,page}.ts`, `src/plugins/workflow-medium/stages/index.ts`
- modify `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts`: add the plugin after `workflow-light`
- modify `scripts/check-layers.mts`: a `workflow-medium` entry in `PLUGIN_EXTRAS`, as 07's
- test: create `src/plugins/workflow-medium/stages/medium-stages.test.ts`, `src/plugins/workflow-medium/medium-state.test.ts`, `src/plugins/workflow-medium/layouts/default/layout.test.ts`, `src/plugins/workflow-levels.test.ts`

Consumes:
- Everything 07 consumes from 01, 02, 03, 04, 05
- `MainWorkflow.foldState`, `MainWorkflow.fixCycles`, `SessionFlow.state` ← 01
- `RunLogLine` and `workflow.fixCycles?.(next) ?? 0` in `apply` ← 04
- `WorkflowSelfTestHooks.callChecklistTool`, the log lines `<name> level <badge>`, `<name> trail <labels>`, `<name> no workflow`, `lightMainWorkflow`, `src/plugins/workflow-light/main/selftest-script.ts` (the shape to follow) ← 07
- `heavyMainWorkflow` ← 05

Produces:
- `export const workflowMediumManifest` in `workflow-medium/manifest.ts`
- In `workflow-medium/contract.ts`: `export const MEDIUM_WORKFLOW_ID = 'workflow-medium'`, `export interface MediumState { fixCycles: number }`
- In `workflow-medium/medium-state.ts`: `mediumStateOf(flow: SessionFlow): MediumState`, `foldMediumState(flow: SessionFlow, signal: WorkflowSignal): unknown`, `mediumFixCycles(flow: SessionFlow): number`
- `export const workflowMediumMainPart: MainPart<typeof workflowMediumManifest>` in `workflow-medium/main/start.ts`
- `export const workflowMediumPagePart: PagePart<typeof workflowMediumManifest>` in `workflow-medium/page/start.ts`
- `export const MEDIUM_MAIN_STAGES: readonly MainStage[]`, `export const MEDIUM_PAGE_STAGES: readonly PageStage[]`, `export const mediumMainWorkflow: MainWorkflow` in `workflow-medium/stages/index.ts`
- `export function workflowMediumSelfTestScript(deps: WorkflowMediumSelfTestDeps): SelfTestScript` in `workflow-medium/main/selftest-script.ts`

Decisions, what differs from 07:

- **Manifest.** `id` `workflow-medium`. `settingInfo.layout`: label `Medium workflow layout`; description `The layout that draws Medium's status chip, composer strip and side pane: a folder in the layouts/workflow-medium folder, or default.` `themeTokens` is `{ badge: { kind: 'color', default: 'var(--wg-accent)' } }`.
- **Workflow.** `id: MEDIUM_WORKFLOW_ID`, `order: 20`, `firstStage: 'interview'`, `stages: MEDIUM_MAIN_STAGES`, `claims` true when `startsSkill(signal, 'wigley:medium')`, `foldState: foldMediumState`, `fixCycles: mediumFixCycles`. It leaves out `sameState`: `foldMediumState` returns `flow.state` itself for no change, so comparing by reference is enough.
- **Page workflow.** `label: 'Medium'`, `badge: 'M'`. `sideTitle` is `Checklist`, as 07.
- **Pinned stages.**

  | id | `order` | `reportedAs` | `label` | `stepSlot` | `status` | `finishes` |
  |---|---|---|---|---|---|---|
  | `interview` | 10 | none | `Interview` | none | `busyStatus` | |
  | `build` | 20 | `build` | `Build` | none | `busyStatus` | |
  | `review` | 30 | `review` | `Review` | none | `busyStatus` | |
  | `fix` | 40 | `fix` | `Fix` | none | `busyStatus` | |
  | `land` | 50 | `land` | `Land` | `land` | `busyStatus` | |
  | `done` | 60 | `done` | `Land` | `land` | `() => 'done'` | `true` |

  So the trail reads `Interview › Build › Review › Fix › Land`.
- **Entry rules.** As 07, with `interview` in the place of `scope`. Steps may move back: `wigley:medium`'s Reporting says a fix cycle may return to `review`, and no rule names a stage to come from. A skill `wigley:review` claims nothing and moves nothing: the Review step comes from the report. Medium's reviewer is a dispatched reader, not that skill.
- **`fixCycles`.** Each time the flow enters `fix` from another stage, the count goes up by one.
  - `foldMediumState` returns a new `{ fixCycles: n + 1 }` on `stepReported` with `step === 'fix'` when `flow.stage !== 'fix'`.
  - It returns `null` when `startsSkill(signal, 'wigley:medium')`, so a second Medium ask in one session counts from 0.
  - It returns `flow.state` itself in every other case.
  - This runs before the stage rules (01, step 6), so `flow.stage` is still the stage being left.
  - `mediumStateOf` returns `flow.state` when it has a number `fixCycles`, and `{ fixCycles: 0 }` for null or any other shape: the store does not check `state`.
  - `mediumFixCycles` returns `mediumStateOf(flow).fixCycles`. A move up to Heavy sets `state` to null, and that run's log line uses Heavy's count.
- **Progress words.** Build's `statusProgress` is as 07. Fix's `statusProgress` returns ` · cycle <n>` when `n` is above 0, and `''` otherwise, the words Heavy's Fix shows. The current step then reads `Fix · cycle 1`.
- **Self-test.** `SELFTEST_PROJECT_NAME` is `workflow-medium-selftest`. The script follows 07's, opening the same way with `fake: tool`, so `no workflow` shows on open.

  | Group | `why` | Send | `expect` | `alsoExpect` | `screenshot` |
  |---|---|---|---|---|---|
  | `level and trail` | `The skill's start claims the session: the M badge, the five-word trail, and Interview as the first step, and the No workflow tag leaves.` | `/wigley:medium` | `shows interview` | `level M`, `trail Interview › Build › Review › Fix › Land` | `medium-interview` |
  | `steps move back` | `Reports move the trail forward and back, the checklist draws with its count, and a fix cycle may return to review.` | `fake: report build` | `shows build` | | |
  | | | `fake: checklist` | `progress 1/3` | | `medium-build-checklist` |
  | | | `fake: report review` | `shows review` | | |
  | | | `fake: report fix` | `shows fix` | | `medium-fix-cycle` |
  | | | `fake: report review` | `shows review` | | |
  | | | `fake: report fix` | `shows fix` | | |
  | | | `fake: report land` | `shows land` | | |
  | | | `fake: report done` | `shows done` | | `medium-done` |

  `problems`: the sends equal, in order, `fake: tool`, `/wigley:medium`, then the eight sends above; main turn ends are at least the number of sends minus one.

GIVEN a new flow WHEN `wigley:medium` starts THEN `workflow` is `workflow-medium`, `stage` is `interview`, and the row draws the `M` badge
GIVEN a flow in `fix` WHEN the agent reports `review` THEN `stage` is `review`
GIVEN a flow that entered `fix` twice WHEN the agent reports `done` THEN the run log line has `fixCycles` 2
GIVEN a Light flow WHEN `wigley:medium` starts THEN `workflow` is `workflow-medium`, `movedUpFrom` is `workflow-light`, `stage` is `interview`, and `checklist` is null
GIVEN a Medium flow WHEN `wigley:feature` starts THEN `workflow` is Heavy's id and `movedUpFrom` is `workflow-medium`
GIVEN a Medium flow WHEN `wigley:review` starts THEN nothing changes
GIVEN a Light flow and a Medium flow WHEN each reports `build` THEN each moves through its own stage alone

Tests:
- `stages/medium-stages.test.ts`:
  - `foldFlow_MediumRules` table, through `foldFlow` with `[mediumMainWorkflow]`:

    | Start stage | Signal | Stage after |
    |---|---|---|
    | new flow | skill `wigley:medium` | `interview` |
    | new flow | skill `medium` | `interview` |
    | `interview` | step `build` | `build` |
    | `build` | step `review` | `review` |
    | `review` | step `fix` | `fix` |
    | `fix` | step `review` | `review` |
    | `fix` | step `land` | `land` |
    | `land` | step `done` | `done` |
    | `interview` | step `done` | `done` |
    | `done` | skill `wigley:medium` | `interview` |
    | `build` | skill `wigley:review` | `build` |
    | `build` | step `check` | `build` |

  - `mediumMainWorkflow_Values`: `id` `workflow-medium`, `order` 20, `firstStage` `interview`; `reportedAs` values `['build', 'review', 'fix', 'land', 'done']`; the stages with `finishes` true are `['done']`.
  - `mediumPageStages_MatchMainHalves`, `mediumTrail_ReadsFiveWords` (`Interview`, `Build`, `Review`, `Fix`, `Land`), `mediumStatus`: as 07's.
  - `fixStatusProgress`: `state` null gives `''`; `{ fixCycles: 2 }` gives ` · cycle 2`.
- `medium-state.test.ts`, `foldMediumState` table, through `foldFlow`:
  - `review` then step `fix` gives `fixCycles` 1
  - `fix`, then step `review`, then step `fix` gives 2
  - `fix` then step `fix` gives the same count
  - step `build` returns `flow.state` by reference
  - skill `wigley:medium` from `{ fixCycles: 2 }` gives `state` null and `mediumFixCycles` 0
  - `mediumStateOf` of `{ fixCycles: 'x' }` gives `{ fixCycles: 0 }`
- `layouts/default/layout.test.ts`: 07's rows with `M` and `Medium`.
- `src/plugins/workflow-levels.test.ts`, crossing plugins as `agent-form-drive.test.ts` does, through `foldFlow` with `[lightMainWorkflow, mediumMainWorkflow, heavyMainWorkflow]` sorted by `order`:
  - `claimOrder_MovesUp` table: `wigley:light` gives `workflow-light`, `movedUpFrom` null; then `wigley:medium` gives `workflow-medium`, `movedUpFrom` `workflow-light`, `checklist` null; then `wigley:feature` gives Heavy's id, `movedUpFrom` `workflow-medium`.
  - `movingDown_SetsMovedUpFromToo`: `wigley:medium` then `wigley:light` gives `workflow-light`, `movedUpFrom` `workflow-medium`, per plan.md: the engine does not check direction.
  - `sharedStageIds_FoldOnlyTheCurrentWorkflow`: a Light flow at `build`, step `review`, stays at `build`; a Medium flow at `build`, step `review`, moves to `review`.
  - `skillsOutsideTheLevels_ClaimNothing`: `wigley:review`, `wigley:debug` and `wigley:explore` on a new flow leave `workflow` null.
  - `claims_AreDisjoint`: for each of `wigley:light`, `wigley:medium`, `wigley:feature`, `wigley:feature-primer`, `wigley:make`, exactly one workflow's `claims` is true.
- `src/plugins/manifests.test.ts`, one row: `workflow-medium` has the setting `layout` and the theme token `badge`, default `var(--wg-accent)`.

Done when: it compiles; `scripts/check-layers.mts` passes; `workflow-medium` is in `manifests.ts`, `main.ts` and `page.ts`; the test gate runs the tests above. Task 12 runs `npm run selftest -- --plugin workflow-medium` and the drive checks.

Commit: one commit for the group.

## Proof

