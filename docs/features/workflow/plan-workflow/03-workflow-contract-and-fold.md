# 03 — Workflow contract and the flow fold

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/workflow/contract.ts` · create `src/plugins/workflow/flow.ts` · test `src/plugins/workflow/flow.test.ts`
Consumes:  `PlanProgress` ← 02 (type import from `./plan-reader`; the file lands in the same wave, so the implementer
           writes against plan.md's line and the compile proves it once both land)
           `ChannelShape` in `src/contracts/plugin.ts`, `Disposable` in `src/contracts/disposable.ts` (in the tree)
Produces:  in `src/plugins/workflow/contract.ts`, word for word as plan.md § File Structure writes them:
           `export type StageId = string;`
           `export const IDLE_STAGE: StageId = 'idle';`
           `export interface SessionFlow { sessionId: string; projectDir: string; stage: StageId; planDir: string | null; progress: PlanProgress | null; turnRunning: boolean; runningSubagents: readonly string[]; countdownEndsAt: number | null; hasLeftIdle: boolean }`
           `export type WorkflowSignal` (the eleven members of plan.md, `skillStarted` with `args` and `argsPath`)
           `export interface MainStage { id: StageId; order: number; enter(flow: SessionFlow, signal: WorkflowSignal): StageId | null; autoCommand?: string; clearsPlan?: boolean }`
           `export function isBusy(flow: SessionFlow): boolean;`
           `export interface StageActionSpec { command: string; label: string; side: 'page' | 'main'; available(flow: SessionFlow): boolean; enabled(flow: SessionFlow): boolean }`
           `export interface PageStage { id: StageId; label: string; inStepper: boolean; order: number; actions: readonly StageActionSpec[]; detail(flow: SessionFlow): string }`
           `export interface WorkflowMainExports { addStage(stage: MainStage): Disposable; }`
           `export interface WorkflowPageExports { addStage(stage: PageStage): Disposable; }`
           `export interface WorkflowActionRequest { sessionId: string; command: string }`
           `export interface WorkflowChannel extends ChannelShape { invoke: { flows(): Promise<SessionFlow[]>; runAction(request: WorkflowActionRequest): Promise<void> }; messages: { flows: SessionFlow[] } }`
           in `src/plugins/workflow/flow.ts`, word for word as plan.md writes them:
           `export function foldFlow(flow: SessionFlow, signal: WorkflowSignal, stages: readonly MainStage[]): SessionFlow;`
           `export function newFlow(sessionId: string, projectDir: string): SessionFlow;`
           `export function isPlanFile(path: string): boolean;`
           `export function planDirOf(path: string): string;`
Decisions:
- **Three names the drafter added, now in plan.md**: `MainStage.autoCommand`,
  `WorkflowActionRequest`, and the `WorkflowChannel` type. `autoCommand` exists because main starts the countdown and
  may name no stage id (plan.md boundary rule): the stage that wants an auto-start says so itself. Contract comment:
  "A main-side command the auto-start runs when a flow enters this stage while `workflow.autoClearAndMake` is on,
  after `workflow.autoStartSeconds`; left out, entering the stage starts no countdown." Plan ready sets it to
  `'clearAndMake'` (07).
- **The channel is typed as notes and sessions type theirs**: an interface extending `ChannelShape` with `invoke`
  and `messages`. Contract comments: `flows` (invoke) resolves to every flow main holds, once main has read
  `flows.json`; `runAction` runs a main-side command (`StageActionSpec.command` with `side: 'main'`) on the session's
  flow, and rejects with main's error text; `flows` (message) is every flow main holds, sent on each change. Copy the
  plan.md comments onto every other name.
- **`isBusy`** lives in `contract.ts`, as plan.md places it: `flow.turnRunning || flow.runningSubagents.length > 0`.
  Contract comment: plan.md's. It is the one busy rule: the stage rules (07) and the page's `enabled` read it.
- **`StageActionSpec.enabled`** and **`PageStage.order`**: copy the plan.md comments. `available` decides whether an
  action shows; `enabled` decides whether a shown action can run.
- **`MainStage.clearsPlan`**: copy the plan.md comment. The fold reads it in step 8; no other code reads it.
- **`contract.ts` imports only** `src/contracts/plugin.ts`, `src/contracts/disposable.ts` and `./plan-reader`.
- **`flow.ts` is pure**: no I/O, no clock, no DOM. It imports only `./contract` (and `PlanProgress` as a type).
- **`newFlow`**: `{ sessionId, projectDir, stage: IDLE_STAGE, planDir: null, progress: null, turnRunning: false, runningSubagents: [], countdownEndsAt: null, hasLeftIdle: false }`.
- **`isPlanFile`**: true when `path` matches `/[\\/]plan-[^\\/]+[\\/]plan\.md$/` — a `plan.md` whose folder's name
  starts `plan-` and has at least one more character, either separator. Case-sensitive.
- **`planDirOf`**: `path` with its last separator and everything after it removed (`/a/plan-x/plan.md` →
  `/a/plan-x`; `C:\a\plan-x\plan.md` → `C:\a\plan-x`). Called only on a path `isPlanFile` accepts.
- **A plan argument** (internal to `flow.ts`, not exported) reads the signal's `argsPath`, never `args`. A null
  `argsPath` names no plan. Else `argsPath` names a plan when `isPlanFile(argsPath)` (its plan folder is
  `planDirOf(argsPath)`), or when `argsPath`, its trailing separators removed, has a last segment that starts `plan-`
  and has at least one more character (its plan folder is `argsPath` less those trailing separators). Anything else
  names no plan. Main resolves `argsPath` against the session's folder before it folds (08), so the fold sees full
  paths. `args` stays the raw text, for a stage rule that reads it as text.
- **The fold**, `foldFlow(flow, signal, stages)`, in this order:
  1. `turnStarted` sets `turnRunning` true and `countdownEndsAt` null. Main maps it from the `turnStarted` agent
     event (08), which every turn emits, an unrequested one included; `userMessage` is not a signal.
  2. `turnEnded` sets `turnRunning` false. `subagentStarted` adds `agentId` to the end of `runningSubagents` when the
     list does not hold it. `subagentFinished` removes `agentId` from `runningSubagents` when the list holds it.
  3. `fileWritten` whose `path` passes `isPlanFile` sets `planDir` to `planDirOf(path)`: the last plan written wins.
     When that changes `planDir`, `progress` becomes null. A write to the same plan keeps `progress`, so the chip
     does not blank on each edit of the plan; the plan watch sends the new progress (08).
  4. `skillStarted` with `skill` exactly `wigley:make` whose `argsPath` names a plan sets `planDir` to that plan folder,
     with `progress` null when that changes `planDir`.
  5. `planChanged` sets `progress` to `signal.progress`. A progress equal to the current one changes nothing:
     equal means every scalar field equal and `tasks` the same length with each line's `wave`, `text` and `done`
     equal.
  6. `cleared` sets `countdownEndsAt` null, `turnRunning` false and `runningSubagents` `[]`: the new process runs no
     turn and no subagent.
  7. The stage rules: call `enter(flowAfterSteps1to6, signal)` on each stage in the order `stages` gives (the
     caller keeps them sorted by `order`); the first non-null result is the new stage. With none, the stage stays.
     The fold does not check the result names a stage in `stages`.
  8. When step 7 changed the stage: `countdownEndsAt` becomes null (a countdown belongs to the stage it started in),
     and when the new stage is `IDLE_STAGE`, `planDir` and `progress` become null (idle holds no plan: Dismiss and
     Make in new session both reach idle). When step 7's answer is a stage in `stages` whose `clearsPlan` is true,
     `planDir` and `progress` become null, also when that stage is the current one: a new `wigley:feature` starts a
     new plan, so a plan from a closed run or an earlier revision never makes the next turn end plan ready.
  9. `hasLeftIdle` becomes true when the stage is not `IDLE_STAGE`; it never returns to false.
  The fold returns `flow` itself (the same object) when no field changed, so main writes and sends only real
  changes; otherwise a new object. `runningSubagents` is equal when it holds the same ids in the same order. It never
  mutates `flow`.
- **The countdown's start lives in main, not here.** The fold has no clock. After a fold that changed the stage to
  one whose `autoCommand` is set, while `workflow.autoClearAndMake` is on, main sets `countdownEndsAt` to
  `clock.now() + autoStartSeconds * 1000` (08). The fold only clears it (steps 1, 6, 8).

GIVEN a flow in a stage with `turnRunning` false and a countdown running WHEN `turnStarted` folds THEN `turnRunning`
is true, `countdownEndsAt` is null and the stage stays
GIVEN a flow with `planDir` `/r/docs/features/x/plan-a` WHEN `fileWritten` `/r/docs/features/y/plan-b/plan.md` folds
THEN `planDir` is `/r/docs/features/y/plan-b` and `progress` null
GIVEN stage rules that both answer WHEN a signal folds THEN the first in the given order wins
GIVEN a flow with a turn running and subagent `a1` running WHEN `cleared` folds THEN `turnRunning` is false and
`runningSubagents` is `[]`
GIVEN a flow with `planDir` set WHEN a signal enters a stage whose `clearsPlan` is true THEN `planDir` and `progress`
are null

Tests:     `flow.test.ts`, `describe('foldFlow')`, one `it.each` table `'$name'`, rows
           `{ name, flow, signal, expected }` where `flow` and `expected` are built from one helper
           `flowWith(fields: Partial<SessionFlow>)` over `newFlow('s1', '/r')`, and `expected` is compared whole with
           `toEqual`. The stages are a fake list, not the real stages: `fake('a', 10, (f, s) => s.type === 'dismissed' ? 'a' : null)`,
           `fake('b', 20, …)` answering `skillStarted` with skill `x:b` → `'b'`, and `fake('c', 30, …)` answering
           `skillStarted` `x:b` → `'c'` and `turnEnded` while `planDir` non-null → `'c'`, `fake('e', 40, …)` with
           `clearsPlan: true` answering `skillStarted` `x:e` → `'e'`, plus `idle` answering `handedOff` →
           `IDLE_STAGE`. A `skillStarted` signal in a row carries `args` and `argsPath`. Rows, one per rule:
           · turnStarted → `turnRunning true`, `countdownEndsAt null` (from `countdownEndsAt: 5000`)
           · turnEnded → `turnRunning false`, `runningSubagents` kept (from `['a1']`)
           · subagentStarted `a1` → `runningSubagents ['a1']`; subagentStarted `a1` again → `toBe` the input flow
           · subagentFinished `a1` from `['a1', 'a2']` → `['a2']`; subagentFinished `a9` → `toBe` the input flow
           · fileWritten of a plan file, new plan → `planDir` set, `progress null` (from a progress)
           · fileWritten of the same plan → `progress` kept
           · fileWritten of `/r/src/a.ts` → returns the flow unchanged
           · fileWritten with `\` separators (`C:\r\plan-a\plan.md`) → `planDir` `C:\r\plan-a`
           · skillStarted `wigley:make` argsPath `/r/plan-a` and argsPath `/r/plan-a/` → `planDir` `/r/plan-a`
           · skillStarted `wigley:make` argsPath `/r/plan-a/plan.md` → `planDir` `/r/plan-a`
           · skillStarted `wigley:make` argsPath `/r/docs/x` → `planDir` unchanged
           · skillStarted `wigley:make` args `plan-a`, argsPath null → `planDir` unchanged (the fold read `args`)
           · skillStarted `other:skill` argsPath `/r/plan-a` → `planDir` unchanged
           · planChanged → `progress` set; planChanged with an equal progress → `toBe` the input flow
           · cleared from `turnRunning: true`, `runningSubagents: ['a1']` and a countdown → `turnRunning false`,
             `runningSubagents []`, `countdownEndsAt null`, stage kept
           · skillStarted `x:b` → stage `'b'` (first rule wins over `'c'`)
           · turnEnded with `planDir` null → stage kept (`'c'` does not answer); turnEnded with `planDir` set → `'c'`
           · the rules see the flow after bookkeeping: a `fake('d', 5, …)` answering `fileWritten` only while
             `flow.planDir` is non-null, given a first plan write from `planDir` null → `'d'`
           · a stage change clears `countdownEndsAt`
           · skillStarted `x:e` from `'c'` with a plan and a progress → stage `'e'`, `planDir null`, `progress null`;
             from `'e'` itself with a plan → the same (a re-entered `clearsPlan` stage)
           · handedOff from `'c'` with a plan → stage `idle`, `planDir null`, `progress null`
           · `hasLeftIdle` true after the first non-idle stage, and still true after returning to idle
           · a signal no rule answers and no bookkeeping touches → `toBe` the input flow
           `describe('isPlanFile')`: one `it.each` table: `/a/plan-x/plan.md` true, `C:\a\plan-x\plan.md` true,
           `/a/plan-/plan.md` false, `/a/x/plan.md` false, `/a/plan-x/notes.md` false, `/a/plan-x/plan.md.bak` false.
           `planDirOf` is covered by the fold rows.
           `describe('isBusy')`: one `it.each` table: no turn and `[]` → false; a turn → true; `['a1']` → true.
Done when: compiles; `npm run lint` passes; the test gate runs the tests above.
Commit:    one commit for the group

## Proof
