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
  Small twin: write it like Small's `scope` main stage plus the `reportsStep` branch and
  `reportedAs: 'interview'`.
- **Page stages.** Copy Small's page stage of the same id. The interview page stage copies
  `src/plugins/workflow-medium/stages/interview/page.ts` (label `Interview`, `inStepper: true`,
  `order: 10`, `busyStatus`). The done page stage keeps `label: 'Land'` and `stepSlot: 'land'`.
- **Page part.** `label: 'Spike'`, `badge: 'X'`, `sideTitle: 'Checklist'`,
  `runAction: () => Promise.reject(new Error('Spike has no actions'))`,
  `progressText: checklistCount`.
- **Self-test script.** Copy Small's script. Its fixture session starts `wigley:spike` and then
  reports `build`, `check`, `build`, `check`, `land`, `done`. Its groups prove: the chip shows `X`
  and `Interview` on the skill start; the trail goes back to Build after Check; it finishes on
  Land.
- **Registries.** Add one import and one array entry in each of `src/plugins/main.ts`,
  `src/plugins/page.ts` and `src/plugins/manifests.ts`, placed before the Small entry.
- **Layer rules.** Copy the `'workflow-small'` block in `scripts/check-layers.mts` (starts at line
  273, measured at plan time, re-verify) as a `'workflow-spike'` block, with every path renamed and
  `small-stages.test.ts` renamed `spike-stages.test.ts`.
- **Contract comment.** In `MainWorkflow` in `src/plugins/workflow/contract.ts`, the comment
  `// Small 10, medium 20, large 30.` becomes `// Small 10, medium 20, large 30, spike 40.`.

GIVEN a session that starts `wigley:spike` WHEN the fold runs THEN the flow's workflow is `workflow-spike` and its stage is `interview`
GIVEN a Spike flow in `check` WHEN the agent reports `build` THEN the stage is `build`
GIVEN a Spike flow in `build` WHEN the agent reports `interview` THEN the stage is `interview`
GIVEN a Spike flow WHEN the agent reports `review` THEN the stage does not change
GIVEN a Spike flow WHEN the agent reports `done` THEN the run finishes

## Tests

- `stages/spike-stages.test.ts` — copy `small-stages.test.ts`. Keep each case that applies to Spike's
  stages. Add these rows to its stage-entry table: `check` then `build` → `build`; `build` then
  `interview` → `interview`; `review` → unchanged.
- `page/start.test.ts` — copy Small's; it asserts label `Spike`, badge `X`.
- `layouts/default/layout.test.ts` — copy Small's with the class names renamed.
- `manifests.test.ts` — add `manifests_WorkflowSpike_HasItsLayoutSettingAndBadgeToken` beside the
  Small and Medium cases: settings keys `['layout']`, badge default `'var(--wg-fg-secondary)'`.
- `workflow-levels.test.ts` — add Spike to every place it lists the levels: the claim of
  `wigley:spike` goes to `workflow-spike`, and the union of reported step words is unchanged by
  Spike (it adds no new word).

Done when: `npm test`, `npm run typecheck` and `npm run lint` pass in the worktree (prefix
`source ~/.nvm/nvm.sh && nvm use &&` when the shell's Node is not the pinned one).
Commit:    one commit for the group

## Proof
