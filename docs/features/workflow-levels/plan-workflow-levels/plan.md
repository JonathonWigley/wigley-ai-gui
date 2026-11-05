# Workflow levels — plan

Feature: Workflow levels · Implements: none · Ticket: none
Target: `main` of wigley-ai-gui, wigley-ai-marketplace and wigley-agents, through the `workflow-levels` branches · Written: 2026-11-04

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every session runs one of three workflows: Light, Medium or Heavy. The agent picks the level from `~/wigley-agents/workflows.md`. The app shows the level as an L, M or H badge on the session row, and shows that workflow's trail and checklist. Each workflow is one app plugin with its own stages and layout, so a new workflow needs no engine edit. Heavy behaves exactly as it does today.

## Architecture

Systems touched:

- wigley-ai-gui: the `workflow` plugin becomes an engine. New plugins `workflow-heavy`, `workflow-light` and `workflow-medium`.
- wigley-ai-marketplace: skills `light` and `medium` (written ahead); a version bump at landing. The relay does not change.
- wigley-agents: `workflows.md` and `AGENTS.md` (written ahead); new tool `tools/workflow-gate/`.
- This machine: hook wiring in `~/.claude/settings.json` (`~/.claude-personal/settings.json` is a symlink to it, so one real file) and `~/.agents/AGENTS.local.md`.

## Preconditions

Run from `~/Documents/ai-dev`. wigley:make re-runs each one before the first dispatch.

1. The peer's trail work is on `main`, verified at plan time:
   - `git -C wigley-ai-gui merge-base --is-ancestor abe4d1d6 main`
   - `git -C wigley-ai-marketplace merge-base --is-ancestor 9872886 main`
2. Each `workflow-levels` branch holds only the docs written ahead, on `main`. Rebase when `main` moved.
3. The tool exists: `grep -n "SET_WORKFLOW_STEP_TOOL = " wigley-ai-gui/src/plugins/workflow/main/step-tool.ts`
4. The user has no workflow setting, keymap entry or layout to move, checked at plan time, re-verify:
   - `grep -c workflow ~/.config/wigley-ai-gui/settings.json` prints 0
   - `grep -c workflow ~/.config/wigley-ai-gui/keymap.json` prints 0, or the file is missing
   - `ls ~/.config/wigley-ai-gui/layouts/workflow` lists only `layout.d.ts`

## Docs written ahead

Each is a hypothesis until task 11 re-reads it against the landed code.

- wigley-agents, branch `workflow-levels`, commit ee97ed1: `workflows.md`, `AGENTS.md`
- wigley-ai-marketplace, branch `workflow-levels`, commit c8e7abb: `plugins/wigley/skills/light/SKILL.md`, `plugins/wigley/skills/medium/SKILL.md`, the `description` of `plugins/wigley/skills/feature/SKILL.md`
- wigley-ai-gui, branch `workflow-levels`, commit b89c4299: `docs/features/workflow-levels/design.md`

## Mandatory Reads

- `wigley-ai-gui/AGENTS.md`: every implementer reads Intent, and the Architecture entries for a plugin, a registration, a session part, a composer part, a side part, a row activity, a key, an event, a setting, a theme, plugin data, a layout, an MCP tool, and the layer checks. Task 05 also reads Running and testing.
- `wigley-ai-gui/DESIGN.md`: every task that draws.
- `wigley-ai-gui/docs/keymap.md`: task 05.
- `wigley-ai-gui/docs/features/workflow/design.md` and `docs/features/workflow-levels/design.md`
- `wigley-ai-marketplace/AGENTS.md` and `~/wigley-agents/AgentsStandardMapping.md` § Tools: task 09.

## Design Overview

```
session ── reads workflows.md ── loads a level skill
                                    │  skillStarted
                                    ▼
workflow (engine)  claims → flow.workflow, flow.stage = firstStage
   │  folds only that workflow's stage rules        ◄── set_workflow_step
   │  flow.checklist                                ◄── set_workflow_checklist
   │  a stage with `finishes` entered → one line in runs.jsonl
   ├─ workflow-light    Scope › Build › Check › Land
   ├─ workflow-medium   Interview › Build › Review › Fix › Land
   └─ workflow-heavy    Primer/Explore › Interview › Plan › Cold read › Make › Review › Fix › Close
   draws: row badge + stage text · composer trail · side pane checklist · No workflow tag
```

Decisions:

