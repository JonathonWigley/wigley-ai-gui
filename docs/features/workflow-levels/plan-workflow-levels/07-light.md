# 07 — workflow-light

Status: done
Type: Task
Wave: 6 · Depends on: 05
Plan: [plan.md](plan.md)

All paths are relative to the wigley-ai-gui repo root. Task 08 follows this pattern: keep this task's shape plain, so 08 can copy it.

Files:
- create `src/plugins/workflow-light/manifest.ts`, `contract.ts`, `main/start.ts`, `main/selftest-script.ts`, `page/start.ts`, `layouts/default/layout.js`, `layouts/default/layout.css`
- create `src/plugins/workflow-light/stages/{scope,build,check,land,done}/{main,page}.ts`, `src/plugins/workflow-light/stages/index.ts`
- create `src/plugins/workflow/main/drive-actions.ts`
- modify `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts`: add the plugin after `workflow-heavy`
- modify `scripts/check-layers.mts`: a `workflow-light` entry in `PLUGIN_EXTRAS`
- modify `src/plugins/workflow/contract.ts`: `WorkflowSelfTestHooks` gains `callChecklistTool`
- modify `src/plugins/workflow/main/start.ts`: `callChecklistTool`, and the drive actions
- modify `src/plugins/workflow/page/workflow-view.ts`: three log lines
- test: create `src/plugins/workflow-light/stages/light-stages.test.ts`, `src/plugins/workflow-light/layouts/default/layout.test.ts`, `src/plugins/workflow/main/drive-actions.test.ts`
- test: modify `src/plugins/workflow/page/workflow-view.test.ts`

Consumes:
- `MainWorkflow`, `MainStage`, `WorkflowMainExports.addWorkflow`, `workflowMainKey`, `foldFlow(flow, signal, workflows)`, `newFlow`, the fold order in 01 § Fold order, `startsSkill`, `reportsStep`, `busyStatus`, `SessionFlow.checklist`, `ChecklistItem`, `WorkflowMainExports.layoutTypes`, `WorkflowMainExports.selfTestHooks`, `WorkflowSelfTestHooks` ← 01
- `PageWorkflow`, `PageStage`, `WorkflowPageExports.addWorkflow`, `WorkflowPageExports.createWorkflowDraw`, `workflowPageKey`, `PageWorkflow.runAction`, `PageWorkflow.progressText`, `WorkflowDrawOptions` (`manifest`, `defaultLayout`, `defaultStylesheet`, `userLayout`, `sideTitle`), `defaultChecklist`, `WorkflowKit.badge`, `ChipInput.badge`, `ChipInput.workflowLabel`, `StripInput.hasChecklist`, `SidePaneInput`, `chipInput`, the `No workflow` tag ← 02
- `set_workflow_step`'s `reportStep` and `set_workflow_checklist`'s `reportChecklist` in `src/plugins/workflow/main/start.ts`, `SET_WORKFLOW_CHECKLIST_TOOL`, `startChecklistTool` ← 03
- `MainStage.finishes`, `RunLogLine` ← 04
- `src/plugins/workflow-heavy/layouts/default/layout.js` and `layout.css` (the shape to follow), the `workflow-heavy` entry in `PLUGIN_EXTRAS` ← 05
- Tree members: `chatMainKey`, `ChatMainExports.launch`, `closeSessionsIn` in `src/plugins/chat/contract.ts`; `sessionsMainKey`, `activate` in `src/plugins/sessions/contract.ts`; `markRun`, `FAKE_TOOL_TEXT` in `src/shared/fake-agent-harness.ts`; `argsObject` in `src/shared/drive-args.ts`; `DriveHost`, `MainApi.drive` in `src/contracts/plugin.ts`

