# Work inbox — plan

Feature: Work inbox · Implements: none · Ticket: none
Target: `main` of the `ai` repo (`wigley-ai-gui/`), or of `~/Documents/wigley-ai-gui` once the shareable-app plan has moved the app (Preconditions) · Written: 2026-11-23

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Build three built-in plugins that bring the user's Slack and Jira work into the app:
- `work`, a data plugin, with the store, the job queue, the worker sessions, the worker's tools, work detection, spin-up, and every card action as a command
- `work-inbox`, the Inbox mode view
- `work-board`, the Board mode view

Every write to Slack or Jira runs only on the user's press. The settled result is `docs/features/work-inbox/design.md`, and that doc is the spec. `spike.md` beside it records the spike, and the spike's code on `spike/work-inbox` is reference only. Neither its code nor its structure is copied.

## Architecture

Systems touched:
- **Git service** (`src/contracts/git.ts`, `src/main/git/process-git.ts`) gains branch listing and an all-branch key search.
- **A new pull-request service** (`src/contracts/pull-requests.ts`, `src/main/pull-requests/`) wraps the `gh` CLI. It's added to `MainServices` beside `git`.
- **Chat** gains `LaunchRequest.permissions?: 'auto'`, which flows to each harness as `AgentStart.permissions`. The **claude-code harness** maps `'auto'` to its permission-skipping launch.
- **New plugins:** `work` (main and page), `work-inbox` (page) and `work-board` (page). They register in `src/plugins/main.ts`, `page.ts` and `manifests.ts`, with keys in `src/plugins/keymap.ts`.

## Preconditions

Each command below was run at plan time. `wigley:make` re-runs each one before its first dispatch.

- The plan branch `work-inbox` sits on local `main` `35f62ddac`, with the docs and plan commits on top. Check with `git -C /Users/jonathonwigley/Documents/.worktrees/ai-work-inbox-plan log --oneline -3`. If `main` has moved since, rebase the plan branch onto it.
- No `work`, `work-inbox` or `work-board` plugin exists on `main`. Check with `git -C /Users/jonathonwigley/Documents/ai ls-tree main wigley-ai-gui/src/plugins/ | grep -E 'work(-inbox|-board)?$'`, which should print nothing. The spike's `work-inbox` folder exists only on `spike/work-inbox`.
- The `gh` CLI is on PATH and logged in. Check with `command -v gh && gh auth status`, which should exit 0. Tests never run it, because they use a fake adapter.
- **The shareable-app plan's code is not on `main` yet.** Its plan folder landed at `35f62ddac` (`wigley-ai-gui/docs/features/shareable-app/plan-shareable-app/`), but its code had not run at plan time. Check with `git -C /Users/jonathonwigley/Documents/ai cat-file -e main:wigley-ai-gui/src/shared/agent-plugin.ts`, which exited non-zero at plan time (its task 01 and later add that file). Before the first dispatch, read the chatroom and run that check again. Its task 17 posts here before the repo split and asks the user how this branch and its worktrees move. If its code has landed:
  - Rebase this branch onto its tip.
  - Add `appDir` handling wherever this plan builds a `MainServices` fake (its task 01 adds `appDir: string`).
  - Name tools through the server-name constant in `src/shared/agent-plugin.ts`. Tool names become `mcp__plugin_auri_auri__*`.
  - Task 13's README.md and CHANGELOG.md entries are then checked by that plan's coverage test and changelog lint.

  If its repo move (its task 17) has run, land in `~/Documents/wigley-ai-gui`, not in `ai`.

## Docs written ahead

- `wigley-ai-gui/docs/features/work-inbox/design.md`: the full design, marked planned.
- `wigley-ai-gui/docs/features/work-inbox/spike.md`: the spike's settled result, brought over from `spike/work-inbox`.

Both are in the docs commit under the plan commit. `README.md` and `CHANGELOG.md` already exist on `main`, written ahead by the shareable-app docs commit, and every built-in plugin, contributed MCP tool and setting must appear in `README.md` with a `CHANGELOG.md` entry under `## Unreleased`. Task 13 writes those entries, and the `AGENTS.md` and `docs/keymap.md` ones. Those files are read as live fact by every session, so their entries land with the code rather than ahead of it.

## Mandatory Reads

