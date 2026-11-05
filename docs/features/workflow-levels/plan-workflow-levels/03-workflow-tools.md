# 03 — Checklist tool, scoped step tool, session note

Status: not started
Type: Task
Wave: 3 · Depends on: 01
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/workflow/main/checklist-tool.ts` · `src/plugins/workflow/main/session-note.ts`
- modify `src/plugins/workflow/main/step-tool.ts` · `src/plugins/workflow/main/start.ts`
- test: create `src/plugins/workflow/main/checklist-tool.test.ts`
- test: modify `src/plugins/workflow/main/step-tool.test.ts` · `src/plugins/workflow/main/start.test.ts`

Consumes:
- `MainWorkflow`, `ChecklistItem`, the signal `checklistReported`, and `addWorkflow` in `src/plugins/workflow/main/start.ts` ← 01
- `foldFlow`'s rule that a null workflow ignores `checklistReported` and `stepReported` ← 01
- `contributeTools`, `textResult`, `errorResult`, `ToolDefinition`, `ToolSession`, `AgentSession` in `src/plugins/sessions/contract.ts` (tree members)
- `ChatMainExports.addInstructions` in `src/plugins/chat/contract.ts` (tree member)

Produces:
- In `src/plugins/workflow/main/checklist-tool.ts`:
  - `SET_WORKFLOW_CHECKLIST_TOOL = 'set_workflow_checklist'`
  - `checklistToolDefinition(): ToolDefinition`
  - `interface ChecklistToolDeps { reportChecklist(sessionId: string, items: readonly ChecklistItem[]): Promise<boolean> }`
  - `startChecklistTool(deps: ChecklistToolDeps): (session: Pick<AgentSession, 'id'>) => ToolSession`
- In `src/plugins/workflow/main/step-tool.ts`:
  - `reportedSteps(workflows: readonly MainWorkflow[]): string[]`
  - `stepToolDefinition(workflows: readonly MainWorkflow[]): ToolDefinition`
  - `interface StepToolDeps { workflows(): readonly MainWorkflow[]; reportStep(sessionId: string, step: string): Promise<boolean> }`
  - `SET_WORKFLOW_STEP_TOOL` and `startStepTool` keep their names.
- In `src/plugins/workflow/main/session-note.ts`: `SESSION_NOTE: string`.

Decisions:

`set_workflow_checklist`.
- Definition: `name` the constant; `required: ['items']`; `additionalProperties: false`; `items` an array of objects with `text` string and `done` boolean, each required.
- Description, verbatim: `Set this session's checklist, so the app shows it. Send the whole list each time: this call replaces the list before it.`
- Validation runs first, in the handler. `args.items` must be an array, and each entry an object with a non-empty string `text` and a boolean `done`. Extra keys on an entry are dropped: the handler passes on `{ text, done }` only. An empty array is valid and sets an empty list.
- Bad items return `errorResult('items must be an array of { text: string, done: boolean }, with text not empty.')`, and nothing folds.
- Valid items call `deps.reportChecklist`.
- True returns `textResult('Checklist set: <done> of <total> done.')`.
- False returns `textResult('Ignored the checklist: this session has no workflow yet.')`. This is a success: a skill's first call may come before the app knows of the flow. The text covers both a session with no flow and a null workflow.
- A different tool name rejects with `no workflow tool "<name>"`, as the step tool does.
- `end` does nothing.

`reportChecklist` in `main/start.ts`. It waits for `ready`. It returns false when `store.get(sessionId)` is null or its `workflow` is null. Otherwise it calls `apply(sessionId, { type: 'checklistReported', items }, 'live')` and returns true. The tool is contributed once in `start`, and not again when a workflow is added: its definition does not change. The handle joins `dispose`.

A Heavy flow that gets this call folds `checklist` and says set. Nothing draws it, since Heavy's `checklist` reads `plan.md`. Heavy's skills do not call it, and the note does not ask for it.

`set_workflow_step`.
- The schema lists the union. `reportedSteps` walks `workflows` in the order given, then each workflow's `stages`, and keeps the first of each `reportedAs`, so the JSON `enum` has no duplicate. `build`, `review`, `fix`, `land` and `done` appear once.
- Order with the three plugins: Light's `build`, `check`, `land`, `done`; then Medium's `review`, `fix`; then Heavy's `explore`, `interview`, `plan`, `cold_read`. Today Heavy alone gives `explore`, `interview`, `plan`, `cold_read`, `fix`.
- The handler reads `step`. A step not in `reportedSteps(deps.workflows())` returns today's text `Unknown step. Use one of: <a, b>.`, comma-joined, as an error.
- A listed step calls `deps.reportStep(sessionId, step)`. True returns `Step set to <step>.` False returns today's text `Ignored <step>: this session is not at a place in the workflow that takes it.` Both texts are unchanged.

`reportStep` in `main/start.ts`. It waits for `ready`, then:
1. Reads the flow. A null flow returns false. A flow with a null workflow, or a workflow no plugin holds, returns false.
2. Finds the stage in the flow's current workflow's `stages` with that `reportedAs`. None returns false, even when another workflow lists the step.
3. Calls `apply(sessionId, { type: 'stepReported', step: stage.id }, 'live')`, and returns `store.get(sessionId)?.stage === stage.id`.

So a Light flow's `review` is ignored with success, and a Medium flow's `review` moves only Medium. Heavy's `cold_read` still reaches the stage id `coldRead`.

Contribution. `contributeStepTool` passes `workflows.all()`, which `createStageList` keeps sorted by `order`. `addWorkflow` from task 01 calls it when a workflow with a `reportedAs` stage is added or disposed, so a session lists the union once the plugins start. The self-test hook `callStepTool` keeps its signature.