Produces:
- `export const workflowLightManifest` in `workflow-light/manifest.ts`
- `export const LIGHT_WORKFLOW_ID = 'workflow-light'` in `workflow-light/contract.ts`
- `export const workflowLightMainPart: MainPart<typeof workflowLightManifest>` in `workflow-light/main/start.ts`
- `export const workflowLightPagePart: PagePart<typeof workflowLightManifest>` in `workflow-light/page/start.ts`
- `export const LIGHT_MAIN_STAGES: readonly MainStage[]`, `export const LIGHT_PAGE_STAGES: readonly PageStage[]`, `export const lightMainWorkflow: MainWorkflow` in `workflow-light/stages/index.ts`
- `export function workflowLightSelfTestScript(deps: WorkflowLightSelfTestDeps): SelfTestScript` in `workflow-light/main/selftest-script.ts`
- `callChecklistTool(sessionId: string, items: readonly ChecklistItem[]): void` on `WorkflowSelfTestHooks` in `workflow/contract.ts`
- Drive actions `workflow.reportStep` (`{ "sessionId": string, "step": string }`) and `workflow.reportChecklist` (`{ "sessionId": string, "items": { "text": string, "done": boolean }[] }`), `export function addDriveActions(drive: DriveHost, deps: WorkflowDriveDeps): void` in `workflow/main/drive-actions.ts`
- Log lines from `workflow-view.ts`, under the `[workflow]` prefix: `<name> level <badge>`, `<name> trail <labels joined by ' › '>`, `<name> no workflow`

Decisions:

- **Manifest.**
  - `id` is `workflow-light`. `dependsOn.main` is `['workflow', 'chat', 'sessions']`, and `chat` and `sessions` are for the self-test only. `dependsOn.page` is `['workflow']`. `commands` and `scopes` are `{}`.
  - `settings` is `{ layout: 'default' }`.
  - `settingInfo.layout`: label `Light workflow layout`; description `The layout that draws Light's status chip, composer strip and side pane: a folder in the layouts/workflow-light folder, or default.`
  - `themeTokens` is `{ badge: { kind: 'color', default: 'var(--wg-status-info)' } }`. Its CSS variable is `--wg-workflow-light-badge`, which `kit.badge` reads under this manifest's id (02).
- **Workflow.** `lightMainWorkflow` has `id: LIGHT_WORKFLOW_ID`, `order: 10`, `firstStage: 'scope'`, `stages: LIGHT_MAIN_STAGES`, and `claims` true when `startsSkill(signal, 'wigley:light')`. It leaves out `foldState`, `sameState` and `fixCycles`: the run log writes `fixCycles` 0.
- **Pinned stages.** `order` is equal in both halves. `inStepper` is true for each, `actions` is `[]` and `detail` returns `''`.

  | id | `order` | `reportedAs` | `label` | `stepSlot` | `status` | `finishes` |
  |---|---|---|---|---|---|---|
  | `scope` | 10 | none | `Scope` | none | `busyStatus` | |
  | `build` | 20 | `build` | `Build` | none | `busyStatus` | |
  | `check` | 30 | `check` | `Check` | none | `busyStatus` | |
  | `land` | 40 | `land` | `Land` | `land` | `busyStatus` | |
  | `done` | 50 | `done` | `Land` | `land` | `() => 'done'` | `true` |

  So the trail reads `Scope › Build › Check › Land`, and the current step in `done` reads `Land`.
- **Entry rules.**
  - `build`, `check`, `land` and `done`: `reportsStep(signal, <id>) ? <id> : null`. No rule names a stage to come from. An out-of-order report is the agent's own word, a later step may go back to an earlier one, and a session that only answers goes from `scope` to `done`.
  - `scope`: `startsSkill(signal, 'wigley:light') ? 'scope' : null`. The first claim sets `firstStage` in step 3 of the fold. This rule is for a second Light ask in one session: 01's step 3 changes nothing when the claimer is the current workflow, and without this rule the flow stays in `done`. A second run then writes a second run log line, as 04 allows.
  - The old `checklist` stays until the next `set_workflow_checklist`. The skill sends a new list at Scope.