- `wigley-ai-gui/AGENTS.md`, every line through the last. It's the plugin, layer, layout, settings, slot, command, demo and self-test rules.
- `wigley-ai-gui/AGENTS*.md` and `wigley-ai-gui/.agents/**/*.md` (glob), for any local variant or project rule.
- `wigley-ai-gui/DESIGN.md`, for every view task: tokens, cards, lists and focus.
- `wigley-ai-gui/docs/keymap.md`, for tasks 12 and 13.
- `wigley-ai-gui/docs/features/work-inbox/design.md`, for every task.
- `wigley-ai-gui/.agents/skills/drive/SKILL.md`, for the final verification.

## Design Overview

```
                ┌──────────────── work (data plugin, main) ───────────────────┐
 timer/start/W ─┤ job-queue (pure reducer) ─► job-runner ─► chat.launch(       │
 card presses  ─┤        ▲    saved in plugin data           unattended,       │
                │        │                                   permissions:'auto',│
                │        │                                   owner:'work')      │
                │   work tools (MCP, only the running job's session) ◄── worker│
                │        ▼                                                     │
                │   work store (plugin data) ─► actions/clearing (pure)        │
                │        ▲                                                     │
                │   detection (pure) ◄─ signals: services.git, .pullRequests,  │
                │                        chat.session, sessions.rows           │
                │        ▼                                                     │
                │   work.state slot ── spin-up ─► chat.launch (visible row)    │
                └────────┬────────────────────────────────────────────────────┘
                         ▼ slot + work commands
          work-inbox (page view, layouts)    work-board (page view, layouts)
```

**Decisions** (the interview, 2026-11-23):
- Round 1:
  - Add to Board makes a local task.
  - The worker is a fresh, hidden, unattended session for each job, queued one at a time, and closed when it goes idle.
  - PRs come through `gh` behind a contract.
  - The watched repos are chat's projects, their pool clones, and `work.repoFolders`.
  - Spin-up uses the `work.projects` map, falling back to chat's new-session prompt.
- Round 2: jobs launch with a role-based `permissions: 'auto'` that each harness maps to its permissive mode. The user picked this over the profile's allow rules.
- Decided notices:
  - Three plugins.
  - Sweeps run only while the app runs, plus one at start.
  - Session-to-ticket links come from the start-from-card record, or the key in a session's branch or first message.
  - Keys: `<Leader>ki`, `<Leader>kj`, `W`, and Ctrl+n in both scopes.
  - Worker text is harness-neutral.
  - Layouts follow DESIGN.md.
  - The spike branch is deleted after this lands.
  - Writes happen only on a press.
  - Git gains two methods.
  - The pull-request contract has a `gh` adapter.
  - The queue, detection and clearing are pure modules with an injected clock.
  - Tools are gated to the job session.
  - Every action is a command.
  - Local tasks start in Todo and leave only when deleted.
  - A move goes to the first reachable status in the column.
  - Demo and self-test use sample data and launch no worker.
- Agent decision: the claude-code harness maps `'auto'` to a launch with `--dangerously-skip-permissions` and mode `bypassPermissions`. Its normal launch mode is already `auto`, which an unattended row still denies when the classifier asks. Claude refuses bypass mid-session, so it is set at launch only.

**Out of scope:**
- Sweeps while the app is closed.
- Catch-up mode (rejected).
- Key people, muted channels, and a memory (later work).
- Creating Jira tickets.
- Slack or Jira writes not pressed by the user.
- A pane to talk to the worker.

## File Structure

Paths are relative to `wigley-ai-gui/`.