The session note, verbatim in `SESSION_NOTE`:

```
This app shows each session's workflow level, step and checklist. The `set_workflow_step` and `set_workflow_checklist` tools report them. Call a tool only where your running skill names it.
```

- `main/start.ts` calls `chat.addInstructions(SESSION_NOTE)` once in `start`, as `src/plugins/visual/main/start.ts` does. The disposable joins nothing, for the same reason as there: it lives as long as the plugin.
- The last sentence keeps Heavy out. `wigley:feature` and `wigley:make` name only `set_workflow_step`, so a Heavy session has no call to send a checklist. Do not add any sentence that says when to send a checklist. The skills `wigley:light` and `wigley:medium` hold that rule.
- A running session keeps what it started with, per `addInstructions`. This is fine: only new sessions need the note.

Heavy keeps:
- The values `explore`, `interview`, `plan`, `cold_read` and `fix`. All stay in the schema.
- `cold_read` reaches `coldRead`.
- A report from a stage whose rule rejects it succeeds with the ignored text: `closed` plus `explore`, `make` plus `plan`, idle plus `interview`.
- The re-contribution on add.
- The `ready` wait.
- `fix` from make or review only.
- The fold goes `live`, so it stamps the save time.
- No Heavy skill text changes.

Pinned after the cold read: `reportChecklist` returns false for a flow whose `workflow` is null or held by no plugin, as `reportStep` does, so the text never says `Checklist set` when nothing changed. `set_workflow_step`'s description does not change. The item validation is one exported function in `workflow/main/checklist-tool.ts`, `parseChecklistItems(value: unknown): readonly ChecklistItem[] | string` (a string is the error text), which the tool handler and task 07's drive action both call. Add a `ChecklistTool_Flow` row for a workflow no plugin holds.

GIVEN `set_workflow_checklist` with `items` of a wrong shape WHEN called THEN it returns an error naming the shape and the flow does not change.
GIVEN a session with no flow or a null workflow WHEN `set_workflow_checklist` is called with valid items THEN it succeeds saying ignored.
GIVEN a Light flow WHEN `set_workflow_checklist` is called with valid items THEN `flow.checklist` holds them and `flows` pushes.
GIVEN Light and Medium registered WHEN a Light flow reports `review` THEN it succeeds saying ignored and `stage` does not change.
GIVEN Light and Medium registered WHEN a Medium flow reports `review` THEN `stage` is Medium's stage for it.
GIVEN any step not in the union WHEN reported THEN it returns the error listing the union.

Tests:
- `main/checklist-tool.test.ts`:
  - `call_BadItems_ReturnsErrorNamingShape` table of `args`: `{}`; `{items:'a'}`; `{items:[1]}`; `{items:[{text:'a'}]}`; `{items:[{text:1,done:true}]}`; `{items:[{text:'',done:true}]}`; `{items:[{text:'a',done:'yes'}]}`. Each gives `isError` true, the text `items must be an array of { text: string, done: boolean }, with text not empty.`, and 0 calls of `reportChecklist`.
  - `call_ValidItems_ReportsAndSaysCount`: `{items:[{text:'a',done:true,extra:1},{text:'b',done:false},{text:'c',done:true}]}` calls `reportChecklist('s1', [{text:'a',done:true},{text:'b',done:false},{text:'c',done:true}])` and gives `Checklist set: 2 of 3 done.`
  - `call_Empty_Accepted`: `{items:[]}` gives `Checklist set: 0 of 0 done.`
  - `call_ReportFalse_SucceedsSayingIgnored`: `isError` not true; `Ignored the checklist: this session has no workflow yet.`
  - `call_OtherToolName_Rejects`: rejects with `no workflow tool "x"`.
- `main/step-tool.test.ts`, the existing tests kept and reworked over stub workflows:
  - `definition_ListsTheUnionOnce`: workflows `[{stages:[build,check]},{stages:[build,review]}]` give the `enum` `['build','check','review']`.
  - `call_ListedStep_ReportsTheStepForTheSession`: `reportStep` gets `('s1','review')`; true gives `Step set to review.`
  - `call_RuleIgnoresIt_SucceedsSayingIgnored`: false gives `Ignored review: this session is not at a place in the workflow that takes it.`
  - `call_UnknownStep_ListsTheUnion`: `Unknown step. Use one of: build, check, review.`
  - `call_OtherToolName_Rejects` stays.
- `main/start.test.ts`:
  - `StepTool_ScopedToTheFlowsWorkflow` table, stub `light` with `build` and stub `medium` with `build`, `review`:
    | flow | step | text | stage after |
    |---|---|---|---|
    | light at `build` | `review` | `Ignored review: ...` | `build` |
    | medium at `build` | `review` | `Step set to review.` | `review` |
    | new (workflow null) | `build` | `Ignored build: ...` | `idle` |
    | no flow | `build` | `Ignored build: ...` | none |
  - `StepTool_Heavy`: a flow in `explore` reporting `cold_read` gives `Step set to cold_read.` and `stage` `coldRead`.
  - `ChecklistTool_Flow` table: Light flow gives `checklist` `[{text:'a',done:false}]` in the last `flows` push; new flow and no flow give the ignored text and no push.
  - `Start_AddsTheSessionNote`: the fake chat's `addInstructions` gets `SESSION_NOTE` once.
  - `SessionNote_NamesBothTools`: `SESSION_NOTE` contains `set_workflow_step`, `set_workflow_checklist` and `only where your running skill names it`.
  - `Start_ContributesBothTools`: the fake `contributeTools` has been given both tool names.

Done when: compiles; `scripts/check-layers.mts` passes; the test gate runs the tests above. A real agent's tool call in a session goes to task 12.
Commit: one commit for the group.

## Proof