- **Progress on the trail.** Build's `statusProgress` returns ` <checked>/<total>` from `defaultChecklist(flow)`, and `''` when that is null: the current step reads `Build 1/3`. Only Build has it, because the skill's items are build items.
- **`progressText`.** It returns `<checked>/<total>` from `defaultChecklist(flow)`, and null when that is null. The view logs it as `<name> progress <text>`.
- **Page workflow.** `page/start.ts` calls `workflow.createWorkflowDraw(api, { manifest: workflowLightManifest, defaultLayout, defaultStylesheet, userLayout: () => api.settings().layout, sideTitle: 'Checklist' })`, then `workflow.addWorkflow({ id: LIGHT_WORKFLOW_ID, label: 'Light', badge: 'L', stages: LIGHT_PAGE_STAGES, draw, runAction, progressText })`. It returns `{ commands: {} }`. It leaves out `checklist`, so the engine's `defaultChecklist` draws the list. Light has no action, so it leaves out `countdownText`, `hasPlan` and `previewFlows`, and the layout preview stays Heavy's. `runAction` is required by 02: it rejects with `Light has no actions`, and no drawn control can call it.
- **Main part.** `main/start.ts` calls `api.layouts.register({ layoutTypes: workflow.layoutTypes })`, so a user's types file lands in `layouts/workflow-light/`. It calls `workflow.addWorkflow(lightMainWorkflow)`, and hands the self-test script when `services.selfTest` is not null, with `hooks: workflow.selfTestHooks`.
- **Default layout.** It follows `workflow-heavy/layouts/default/layout.js`, with the typedef import `../../../workflow/layouts/layout`, and defines all three parts:
  - `chip`: `kit.badge(chip, input.badge, input.workflowLabel)` first, then the label and status as one tag. No countdown.
  - `strip`: the stepper. No countdown and no main action.
  - `sidePane`: the status mark and line, a progress bar, `finishedGroups` as one fold, `currentGroup` in full, `laterGroups` as a line each. No action row.
  - `layout.css` selects under `[data-layout-owner="workflow-light"][data-layout="default"]`, and takes spacing and colours from tokens per `DESIGN.md`.
- **Side section title.** `sideTitle` is `Checklist`: the list is the skill's own items, not a plan. 02 gives each workflow its own side part, `workflow-light.sidePane`. `checklistTitle` is `''` for this list (`defaultChecklist`), so the pane draws no second title.
- **Layer rule.** Add a `workflow-light` entry to `PLUGIN_EXTRAS`, with a `stages` sublayer `src/plugins/workflow-light/stages` that takes `src/contracts`, `src/plugins/workflow-light`, `src/plugins/workflow-light/contract.ts` and `src/plugins/workflow/contract.ts`. No `node:` package.
- **Engine log lines.** `logFlow` in `workflow-view.ts` adds three lines, each logged once per change per session, as `shows` is. They add no decision to the view: they are what a self-test step can wait for, since a step reads only log lines.
  - `<name> level <badge>` when the flow's `PageWorkflow` changes.
  - `<name> trail <labels>` when the labels of the steps the stepper draws change, read through the helper at `page/workflow-view.ts`'s `inStepper` filter so a shared `stepSlot` counts once, joined by ` › `, with no status or progress.
  - `<name> no workflow` when `flow.workflow === null && flow.missedLevel` turns true.
- **Drive actions.** `addDriveActions` joins `workflow/main/start.ts` when `api.drive` is not null, in the shape of `usage/main/drive-actions.ts`. `workflow.reportStep` calls the `reportStep` task 03 landed, and `workflow.reportChecklist` the `reportChecklist`, so a drive run goes through the tools' own path and rules. Each returns `{ accepted: <boolean> }`, the handler's result: a report that is ignored returns false. Task 12 uses them, because a fake harness makes no tool call.
- **`callChecklistTool`.** It calls the checklist tool's session as `callStepTool` calls the step tool's.

**Self-test script.** `SELFTEST_PROJECT_NAME` is `workflow-light-selftest`. It follows `workflow-heavy/main/selftest-script.ts`: `makeProject`, closing an earlier run's sessions, `hooks.forgetFlows`, `markRun`, and `onMainTurnEnded`, which at a send's turn end makes the tool call the send asks for.