- The level comes only from the skill that started. A workflow claims skills: Light `wigley:light`; Medium `wigley:medium`; Heavy `wigley:feature`, `wigley:feature-primer`, `wigley:make`. `wigley:review` and every other skill claim nothing, so they run inside the level.
- A claim by a different workflow than the flow's current one sets `movedUpFrom` to the current one. The engine does not check that the move is upward: moving down happens on the user's word, by the same skill load.
- Only the flow's current workflow folds its stage rules. Two workflows may hold a stage with one id or one `reportedAs`.
- Heavy's skills do not change and Heavy never calls `set_workflow_checklist`. Heavy's checklist comes from `plan.md`.
- Each workflow plugin owns a layout folder (`layouts/workflow-light/<name>/`) over one contract and one kit that the engine exports.
- The engine holds no plan, wave, countdown or Clear & make concept. They move to `workflow-heavy`. The stage actions become commands the owner plugin declares, which closes the follow-up "Workflow stage actions as commands".
- A flow shape change has no migration (`wigley-ai-gui/AGENTS.md` § Intent): an old `flows.json` fails validation and the app starts with no flows.
- Only a session the app starts gets the note that names the tools.
- A standalone `wigley:explore` or `wigley:review` shows its level and trail through the level skill. This replaces the workflow-trail work's rule that standalone runs show nothing.
- The edit gate is a Claude Code `PreToolUse` command hook on `Edit|Write|NotebookEdit`. It reads the session transcript for a level skill. A subagent's call passes.

Accepted changes to Heavy, each visible once or never: the H badge; a Plan section the user collapsed opens once, because its part id changes; an in-flight run loses its flow once, because `flows.json` changes shape; a `plan.md` written before any level skill names no plan.

Out of scope: any change to `wigley:feature` or `wigley:make` steps, a screen for the run log, Codex's adapter, a runtime plugin loader, a Stop hook that runs tests.

## File Structure

Paths are under `wigley-ai-gui/src/plugins/` unless named.

New plugins, each with `manifest.ts`, `contract.ts`, `main/start.ts`, `page/start.ts`, `layouts/default/layout.js`, `layouts/default/layout.css`, `layouts/layout.d.ts` as needed, joining `manifests.ts`, `main.ts` and `page.ts`:

- `workflow-heavy/`: takes `workflow/stages/*`, `workflow/plan-reader.ts`, `workflow/main/plan-watch.ts`, `workflow/main/actions.ts`, `workflow/main/countdown.ts`, `workflow/page/countdown.ts`, and the current default layout
- `workflow-light/`: `stages/{scope,build,check,land,done}/`
- `workflow-medium/`: `stages/{interview,build,review,fix,land,done}/`

Boundary rules: a workflow plugin imports only `src/contracts`, `src/shared`, its own folder, `workflow/contract.ts`, and the contract of a plugin in its `dependsOn` (Heavy: `chat`, `sessions`, `docs`). The engine imports no workflow plugin. `dependsOn` for each workflow plugin names `workflow` in both processes.

Shared names, pinned here. Every part uses these words exactly. `workflow/contract.ts`:

