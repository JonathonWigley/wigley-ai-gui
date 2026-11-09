# 02 — workflow-spike plugin

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo:      wigley-ai-gui, worktree `~/Documents/ai-dev/.worktrees/wigley-ai-gui-spike-level`
Files:     create in `src/plugins/workflow-spike/`:
           `manifest.ts` · `contract.ts` · `stages/index.ts` ·
           `stages/{interview,build,check,land,done}/main.ts` and `page.ts` (ten files) ·
           `main/start.ts` · `main/selftest-script.ts` · `page/start.ts` ·
           `layouts/default/layout.js` · `layouts/default/layout.css` ·
           test `stages/spike-stages.test.ts` · test `page/start.test.ts` · test `layouts/default/layout.test.ts`
           modify `src/plugins/main.ts` · `src/plugins/page.ts` · `src/plugins/manifests.ts` ·
           `scripts/check-layers.mts` · `src/plugins/workflow/contract.ts`
           test `src/plugins/manifests.test.ts` · test `src/plugins/workflow-levels.test.ts`
Consumes:  the engine contract in `src/plugins/workflow/contract.ts` (`MainStage`, `PageStage`, `MainWorkflow`, `startsSkill`, `reportsStep`, `busyStatus`, `checklistCount`, `workflowMainKey`, `workflowPageKey`) — already in the tree
Produces:  `export const SPIKE_WORKFLOW_ID = 'workflow-spike'` in `src/plugins/workflow-spike/contract.ts`
           `export const workflowSpikeManifest` in `src/plugins/workflow-spike/manifest.ts`
           `export const spikeMainWorkflow: MainWorkflow` in `src/plugins/workflow-spike/stages/index.ts`
           `export const workflowSpikeMainPart` in `src/plugins/workflow-spike/main/start.ts`
           `export const workflowSpikePagePart` in `src/plugins/workflow-spike/page/start.ts`

## Decisions

The plugin is a copy of `src/plugins/workflow-small/`, file for file, with these changes. Every
`small`/`Small`/`SMALL` name becomes `spike`/`Spike`/`SPIKE`. Every CSS class `workflow-small-*`
becomes `workflow-spike-*`.

- **Manifest.** `id: 'workflow-spike'`, `label: 'Spike workflow'`,
  `description: 'Tracks a throwaway spike through interview, then build and check per ask, then land.'`.
  `settingInfo.layout.label: 'Spike workflow layout'`; its description names the
  `layouts/workflow-spike` folder and Spike's chip, strip and pane. `dependsOn` is the same as
  Small's. `themeTokens.badge.default: 'var(--wg-fg-secondary)'`.
- **Workflow.** `order: 40`. `claims: (signal) => startsSkill(signal, 'wigley:spike')`.
  `firstStage: 'interview'`. Stages in this order: interview, build, check, land, done.
- **Main stages.** Each `enter` answers its own word at any time, in any order. This is what lets the
  trail loop.

  | Stage | `order` | `reportedAs` | `enter` returns the stage id when |
  |---|---|---|---|
  | interview | 10 | `'interview'` | `startsSkill(signal, 'wigley:spike')` or `reportsStep(signal, 'interview')` |
  | build | 20 | `'build'` | `reportsStep(signal, 'build')` |
  | check | 30 | `'check'` | `reportsStep(signal, 'check')` |
  | land | 40 | `'land'` | `reportsStep(signal, 'land')` |
  | done | 50 | `'done'` | `reportsStep(signal, 'done')`; keep Small's `finishes: true` |

  Copy every other field of each main stage from Small's stage of the same id. Interview has no
  Small twin. Its `enter` returns
  `startsSkill(signal, 'wigley:spike') || reportsStep(signal, 'interview') ? 'interview' : null`,
  and it declares `reportedAs: 'interview'`. Copy the comment of Small's `scope` main stage, worded
  for Spike: the engine leaves the stage where it is on a claim by the flow's own workflow, so this
  rule moves a second Spike ask, or a new run after `done`, back to interview.
- **Page stages.** Copy Small's page stage of the same id. The interview page stage copies
  `src/plugins/workflow-medium/stages/interview/page.ts` (label `Interview`, `inStepper: true`,
  `order: 10`, `busyStatus`). The done page stage keeps `label: 'Land'` and `stepSlot: 'land'`.
- **Page part.** `label: 'Spike'`, `badge: 'X'`, `sideTitle: 'Checklist'`,
  `runAction: () => Promise.reject(new Error('Spike has no actions'))`,
  `progressText: checklistCount`.
