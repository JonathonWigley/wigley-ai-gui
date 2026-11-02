# Workflow plugin — plan

Feature: workflow · Implements: none · Ticket: none
Target: main · Written: 2026-10-31

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Add the `workflow` plugin: each Chat-tab session shows its stage in the user's wigley workflow (idle, primer, feature,
plan ready, make, review, closed) on its session row, in a strip above the Chat composer and in a Flow tab, and each
stage offers its next step as a button and a `<Leader>w` key. The headline action is Clear & make: it clears the
session and sends `/wigley:make <plan folder>`. A setting, off by default, starts it by itself after a countdown. Each
stage is one module folder, so the workflow changes by editing one folder.

## Architecture

Systems touched:

- `src/contracts/agent.ts` — three new `AgentEvent` members: `skillStarted`, `fileWritten`, `turnEnded`
- `src/main/claude-code/` — the Claude adapter emits them; `src/shared/fake-agent-harness.ts` — the fake emits them
- `src/plugins/agents/roster.ts` — its exhaustive fold passes the new members through
- `src/plugins/chat/` — main exports `send` and `clear`; page exports `fillComposer` and `addComposerPart`; the chat
  layout gains the composer parts slot
- `src/plugins/workflow/` — the new plugin: contract, pure fold, plan reader, seven stage modules, main part, page
  part, layout, self-test script
- registration — `src/plugins/manifests.ts`, `main.ts`, `page.ts`, `keymap.ts`, `scripts/check-layers.mts`

```
 Claude adapter / fake ──AgentEvent──▶ chat main ──chat.agentEvent──┐
 sessions main ──hostSessionChanged / ended─────────────────────────┤
                                                                    ▼
                                        workflow main ── foldFlow(flow, signal, stages) ──▶ flows (plugin data)
                                          │  watches each flow's plan folder → plan changed / plan gone
                                          │  runs main actions: chat.clear, chat.send, chat.launch
                                          └──workflow channel (flows)──▶ workflow page
                                                                            ├─ row chip      (sessions.addRowPart)
                                                                            ├─ composer strip (chat.addComposerPart)
                                                                            └─ Flow tab       (sessions.addTab)
                                                                            page actions: chat.fillComposer, docs.openDoc
```

## Preconditions

All passed on 2026-11-02 at `53c2810`: the four plans had landed while the tasks were drafted, and the tasks are
written against the tree. `wigley:make` re-runs each before the first dispatch, and the run waits until all pass.

- The clear-command plan has landed: `test ! -d docs/features/agent-chat/plan-clear-command` and
  `grep -n "clear(sessionId: string): void" src/plugins/chat/main/chat-sessions.ts` prints a line, and
  `grep -n "hostSessionChanged" src/plugins/sessions/contract.ts` prints a line.
- The usage plan has landed: `test ! -d docs/features/usage/plan-usage` and
  `grep -n "export type AgentEvent" src/contracts/agent.ts` prints a line.
- The subagent-lines plan has landed: `test ! -d docs/features/agent-tower/plan-subagent-lines`,
  `test -f src/plugins/agents/roster.ts`, and `grep -n "addRowPart" src/plugins/sessions/contract.ts` prints a line.
- The chat-panes plan has landed: `test ! -d docs/features/chat-panes/plan-chat-panes`.
- After those land, re-read every signature this plan's File Structure names from them (`AgentEvent`,
  `MAIN_AGENT_ID`, `ChatAgentEvent`, `SessionPart`, `addRowPart`, `ChatSessions.clear`,
  `SessionsMainEvents.hostSessionChanged`) against the tree. A changed signature is a ruling in the Run log, and the
  amended line replaces this plan's line in every brief.
- `grep -n "'<Leader>w" src/plugins/keymap.ts` prints nothing (the `w` group is free), and
  `grep -n "Space z l w\|'<Leader>zlw'" src/plugins/keymap.ts` prints nothing.

## Docs written ahead

Commit `22dfcf9`:

- `docs/features/workflow/design.md` — the whole design
- `AGENTS.md` — the `workflow/` folder in the plugin list, and the "A composer part" bullet
- `docs/keymap.md` — the `w` leader group row
- `docs/features/layouts/design.md` — the `workflow` owner row and the `Space z l w` preview row
- `docs/features/agent-tower/design.md` — the `skillStarted`, `fileWritten` and `turnEnded` rows

