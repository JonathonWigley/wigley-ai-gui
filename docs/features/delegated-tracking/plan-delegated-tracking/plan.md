# Delegated tracking — plan

Feature: delegated tracking · Implements: none · Ticket: none
Target: main · Written: 2026-11-08

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user delegates most work to subagents and background tasks, often in git worktrees. The app's existing tracking
must stay correct when the work is delegated. The plan adds no new view, record or tab. When the plan is done:

- Heavy's plan checklist and count, and Backlog's plan counts, read the plan's newest copy across the clone and its
  git worktrees. A task whose task document reads `Status: in progress` shows as running.
- A subagent's call of `set_workflow_step`, `set_workflow_checklist` or `set_session_title` succeeds and changes
  nothing. Only the main agent's calls move the session's step, checklist and title.
- A session shows as busy while a subagent at any depth runs.
- The session's Worktrees fact also lists a worktree that an agent touched only through Bash.
- A subagent's text and thinking stay out of the main transcript. A background subagent's strip box stays while a task
  it owns runs, and comes back when a line arrives from a subagent that already ended.

The source of the ask: the command-consumers plan showed 0/11 from the main clone's `plan.md` while subagents had ticked
two tasks in `.worktrees/wigley-ai-gui-command-consumers`.

## Architecture

Systems touched:

- `src/shared/` — a new shared plan reader (`plan-progress.ts`, moved from workflow-heavy) and plan-copy finder
  (`plan-copies.ts`).
- `src/contracts/git.ts`, `src/main/git/` — the git adapter lists a clone's worktrees and its common git folder.
- `workflow-heavy` — the plan watch follows every copy and the task documents.
- `workflow` — the checklist item gains a running flag; the busy state counts nested subagents; the two tools are
  contributed as main-agent-only.
- `backlog` — plan counts and task statuses come from the shared reader.
- `sessions` — tool-call guards and main-agent-only contributions; `set_session_title` is main-agent-only.
- `chat` (main) — maps each tool-use id to its agent, registers the guard, and adds worktrees from Bash commands.
- `src/main/claude-code/stream-decoder.ts`, `src/contracts/agent.ts`, `chat` (page) — text and thinking entries carry
  their agent id; the transcript skips a subagent's; a background subagent's end waits for its tasks and a late line
  lists it again.

## Preconditions

Each was verified at plan time on `34a21fb3`. `wigley:make` runs each again before the first dispatch.

| Claim | Command | Expected |
|---|---|---|
| `main` is level with origin | `git -C <clone> fetch -q origin && git -C <clone> rev-list --count main..origin/main` | `0` |
| A subagent's skill start is dropped, and only direct children count as subagents | `grep -n 'MAIN_AGENT_ID' src/plugins/workflow/main/agent-signals.ts` | lines 16 (`event.agentId === MAIN_AGENT_ID`) and 34 (`event.parentAgentId === MAIN_AGENT_ID`) |
| The MCP call carries the tool-use id | `grep -n 'claudecode/toolUseId' src/plugins/sessions/main/mcp/mcp-server.ts` | one hit |
| Sessions has `addCloseGuard` and `contributeTools` | `grep -n 'addCloseGuard\|contributeTools' src/plugins/sessions/contract.ts` | both |
| The plan watch is one non-recursive watch | `grep -n 'recursive: false' src/plugins/workflow-heavy/main/plan-watch.ts` | one hit |
| Text blocks are decoded with no agent id | `grep -n 'decodeTextBlock\|function agentOf\|function finishByNotification' src/main/claude-code/stream-decoder.ts` | all three |
| Backlog counts come from the index meta | `grep -n "metaNumber(entry, 'checked')" src/plugins/backlog/main/homes.ts` | hits |
| Two test fakes implement `Git` | `grep -rln 'isLinkedWorktree:' src --include='*.ts'` | `src/plugins/backlog/main/start.test.ts`, `src/plugins/docs/main/plugin-status.test.ts` (and the adapter) |
| `git worktree list --porcelain` lists the main tree first | `git -C <clone> worktree list --porcelain` | first block is the clone |

## Docs written ahead

Commit `34a21fb3`:

- `docs/features/workflow/design.md`
- `docs/features/workflow-levels/design.md`
- `docs/features/backlog/design.md`
- `docs/features/chat-bar/design.md`
- `docs/features/agent-chat/design.md`
- `docs/features/agent-chat/claude-stream.md`
- `AGENTS.md`
- `docs/features/auto-compact/design.md` (two lines, written at the cold read)

## Mandatory Reads