- `chat.launch`'s first message is `FAKE_TOOL_TEXT` (`fake: tool`), a turn with agent work, so the turn's end sets `missedLevel`. `open` returns `shownLine: line('shows idle')` and `alsoShown: [anchored('no workflow')]`.
- `fake: report <step>` calls `hooks.callStepTool(sessionId, <step>)` at the turn's end. `fake: checklist` calls `hooks.callChecklistTool(sessionId, [{ text: 'first', done: true }, { text: 'second', done: false }, { text: 'third', done: false }])`.
- Groups and steps, in order. `line` and `anchored` are as in Heavy's script:

  | Group | `why` | Send | `expect` | `alsoExpect` | `screenshot` |
  |---|---|---|---|---|---|
  | `answer only` | `A session that only answers goes from Scope straight to done, with the L badge and the trail, and the No workflow tag leaves on the claim.` | `/wigley:light` | `shows scope` | `level L`, `trail Scope › Build › Check › Land` | `light-scope` |
  | | | `fake: report done` | `shows done` | | `light-answer-done` |
  | `full run` | `Reports move the trail through each step, the checklist draws with its count, and a second Light ask starts at Scope.` | `/wigley:light` | `shows scope` | | |
  | | | `fake: report build` | `shows build` | | |
  | | | `fake: checklist` | `progress 1/3` | | `light-build-checklist` |
  | | | `fake: report check` | `shows check` | | |
  | | | `fake: report land` | `shows land` | | |
  | | | `fake: report done` | `shows done` | | `light-done` |

- The first step sets `width: 1200`, so the side pane shows in its screenshot. The script ends on `width: 'start'`.
- `problems`: the sends equal, in order, `fake: tool`, `/wigley:light`, `fake: report done`, `/wigley:light`, `fake: report build`, `fake: checklist`, `fake: report check`, `fake: report land`, `fake: report done`; main turn ends are at least the number of sends minus one.

Pinned after the cold read. These hold for 08 too.
- `runsTasks: true` on Build alone, so open items show a running mark while the agent works.
- The default layout's side pane draws one flat list in every state, finished or not, by joining `finishedGroups`, `currentGroup` and `laterGroups` in order, with a `<checked>/<total>` line and the bar. It draws no fold: a list of two to five items has nothing to hide.
- At `total` 0 (an empty `items`), `statusProgress` is `''` and `progressText` is null.
- `logFlow`'s order within one push: `level`, `trail`, `shows`, `progress`.
- `workflow.reportChecklist` calls `parseChecklistItems` (03) and rejects with its text, and `workflow.reportStep` gives `accepted: false` for a step outside the union. `WorkflowDriveDeps` is `{ reportStep, reportChecklist }`, closures `workflow/main/start.ts` passes in.

GIVEN a new flow WHEN `wigley:light` starts THEN `workflow` is `workflow-light`, `stage` is `scope`, and the row draws the `L` badge
GIVEN a flow in `scope` WHEN the agent reports `done` THEN `stage` is `done`, the trail's last step reads `Land`, and `runs.jsonl` gains one line
GIVEN a flow in `check` WHEN the agent reports `build` THEN `stage` is `build`
GIVEN a flow in `done` WHEN `wigley:light` starts again THEN `stage` is `scope` and `movedUpFrom` stays null
GIVEN a Light flow WHEN the agent reports `review` THEN the stage does not change, and the tool says it was ignored
GIVEN a flow in `build` with a checklist of 1 done of 3 WHEN the trail draws THEN the current step reads `Build 1/3` and the side pane lists three items