## Mandatory Reads

- `AGENTS.md` — every task
- `DESIGN.md` — tasks 09 and 10 (every view and its CSS)
- `docs/keymap.md` — task 09 (the `w` group)
- `docs/features/workflow/design.md` — every task; it is the design this plan implements
- `docs/features/layouts/design.md` — tasks 06 and 09
- `docs/features/agent-tower/design.md` § Agent events — tasks 01, 04, 05
- `docs/features/agent-chat/claude-stream.md` — task 04 (the CLI's stream shapes)
- `.agents/skills/drive/SKILL.md` — task 12

## Design Overview

### Decisions

- **Stages are modules.** One folder per stage under `src/plugins/workflow/stages/`, each a `main.ts` and a
  `page.ts`. Each half registers through the workflow `addStage` export of its process. The plugin core names no
  stage (design review: deep module; an extension point over a closed list).
- **One pure fold.** `foldFlow(flow, signal, stages)` is the only place a flow changes. It applies the shared
  bookkeeping (turn running, plan path, plan progress), then asks each stage's `enter` rule in stage order; the first
  rule that returns a stage id wins; with none, the stage stays. The fold is the test surface for every stage rule.
- **Agent events only.** Detection reads `skillStarted`, `fileWritten`, `turnEnded` and `userMessage` from
  `chat.agentEvent`, never a harness's JSON. Only events whose `agentId` is `MAIN_AGENT_ID` are signals.
- **Owned sessions only.** Only Chat-tab sessions carry agent events and can be cleared.
- **Main owns the flows.** Main folds, keeps the flows in plugin data (`flows.json`, keyed by host session id,
  because row ids are fresh on every launch; `hostSessionChanged` moves the key; `sessions.ended` drops it), watches plan folders, runs the
  countdown on the injected timers, and pushes every changed flow to the page over the workflow channel. The page
  draws and runs page actions only.
- **Every workflow command runs in the page** (`runsIn: 'page'`), so the `<Leader>w` binds are page binds. A command
  acts on the selected session (sessions' `selectedSessionId()`). A main-side action (a clear, a send, a launch, a
  flow change) goes to main through the channel's `runAction`; the page runs `fillComposer` and `openDoc` itself.
  Command ids: `workflow.mainAction` (`ww`), `workflow.makeInNewSession`, `workflow.resumeMake`, `workflow.openPlan`,
  `workflow.retro`, `workflow.startFeature`, `workflow.dismiss`; `workflow.clearAndMake` and
  `workflow.cancelCountdown` run only through `mainAction` and the buttons, with no key of their own.
- **Busy is a turn or a subagent.** `isBusy(flow)` is true while a turn runs or a subagent the main agent spawned
  runs. Plan ready waits for a turn end in feature with the plan's `## Tasks` holding at least one box and nothing
  busy, so a plan whose task documents are still being drafted never shows Clear & make, and the auto-start never
  clears a run mid-draft. Clear & make, Resume make and Retro draw disabled while busy, and `ww` then runs nothing.
- **Buttons act on their own session.** A row chip's or a strip's button runs for the session it is drawn for; only
  keys act on `selectedSessionId()`.
- **Clear keeps the stage.** The `cleared` signal changes no stage, so Clear & make's own clear keeps plan ready until
  `wigley:make` starts.
- **The user presses** (round 1), unless `workflow.autoClearAndMake` is on (round 1 notes): then plan ready starts a
  countdown of `workflow.autoStartSeconds` (default 10). During it the main action is Cancel, run by `ww` or the
  button (round 3).
- **Idle draws nothing on the row** and a dim Start feature on the strip. The Flow tab is added when a session first
  leaves idle and stays (round 2).
- **Closed stays** until the next flow skill or Dismiss (round 2).
- **Make in new session** hands the plan to the new session and returns the old session to idle.

### Out of scope

- Terminal sessions, Codex and wigley-harness adapters, stages for other skills (`docs/features/workflow/design.md` §
  Out of scope).
- Any change to the wigley skills in wigley-ai-marketplace.

## File Structure

### Names more than one task uses

```ts
// src/contracts/agent.ts  (01) — four members join the AgentEvent union the precondition plans built
  | { type: 'skillStarted'; at: number; agentId: string; skill: string; args: string }
  | { type: 'fileWritten'; at: number; agentId: string; path: string }
  | { type: 'turnStarted'; at: number }   // every turn, requested or not (Claude: each turn's system/init)
  | { type: 'turnEnded'; at: number }

// src/shared/typed-skill.ts  (01) — a typed or sent "/<skill> <args>" message; the Claude adapter and the fake share it
export function typedSkill(text: string): TypedSkill | null;

// src/shared/fake-agent-harness.ts  (05) — the new argument is required; every call site changes
export function createFakeAgentHarness(clock: Clock, files: Pick<Files, 'write' | 'trash'>): FakeAgentHarness;
export const FAKE_WORKFLOW_FEATURE_TEXT = 'fake: workflow feature';  // the turn that writes the plan
export const FAKE_WORKFLOW_STEP_TEXT = 'fake: workflow step';        // each send ticks the next box
export const FAKE_WORKFLOW_PLAN_PATH = 'docs/features/fake-flow/plan-fake-flow/plan.md'; // relative to projectDir
export const FAKE_WORKFLOW_TITLE = 'Fake flow';

// src/shared/page/contributed-parts.ts  (06) — sessions' part store and placement, moved so chat reuses them
export interface ContributedPart; export interface PartStore; export function createPartStore(); export function placeContributedParts();

// src/plugins/workflow/plan-reader.ts  (02)
export interface PlanProgress {
  checked: number;              // ticked or struck boxes under ## Tasks
  total: number;                // every box under ## Tasks
  wave: number | null;          // the number of the first ### Wave N holding an open box; null when none is open
  reviewRounds: number;         // lines starting "- " under ### Review rounds in ## Run log
  title: string;                // the first "# " heading, less a trailing " — plan"
  tasks: readonly PlanTaskLine[]; // one per counted box, in file order; the Flow tab's checklist
}
export interface PlanTaskLine {
  wave: number | null;          // the ### Wave N the box sits under; null before any wave heading
  text: string;                 // the line after its box, links reduced to their text, ~~ removed
  done: boolean;                // ticked or struck
}
export function readPlanProgress(text: string): PlanProgress;

// src/plugins/workflow/contract.ts  (03)
export type StageId = string;   // a stage module's id: 'idle', 'primer', 'feature', 'planReady', 'make', 'review', 'closed'
export const IDLE_STAGE: StageId = 'idle';
export interface SessionFlow {
  sessionId: string;
  projectDir: string;
  stage: StageId;
  planDir: string | null;       // the plan folder (holding plan.md), full path
  progress: PlanProgress | null;// null until the plan folder is read
  turnRunning: boolean;
  runningSubagents: readonly string[]; // agent ids the main agent spawned that have not finished
  countdownEndsAt: number | null; // epoch ms; non-null only while the auto-start counts down
  hasLeftIdle: boolean;         // true once the stage was ever other than idle; the Flow tab exists from then on
}
export type WorkflowSignal =
  | { type: 'skillStarted'; skill: string; args: string; argsPath: string | null } // argsPath: args resolved against projectDir; null only for empty args
  | { type: 'fileWritten'; path: string }
  | { type: 'turnStarted' }
  | { type: 'turnEnded' }          // also from a sessionEnded of the flow's current host session (a crash mid-turn)
  | { type: 'subagentStarted'; agentId: string }   // agentSpawned with parentAgentId MAIN_AGENT_ID
  | { type: 'subagentFinished'; agentId: string }  // agentFinished for an id in runningSubagents
  | { type: 'cleared' }            // resets turnRunning and runningSubagents: a fresh process runs nothing
  | { type: 'planChanged'; progress: PlanProgress }
  | { type: 'planGone' }
  | { type: 'handedOff' }        // Make in new session gave this session's plan away
  | { type: 'dismissed' };
export interface MainStage {
  id: StageId;
  order: number;                // stage order: idle 0, primer 10, feature 20, planReady 30, make 40, review 50, closed 60
  // The stage this signal moves the flow to, or null to leave the decision to the next stage. Pure.
  // `flow` is the flow after the fold's bookkeeping for this signal (see foldFlow).
  enter(flow: SessionFlow, signal: WorkflowSignal): StageId | null;
  // The main-side command the auto-start runs when a flow enters this stage while autoClearAndMake is on.
  // Plan ready sets 'clearAndMake'; main never names the stage.
  autoCommand?: string;
  // True for a stage that starts a new plan (primer, feature): entering it clears planDir and progress.
  clearsPlan?: boolean;
}
// A flow is busy while a turn runs or a main-agent subagent runs (wigley:make and wigley:feature dispatch in the
// background, and their results arrive in turns with no user message).
export function isBusy(flow: SessionFlow): boolean;
export interface StageActionSpec {
  command: string;              // the workflow command id it runs, without the 'workflow.' prefix: 'clearAndMake'
  label: string;                // the button's text: 'Clear & make'
  side: 'page' | 'main';        // 'page': the page runs it (startFeature, openPlan); 'main': through runAction
  // Whether the action shows for this flow, beyond the stage match: Resume make shows only with open boxes.
  available(flow: SessionFlow): boolean;
  // Whether the shown action can run now: Clear & make, Resume make and Retro are drawn disabled while isBusy.
  enabled(flow: SessionFlow): boolean;
}
export interface PageStage {
  id: StageId;
  label: string;                // the stepper's and the chip's word: 'Plan ready'
  inStepper: boolean;           // idle is false
  order: number;                // equal to the main half's order (page-stages.test.ts pins it); the stepper sorts on it
  // Actions in order, the main action first. `ww` and the chip's button run the first available one; when that one
  // is disabled, they run nothing and log `nothing to run`.
  actions: readonly StageActionSpec[];
  // The chip's and the strip's detail text: '3/7 · wave 2'; '' for none.
  detail(flow: SessionFlow): string;
}
export interface WorkflowMainExports { addStage(stage: MainStage): Disposable; }
export interface WorkflowPageExports { addStage(stage: PageStage): Disposable; }
export interface WorkflowActionRequest { sessionId: string; command: string }
// Main pushes `flows` (every flow, on start and on each change); the page invokes runAction and flows().
export interface WorkflowChannel extends ChannelShape {
  invoke: { flows(): Promise<SessionFlow[]>; runAction(request: WorkflowActionRequest): Promise<void> };
  messages: { flows: SessionFlow[] };
}

// src/plugins/workflow/stages/index.ts  (07)
export const BUILT_IN_MAIN_STAGES: readonly MainStage[];   // each stage file exports <name>MainStage
export const BUILT_IN_PAGE_STAGES: readonly PageStage[];   // and <name>PageStage; <name> is idle, primer, feature,
export const WORKFLOW_COMMANDS;                            // planReady, make, review or closed. `as const`

// src/plugins/workflow/main/flow-store.ts  (08)
export function createFlowStore(deps: { files: Files; log: Log; paths: Paths }): FlowStore;
// FlowStore keeps flows.json keyed by host session id (row ids are fresh on each launch), and has
  resetFlows(projectDir: string): void;   // every open flow in that folder becomes a new idle flow; one write
  hostIdOf(sessionId: string): string | null;

// src/plugins/workflow/main/agent-signals.ts  (08) — a list, so a current-host sessionEnded gives one
// subagentFinished per running id, then turnEnded
export function signalOf(event: ChatAgentEvent, flow: SessionFlow, fromCurrentHost: boolean): WorkflowSignal[];
// Main logs `[workflow] settings: autoClearAndMake <on|off>, autoStartSeconds <n>` on each settings change (10 waits on it).

// src/plugins/workflow/main/start.ts  (08) — built only in a self-test run, handed to selftest-script.ts (10)
export interface WorkflowSelfTestHooks {
  resetFlows(projectDir: string): void;                                   // also stops countdowns and watches
  onMainTurnEnded(listener: (sessionId: string) => void): Disposable;     // after each main-agent turnEnded applies
}

// src/plugins/workflow/flow.ts  (03)
export function foldFlow(flow: SessionFlow, signal: WorkflowSignal, stages: readonly MainStage[]): SessionFlow;
export function newFlow(sessionId: string, projectDir: string): SessionFlow;
export function isPlanFile(path: string): boolean;      // a path ending in /plan-<name>/plan.md, either separator
export function planDirOf(path: string): string;        // the folder that holds that plan.md

// src/plugins/chat/contract.ts  (06)
// ChatMainExports gains:
  send(sessionId: string, message: UserMessage): Promise<void>;  // as the composer's send; rejects for a session chat does not own
  clear(sessionId: string): Promise<void>;                       // the clear-command plan's clear; resolves once the new process started
// The composer kit gains `contributedParts`, the slot above the box where composer parts draw.
// ChatPageExports gains:
  fillComposer(sessionId: string, text: string): void;           // replaces the draft, selects the Chat tab, focuses the box in insert mode at the end
  addComposerPart(part: ChatComposerPart): Disposable;
export interface ChatComposerPart { id: string; build(parent: HTMLElement, sessionId: string): { dispose?(): void } }
export const CHAT_PREVIEW_HOST_ID = 'chat-layout-preview';      // moved from main/preview/preview-session.ts
```

### Files

New, all under `src/plugins/workflow/`:

- `manifest.ts`, `contract.ts`, `flow.ts`, `flow.test.ts`, `plan-reader.ts`, `plan-reader.test.ts`
- `stages/<idle|primer|feature|plan-ready|make|review|closed>/main.ts`, `page.ts`, `main.test.ts`;
  `stages/page-stages.test.ts`
- `stages/index.ts` — the built-in stages, main halves and page halves, in stage order, with their commands
- `main/start.ts`, `main/flow-store.ts`, `main/plan-watch.ts`, `main/actions.ts`, `main/countdown.ts`,
  `main/agent-signals.ts`, `main/selftest-script.ts`, with a test beside each main module
- `page/start.ts`, `page/workflow-view.ts`, `page/flow-tab.ts`, `page/preview.ts`, `page/countdown.ts`, `page/workflow.css`,
  `page/layout/workflow-parts.ts`, `page/layout/workflow-kit.ts`, `page/layout/read-workflow-layout.ts`
- `layouts/layout.d.ts`, `layouts/default/layout.js`

New outside the plugin: `src/shared/typed-skill.ts` (01), `src/shared/page/contributed-parts.ts` (06).

Modified: `src/contracts/agent.ts`, the Claude adapter's decoder and harness files, `src/shared/fake-agent-harness.ts`
and every test that calls it, `src/main/main.ts`, `src/plugins/agents/roster.ts`, chat's `contract.ts`, main and page
start files, `chat/main/preview/*` and composer layout files, the sessions page files the part-store move touches,
`src/plugins/manifests.ts`, `main.ts`, `page.ts`, `keymap.ts`, `scripts/check-layers.mts`. Each task's Files line
is the full list.

Boundary rules:

- `workflow/` imports `src/contracts`, `src/shared`, its own folder, and the `contract.ts` of `chat`, `sessions`,
  `docs` and `keys` (its manifest's `dependsOn`).
- `flow.ts`, `plan-reader.ts` and each stage's `main.ts` are pure: no I/O, no clock, no DOM.
- No module outside `stages/` names a stage id except `IDLE_STAGE`. One exception: `page/preview.ts` names the
  built-in ids in its sample data.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the task document in
> the same change. The run is done when every box is ticked.

### Wave 1

- [x] [01 — Agent event members](01-agent-event-members.md)
- [x] [02 — Plan reader](02-plan-reader.md)
- [x] [03 — Workflow contract and fold](03-workflow-contract-and-fold.md)
- [x] [06 — Chat exports](06-chat-exports.md)

### Wave 2

- [x] [04 — Claude agent events](04-claude-agent-events.md) · after 01
- [ ] [05 — Fake agent events](05-fake-agent-events.md) · after 01
- [x] [07 — Stage modules](07-stage-modules.md) · after 02, 03

### Wave 3

- [ ] [08 — Workflow main](08-workflow-main.md) · after 01, 03, 06, 07

### Wave 4

- [ ] [09 — Workflow page](09-workflow-page.md) · after 06, 08

### Wave 5

- [ ] [10 — Workflow self-test](10-workflow-selftest.md) · after 05, 09

### Wave 6

- [ ] [11 — Doc re-read](11-doc-re-read.md) · after 01–10

### Wave 7

- [ ] [12 — Final verification](12-final-verification.md) · after 11

## Run log

Review base: c95c7eb

### Groups
- 01 · 441b6eb · diff read: all four AgentEvent members and typedSkill present as Produces; roster fold exhaustive; typecheck clean outside in-flight 06; worker ran roster and typed-skill tests (28 pass) · concerns: plan.md Architecture says three new members, four landed (turnStarted) — for task 11's doc re-read
- 02 · ed6174a · diff read: PlanProgress, PlanTaskLine, readPlanProgress word for word; typecheck clean for the file; plan-reader tests pass · concerns: none (lint could not reach the file past 06's in-flight layer error; oxlint/oxfmt run directly passed)
- 03 · f459b85 · diff read: every contract.ts export and foldFlow/newFlow/isPlanFile/planDirOf present as Produces; typecheck clean for the files; workflow tests 55 pass · concerns: check-layers has no workflow layer rules yet (08 adds them); clearsPlan read from the stage whose id won, not the stage whose rule answered
- 04 · 59d441c · diff read: decoder emits skillStarted (Skill), fileWritten (ok write results), turnStarted (init), turnEnded (result); harness emits typed skillStarted; typecheck clean; claude-code tests 247 pass · concerns: the write-left-open-at-agent-end row cannot fail on a leaked writePaths entry (only a memory leak, unobservable)
- 07 · 6456472 · diff read: seven stage halves, BUILT_IN_MAIN_STAGES/BUILT_IN_PAGE_STAGES/WORKFLOW_COMMANDS present; typecheck and lint clean; workflow tests 122 pass · concerns: stage folders name other stages' ids as string literals (idle checks 'closed', review and closed check 'make'); a rename edits them too
- 06 · bbdee57 · diff read: send, clear, fillComposer, addComposerPart, ChatComposerPart, CHAT_PREVIEW_HOST_ID, composer contributedParts slot, shared contributed-parts present; typecheck and lint clean; chat/sessions/shared tests 1751 pass · concerns: sessions-parts.test.ts and chat layout.test.ts changed beyond the Files line (imports and one slot-order assertion); forms keeps its own part store (src/plugins/forms/page/contributions.ts), a candidate to move onto the shared helper
### Contract changes
- placeContributedParts(..., rollback): RollbackDeps → PartRollback { recordBox(destroy) } (new export; RollbackDeps assignable) · why: check-layers refuses src/shared/page importing layout-host · consumers: 09 · group 06
### Rulings
- 03 stays in wave 1 beside 02 although it consumes PlanProgress — the consumption is a type import the plan writes against plan.md's line, and the compile proves it once both land — a mismatch costs one re-dispatch of 03 · lead
- origin fetch failed (the 1Password SSH agent is unreachable from this session); the run builds on local main at c95c7eb, even with the last-fetched origin/main — a newer origin commit would need a merge before push · lead
- typedSkill splits on \S (any Unicode whitespace), wider than the brief's space/tab/newline — no real skill name holds other whitespace — a skill name with a non-breaking space would split · group 01 · group 01
- ## Run log and ### Review rounds match with trailing whitespace ignored, like ## Tasks — one heading rule — a heading with trailing spaces counts · group 02 · group 02
- a non-wave ### heading under ## Tasks ends the current wave (later boxes wave null), per the Decisions' level-1-to-3 rule — such boxes drop out of the wave pick · group 02 · group 02
- foldFlow reads clearsPlan from the stage whose id is the winning answer, as plan.md says — differs only if one stage's rule returns another stage's id · group 03 · group 03
- a sent control command (CONTROL_COMMAND match) gives no skillStarted; only other /-messages do — a control command never starts a workflow stage · group 04 · group 04
- stage folders do not import each other; a rule naming another stage writes its id literal — a stage rename must edit those literals · group 07 · group 07
- an absent contributedParts call in a custom composer layout prepends the parts holder to the composer root · group 06 · group 06
### Review rounds
### Test gate