```ts
export type WorkflowId = string;
export interface ChecklistItem { text: string; done: boolean }

export interface SessionFlow {
  sessionId: string;
  projectDir: string;
  workflow: WorkflowId | null;       // null until a workflow claims a skill
  movedUpFrom: WorkflowId | null;
  stage: StageId;
  checklist: readonly ChecklistItem[] | null;  // from set_workflow_checklist
  state: unknown;                    // the current workflow's own; null on a new claim
  missedLevel: boolean;              // a live turn ended with workflow === null
  turnRunning: boolean;
  runningSubagents: readonly string[];
}

// signal added: { type: 'checklistReported'; items: readonly ChecklistItem[] }

export interface MainWorkflow {
  id: WorkflowId;
  order: number;                     // light 10, medium 20, heavy 30
  claims(signal: WorkflowSignal): boolean;
  firstStage: StageId;
  stages: readonly MainStage[];
  // Heavy's bookkeeping; returns the new state, or `flow.state` for no change.
  foldState?(flow: SessionFlow, signal: WorkflowSignal): unknown;
  // Compares states for sameFlow. Left out: by reference.
  sameState?(a: unknown, b: unknown): boolean;
  // Review fix cycles for the run log. Left out: 0.
  fixCycles?(flow: SessionFlow): number;
}

// signal added: { type: 'custom'; event: unknown }. planChanged, planGone, handedOff, dismissed leave the union.
export type SignalOrigin = 'live' | 'replay' | 'observed';
export interface FoldEvent { sessionId: string; before: SessionFlow; after: SessionFlow; signal: WorkflowSignal; origin: SignalOrigin; whole: boolean }
export interface WorkflowObserver {
  folded(event: FoldEvent): void;
  opened(flow: SessionFlow): void;
  closed(sessionId: string): void;
  replaying(sessionId: string): void;
}

export interface WorkflowMainExports {
  addWorkflow(workflow: MainWorkflow): Disposable;
  ready: Promise<void>;
  signal(sessionId: string, signal: WorkflowSignal, origin: 'live' | 'observed'): void;
  flowOf(sessionId: string): SessionFlow | null;
  flows(): readonly SessionFlow[];
  setState(sessionId: string, state: unknown): void;  // no fold; keeps savedAt
  observe(observer: WorkflowObserver): Disposable;
  layoutTypes: string;
  selfTestHooks: WorkflowSelfTestHooks | null;
}

export interface ChecklistGroup { title: string; items: readonly ChecklistItem[] }
export interface ChecklistView { title: string; checked: number; total: number; groups: readonly ChecklistGroup[] }

export interface PageWorkflow {
  id: WorkflowId;
  label: string;                     // 'Light'
  badge: string;                     // 'L'
  stages: readonly PageStage[];
  draw: WorkflowDraw;                // from createWorkflowDraw
  // Left out: one group built from flow.checklist; null when that is null.
  checklist?(flow: SessionFlow): ChecklistView | null;
  runAction(sessionId: string, command: string, flow: SessionFlow): Promise<void>;
  countdownText?(flow: SessionFlow, now: number): string | null;
  progressText?(flow: SessionFlow): string | null;
  hasPlan?(flow: SessionFlow): boolean;   // left out: checklist(flow) !== null
  previewFlows?(sessionId: string, now: number): readonly SessionFlow[];
}

export type PagePluginApi = Pick<PageApi<PluginManifest, ChannelShape>, 'layouts'>;
export interface WorkflowDrawOptions {
  manifest: Pick<PluginManifest, 'id' | 'commands'>;
  defaultLayout: CompleteLayout;
  defaultStylesheet: string;
  userLayout(): string;
  sideTitle: string;
}

export interface WorkflowPageExports {
  addWorkflow(workflow: PageWorkflow): Disposable;
  createWorkflowDraw(api: PagePluginApi, options: WorkflowDrawOptions): WorkflowDraw;
  runCommand(sessionId: string, command: string): Promise<void>;
}
```

- `MainStage` gains `finishes?: boolean`: entering the stage writes one run log line. Heavy `closed`, Light and Medium `done`.
- `addStage` is removed from both exports. `MainStage` loses `autoCommand`, `clearsPlan` and `recordsReviewRounds` (`HeavyMainStage` holds them). `StageActionSpec` loses `side`, and `command` is the owner's short id. `WorkflowSelfTestHooks` moves to the contract.
- Layout input names in `workflow/layouts/layout.d.ts`: `ChipInput.badge`, `ChipInput.workflowLabel`, `StripInput.hasChecklist`, `SidePaneInput.checklistTitle`, `finishedGroups`, `currentGroup`, `laterGroups`, `SideGroupInput`, `SideItemInput`, `WorkflowKit.badge`. Each workflow has one side part, `<workflow.id>.sidePane`.
- `WorkflowSelfTestHooks` gains `callChecklistTool(sessionId, items)` (07). Drive actions `workflow.reportStep` and `workflow.reportChecklist`, each returning `{ accepted: boolean }`, live in `workflow/main/drive-actions.ts`. View log lines: `<name> level <badge>`, `<name> trail <labels>`, `<name> no workflow`. A flow with no `PageWorkflow` still logs `<name> shows idle`.
- `sideTitle` is `Plan` for Heavy and `Checklist` for Light and Medium. Light's and Medium's `runAction` reject with `Light has no actions` and `Medium has no actions`. Each has `LIGHT_WORKFLOW_ID` or `MEDIUM_WORKFLOW_ID` in its contract; Medium adds `MediumState`, `mediumStateOf`, `foldMediumState`, `mediumFixCycles`.
- `workflow-heavy/contract.ts` holds `HEAVY_WORKFLOW_ID`, `HeavyState`, `heavyStateOf`, `withHeavyState`, `HeavyEvent`, `heavySignal`, `heavyEventOf`, `HeavyMainStage`.
- Step words and `reportedAs` values are the values in the skills: Light `build`, `check`, `land`, `done`; Medium `build`, `review`, `fix`, `land`, `done`. Each `done` stage shares its `stepSlot` with `land`, so the trail still reads `Land`.
- Tool `set_workflow_checklist`, argument `items`: an array of `{ text: string, done: boolean }`. The tool name constant is `SET_WORKFLOW_CHECKLIST_TOOL` in `workflow/main/checklist-tool.ts`.
- Run log: `runs.jsonl` in the `workflow` plugin data. One JSON object per line, with the keys `at`, `sessionId`, `projectDir`, `workflow`, `movedUpFrom`, `activeMs`, `costUsd`, `fixCycles`. `workflow` is the id, and `costUsd` is spend through the last finished turn.
- Theme tokens: `workflow-light.badge` default `var(--wg-status-info)`; `workflow-medium.badge` default `var(--wg-accent)`; `workflow-heavy.badge` default `var(--wg-status-warning)`.
- Row words: the tag `No workflow` draws with `--wg-status-error`.
- Commands: `workflow.mainAction`, `workflow.toggleSidePane`, `workflow.toggleFinishedWaves` and `workflow.openPreview` stay in the engine. `clearAndMake`, `cancelCountdown`, `makeInNewSession`, `resumeMake`, `openPlan`, `retro` and `dismiss` move to `workflow-heavy.<name>`. Their keys do not change.
- Settings: `workflow.autoClearAndMake` and `workflow.autoStartSeconds` move to `workflow-heavy`. Each workflow plugin has its own `layout` setting.

