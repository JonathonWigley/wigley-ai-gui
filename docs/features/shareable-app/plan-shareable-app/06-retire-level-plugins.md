# 06 — Retire the four level plugins onto sample declarations

Status: not started
Type: Task
Rung: hard · many parts: four plugins' behaviour moves onto declarations, and a wrong label or trigger changes what the user sees
Wave: 5 · Depends on: 04, 05
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- remove `src/plugins/workflow-spike/` · remove `src/plugins/workflow-small/` · remove `src/plugins/workflow-medium/` · remove `src/plugins/workflow-large/` (every file, tests and layouts included)
- remove `src/plugins/workflow-large-main.test.ts` · remove `src/plugins/workflow-large-page.test.ts` · remove `src/plugins/workflow-levels.test.ts`
- remove `src/shared/plan-progress.ts` · remove `src/shared/plan-progress.test.ts` · remove `src/shared/plan-copies.ts` · remove `src/shared/plan-copies.test.ts`
- create `src/plugins/workflow/declared/sample-auri.json` · create `src/plugins/workflow/declared/sample-workflows.ts` · test `src/plugins/workflow/declared/sample-workflows.test.ts` · test `src/plugins/workflow/declared/sample-large.test.ts`
- create `src/plugins/workflow/main/sample-selftest-scripts.ts` · create `src/plugins/workflow/main/sample-large-selftest-script.ts`
- modify `src/plugins/workflow/main/level-selftest-script.ts` · modify `src/plugins/workflow/main/start.ts` · modify `src/plugins/workflow/main/demo-steps.ts`
- create `src/plugins/workflow/page/sample-demo-steps.ts` · test `src/plugins/workflow/page/sample-demo-steps.test.ts` · modify `src/plugins/workflow/page/start.ts`
- modify `src/plugins/workflow/contract.ts`
- modify `src/plugins/manifests.ts` · modify `src/plugins/main.ts` · modify `src/plugins/page.ts` · modify `src/plugins/keymap.ts` · test `src/plugins/keymap.test.ts` · test `src/plugins/manifests.test.ts`
- modify `src/main/drive/drive-commands.ts` · test `src/main/drive/drive-commands.test.ts`
- modify `AGENTS.md`

Consumes:
- `buildMainWorkflow(workflow: DeclaredWorkflow, planFold: PlanFold): MainWorkflow` in `src/plugins/workflow/declared/build-main.ts` ← 04
- `buildPageWorkflow(workflow: DeclaredWorkflow, deps: PageBuildDeps): PageWorkflow` in `src/plugins/workflow/declared/build-page.ts` ← 04
- `qualifiedWorkflowId(pluginName, id)`, `actionCommandShortId(workflowId, actionId)`, `DeclaredWorkflow`, `CHECKLIST_WORKFLOW` in `src/plugins/workflow/contract.ts` ← 04
- `countdownText` in `src/plugins/workflow/declared/countdown-text.ts` ← 04
- `WorkflowSelfTestHooks.addDeclared(workflow: DeclaredWorkflow): Disposable` in `src/plugins/workflow/contract.ts` ← 04 (it adds to the `workflowDeclaredSlot` set, ignoring `workflow.off`; its disposal removes it)
- `createPlanFold(): PlanFold`, `createPlanPane(): PlanPane`, `readPlan` ← 05
- `AuriFile`, `WorkflowDecl`, `PlanFormat` in `src/contracts/contributions.ts` ← 03

Produces:
- `src/plugins/workflow/declared/sample-auri.json`: an `auri.json` with `"version": 1`, `workflows` and `planFormat` only, as plain JSON so task 13 can compare it with Python
- `SAMPLE_AURI_FILE: AuriFile` (that JSON, imported and typed; `tsconfig.json` sets `resolveJsonModule`) and `SAMPLE_PLUGIN_NAME = 'wigley'` in `src/plugins/workflow/declared/sample-workflows.ts`
- `sampleDeclared(id: 'small' | 'medium' | 'large' | 'spike', pluginName?: string): DeclaredWorkflow` in `src/plugins/workflow/declared/sample-workflows.ts` (`pluginName` defaults to `SAMPLE_PLUGIN_NAME`)

## What this task does

Task 04 made every workflow a declaration, and 05 added the plan capability. The four level plugins are now dead weight that duplicates the user's config. This task:

1. writes the user's four workflows and plan format once, as sample data in `sample-workflows.ts`;
2. ports every behaviour test, self-test and demo step of the four plugins onto that sample data, run through 04's engine and 05's capability;
3. removes the four plugins, the three cross-level tests, `src/shared/plan-progress.ts` and `src/shared/plan-copies.ts`, and the four plugins' settings.