**Modified:**
- `src/contracts/git.ts` and `src/main/git/process-git.ts` (+ test): `branches`, `commitsMatching` (01)
- `src/contracts/plugin.ts` (`MainServices.pullRequests`), `src/main/main.ts` (wired once beside `git`), `src/shared/plugin-part-harness.test-support.ts` (the full `MainServices` fake) and `scripts/check-layers.mts` (the adapter's layer entry) (02)
- `src/contracts/agent.ts` (`AgentStart.permissions`), `src/plugins/chat/contract.ts` (`LaunchRequest.permissions`), chat's `chat-sessions.ts` and `open-sessions.ts` (a saved row without `permissions` reads `'default'`), and claude-code's `claude-launch.ts`, `claude-controls.ts`, `session-fold.ts` and `claude-code-harness.ts` (+ tests) (03)
- `src/plugins/main.ts`, `page.ts` and `manifests.ts` (register `work`) (04); the same three (register the views, each with a main part for its layout) and `src/plugins/keymap.ts` (12)
- `src/plugins/chat/contract.ts`, `chat/page/start.ts` and `chat/page/start-prompt.ts`: the page export `newSessionWithDraft(text): Promise<string | null>` for spin-up's fallback (08)
- `AGENTS.md`, `DESIGN.md`, `docs/keymap.md`, `docs/features/layouts/design.md`, the feature's `design.md` and `spike.md`, the views' groups in `work/main/selftest-script.ts`, `README.md` and `CHANGELOG.md` (13)

**New:**
- `src/contracts/pull-requests.ts`: the seam. The live adapter is `gh`, and tests use a fake (02).
- `src/main/pull-requests/gh-pull-requests.ts` (+ test): the only place `gh` runs (02).
- `src/plugins/work/`: `manifest.ts`, `contract.ts`, `main/store.ts`, `main/start.ts` (04, with the wiring in 09).
  - `main/job-queue.ts` and `main/job-runner.ts`; plugin data gains `queue.json` beside `work.json` (05)
  - `main/work-tools.ts` and `main/job-text.ts` (06)
  - `main/detection.ts` and `main/signals.ts` (07)
  - `main/actions.ts` and `main/spin-up.ts` (08)
  - `main/sweep-timer.ts`, `main/selftest-fixture.ts`, `main/selftest-script.ts`, and the drive action `work.seed` task 14 uses (09)
  - `page/start.ts` (04)
- `src/plugins/work-inbox/`: `manifest.ts`, `contract.ts` (its place slot), `main/start.ts` (its layout), `page/start.ts`, `page/inbox-state.ts`, `page/inbox-view.ts`, `page/sample-state.ts`, `page/demo-steps.ts`, `page/layout/`, and `layouts/layout.d.ts` with `layouts/default/` (10).
- `src/plugins/work-board/`: the same shape, with `page/board-state.ts` and `page/board-view.ts` (11).

**Shared names.** Each is produced once and consumed word for word.

```ts
// src/contracts/git.ts — 01
interface GitBranch { name: string; at: string /* tip committer ISO */; isRemote: boolean }
branches(root: string): Promise<GitBranch[]>                       // local + remote-tracking
commitsMatching(root: string, pattern: string, since: string | null): Promise<GitCommit[]>
                                                    // every ref, subject+body, case-insensitive ERE

// src/contracts/pull-requests.ts — 02
interface PullRequestInfo { number: number; title: string; url: string; headBranch: string;
                            state: 'open' | 'merged' | 'closed'; updatedAt: string }
interface PullRequests { forRepo(folder: string): Promise<PullRequestInfo[] | null> }
                                                    // null: gh missing, unauthed, or no GitHub remote
// MainServices.pullRequests: PullRequests

// chat + agent — 03
LaunchRequest.permissions?: 'auto'
AgentStart.permissions: 'default' | 'auto'

// src/plugins/work/contract.ts — 04 (04's doc holds the full field lists)
type WorkSection = 'needs_you' | 'promised' | 'waiting' | 'my_threads' | 'around' | 'worth_knowing'
type WorkSignal  = 'branch' | 'commit' | 'pr_opened' | 'pr_merged' | 'session'
WORK_SECTIONS, WORK_SIGNALS, OTHER_COLUMN = 'Other'
interface WorkItem      // one Slack item: id (permalink), section, channel, author, at, title, summary,
                        // latest, participants, url, ticketKeys, linkReason, why, draft, sending,
                        // state: 'open'|'cleared'|'dismissed'|'snoozed', snoozedUntil, firstSeen, note
interface WorkCard      // common: id, column, movedAt, title, url, movingTo, note, linkedSessionIds;
                        // kind 'jira' (key, jiraStatus, priority, reachableStatuses) | 'local' (sourceItemId)
interface WorkSuggestion { cardId; signal: WorkSignal; column; reason; at; state: 'suggested' | 'done' }
interface WorkJobStatus { kind: WorkJobKind; state: 'queued'|'running'|'done'|'failed';
                          rowId: string | null; at: string; note: string | null }
interface WorkState { items; cards; suggestions; columns: string[];
                      job: { running: WorkJobStatus | null; last: WorkJobStatus | null }; problem: string | null }
type WorkJob = { kind:'sweep' } | { kind:'send'; itemId; text } | { kind:'nudge'; itemId; text }
             | { kind:'move'; key; column }
WorkColumnSetting { name; jiraStatuses: string[] }, WorkProjectSetting { jiraProject; project },
WorkSignalSetting (a column name or 'off')
columnForStatus(status, columns): string             // OTHER_COLUMN when unmapped; the one column rule
ticketKeysIn(text): string[]                          // the one in-process key matcher
readColumns(raw), readProjects(raw)                   // every reader of work.columns / work.projects
statusLine(job, now): WorkStatusLine { text, tone, hasRow }   // the one status-line rule; hasRow = last.rowId set
workStateSlot                                         // main-published slot of WorkState
// work commands (page-runnable): sweep, send, dismiss, restore, snooze, addToBoard, moveCard,
//   acceptSuggestion, notYet, deleteTask, startSession, openJobRow
// WorkChannel: one invoke per command, same name, the command's arg
//   (WorkSendArg {itemId,text}, WorkMoveArg {cardId,column}, WorkStartArg {source,id})
// 08 adds: WorkStartResult = { kind:'launched'; toast } | { kind:'prompt'; message; cardIds },
//   invoke.startSession → Promise<WorkStartResult>, invoke.linkSession(WorkLinkArg {cardIds, sessionId})
//   with no command behind it, and work's manifest dependsOn.page ['chat']

// src/plugins/work/main/store.ts — 04
WORK_FILE = 'work.json'; WorkFile { items, cards, suggestions, notYet: WorkNotYet[], job, lastSweepAt }
WorkNotYet { cardId, signal, at }; buildWorkState(file, columns, problem): WorkState
createWorkStore(data, log): WorkStore { load, file, update(change), onChange, problem, settled }

// src/plugins/work/main/job-runner.ts, job-queue.ts — 05
createJobRunner(deps): JobRunner { start(); enqueue(job): Promise<void>; jobOf(session);
                                   report(session, { ok, note }): boolean; pending(): WorkJob[]; dispose() }
// deps include profile(), instructions(), message(job): string | null, ended(job, outcome)
nextJobQueue(queue, event), parseJobQueue, EMPTY_JOB_QUEUE   // queue.json

// src/plugins/work/main/work-tools.ts, job-text.ts — 06
startWorkTools(deps): (session) => ToolSession; WORK_TOOLS =
  read_work_state, record_work_items, record_work_tickets, report_work_job
mergeRecordedItems, mergeRecordedTickets; WORKER_INSTRUCTIONS; jobMessage(job, settings, file)

// src/plugins/work/main/actions.ts — 08
clearStaleMarks(file, pending), LOST_JOB_NOTE         // 09 runs it at start against runner.pending()

// src/plugins/work/main/selftest-script.ts — 09
reseedStep(group): SelfTestStep; self-test binds under WORK_SELFTEST_KEYS = Space z w   // 13 consumes

// view commands — 10, 11, 12
work-board.showTicket, work-inbox.filterTicket       // run across plugins by id
// each view runs every work.* command through its own view commands and one runWork path (runFor), which toasts
// a refusal; W and gs bind the views' own sweep and showJobRow, never a work.* command
```

Settings shape (04): `work.projects` is a list of `WorkProjectSetting`, and `work.signals` is five leaves
`work.signals.branch` … `work.signals.session`, since a setting whose default is `{}` declares no leaf.

Boundary rules:
- The views read `workStateSlot` and run `work` commands only. They import nothing from `work/main`.
- `gh` runs only in `gh-pull-requests.ts`, and git only in `process-git.ts`.
- Worker text names no harness's tools.
- Every view draws through its layout, with `--wg-*` tokens only (`scripts/check-styles.mts`, `check-layers.mts`).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 04 → 07 → 09 → 13

### Wave 1
- [x] [Git branch listing and key search](01-git-branches-and-key-search.md)
- [x] [Pull-request service over gh](02-pull-request-service.md)
- [x] [Role-based permissive launch](03-permissive-launch.md)
- [x] [Work plugin skeleton, contract and store](04-work-skeleton.md)

### Wave 2
- [ ] [Job queue and runner](05-job-queue-and-runner.md) — after 03, 04
- [ ] [Worker tools and job text](06-worker-tools-and-text.md) — after 04
- [ ] [Work detection](07-work-detection.md) — after 01, 02, 04
- [ ] [Card actions, clearing and spin-up](08-actions-and-spin-up.md) — after 03, 04
- [ ] [Inbox view plugin](10-inbox-view.md) — after 04
- [ ] [Board view plugin](11-board-view.md) — after 04

### Wave 3
- [ ] [Wire the work plugin, fixture and self-test](09-wire-work-main.md) — after 02, 04, 05, 06, 07, 08
- [ ] [Register the views and keys](12-register-views-and-keys.md) — after 10, 11

### Wave 4
- [ ] [Docs and doc re-read](13-docs-and-re-read.md) — after 09, 12
- [ ] [Final verification](14-final-verification.md)

## Run log

Review base: 5459b99a5c62268ba8196ce3bdf814dd214ad5cc

### Groups
- 01 · hard (compile fix ee14df69b on the same rung) · 2b1f4f3d7 · diff read: GitBranch, branches, commitsMatching in git.ts and process-git.ts; wave 1 typecheck + lint clean after the plugin-status.test.ts fake fix · concerns: AGENTS.md git/ layout entry lacks the two members (task 13 step 2); missed a second Git fake in docs plugin-status.test.ts, fixed
- 02 · hard (compile fix 1441de573 on the same rung) · 385a0c52b · diff read: PullRequestInfo, PullRequests, createGhPullRequests, PR_LIST_LIMIT, PR_LIST_TIMEOUT_MS, MainServices.pullRequests, MAX_GH_RUNS, notFaked harness entry, CORE_LAYERS; wave 1 typecheck + lint clean after the packages fix · concerns: CORE_LAYERS entries lacked required packages (fixed); test pins literals 100 and 15000 rather than the constants
- 03 · deep · ae6e9e16e · diff read: LaunchRequest.permissions, AgentStart.permissions, launchMode/startingControls on Pick<AgentStart,'controls'|'permissions'>, BYPASS_MODE, SKIP_PERMISSIONS_FLAG, BYPASS_CHOICE; wave 1 typecheck + lint clean · concerns: fake-agent-harness ignores permissions, so permissive Mode choices are pinned only in claude-controls and session-fold tests; startingControls_PermissiveStart test names interpolate an object; edited agent-chat/design.md outside its Files list (kept: stale-doc fix)
- 04 · deep · 23d8904d9 · diff read: manifest (12 commands, settings), contract (types, columnForStatus, ticketKeysIn, readColumns, readProjects, statusLine, workStateSlot, WorkChannel, 3 CommandKeys), store (parseWorkFile, buildWorkState, createWorkStore), main and page starts, registered after backlog; wave 1 typecheck + lint clean · concerns: hand formatting passed oxfmt; readColumns/readProjects carry as-string casts on an any entry; start_emptySlot and columnForStatus default rows read the manifest defaults
### Contract changes
- 02: CORE_LAYERS 'src/main/pull-requests' layers ['src/contracts'] → ['src/contracts','src/shared'], packages [] · why: the mapper uses isJsonObject from src/shared/json · consumers: none
### Rulings
- 01: branches strips refs/heads/ or refs/remotes/ by one regex; any other ref prefix keeps its full name (none can appear) · group 01
- 02: a run with code 0 but timedOut resolves null · group 02
- 02: MainServices' doc comment names pullRequests beside git · group 02
- 03: chat's permissions fields are typed AgentStart['permissions']; resume, resumed attach, adopted runs and the user's start open 'default' · group 03
- 03: agent-chat/design.md updated for permissions (launch diagram, saved fields, process start) since no task owned it · group 03
- 04: work contract may import src/shared (PLUGIN_EXTRAS), for isJsonObject/isStringArray · group 04
- 04: contract.test-support.ts holds workItem/jiraCard/localCard fixtures for later tasks · group 04
- 04: an update before load() starts the load; settled() waits for load and chain; save, then tell listeners, then resolve · group 04
- 04: parseWorkFile checks enum values too; statusLine ages floor to just now / Nm / Nh (<48h) / Nd · group 04
### Review rounds
### Test gate