wigley-agents: `tools/workflow-gate/workflow-gate`, `tools/workflow-gate/README.md`, `tools/workflow-gate/tests/`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Engine: workflows in main](01-engine-main.md)
- [x] [Edit gate hook](09-edit-gate.md)

### Wave 2
- [x] [Engine: workflows on the page](02-engine-page.md) — after 01

### Wave 3
- [x] [Checklist tool, scoped step tool, session note](03-workflow-tools.md) — after 01

### Wave 4
- [x] [Run log](04-run-log.md) — after 03

### Wave 5
- [x] [workflow-heavy](05-workflow-heavy.md) — after 02, 04

### Wave 6
- [x] [workflow-light](07-light.md) — after 05

### Wave 7
- [x] [workflow-medium](08-medium.md) — after 07

### Wave 8
- [x] [Project docs and follow-ups](10-project-docs.md) — after 08, 09

### Wave 9
- [x] [Doc re-read](11-doc-re-read.md) — after 10

### Wave 10
- [ ] [Final verification and landing](12-final-verification.md) — after 11

## Run log

Review base: 52a66bfab67b0c27b09dee28ff4ecfb97ef320ce

### Groups
- 09 · wigley-agents 70a4e4e · diff read against the spec; Produces all present (hook, install, level_skill_started, LEVEL_SKILLS, README); 14 unittest tests pass · concerns: argparse exits 2 on a hand-mistyped wired command; write_settings near-copies unity-pool's; /resume unchecked; Windows stop untested; tests go past the spec's tables
- 01 · a5b319c0 · diff read against the spec; every Produces present; typecheck and lint clean · concerns: TurnWork.worked survives cleared, so a sessionEnded right after a clear on a null workflow re-marks missedLevel; private isRecord copies in heavy-contract; check-layers still allows contract to import plan-reader; step-tool enum may repeat a value until task 03; a self-test hello turn sets missedLevel until the skill claims
- 02 · e20d8bbd · diff read against the spec; every Produces present; the spec's grep prints nothing; typecheck and lint clean · concerns: No workflow tag draws outside any layout (spec's decision) and will show on the self-test's hello session; --wg-workflow-badge has no DESIGN.md entry; AGENTS.md still names addStage until task 10; logFlow does not re-run on addWorkflow; no-page once-sets never clear; start.ts SessionCommand still names Heavy's commands
- 03 · f205596a · diff read against the spec; every Produces present, parseChecklistItems included; typecheck and lint clean · concerns: checklist dispose line has no failing test; reportStep scoping has no start-level test that fails on a union lookup; merged table lost the ignored-step no-push assertion; StepTool_NotInTheUnion_ListsIt pins Heavy's step order, so task 05 reaches it; whitespace-only text accepted
- 04 · 76979d31 · diff read against the spec; every Produces present; typecheck and lint clean · concerns: activeMsOf copies every held session per agent event through chat.sessions(); a read in the clear window can log a negative activeMs; costUsd is 0 not null when the only spend predates the run; meter note after forget leaves one small entry
- 05 · 6dd57b21 · diff read against the spec; § Finish's greps and file-gone checks hold; manifest, page part and layer rules read; typecheck and lint clean; a read of settings.json at preflight found no workflow setting to move · concerns: engine still registers layout types with no default folder, writing layouts/workflow/layout.d.ts; no set_workflow_step is contributed until a workflow with reportedAs is added; self-test not run until task 12, hello turn may draw No workflow in a pre-claim screenshot; page harness keys.command answers only the part's own commands; drive-commands.test.ts still names workflow.autoStartSeconds as a generic path; docs/features/layouts/design.md names the old owner, task 10's
- 07 · b2d36d46 · Diff read; typecheck 0, lint 0; every Produces present by search of the named files; worker's touched tests pass · concerns: Self-test never run (task 12); callChecklistTool and Light's main part have no unit test; toggleFinishedWaves on an all-done flat list logs and changes nothing; empty checklist draws 0/0 pane; Heavy layout.css bare selectors land on Light's parts; logFlow logs no page stage ahead of shows and Heavy's Explore/Primer slot logs a second trail line; DESIGN.md left to task 10; drive-actions.test fakes copy start.test's
- 08 · 4c82e48d · Diff read; typecheck 0, lint 0; every Produces present by search of the named files; registered in manifests, main, page; worker's touched tests pass (6 files, 60) · concerns: checklistCount duplicated in Light and Medium, workflow/contract.ts the natural home; layout and self-test near-verbatim copies of Light's; main part and callChecklistTool path have no unit test; cleared keeps the cycle count; second /wigley:medium keeps the old checklist while the count resets; self-test first runs in task 12
- 10 · 4d1a706d · Diff read; six pinned greps print 0,1,0,0,0,5; lint clean; ~/.agents/AGENTS.local.md edited, uncommitted by rule; ~/.claude-personal/settings.json is a symlink · concerns: docs/features/chat-bar/design.md:108 describes the Plan section as the workflow plugin's side pane (handed to task 11); AGENTS.local.md workflow-gate lines are ahead of the machine until task 12
- 11 · f8ebad9e, marketplace c489a32 · Diffs read; three pinned greps hold; check_pointers passes. Verdicts: workflows.md no change; wigley-agents AGENTS.md no change; light/SKILL.md Reporting and answer-only line fixed; medium/SKILL.md Reporting fixed; feature/SKILL.md description no change; workflow-levels/design.md Decisions and How the app learns fixed; chat-bar/design.md hub lines fixed, beyond Files by the lead · concerns: workflows.md's Heavy row leaves out wigley:feature-primer, which Heavy also claims; the gate's subagent pass and README not checked beyond LEVEL_SKILLS
### Contract changes
- heavy-contract.ts members: as planned → adds heavyStateIn(state: unknown): HeavyState, with heavyStateOf calling it · why: sameHeavyState takes bare states · consumers: 05 · group 01
- RunMeter: five members → six, adding claimed(sessionId), which sets the baseline as finished does · why: the baseline resets at a null-to-claim move and the interface had no member for it · consumers: none outside workflow/main/start.ts · group 04
### Rulings
- A settings file of the wrong shape stops install with exit 1, as a parse failure does — merging into it would traceback — such a file blocks install until fixed · group 09 · group 09
- A transcript line that parses but is not a pinned shape counts as no match, not a hook failure — one odd line should not disable the gate — a Claude Code shape change denies rather than fails open · group 09 · group 09
- An OSError between install's writes exits 1, and a second run finishes — stops are planned, a disk failure is not — a link with some profiles unwired until rerun · group 09 · group 09
- Review bases per repo: wigley-ai-gui 52a66bfa, wigley-agents ee97ed1, wigley-ai-marketplace c8e7abb — the plan spans three repos and plan.py holds one base — review ranges name each · lead
- checklistReported runs in its own fold step, not applyBookkeeping — Fold order is pinned and needs a checklist on a null workflow to change nothing — one call moves · group 01 · group 01
- The runtime's opened is guarded to Heavy flows, plan watch included — heavyStateOf ignores flow.workflow — nothing visible · group 01 · group 01
- closed fires before store.drop on sessions.ended and after the store forgot on forgetFlows — the store returns ids only then — an observer reading the flow in closed sees null on the self-test path · group 01 · group 01
- turnWork.note runs only for a session the store holds — turns never gains an orphan entry — work before chat.sessionOpened does not count toward missedLevel · group 01 · group 01
- check-layers lets the stages sublayer import page, beyond the spec — heavy-page-workflow.ts needs page/countdown and page/preview — task 05 must remove the entry or stage code imports page code unchecked · group 02 · group 02
- Heavy's api.layouts.show runs at addWorkflow time, ahead of the channel wiring — the draw must exist before the add — a layout delivered during show redraws with no flows held, harmless · group 02 · group 02
- A preview press with no samples closes at once, logging workflow preview closed — the spec names only the fifth-press close — Space z l w with no samples shows nothing · group 02 · group 02
- page/layout/workflow-parts.ts is deleted — nothing remained, which the spec allowed — a later task must import workflow-draw.ts · group 02 · group 02
- parseChecklistItems reuses flow-store's isChecklistItem, exported — widen rather than copy, though flow-store was not in the Files — a change to the saved-flow check moves the tool's check · group 03 · group 03
- stepTool_ReportIsIgnored merged into StepTool_ScopedToTheFlowsWorkflow — its rows repeated the new table's — a report that pushed anyway would not be caught there · group 03 · group 03
- runMeter.note sits inside the listener's ready.then — cleared does too, so they stay in event order — the clock samples a microtask late, which keep-the-largest absorbs · group 04 · group 04
- claimed runs in apply on a null-to-claim move — the one place a full fold lands — a replay past the save holding the first claim also resets the baseline · group 04 · group 04
- costUsd is 0, not null, for a later run with no new spend or a first run whose only spend predates the claim — the spec's null rule reads since the last forget — such a line reads as free, not unknown · group 04 · group 04
- AGENTS.md's line on chat's exports to workflow names activeTime — the edit outdated it — none · group 04 · group 04
- Moved tests that run rules through flow.ts take whole-file layer rules — the spec's layer rule did not foresee them, and AGENTS.md documents the pattern — only test layer rules move · group 05 · group 05
- Real engine plus real Heavy in two harnesses, with the engine's exports as a fakeDependency — the harness refuses fakes outside dependsOn — each harness has its own clock · group 05 · group 05
- opened's body runs for the start walk of workflow.flows(), so a restart also clears a saved countdown — the spec says run the opened body — none · group 05 · group 05
- Engine prose takes neutral examples, while pinned names (hasPlan, toggleFinishedWaves, countdownText, the finished-waves log line) stay — they are plan.md's names — a strict no-plan-word grep hits them · group 05 · group 05
- 07: Light self-test uses services.paths.join, not node:path; 08 copies · group 07
- 07: Light's turn-end listener acts only for the session it launched; 08 must copy · group 07
- 07: width start sits on the last pinned step, so light-done is captured at start width; task 12 reads it · group 07
- 07: Light's side pane is one flat list with a count line, per Pinned after the cold read · group 07
- 07: checklistCount lives once in stages/build/page.ts; 08 copies the shape · group 07
- 07: new workflow/page/engine-parts.test-support.ts holds startEnginePagePart and testWorkflowKit · group 07
- 08: medium-done captured at start width, as light-done; task 12 reads it · group 08
- 08: foldFlow_MediumRules holds only the twelve pinned rows, so a turnEnded that moves a Medium stage would not turn red · group 08
- 10: the $name_ follow-up had no such titles in workflow-view.test.ts or the workflow layout.test.ts, so it drops those sites and reads Four sites · group 10
- 10: set_workflow_step doc says step takes the union of every workflow's reportedAs and the current workflow's rules answer, as step-tool.ts builds it, not the spec's 'the current workflow's reportedAs' · group 10
- 11: chat-bar/design.md fixed beyond the task's Files, since task 10 found it stale and the user's rule keeps docs true · group 11
- Task 12's two parts split around steps 4 and 5: its live checks run now, the test gate and review follow, and its Landing order runs after the review verdict — landing first would push unreviewed code to main, and the live checks' fixes then fall inside the review — the box stays open until landing · lead
- Live checks: S1, S2, D1 to D10 and R1 pass; S2's pinned command, the bare .ui-tag--error selector, D3 and D8's width, D9's Escape and R1's log prefix are spec slips, actual results recorded in task 12's Proof; L1 sets chat.profiles to the real config path as R1 did · group 12
- A long stage word ellipsizes on the row (Interview · pa…) rather than clipping the cache icon — other fixes move other plugins' alignment and the strip still shows the whole word — the user may prefer whole words · group 12
### Review rounds
### Test gate