`sample-auri.json` is the one copy of the user's workflows in the app. Task 13 copies its `workflows` and `planFormat` into the `wigley` plugin's `auri.json`. Plan.md § Boundary rules allows `wigley:` names here because it is test fixture and demo sample data; `sample-workflows.ts`'s header comment says so (JSON holds no comment).

### The sample declarations (pinned values)

Each value below is read from today's stage files, and the port pins it. `planFormat` is the user's block in design.md § Section: planFormat, verbatim. Where this table and design.md § Example disagree, this table wins: it is today's code. Each such row is marked †.

Workflow fields:

| id | label | badge | badgeColor | order | claims | sidePane | counters / fixCycles |
|---|---|---|---|---|---|---|---|
| `small` | `Small` | `S` | `var(--wg-status-info)` | 10 | `wigley:small` | `checklist`, `Checklist` | none |
| `medium` | `Medium` | `M` | `var(--wg-accent)` | 20 | `wigley:medium` | `checklist`, `Checklist` | `fix: { counts: 'fix', resetOn: 'claim' }` / `{ counter: 'fix' }` |
| `large` | `Large` | `L` | `var(--wg-status-warning)` | 30 | `wigley:feature`, `wigley:feature-primer`, `wigley:make` | `plan`, `Plan` | `{ planCounter: 'reviewRounds' }`; `groups.featureRun: [explore, interview, plan, coldRead, planReady]` |
| `spike` | `Spike` | `X` | `var(--wg-fg-secondary)` | 40 | `wigley:spike` | `checklist`, `Checklist` | none |

Small stages, in order. Every status is `busy` unless the row says otherwise.

| id | label | step | other fields | enter |
|---|---|---|---|---|
| `scope` | `Scope` | — | | `{ skill: 'wigley:small' }` |
| `build` | `Build` | `build` | `runsTasks: true`†, `progress: ' {checklist}'` | `{ step: 'build' }` |
| `check` | `Check` | `check` | | `{ step: 'check' }` |
| `land` | `Land` | `land` | `slot: 'land'` | `{ step: 'land' }` |
| `done` | `Land` | `done` | `slot: 'land'`, `status: 'finishing'`, `finishes: true` | `{ step: 'done' }` |
| `answered` | `Answered` | `answered` | `inStepper: false`, `status: 'none'`, `finishes: true`, `unseenActivity: { word: 'answered', tone: 'success' }` | `{ step: 'answered' }` |

Medium stages: `interview` (`Interview`, no step, enter `{ skill: 'wigley:medium' }`), `build` (as Small's), `review` (`Review`, step `review`), `fix` (`Fix`, step `fix`, `progress: ' · cycle {counter.fix}'`), `land` and `done` (as Small's).

Spike stages: `interview` (`Interview`, step `interview`, enter `{ skill: 'wigley:spike' }` then `{ step: 'interview' }`), then `build`, `check`, `land`, `done` as Small's.

Large actions:

| id | kind | label | text / event / then | flags | key |
|---|---|---|---|---|---|
| `clearAndMake` | `clearAndSend` | `Clear & make` | `/wigley:make {plan}` | `risky`, `enabled: ['idle']` | — |
| `makeInNewSession` | `launch` | `Make in new session` | `/wigley:make {plan}`, then `handedOff` | | `<Leader>wn` |
| `resumeMake` | `clearAndSend` | `Resume make` | `/wigley:make {plan}` | `risky`, `keyOnly`†, `available: ['idle', 'planOpen']`†, `enabled: ['idle']` | `<Leader>wr` |
| `openPlan` | `openPlan` | `Open plan` | | `keyOnly`† (04 shows it only while `plan.dir` is set) | `<Leader>wo` |
| `retro` | `send` | `Retro` | `/wigley:retro` | `enabled: ['idle']` | `<Leader>wt` |
| `dismiss` | `event` | `Dismiss` | event `dismissed` | `keyOnly` | `<Leader>wd` |

Large stages, in order. `actions` lists action ids, the main action first. The countdown's Cancel is 04's built-in.