- `AGENTS.md` § Architecture: the bullets "A plugin", "A registration", "A plugin talks", "A slot", "An event", "A
  session part", "An agent harness", "An agent event", "An MCP tool", "An ambient service", "A path", and the src tree
  entries for each plugin the task touches. § Running and testing for the test and self-test rules.
- The docs written ahead that cover the task's area (each task document names them).
- No `.claude/rules/` folder and no nested `AGENTS.md` exist.

## Design Overview

After the change:

```
Heavy plan watch ──planDir──▶ plan-copies.ts ──git.worktrees──▶ copies in clone + each worktree
        │                         │ newest by mtime of plan.md and task docs
        │                         ▼
        │                 plan-progress.ts  (boxes under ## Tasks, waves, review rounds, task Status lines)
        ▼                         ▲
 flow.state.progress ──▶ side pane: done / running (Status: in progress) / pending
                                  │
Backlog readHome ─────────────────┘ (same reader, same counts)

MCP call ─▶ sessions routeCall ─▶ tool-call guards ─▶ chat guard: toolUseId ─▶ agentId (from toolStarted)
                                      │   subagent + main-agent-only tool → success text, no effect
                                      └─▶ else the tool's handler runs

stream-decoder: text/thinking entry.agentId; transcript draws main's only
                launched subagent: end held until its tasks end; a late line lists it again
```

Decisions (from the interview, 2026-11-08):

- No per-agent record, section or tab: the existing views are made correct (round 2, the user's note).
- Newest copy across the clone and its worktrees, by file time (round 1).
- In-progress from each task document's `Status:` line, drawn with the existing running mark; the layout contract does
  not change (round 1, design review).
- A subagent's call of the three tools succeeds and changes nothing (rounds 1 and 3).
- Chat keeps the tool-use-id map; sessions gets `addToolCallGuard`; a contribution marks its tools main-agent-only, so
  `ask_round` and every other tool still run for a subagent (design review).
- An unseen tool-use id waits up to 2000 ms, then counts as the main agent's. A session with no stream counts as main
  (design review).
- One shared reader in `src/shared/`, since neither plugin may import the other; Backlog counts boxes under `## Tasks`
  only, as Heavy does (design review).
- Heavy lists worktrees again at each plan check and when git's worktrees folder changes (design review).
- `planGone` signals only when no copy is left. After `wigley:make` deletes a worktree's copy, Heavy reads the main
  clone's copy until the branch lands and removes it there; then the flow closes (plan time).
- The Worktrees fact matches a Bash command's text against the session repo's worktree roots; a read-only command counts
  (design review).
- Subagent text is left out of the transcript (round 4).
- A background subagent's end waits for every task it owns, and a late line lists it again (round 4).
- Nested subagents keep the session busy (round 1 notice).

Out of scope:

- Telling subagents to report through the tools; no change in `wigley-agents` or `wigley-ai-marketplace`.
- Which agent works which task, and a timer per task.
- Terminal sessions: they carry no stream, so their calls count as the main agent's.
- The docs index's own counts in `docs_index.py` (marketplace); Backlog stops reading them for plans.

## File Structure

Shared names, used by more than one part. Each task document gives the rest.

`src/shared/plan-progress.ts` (create; replaces `src/plugins/workflow-heavy/plan-reader.ts`):

```ts
export type TaskStatus = 'not started' | 'in progress' | 'done';
export const TASK_STATUSES: readonly TaskStatus[];  // shared by readTaskStatus and workflow-heavy's contract guard
export interface PlanTaskLine {
  readonly wave: number | null;
  readonly text: string;
  readonly done: boolean;
  readonly file: string | null;        // the task line's link target, e.g. '03-claim-grants.md'
  readonly status: TaskStatus | null;  // that file's Status line; null when the file is missing or has none
}
export interface PlanProgress { checked; total; wave; reviewRounds; title; tasks: readonly PlanTaskLine[] } // fields as today
export function readPlanProgress(planText: string, taskTexts: ReadonlyMap<string, string>): PlanProgress;
export function readTaskStatus(taskText: string): TaskStatus | null;
```

`src/shared/plan-copies.ts` (create):

```ts
export interface PlanCopy { readonly planDir: string; readonly checkout: string; readonly changedAt: number }
export interface PlanCopyDeps {
  readonly git: Pick<Git, 'topLevel' | 'worktrees'>;
  readonly files: Pick<Files, 'read' | 'modified' | 'list' | 'realPath' | 'stat'>;
  readonly paths: Paths;
}
export function repoTop(planDir: string, deps: PlanCopyDeps): Promise<string | null>;  // topLevel of the nearest existing folder
export function planCopies(planDir: string, deps: PlanCopyDeps): Promise<PlanCopy[]>;
export function newestPlanCopy(planDir: string, deps: PlanCopyDeps): Promise<PlanCopy | null>;
export function readPlanCopy(copy: PlanCopy, deps: PlanCopyDeps): Promise<PlanProgress | null>;
```

`src/contracts/git.ts` (modify):

```ts
export interface GitWorktree { readonly path: string; readonly branch: string | null; readonly isMain: boolean }
// Git gains:
worktrees(root: string): Promise<GitWorktree[]>;  // `git worktree list --porcelain`; the main tree first
commonDir(root: string): Promise<string>;         // `git rev-parse --git-common-dir`, as a full path
```

`src/plugins/workflow/contract.ts` (modify): `ChecklistItem` gains `readonly running?: boolean`.

`src/plugins/sessions/contract.ts` (modify):

```ts
export interface GuardedToolCall {
  readonly sessionId: string; readonly tool: string; readonly toolUseId: string | null; readonly mainAgentOnly: boolean;
}
export type ToolCallVerdict = { readonly kind: 'run' } | { readonly kind: 'skip'; readonly text: string };
export type ToolCallGuard = (call: GuardedToolCall) => Promise<ToolCallVerdict>;
export interface ContributeToolsOptions { readonly mainAgentOnly?: boolean }
// SessionsMainExports:
contributeTools(tools, start, options?: ContributeToolsOptions): Disposable;
addToolCallGuard(guard: ToolCallGuard): Disposable;
```

`src/plugins/backlog/main/start.ts` (modify): `BacklogDeps.files` widens to
`Pick<Files, 'read' | 'modified' | 'list' | 'realPath' | 'stat'>`, so it can pass `PlanCopyDeps`.

`src/contracts/agent.ts` (modify): the `assistant` and `thinking` chat entries gain `readonly agentId: string`.

Boundary rules:

- `src/shared/plan-progress.ts` and `plan-copies.ts` are flat files in `src/shared/`: they import only `src/contracts`,
  `src/shared` and `src/shared/paths`, with no `node:` import, so the layer rules need no new `src/shared` entry.
  Removing `plan-reader.ts` removes its sublayer entries from `scripts/check-layers.mts`.
- Sessions names no plugin: chat registers its guard through `addToolCallGuard`, and the tools' owners mark them
  main-agent-only.
- Chat names no workflow or sessions tool: its guard reads only the `mainAgentOnly` flag the call carries.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Shared plan reader](01-shared-plan-reader.md)
- [x] [Main-agent-only tool calls in sessions](03-main-agent-only-tools.md)
- [x] [Nested subagents keep a session busy](04-nested-subagents-busy.md)
- [x] [Subagent lines in the decoder](05-subagent-lines-in-decoder.md)