Tests:
- `layouts/default/layout.test.ts`, `sidePane_AllDone_StillListsTheItems`: two done items draw two lines and no fold.
- `buildStatusProgress` and `progressText` add a `total` 0 row.
- `logFlow_LevelAndTrail_LogOncePerChange` asserts the order above.
- Drive rows: `reportChecklist_BadItems` (non-array, empty `text`, non-boolean `done`, each rejects naming `items`), `reportStep_UnknownStep` (`accepted` false). `reportStep_Light` runs the real engine start with a stub workflow.
- `workflow-light/page/start.test.ts`: the `addWorkflow` call carries `id`, `label`, `badge`, `stages`; `runAction` rejects with `Light has no actions`; `progressText` gives null for a null checklist and `1/3` for one of three; `createWorkflowDraw` gets `sideTitle` `Checklist` and the plugin's manifest.
- `stages/light-stages.test.ts`:
  - `foldFlow_LightRules` table, through `foldFlow` with `[lightMainWorkflow]`:

    | Start stage | Signal | Stage after |
    |---|---|---|
    | new flow | skill `wigley:light` | `scope` |
    | new flow | skill `light` | `scope` |
    | new flow | skill `wigley:review` | `idle`, `workflow` null |
    | `scope` | step `build` | `build` |
    | `build` | step `check` | `check` |
    | `check` | step `land` | `land` |
    | `land` | step `done` | `done` |
    | `scope` | step `done` | `done` |
    | `check` | step `build` | `build` |
    | `done` | skill `wigley:light` | `scope` |
    | `build` | step `review` | `build` |
    | `build` | skill `wigley:review` | `build` |
    | `build` | `turnEnded` | `build` |

  - `lightMainWorkflow_Values`: `id` `workflow-light`, `order` 10, `firstStage` `scope`; `reportedAs` values `['build', 'check', 'land', 'done']`; the stages with `finishes` true are `['done']`; `fixCycles` undefined.
  - `lightPageStages_MatchMainHalves`: every id and `order` equal between the two lists.
  - `lightTrail_ReadsFourWords`: the page stages by `stepSlot` give `Scope`, `Build`, `Check`, `Land`, and `done`'s `label` is `Land`.
  - `lightStatus` table: `land` busy gives `running`; `land` not busy gives `paused`; `done` busy or not gives `done`.
  - `buildStatusProgress`: `checklist` null gives `''`; one done of three gives ` 1/3`.
- `layouts/default/layout.test.ts`:
  - `chip_DrawsBadgeFirst`: `.workflow-badge` reads `L`, `title` `Light`, before the tag.
  - `strip_DrawsTheSteps`: `.workflow-step-label` texts are the input's labels; no `.workflow-countdown`, even with a `countdown` in the input, and no button.
  - `sidePane_DrawsTheGroups`: a `currentGroup` of two items draws two items; an input with no actions draws no `.workflow-side-actions`.
- `workflow/main/drive-actions.test.ts`:
  - `reportStep_Light`: a stub workflow flow at `scope` with `{ step: 'build' }` returns `{ accepted: true }`, and the flow's stage is `build`; `{ step: 'review' }` returns `{ accepted: false }`, and the stage does not change.
  - `reportStep_BadArgs`: no `sessionId`, and no `step`, each reject naming the missing key.
  - `reportChecklist_SetsTheList`: items `[{text:'a',done:false}]` return `{ accepted: true }`, and `flow.checklist` equals them.
- `workflow/page/workflow-view.test.ts`, new rows:
  - `logFlow_LevelAndTrail_LogOncePerChange`: two pushes of one flow of a stub workflow, badge `L`, stages `A`, `B`, log `s level L` and `s trail A › B` once each.
  - `logFlow_MissedLevel_LogsNoWorkflow`: a flow with `workflow` null and `missedLevel` true logs `s no workflow`; `missedLevel` false logs nothing of the kind.
- `src/plugins/manifests.test.ts`, one row: `workflow-light` has the setting `layout` and the theme token `badge`, default `var(--wg-status-info)`.

Done when: it compiles; `scripts/check-layers.mts` passes; `workflow-light` is in `manifests.ts`, `main.ts` and `page.ts`; the test gate runs the tests above. Task 12 runs `npm run selftest -- --plugin workflow-light` and the drive checks.

Commit: one commit for the group.

## Proof

Commit b2d36d46 · proof: Diff read; typecheck 0, lint 0; every Produces present by search of the named files; worker's touched tests pass · concerns: Self-test never run (task 12); callChecklistTool and Light's main part have no unit test; toggleFinishedWaves on an all-done flat list logs and changes nothing; empty checklist draws 0/0 pane; Heavy layout.css bare selectors land on Light's parts; logFlow logs no page stage ahead of shows and Heavy's Explore/Primer slot logs a second trail line; DESIGN.md left to task 10; drive-actions.test fakes copy start.test's