| id | label | step | slot | status | other fields | actions | enter |
|---|---|---|---|---|---|---|---|
| `idle` | `Idle` | — | — | `none` | `inStepper: false` | — | `{ event: 'handedOff', clearsPlan }`, `{ event: 'dismissed', from: ['closed'], clearsPlan }` |
| `primer` | `Primer` | — | `start` | `busy` | | — | `{ skill: 'wigley:feature-primer', clearsPlan }` |
| `explore` | `Explore` | `explore` | `start` | `busy` | `detail: ['{plan.title}']`† | `openPlan`† | `{ skill: 'wigley:feature', clearsPlan }`, `{ step: 'explore', from: ['featureRun'] }` |
| `interview` | `Interview` | `interview` | — | `busy` | `detail: ['{plan.title}']`† | `openPlan`† | `{ step: 'interview', from: ['featureRun'] }` |
| `plan` | `Plan` | `plan` | — | `busy` | `detail: ['{plan.title}']`† | `openPlan`† | `{ step: 'plan', from: ['featureRun'] }` |
| `coldRead` | `Cold read` | `cold_read` | — | `busy` | `detail: ['{plan.title}']`† | `openPlan`† | `{ step: 'cold_read', from: ['featureRun'] }` |
| `planReady` | `Make` | — | `make` | `ready` | `detail: ['{plan.title}', '{plan.total} tasks']`, `rowActivity: { word: 'ready to make', tone: 'attention', emphasis: 'raised' }`, `auto: 'clearAndMake'` | `clearAndMake`, `makeInNewSession`, `openPlan`† | `{ event: 'turnEnded', from: ['featureRun'], when: ['idle', 'planHasTasks'] }`, `{ event: 'planChanged', from: ['featureRun'], when: ['idle', 'planHasTasks'] }` |
| `make` | `Make` | — | `make` | `busy` | `runsTasks: true`, `records: ['reviewRounds']`, `progress: ' {plan.build}'`, `detail: ['{plan.build}', 'wave {plan.wave}', '{plan.title}']` | `resumeMake`, `openPlan` | `{ skill: 'wigley:make', planFromArgs }` |
| `review` | `Review` | — | — | `busy` | `progress: ' · round {plan.counter.reviewRounds}'`, `detail: ['round {plan.counter.reviewRounds}', '{plan.checked}/{plan.total}', '{plan.title}']`† | `resumeMake`, `openPlan` | `{ skill: 'wigley:review', from: ['make', 'fix'] }`, `{ event: 'planChanged', from: ['make'], when: [{ counterRose: 'reviewRounds' }] }` |
| `fix` | `Fix` | `fix` | — | `busy` | `progress: ' · cycle {plan.counter.reviewRounds}'`, `detail: ['cycle {plan.counter.reviewRounds}', '{plan.checked}/{plan.total}', '{plan.title}']` | `resumeMake`, `openPlan` | `{ step: 'fix', from: ['make', 'review'] }` |
| `closed` | `Close` | — | — | `finishing` | `finishes`, `reopens`, `progress: ' · {plan.checked}/{plan.total}'`, `detail: ['{plan.title} · done']`, `rowActivity: { word: 'closed', tone: 'success', emphasis: 'raised' }` | `retro`, `dismiss`† (no `openPlan`) | `{ event: 'planGone', from: ['make', 'review', 'fix'], when: ['planRead'] }` |

(`clearsPlan` and `planFromArgs` above mean `true`.)

### What changes for the user, accepted