- **Self-test script.** Copy Small's script with these values. `SELFTEST_PROJECT_NAME` is
  `'workflow-spike-selftest'`. `SPIKE_SEND` is `'/wigley:spike'`. `SENDS_AFTER_LAUNCH` is this list,
  in this order: `SPIKE_SEND`, `reportSend('done')`, `SPIKE_SEND`, `reportSend('build')`,
  `CHECKLIST_SEND`, `reportSend('check')`, `reportSend('build')`, `reportSend('check')`,
  `reportSend('land')`, `reportSend('done')`. The run compares the sends to this list exactly.
  - Group `answer only` is Small's group with the renames. Step 1 sends `SPIKE_SEND` and expects
    `shows interview`, with `alsoExpect` `anchored('level X')` and
    `anchored('trail Interview › Build › Check › Land')`; screenshot `spike-interview`. Step 2 sends
    `done` and expects `shows done`; screenshot `spike-answer-done`.
  - Group `full run` has these steps in order: `SPIKE_SEND` expects `shows interview`; `build`
    expects `shows build`; `CHECKLIST_SEND` expects `progress 1/3`, screenshot
    `spike-build-checklist`; the two headless steps as in Small's, screenshot
    `spike-headless-chip-on`; `check` expects `shows check`; `build` expects `shows build`,
    screenshot `spike-build-again`; `check` expects `shows check`; `land` expects `shows land`;
    `done` with `width: 'start'` expects `shows done`, screenshot `spike-done`.
  - The second `shows build` proves the loop. The page logs `shows <stage>` at each stage change
    (`logFlow` in `src/plugins/workflow/page/workflow-view.ts`), and a step's `expect` waits for a
    line logged after its keys ran (`SelfTestStep` in `src/contracts/plugin.ts`). The trail line is
    not logged again, because the trail text does not change.
  - Each group's `why` says what it proves, in the words of Small's.
- **Registries.** Add one import and one array entry in each of `src/plugins/main.ts`,
  `src/plugins/page.ts` and `src/plugins/manifests.ts`, placed before the Small entry.
- **Layer rules.** Copy the `'workflow-small'` block in `scripts/check-layers.mts` (starts at line
  273, measured at plan time, re-verify) as a `'workflow-spike'` block, with every path renamed and
  `small-stages.test.ts` renamed `spike-stages.test.ts`. Also add the three Spike layers
  (`src/plugins/workflow-spike/contract.ts`, `/main`, `/stages`) to the
  `'src/plugins/workflow-levels.test.ts'` entry (about line 678, measured at plan time,
  re-verify), and change its comment "The three level workflows' main rules" to "The four level
  workflows' main rules", and "Small's and Medium's main parts" to "Small's, Medium's and Spike's
  main parts".
- **Open plan overlap.** The unlanded plan `docs/features/workflow/plan-paused-needs-you/` changes
  Small's and Medium's `layouts/default/layout.js` and `layout.test.ts`. When that folder still
  exists at run time, add Spike's `layout.js` and `layout.test.ts` to its task 01 (Files and the
  change list), in the same words it uses for Medium's, and commit that edit with this group. When
  that plan has landed, the copy of Small's files already carries its change.
- **Contract comment.** In `MainWorkflow` in `src/plugins/workflow/contract.ts`, the comment
  `// Small 10, medium 20, large 30.` becomes `// Small 10, medium 20, large 30, spike 40.`.

GIVEN a session that starts `wigley:spike` WHEN the fold runs THEN the flow's workflow is `workflow-spike` and its stage is `interview`
GIVEN a Spike flow in `check` WHEN the agent reports `build` THEN the stage is `build`
GIVEN a Spike flow in `build` WHEN the agent reports `interview` THEN the stage is `interview`
GIVEN a Spike flow WHEN the agent reports `review` THEN the stage does not change
GIVEN a Spike flow WHEN the agent reports `done` THEN the run finishes

## Tests

- `stages/spike-stages.test.ts` — copy `small-stages.test.ts` with the renames. Small's `scope`
  becomes `interview` in every row, so the row `done` then `wigley:spike` expects `interview`. Add
  these rows to the stage-entry table: `build` then report `interview` → `interview`; `check`
  then report `build` → `build`, when Small's table has no such row; `build` then report
  `review` → `build`. The values test expects `order: 40`, `firstStage: 'interview'`, the
  `reportedAs` list `['interview', 'build', 'check', 'land', 'done']` and the finishing stages
  `['done']`. The trail test expects `['Interview', 'Build', 'Check', 'Land']`.
- `page/start.test.ts` — copy Small's; it asserts label `Spike`, badge `X`.
- `layouts/default/layout.test.ts` — copy Small's with the class names renamed.
- `manifests.test.ts` — add `manifests_WorkflowSpike_HasItsLayoutSettingAndBadgeToken` beside the
  Small and Medium cases: settings keys `['layout']`, badge default `'var(--wg-fg-secondary)'`.
- `workflow-levels.test.ts` — add Spike where the file lists the levels: `spikeMainWorkflow` in
  `WORKFLOWS`; a `'wigley:spike'` row in `claims_AreDisjoint`; a row in
  `mainPart_OnTheEngine_ClaimsUntilStopped` with `SPIKE_WORKFLOW_ID`, claim `'wigley:spike'` and
  `workflowSpikeMainPart`. The claim-order tests stay as they are, since Spike is outside the size
  order.

Done when: `npm test`, `npm run typecheck` and `npm run lint` pass in the worktree (prefix
`source ~/.nvm/nvm.sh && nvm use &&` when the shell's Node is not the pinned one).
Commit:    one commit for the group

## Proof
