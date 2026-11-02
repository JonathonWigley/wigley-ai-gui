# 05 — Fake harness emits the workflow events and scripts a workflow run

Status: in progress
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts` ·
           modify `src/main/main.ts` (the two `createFakeAgentHarness` calls) ·
           modify `src/plugins/chat/main/start.ts` (the drive `start` action's description only) ·
           modify the test call sites of `createFakeAgentHarness`: `src/plugins/chat/main/accounts.test.ts`,
           `src/plugins/chat/main/chat-sessions.test.ts`, `src/plugins/chat/main/folder-choices.test.ts`,
           `src/plugins/usage/main/drive-actions.test.ts`
Consumes:  the `skillStarted`, `fileWritten`, `turnStarted` and `turnEnded` members of `AgentEvent` ← 01
           `typedSkill(text: string): TypedSkill | null` in `src/shared/typed-skill.ts` ← 01
           in the tree: `createFakeAgentHarness(clock: Clock)`, `startProcess`, `emitTurnEnd`, `emitToolTurn`,
           `emitEchoTurn`, `emitUserEntry` and the `FAKE_*_TEXT` constants in `fake-agent-harness.ts`; `Files.write`, `Files.trash`
           (`src/contracts/files.ts`); `createMemoryFiles` (`src/shared/memory-files.ts`); `errorText`
           (`src/shared/error-text.ts`); the test tables `sessionEvents_$case` and
           `agentsTurn_$case` in `fake-agent-harness.test.ts`
Produces:  in `src/shared/fake-agent-harness.ts`:
           `export function createFakeAgentHarness(clock: Clock, files: Pick<Files, 'write' | 'trash'>): FakeAgentHarness;`
           `export const FAKE_WORKFLOW_FEATURE_TEXT = 'fake: workflow feature';`
           `export const FAKE_WORKFLOW_STEP_TEXT = 'fake: workflow step';`
           `export const FAKE_WORKFLOW_PLAN_PATH = 'docs/features/fake-flow/plan-fake-flow/plan.md';`
           `export const FAKE_WORKFLOW_TITLE = 'Fake flow';`
           `export function fakeWorkflowPlan(ticked: number, reviewRounds: number): string;`
           the fake's `skillStarted`, `fileWritten`, `turnStarted` and `turnEnded` emissions described below
Decisions: **the fake reaches files only through an injected `Files`.** Today it takes only `clock` and touches no
           file. It gains a second, required parameter `files: Pick<Files, 'write' | 'trash'>`. A required
           parameter, not an optional one, so no call site gets a fake that silently writes nothing.
           - `src/main/main.ts`: both calls pass the app's `files` (`createNodeFiles`, built after
             `modeServicesOf`). The calls sit inside the harness callbacks of `offscreenRunServices`, which run
             only when a window starts, after `files` exists. Under the self-test and a drive run, `trash` deletes
             for good (`offscreenRunServices`' `trashItem`).
           - every test call site passes `createMemoryFiles()`, or the memory files the test reads back.
           **events for what the fake already simulates**:
           - `turnStarted { at: clock.now() }` at each turn's start: in `emitUserEntry`, after `userMessage` and any
             typed `skillStarted`, and before `activity('working')`. Every send that runs a turn emits it: the echo,
             tool, steps, agents, hold and workflow turns. A `FAKE_END_TEXT` send emits none: the process ends and
             runs no turn. This is Claude's order: the send path's events come first, then the turn's
             `system/init` (04).
           - `turnEnded { at: clock.now() }` in `emitTurnEnd`, after `planUsage` and before `activity('idle')`. So
             every reply that ends a turn (echo, tool, workflow turns) emits it.
           - `interrupt` of an open turn: `turnEnded` after the `Interrupted` notice and before `activity('idle')`,
             as Claude's interrupted turn ends on a `result` (04).
           - a `FAKE_END_TEXT` send, `end`, `kill` and a held end: no `turnEnded`; the process ends instead.
           - **typed slash commands**: in `emitUserEntry`, after `userMessage` and before `turnStarted`, emit
             `skillStarted { agentId: MAIN_AGENT_ID, skill, args }` when `typedSkill(text)` is not null. The
             fake has no typed control commands, so it excludes none. A `/wigley:<skill>` send therefore emits
             `skillStarted wigley:<skill>` and then runs as an echo turn, unless the workflow script below takes
             it.
           **the plan file** (`fakeWorkflowPlan(ticked, reviewRounds)`, pure). The text, with `[x]` for the first
           `ticked` boxes in the order 01, 02, 03 and `[ ]` for the rest, and one `- round <n> · no findings` line
           for each n from 1 to `reviewRounds`:

           ```markdown
           # Fake flow — plan

           ## Tasks

           ### Wave 1

           - [ ] [Fake first task](01-fake-first.md)
           - [ ] [Fake second task](02-fake-second.md)

           ### Wave 2

           - [ ] [Fake third task](03-fake-third.md) — after 01, 02

           ## Run log

           ### Review rounds
           ```

           Two waves and three boxes, so the workflow shows a wave change and a count. The `### Review rounds`
           heading is always there; its lines appear from the review step on. `FAKE_WORKFLOW_TITLE` is the heading
           less ` — plan`.
           **the plan path**: `<projectDir>/` joined with `FAKE_WORKFLOW_PLAN_PATH` by `/`, `projectDir` being the
           process's `request.projectDir`. The plan folder is that path less `/plan.md`. The fake builds both
           strings the same way each time, so the folder the workflow sends back in `/wigley:make <folder>` equals
           the one the fake wrote.
           **the typed feature trigger.** `<Leader>wf` fills the composer with `/wigley:feature ` (09), and the
           self-test (10) types the trigger after it. So the send `/wigley:feature fake: workflow feature` runs the
           feature script too. The match is on `typedSkill(text)`: `skill` is `wigley:feature` and `args` equals
           `FAKE_WORKFLOW_FEATURE_TEXT`. Its one `skillStarted` is the typed one from `emitUserEntry`; the script
           then runs without its `Skill` step.
           **the workflow script.** The harness (not the process) keeps `workflowPlans: Map<string, { ticked:
           number; reviewRounds: number }>`, keyed by plan folder. A clear starts a new process (chat's `clear`),
           so the run's progress must outlive the process. Each process keeps `makeFolder: string | null`, the plan
           folder its make run works on, null at start.
           Each workflow turn is a normal closing turn (`isTurnOpen` false): user entry, `userMessage`, any
           `skillStarted` from the typed text, `turnStarted`, `working`, then the steps below, then `emitTurnEnd`. Each tool is two
           entries, with result `null` and then `{ text: 'ok', isError: false }`, ids `workflow-<turn>-<n>`, tool
           use ids `fake-workflow-<turn>-<n>`, each followed by `toolStarted` / `toolFinished` on `MAIN_AGENT_ID`,
           as `emitToolTurn` does. A write step awaits `files.write(planPath, fakeWorkflowPlan(...))` between its
           two entries, then emits `toolFinished` and `fileWritten { agentId: MAIN_AGENT_ID, path: planPath }`, in
           Claude's order (04). A `Skill` tool emits `skillStarted` right after its `toolStarted`, as Claude does.

           | Send | Taken when | Steps | Plan after | Reply text |
           |---|---|---|---|---|
           | `FAKE_WORKFLOW_FEATURE_TEXT` | always | `Skill` `{ skill: 'wigley:feature' }` (`skillStarted wigley:feature ''`); `Write` the plan with 0, 0 | 0/3, wave 1, 0 rounds; the map entry is set to `{ 0, 0 }` | `fake feature wrote <planPath>` |
           | `/wigley:feature <FAKE_WORKFLOW_FEATURE_TEXT>` | always | (the typed `skillStarted wigley:feature 'fake: workflow feature'` came with the user entry); `Write` the plan with 0, 0. No `Skill` step, so the turn holds one `skillStarted` | as the row above | as the row above |
           | `/wigley:make <folder>` | `workflowPlans` holds `<folder>` | (the typed `skillStarted wigley:make <folder>` came with the user entry); set `makeFolder`; one make step | as the make step gives | as the make step gives |
           | `FAKE_WORKFLOW_STEP_TEXT` | `makeFolder` is not null and `workflowPlans` holds it | one make step | as the make step gives | as the make step gives |

           A make step reads the folder's map entry and does the first row that matches:

           | Entry | Steps | Entry after | Reply text |
           |---|---|---|---|
           | `ticked` 0 or 1 | `Edit` the plan with `ticked + 1`, the same rounds | `ticked + 1` | `fake make ticked task <ticked + 1>` |
           | `ticked` 2 | `Skill` `{ skill: 'wigley:review' }` (`skillStarted wigley:review ''`); `Edit` the plan with 3, `reviewRounds + 1` | `ticked` 3, one more round | `fake make ticked task 3 and reviewed` |
           | `ticked` 3 | `Bash` `{ command: 'rm -r <folder>' }`, awaiting `files.trash(<folder>)` between its entries; no `fileWritten` | the entry is deleted; `makeFolder` is null | `fake make closed the plan` |

           So one feature turn, the make turn and three step turns pass through feature, plan ready, make (1/3
           wave 1, then 2/3 wave 2), review (3/3, 1 round) and closed. Primer is reached by sending
           `/wigley:feature-primer`, an echo turn with its `skillStarted`. A `/wigley:make` for a folder the map
           does not hold, and a step text with no `makeFolder`, run as echo turns. A second
           `FAKE_WORKFLOW_FEATURE_TEXT` rewrites the plan and resets its entry to `{ 0, 0 }`. A resumed make (a new
           process after a clear, sent `/wigley:make <folder>` again) continues from the entry, since the map is
           the harness's.
           **failures and ends**: a write or a trash that rejects emits the tool's result entry with
           `{ text: errorText(error), isError: true }`, `toolFinished ok: false`, and a notice entry
           `fake workflow could not change <path>: <errorText(error)>` with tone `error`; the entry is not changed,
           no `fileWritten` is emitted, and the turn ends as usual. When the process has ended while the write or
           trash was pending (`record.ended`), the fake emits nothing more for that turn.
           **drive description** (`chat/main/start.ts`, the `start` action): add `"fake: workflow feature"` as "a
           wigley:feature turn that writes a three-task plan" and `"fake: workflow step"` as "the next make step of
           that plan, after /wigley:make <its folder>".
GIVEN memory files and a fake process in `/p` WHEN `FAKE_WORKFLOW_FEATURE_TEXT` is sent THEN
`/p/docs/features/fake-flow/plan-fake-flow/plan.md` holds `fakeWorkflowPlan(0, 0)`, and the workflow events are
`turnStarted`, `skillStarted wigley:feature ''`, `fileWritten /p/docs/features/fake-flow/plan-fake-flow/plan.md`,
`turnEnded`, in that order after `userMessage`
GIVEN a fake process in `/p` WHEN `/wigley:feature fake: workflow feature` is sent THEN the plan is written as for
`FAKE_WORKFLOW_FEATURE_TEXT`, and the turn holds one `skillStarted` (`wigley:feature`, args `fake: workflow feature`)
GIVEN that plan WHEN a new process in `/p` is sent `/wigley:make /p/docs/features/fake-flow/plan-fake-flow`, then
`FAKE_WORKFLOW_STEP_TEXT` three times THEN the plan holds 1, 2, then 3 ticked boxes with one review round, and after
the last send the plan folder is gone
Tests:     `fake-agent-harness.test.ts`:
           - `fakeWorkflowPlan_TicksAndRounds ($case)`: rows `(0, 0)`, `(2, 0)`, `(3, 2)`. Each asserts the box
             lines in order and the round lines, written out in the row. It catches a box ticked out of order and a
             round line missing.
           - `workflowRun_FeatureThenMake_WalksEveryStage`: the two GIVENs, in one test, over one harness and
             `createMemoryFiles()`, the second process started after the first. After each send and a settle it
             asserts the events of the types `skillStarted`, `fileWritten`, `turnStarted` and `turnEnded`, and the
             plan file's text (`fakeWorkflowPlan(...)`, or missing after the last step). It catches progress lost across a
             clear, a wrong path, a write after its `fileWritten`, and a folder never deleted.
           - `workflowTypedFeature_RunsTheScriptWithOneSkillStarted`: one process in `/p` sent
             `/wigley:feature fake: workflow feature`. The plan file holds `fakeWorkflowPlan(0, 0)`, and the events of
             the four workflow types are `skillStarted main wigley:feature 'fake: workflow feature'`, `turnStarted`,
             `fileWritten /p/docs/features/fake-flow/plan-fake-flow/plan.md`, `turnEnded`, in that order. It catches a
             typed trigger run as an echo turn, and a second `skillStarted` from the script's `Skill` step.
           - `workflowSend_$case`, a table of the sends that run as echo turns: `/wigley:make /p/elsewhere` (a
             folder the fake never wrote) gives `skillStarted wigley:make /p/elsewhere`, an echo reply and no
             write; `FAKE_WORKFLOW_STEP_TEXT` with no make run gives an echo reply and no write. It catches a fake
             that writes outside the folders it made.
           - `workflowWrite_Rejects_EndsTheTurnWithANotice`: files whose `write` rejects `disk full`; the feature
             send gives the error notice, `toolFinished ok false`, no `fileWritten`, and `turnEnded`.
           - rows in `sessionEvents_$case` (it asserts `agentEvents`): `plain send` becomes `userMessage`,
             `turnStarted`, `turnEnded`; `tool turn` gains `turnStarted` after `userMessage` and `turnEnded` after
             its `toolFinished`; `end text` stays `userMessage`, `sessionEnded`; a new row `slash send`:
             `/wigley:feature x` gives `userMessage`, `skillStarted main wigley:feature x`, `turnStarted`,
             `turnEnded`. It catches a turn that never starts or ends, and a typed skill dropped.
           - rows of `agentsTurn_$case` (it asserts the `timeline` lines): `interrupt_FinishesSubagentsAsFailed`,
             `interruptThenEnd_FinishesSubagentsBeforeSessionEnded` and
             `interruptThenKill_FinishesSubagentsBeforeSessionEnded` gain `'turnEnded'` between `'notice notice-1'`
             and `'activity idle'`; `send_FinishesSubagentsAsDone` gains `'turnStarted'` between `'userMessage'` and
             `'activity working'`, and `'turnEnded'` between `'planUsage'` and `'activity idle'`. It catches an
             interrupted turn left running in the workflow.
           - the `agentEvents` lists of `send_StepsText_EmitsStepsAndHoldsTurnOpen` and
             `send_AgentsText_SpawnsTwoSubagentsAndHoldsTurn` gain `{ type: 'turnStarted', at: 1000 }` after
             `userMessage`. Those turns stay open, so they gain no `turnEnded`.
           The `heard` lists do not change: `heard` holds only the `usage` agent events (`recordingEvents`), so
           `send_PlainText_StreamsReplyThenResult`, `send_ToolText_EmitsToolWithResult` and
           `interrupt_HeldTurn_EndsWithNotice` keep their expectations. No other expectation in
           `fake-agent-harness.test.ts` changes, and the four other test files assert no agent event of the fake's
           own turns.
Done when: compiles; the test gate runs `fake-agent-harness.test.ts` and the four other test files whose call sites
           changed; `npm run lint` passes. The workflow self-test (10) runs the script live
Commit:    one commit for the group

## Proof