### Wave 2
- [x] [Worktree list and plan copies](02-worktree-list-and-plan-copies.md) — after 01

### Wave 3
- [x] [Heavy reads the newest plan copy](06-heavy-newest-plan-copy.md) — after 01, 02
- [x] [Backlog counts from the newest copy](07-backlog-newest-copy.md) — after 01, 02
- [x] [Chat names each call's agent and each touched worktree](08-chat-callers-and-worktrees.md) — after 02, 03

### Wave 4
- [x] [Doc re-read](09-doc-re-read.md)

### Wave 5
- [ ] [Final verification](10-final-verification.md)

## Run log

Review base: 9980e669

### Groups
- 04 · 44417ebc · diff read: signalOf gives subagentStarted for every agentSpawned; flow + agent-signals tests pass (54); full typecheck deferred to wave end while peers edit · concerns: none (typecheck failures seen were other wave-1 workers' in-progress edits)
- 03 · 65341284 · diff read: GuardedToolCall, ToolCallVerdict, ToolCallGuard, ContributeToolsOptions, addToolCallGuard present in sessions contract; three tools marked mainAgentOnly; sessions+workflow tests pass (222); full typecheck at wave end · concerns: routeCall moved into createSessionList's closure (reads toolFlags and guards)
- 01 · dde8194a · diff read: TaskStatus, TASK_STATUSES, PlanTaskLine (file, status), PlanProgress, readPlanProgress(planText, taskTexts), readTaskStatus in src/shared/plan-progress.ts; plan-reader.ts gone; heavy + plan-progress tests pass (472); check-layers clean for its files · concerns: git mv staged the renames; oxfmt not yet run (lint gate at wave end); test helpers UNLINKED/linked() instead of literal rows
- 04 fix · 97f9d4ff · layer check passes for workflow files; tests pass (54) · concerns: none
- 05 · 9c23d58b · diff read: agentId on assistant/thinking entries; transcript skips subagent text; held ends, hand-back end, relisting in stream-decoder; follow-up removed; decoder/chat/agents tests pass; typecheck clean for its files · concerns: activity-runs.test.ts also needed agentId (not in Files); a subagent stream_event text block could show the dock as writing (decoder-only case); oxfmt not run
- 02 · 8fa2e4c7 · diff read: GitWorktree, worktrees, commonDir in git contract and process-git; PlanCopy, PlanCopyDeps, repoTop, planCopies, newestPlanCopy, readPlanCopy in src/shared/plan-copies.ts; full typecheck clean; git/backlog/docs/plan-copies tests pass (1368) · concerns: AGENTS.md git/ entry names worktrees but not commonDir (for 09)
- 07 · 45db9863 · diff read: BacklogDeps.files widened; readPlan counts and statuses from newestPlanCopy/readPlanCopy, header from index copy; backlog tests pass; backlog self-test owed to the test gate · concerns: listed memory seed relies on memory-files storing before its first await
- 08 · 4b3f3339 · diff read; Produces present (createToolCallers, callerGuard, worktreesInCommand, guard wired in start.ts); chat tests 46 files 1454 passed; full typecheck/lint held for 06's in-progress heavy files · concerns: doc sentence on the worktree-add command not matching is untrue: the post-result roots read re-matches that command, so the new worktree lists from the add itself; stale-read row is a timeline check; startChatPart fixture has no services.git, so open-time reads log rejections
- 09 · bc88a5d5 · diff read: three AGENTS.md lines match the git contract, plan-watch and the guard wiring; the other seven docs read against the code and held; follow-up already gone; lint clean · concerns: no doc names chat listing a worktree a Bash command names (worktreesInCommand); no line is stale on it, so none was added
- 06 · beb53a5c, 09310eb8 · diff read; Produces present (ChecklistItem.running, itemState, plan watch over copies/commonDir/worktrees); first proof failed 5 stale rows in workflow-heavy-page.test.ts, re-dispatched and fixed by test update; full typecheck, lint, and suite 540 files 10235 tests pass · concerns: the worktree-added row cannot prove the worktrees-folder watch exists, since MemoryFiles reports nested changes as the subfolder name; self-test held for the gate; review-busy row now passes via running:false rather than the stage
### Contract changes
### Rulings
- Ended/aborted checks after the guard wait run only when a guard was registered at call time; with none the handler runs same-tick as before — Decisions call these checks new to the guard wait — once chat's guard lands every call takes the checks · group 03 · group 03
- A skip resolves the call even if the session ended, the signal aborted or the contribution was disposed during the guard wait — first skip wins precedes the checks — a cancelled call returns success text instead of rejecting · group 03 · group 03
- check-layers: only the stages sublayer gained src/shared; root/main/page already get it from layer-rules — none if lint agrees · group 01 · group 01
- Task 04's nested-subagents test lives in main/agent-signals.test.ts (fix 97f9d4ff), not flow.test.ts as its Tests line says — the root may not import main/ — none · lead
- A relisted subagent's agentReplied is rebuilt from kept model/context, so its contextWindow is the model's current window — matches later replies — a window learned off-roster shows one event early · group 05 · group 05
- isDockStep keeps raw steps (no agentId) and main-agent steps — raw carries no agentId — none · group 05 · group 05
- planCopies falls back to the copy at planDir with no log when git.worktrees rejects — task step 6 — a persistently failing worktree list goes unreported unless 06/07 log it · group 02 · group 02
- oxfmt --write (npm run lint:fix) run by the lead as a tooling-only pass over entry-list.ts and session-list.test.ts, commit 71588234 — lint failed on format only — none · lead
- Test rows give files as [path, text, time] triples, not the pairs Decisions names — a written file needs its text — row shape only · group 07 · group 07
- 08: Bash commands are recorded during replay too; only the result-triggered roots read waits for live · group 08
- 08: commandOf is a local field reader, since json-fields.ts is outside plugin imports · group 08
- 08: two roots sharing a last segment list one name · group 08
- Lead: 09 (doc re-read) dispatched beside 06's re-dispatch, since the 06 fix edits only workflow-heavy-page.test.ts, which no doc names.
- 06: git-folder watch onError lists again; worktrees watch onError drops the watch so the next report reopens it · group 06
- 06: a worktrees report closes the worktrees watch when that folder is gone · group 06
- 06: startPartsInHarnesses also gets NO_CLONE_GIT · group 06
- 06: stale page-test rows updated to the decided pending mark, not the code · group 06
### Review rounds
### Test gate