- Command ids become `workflow.wigley-large-<action>` (04's `actionCommandShortId`). Their palette labels become the action labels (`Clear & make` in place of `clear the session and make the plan`), as design.md § Actions settles.
- The badge colour comes from `badgeColor`. The theme tokens `--wg-workflow-<level>-badge` go with the manifests. `grep -rln "workflow-.*-badge" ~/.config/wigley-ai-gui` printed nothing (measured at plan time, re-verify), so no user theme sets them.
- Workflow ids in new run-log lines and saved flows become `wigley:small` and the others. A saved flow naming `workflow-large` reads as 04 reads an unknown workflow id. No migration: intent.md, Local, does not care about backwards compatibility.
- Template edge: a template whose every variable is empty renders `''` (design.md § Templates), where `detailLine` drew `0/0` or `done` alone. A read plan with no box, or with no `# ` title, is the only case.

### Removals beyond the folders

- `src/plugins/manifests.ts`, `main.ts`, `page.ts`: drop the four imports and list entries.
- `src/plugins/keymap.ts`: drop the five `workflow-large.*` rows. Their keys now come from the sample's `key` fields through 04's `api.keys.bind`. `<Leader>ww`, `ws`, `wf`, `wh` stay.
- `src/plugins/workflow/contract.ts`: remove the `{ type: 'custom'; event: unknown }` `WorkflowSignal` variant and every `case 'custom'` that reads it. Its last user was `workflow-large`.
- `src/main/drive/drive-commands.ts` line 245 names `workflow-large.autoStartSeconds` as an example, and line 534's comment names `['workflow-large', 'autoStartSeconds']`. Use `workflow.layout` and `['workflow', 'layout']`. In `drive-commands.test.ts`, the `workflow-large` settings fixtures become `workflow` with `layout` values.
- Settings removed: `workflow-small.layout`, `workflow-medium.layout`, `workflow-large.layout`, `workflow-spike.layout`, `workflow-large.autoClearAndMake`, `workflow-large.autoStartSeconds`. `~/.config/wigley-ai-gui/settings.json` holds no key that starts with `workflow` (measured at plan time, re-verify with the command in Done when). Edit it only if that check prints a key: remove each removed key. `~/.config/wigley-ai-gui/layouts/workflow-{large,medium,small,spike}/` each hold only the app's generated `layout.d.ts` (measured at plan time). Name them in the report; do not delete them.
- `AGENTS.md`: the lines that name the four plugins (near lines 122, 459, 502–515 and 1296–1297, measured at plan time) describe the sample declarations and the `workflow` plugin's `declared/` and `plan/` folders instead.

### Self-tests

Each script registers its sample through 04's `WorkflowSelfTestHooks.addDeclared`. Reason: the self-test home has no installed agent plugin, and the self-test checks the engine, not the registry (task 18 checks a real `auri.json` live).

- `sample-selftest-scripts.ts` holds the Small, Medium and Spike scripts. Each first calls `hooks.addDeclared(sampleDeclared(id))`, then runs `levelSelfTestScript` with today's `SELFTEST_PROJECT_NAME`, `SENDS_AFTER_LAUNCH`, group names, `why` texts, expected lines and screenshot names, word for word.
- `sample-large-selftest-script.ts` is `workflow-large/main/selftest-script.ts` moved, plus `addDeclared(sampleDeclared('large'))`. The auto-start group writes `{"workflow":{"autoStart":[{"workflow":"wigley:large","seconds":30}]}}` and then `{}`. Its two expected settings lines become the lines 04's engine logs for `workflow.autoStart`, read from 04's landed code. Every other step stays as it is.
- `main/start.ts` runs the four scripts where the four plugins ran theirs, under the same `services.selfTest !== null && workflow.selfTestHooks !== null` check.

### Demo steps

- `page/sample-demo-steps.ts` registers four steps: ids `workflow.small`, `workflow.medium`, `workflow.spike`, `workflow.large`; section `workflows`; orders 20, 30, 40, 50; titles `Small workflow`, `Medium workflow`, `Spike workflow`, `Large workflow`. Their captions, `ITEMS`, beats and the Large sample plan (`Daily quests`, `docs/features/daily-quests/plan-daily-quests` under the scratch folder) are today's, word for word. `files` names the new files.
- Each step adds only a page half, `buildPageWorkflow(sampleDeclared(id, 'demo'), …)`, for the step's life. Its id is `demo:<id>`. Reason: a real `wigley:<id>` may already be added, and the page `addWorkflow` throws on a duplicate id; a page half also claims nothing and adds no step.
- Large's sample flows build `SessionFlow.plan` from a `PlanProgress` with the seven `PREVIEW_TASKS` and the `PREVIEW_PROGRESS` rows of `workflow-large/page/preview.ts`, for the `interview` and `closed` beats.
- `main/demo-steps.ts` registers `sampleSessionStep('workflow.small', 'Small workflow')` and the other three, in place of the four plugins' main halves.
- The four plugins' layout preview samples go: 04's `buildPageWorkflow` makes one preview flow per stage.
- The four layout folders go: 04 copied Large's default layout to `src/plugins/workflow/layouts/default/` and ported its tests.

## Decisions

- Keep today's behaviour wherever design.md's example differs (the † rows): design.md § Example says "the port's fixture tests pin the text".
- One sample file serves the tests, the self-tests, the demo and task 13. Intent: one truth for every fact.
- The four layout folders and their `layout.test.ts` go. 04 owns the one shared default layout and its tests.

## Tests

Each old test that pins a behaviour becomes a row over the sample declarations, run through `buildMainWorkflow`, `buildPageWorkflow`, `foldFlow`, 04's engine fakes (`engine-fakes.test-support.ts`, `engine-parts.test-support.ts`) and 05's capability. Keep each test's name where its behaviour is the same.

`sample-workflows.test.ts`:
- `SAMPLE_AURI_FILE_ReadsThroughTheWorkflowsReader` — 04's workflows reader accepts every declaration with no reasons, and the `planFormat` reader accepts the format. Catches a sample that the contract refuses, which task 13 would ship.
- From `workflow-levels.test.ts`: `claimOrder_MovesUp`, `movingDown_SetsMovedUpFromToo`, `sharedStageIds_FoldOnlyTheCurrentWorkflow`, `skillsOutsideTheLevels_ClaimNothing` (`wigley:review`, `wigley:debug`, `wigley:explore`), `claims_AreDisjoint` (the six claimed skills).
- From each `*-stages.test.ts`: `<level>Trail_Reads…`. Trails: Small `Scope › Build › Check › Land`, Medium `Interview › Build › Review › Fix › Land`, Spike `Interview › Build › Check › Land`.
- From `medium-state.test.ts`: `fixCycles_CountsEachEntryToFix`, `fixCycles_SecondMediumAsk_CountsFromZero`, `fixCycles_OtherStep_KeepsTheCount`.
- From each `page/start.test.ts`: `badge_Reads<letter>` and `progressText_CountsTheChecklist` for Small, Medium and Spike.
- `sampleKeys_BindUnderActionCommandIds` — replaces the `workflowLargeCommands_KeepTheirChords` rows of `keymap.test.ts`: `<Leader>wn`, `wr`, `wo`, `wt`, `wd` bind `workflow.wigley-large-makeInNewSession`, `-resumeMake`, `-openPlan`, `-retro`, `-dismiss`.

`sample-large.test.ts`, the Large rows:
- One table test per old stage rule file (`stages/{closed,explore,idle,make,plan-ready,primer,review}/main.test.ts`, `reported-steps.test.ts`, `main-stages.test.ts`), each old `it` a row: given the flow's stage, plan and running state and the signal, the stage the fold gives.
- The stage-rule rows of `large-state.test.ts` `foldFlow over Large`.
- `page-stages.test.ts`: labels, slots, statuses, details and action lists as the table above pins them, each a row.
- From `workflow-large-main.test.ts`: `replayedFeatureTurn_ReachesPlanReady_StartsNoCountdown`, `replayBurstOfAFeatureTurn_ItsPlanReadStartsNoCountdown`, `StepTool_Large`, `Open_SavedCountdown_RunsNone`, `Countdown_CancelStopsTheTimer`, `Countdown_CancelOnAnotherWorkflow`, `RunLog_LargeClosed`, `RunLog_MovedUp`, `RunLog_OnlyOnEntry`, `MissedLevel_ClaimedInTurn_StaysFalse`. Its plan rows are 05's.
- From `workflow-large-page.test.ts`: every row, with the sample Large added through the page engine.
- From `main/actions.test.ts`: `clearAndMake_ClearRejects_SendsNothingAndRejects` and `signals nothing when the part stops while the new session launches`, over 04's action runner.

`sample-demo-steps.test.ts`: `registers workflow.small` and the other three; `the Large beats show the interview, then the closed run`.

Dropped, each with its reason: the four `stop_LeavesNoLiveRegistration` and `stopThenStart` rows and `mainPart_OnTheEngine_ClaimsUntilStopped` (no level plugin left to stop); `*PageStages_MatchMainHalves` and `pairs each page half with its main half` (one declaration builds both halves); `createWorkflowDraw_TakesTheChecklistTitleAndThePluginsManifest` and the four `layout.test.ts` files (04's shared layout and its tests); `runAction_Rejects` (a declaration with no actions has none to run); `preview.test.ts` (04's generated preview); `countdown.test.ts` both halves (moved with 04's countdown); the plan tests (moved in 05); the four `manifests.test.ts` rows that find `workflow-*` ids.

## Done when

- `npm run typecheck`, `npm run lint` and `npm test` pass in `wigley-ai-gui/`.
- `find src/plugins -maxdepth 1 -name 'workflow-*'` prints nothing, and `ls src/shared/plan-progress.ts src/shared/plan-copies.ts` fails.
- `grep -rn "workflow-large\|workflow-small\|workflow-medium\|workflow-spike\|plan-progress\|plan-copies\|LargeState\|MediumState" src AGENTS.md` prints only test-data manifest ids in `src/plugins/workflow/page/` and `src/plugins/workflow/main/run-log.test.ts`.
- `python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.config/wigley-ai-gui/settings.json')));print([k for k in d if k.startswith('workflow-')])"` prints `[]`.
- `npm run selftest` passes, the four ported scripts included.
- The demo walk and the live look are task 18's.

Commit: one commit for the group.

## Proof
