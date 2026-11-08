# Auto retro — plan

Feature: auto-retro · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui and `main` in wigley-ai-marketplace, through worktree branches `auto-retro` (`~/wigley-agents/WigleyRepos.md` § Landing) · Written: 2026-11-08

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

When the user closes an app session, the app starts a background `/wigley:retro auto` run for it. The run digests,
analyzes, records the ledger, drafts promotions and commits, then its row closes itself. A manual `/wigley:retro`
then only catches up, reports the background runs and asks about ripe candidates.

## Architecture

- **wigley-ai-gui**
  - `chat` plugin: `launch` takes `unattended`; a new `close(sessionId, reason)` export; a new close reason
    `finished`.
  - `sessions` plugin: a sidebar section registration, `addSection`, and its layout contract and `default` layout.
  - new `auto-retro` plugin: the queue, the launch, done detection, the close, the Retro section.
  - `session-log` and `session-stash`: read the close reason through chat's new `isUserClose`.
- **wigley-ai-marketplace** (worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-auto-retro`)
  - `plugins/wigley/scripts/retro/ledger.py`: `lock`, `runs`, `draft`, and `ripe`'s draft status.
  - `plugins/wigley/scripts/retro/digest.py`: `session` prints `short`; `--projects` defaults from `$CLAUDE_CONFIG_DIR`.
  - the version bump in both plugin manifests, in task 05's commit (the series' last).

## Preconditions

Each was checked at plan time; `wigley:make` runs each again before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| GUI worktree on branch `auto-retro`, based on `main` | `git -C /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-auto-retro log --oneline 1a938e2f..auto-retro` | the docs-ahead and plan commits only |
| Marketplace worktree on branch `auto-retro`, based on `main` | `git -C /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-auto-retro log --oneline dd60953..auto-retro` | `e7fdbfd` and `1dbe437`, docs ahead only |
| GUI worktree has `node_modules` linked | `test -L /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-auto-retro/node_modules` | link to the clone's |
| `LaunchRequest` has only `projectDir`, `profile`, `message` | `grep -n "interface LaunchRequest" -A5 src/plugins/chat/contract.ts` | lines 45–49 |
| `SessionCloseReason` has three members | `grep -n "type SessionCloseReason" src/plugins/chat/contract.ts` | line 367: `user`, `start-failed`, `project-closed` |
| A permission prompt waits on the user | `grep -n "askPermission" src/plugins/chat/main/chat-sessions.ts` | around line 2793 |
| Sessions main exports `setTitle(sessionId, source, title)` | `grep -n "setTitle" src/plugins/sessions/contract.ts` | line 209 |
| `SessionPart` is `{ id; build(parent, sessionId) }` | `grep -n "interface SessionPart" -A3 src/plugins/sessions/contract.ts` | line 336 |
| Sidebar sections are a closed pair | `grep -n "kind" src/plugins/sessions/layouts/layout.d.ts` | `SectionInput.kind` `'favorites' \| 'recent'`, line 72 |
| `digest.py` reads `~/.claude/projects` by default | `grep -n "^PROJECTS" plugins/wigley/scripts/retro/digest.py` (marketplace) | line 57 |
| Marketplace plugin version | `grep -n '"version"' plugins/wigley/.claude-plugin/plugin.json plugins/wigley/.codex-plugin/plugin.json` (marketplace) | measured at plan time, re-verify against `origin/main` |

## Docs written ahead

- GUI commits `a9729edc`, `0f26aa34` and `eb9db1e8` on `auto-retro`:
  - `docs/features/auto-retro/design.md` (new)
  - `AGENTS.md`: the `sessions` page entry (`addSection`), the new `auto-retro/` entry, chat's `launch`/`close` exports
  - `docs/features/session-log/design.md`: the `closed` row names the `finished` reason
  - `docs/features/layouts/design.md` Adopters and `DESIGN.md` § Side bar: plugin sections
  - `docs/features/session-groups/design.md` § Order and § Drawing: plugin sections (cold-read fix)
  - `docs/features/agent-chat/design.md` **Turn finished** and `docs/features/auto-retro/design.md` § The queue, § Done,
    § Decisions: no alert for an unattended row, self-test, settle setting, restore miss (cold-read fix)
  - `docs/features/agent-chat/design.md` § Chat plugin: **Saved sessions** (`unattended`, which closes remove a
    record) and **Permissions** (an unattended row denies at once), in `0f26aa34`
- Marketplace commits `e7fdbfd` and `1dbe437` on `auto-retro`:
  - `plugins/wigley/skills/retro/SKILL.md`: § Modes, the lock, steps 1–11
  - `plugins/wigley/skills/retro/criteria.md` § Candidate file: `## Draft`, `draft_target`, `draft_hash`, and the new step numbers

## Mandatory Reads

- GUI: `AGENTS.md` (whole; § Architecture is the part every task needs), `DESIGN.md` (tasks 03 and 04), `docs/features/auto-retro/design.md`, `docs/features/layouts/design.md` (tasks 03 and 04)
- Marketplace: `AGENTS.md`, `plugins/wigley/skills/retro/SKILL.md`, `plugins/wigley/skills/retro/criteria.md`
- `wigley:writing-code`, `wigley:codebase-design`, `wigley:writing-tests` (its `typescript-vitest.md` for GUI tasks)

## Design Overview

```
GUI main                                   GUI page
────────                                   ────────
chat.sessionClosed ─► auto-retro queue     auto-retro.state slot ─► Retro section
  (user, sent, not ours)   queue.json        (rows, queued)          (sessions.addSection,
        │                                                              claims rows, header
        ▼                                                              through auto-retro layout)
chat.launch({ unattended: true,
  projectDir: <folder setting>,            sessions sidebar: Favorites, Recent,
  message: /wigley:retro auto <ids> })       then plugin sections by order
        │
        ▼
sessions.setTitle(row, 'user', <closed title>)
chat.session slot: idle, background 0,
  no compaction, settle 5 s  ─► chat.close(row, 'finished') ─► next item

Marketplace: /wigley:retro auto <ids> ─► ledger.py lock ─► digest.py session (short?) ─►
  analysts ─► ledger.py add/seen/archive/index ─► commit ─► ledger.py ripe ─► ledger.py draft ─►
  ledger.py runs add ─► commit ─► lock release
Manual /wigley:retro ─► lock ─► backfill per profile ─► ledger.py runs ─► ripe (draft status) ─►
  round ─► runs --clear ─► commit ─► report
```

**Decisions** (from the interview):

- A visible row per retro in a Retro section at the bottom of the sidebar; muted with a dashed accent edge; the
  header counts queued closes; the row closes itself (round 1, round 2).
- Only app sessions the user closes queue a retro; the manual run backfills the rest (round 1).
- The manual run: catch-up backfill, report background runs, ripe round (round 1).
- Background runs pre-write promotion drafts; the manual run redrafts only stale or missing ones (round 1).
- The lead runs on the profile's default model, Opus today; analysts stay `wigley:reader-opus` (round 1).
- No status surface beyond the section (round 1).
- Decided notices: the plugin hooks `chat.sessionClosed`; no on/off setting (`plugins.disabled`); one run at a time
  with the queue on disk; a ledger lock; every host id of a cleared row; a re-closed row runs again (`add` dedupes);
  a retro never queues a retro; `addSection` is a registration; unattended rows deny each permission prompt at once;
  done is idle with nothing in the background; the close reason `finished`; a failed run closes and the manual
  backfill catches it up; the run's folder is `~/wigley-agents` on the closed row's profile; launched ids persist;
  Heavy's Retro button stays.

**Out of scope:** terminal sessions; a headless run; a status-bar line; Codex launches (the app launches Claude only).

## File Structure

### Shared names (every part uses these exactly)

wigley-ai-gui:

```ts
// src/plugins/chat/contract.ts
export interface LaunchRequest {
  projectDir: string;
  profile: string;
  message: UserMessage;
  // True for a session nobody answers: chat denies each permission prompt at
  // once. Kept with the row across a relaunch.
  unattended?: boolean;
}
export type SessionCloseReason = 'user' | 'start-failed' | 'project-closed' | 'finished';
export function isUserClose(reason: SessionCloseReason): boolean; // backed by a Record<SessionCloseReason, boolean>
// in ChatMainExports:
close(sessionId: string, reason: SessionCloseReason): Promise<void>;
// Ends one session chat owns, as a sessions.closed would, without asking the close
// guards; fires sessionClosed with `reason`. Resolves once its row is gone; rejects
// for a session chat does not hold.

// src/plugins/sessions/contract.ts
export interface SidebarSection {
  id: string;            // unique among registered sections
  label: string;         // the section header's text
  order: number;         // sections sort by order after Favorites and Recent
  claims(row: SessionRow): boolean;
  header?: SectionPart;  // drawn at the header's end
}
export interface SectionPart {
  build(parent: HTMLElement): { dispose?(): void };
}
// in SessionsPageExports:
addSection(section: SidebarSection): Disposable;

// src/plugins/sessions/layouts/layout.d.ts
// SectionInput.kind: 'favorites' | 'recent' | 'plugin'; SectionInput gains `id: string`
// (the kind for Favorites and Recent, the registration id for a plugin section).
// SessionRowInput gains `section: string | null`: the id of the plugin section that claimed it.
// export interface SectionKit extends SessionsKit { headerPart(parent: HTMLElement): HTMLElement; }
// Layout.section?(parent, input: SectionInput, kit: SectionKit): the layout places the header part;
// sessions builds SidebarSection.header into it.

// src/plugins/auto-retro/contract.ts
export interface AutoRetroState { rows: string[]; queued: number } // rows: the current row id of every open retro row
// queue.json keys every retro by host session id: a restored row gets a new row id.
export const autoRetroStateSlot: SlotKey<AutoRetroState, 'main', 'auto-retro'>; // id 'auto-retro.state'
```

wigley-ai-marketplace (`plugins/wigley/scripts/retro/ledger.py`):

```
ledger.py lock acquire --owner <id> [--lock-file <path>]   exit 0 taken (or already this owner's); 1 and prints
                                                           `held by <owner> since <iso time>`; a lock older than
                                                           3 hours is taken over and prints `took over <owner>`
ledger.py lock release --owner <id> [--lock-file <path>]   exit 0; releasing another owner's lock exits 1
                                                           default lock file: ~/.local/state/wigley-retro/ledger.lock
ledger.py runs add --session <id> --analyzed <id>... --note "<line>"   appends to <root>/runs.md
ledger.py runs                                                         prints each run line, oldest first
ledger.py runs --clear                                                 empties runs.md to its header
ledger.py draft <slug> --file <path> [--target <path>]   writes `## Draft` and frontmatter `draft_target` (as passed, `none` without `--target`) and `draft_hash`
ledger.py ripe                                           each item gains "draft": "missing" | "fresh" | "stale"
digest.py session <id>                                   prints `short` (exit 0, no digest) under MIN_PROMPTS
                                                         with no answer line, as backfill counts short
digest.py --projects                                     default $CLAUDE_CONFIG_DIR/projects, else ~/.claude/projects
```

### Existing files modified

- GUI `src/plugins/chat/contract.ts`, `main/chat-sessions.ts`, `main/start.ts`, `main/open-sessions.ts`,
  `main/permission-tool.ts`, and their tests — task 02
- GUI `src/plugins/session-log/main/recently-closed.ts`, `src/plugins/session-stash/main/session-stash.ts`, and their tests — task 02
- GUI `src/plugins/sessions/contract.ts`, `page/start.ts`, `page/sidebar-order.ts`, `page/sidebar-view.ts`,
  `page/sessions-view.ts`, `layouts/layout.d.ts`, `layouts/default/layout.js`, `layouts/default/layout.css` — task 03
- GUI `src/plugins/manifests.ts`, `main.ts`, `page.ts`, `scripts/check-layers.mts` when it needs an entry — task 04
- Marketplace `plugins/wigley/scripts/retro/ledger.py`, `digest.py`, their tests — task 01; both plugin manifests — task 05

### New files

- GUI `src/plugins/auto-retro/` — `manifest.ts`, `contract.ts`, `main/` (start, the pure queue, done detection),
  `page/` (the section), `layouts/` (contract and `default`). One plugin, because the queue, the rows and the section
  are one feature the user switches off in one place.

### Boundary rules

- No Claude knowledge in `auto-retro` or chat's `unattended` path: the plugin names a skill only in its message text.
- `auto-retro` reaches chat and sessions only through their exports, slots and events, listed in its manifest's
  `dependsOn` and `reads`.
- The marketplace changes keep the scripts' CLI shapes above; the GUI reads none of the ledger.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Retro scripts: lock, runs, drafts, short sessions](01-retro-scripts.md)
- [x] [Chat: unattended launch and close by id](02-chat-unattended-close.md)
- [x] [Sessions: sidebar section registration](03-sessions-sections.md)

### Wave 2
- [x] [The auto-retro plugin](04-auto-retro-plugin.md) — after 02, 03

### Wave 3
- [x] [Doc re-read](05-doc-re-read.md) — after 01, 04

### Wave 4
- [ ] [Final verification](06-final-verification.md) — after 05

## Run log

Review base: 946a8cda

### Groups
- 01 · 94313b0 · diff read; retro unittest 180 OK; check_manifests, check_pointers (after rebase onto origin/main 0122bbb), claude plugin validate pass · concerns: check_pointers failed before the rebase: the branch lacked origin/main's new wigley:wrap-up skill; lead rebased the marketplace branch onto origin/main
- 02 · fb6ba21b · diff read; Produces present (LaunchRequest.unattended, finished, isUserClose, close, SavedSession.unattended, UNATTENDED_REASON); typecheck clean outside sessions/ (03 in flight); 5 test files 534 pass; oxfmt clean on touched folders · concerns: selftest-script.ts:1185 also closes with project-closed, not named by the new SessionCloseReason comment; npm run lint fails on docs/keymap.md formatting, untouched since 3e3c2fcb (pre-existing)
- 03 · b82a3403 · diff read; Produces present (SidebarSection, SectionPart, addSection, SectionInput.kind/id, SessionRowInput.section, SectionKit.headerPart, RowClaim/ClaimedSection, sidebarSections sections arg, SessionsParts.section header); typecheck 0 errors; sessions tests 573 pass; lint clean but pre-existing docs/keymap.md format · concerns: headerPart returns a detached div when header build throws; claims failures log per order computation (orderedRows, moveFavorite too), not only per draw; accent-edge rule doubles the class to outrank hover specificity; status edge sits beside the dashed edge, unverified live; no user sessions layout and no layout setting
- 04 · ae33390d · diff read; Produces present (AutoRetroState, autoRetroStateSlot, autoRetroManifest, RetroItem/RetroQueue/QueueEvent/nextQueue/parseQueue/EMPTY_QUEUE, QUEUE_FILE/createQueueFile, DEFAULT_SETTLE_SECONDS/RESTORE_WAIT_MS/isRetroDone, both parts, layout.d.ts, readAutoRetroLayout); typecheck 0; auto-retro + layout-contracts tests 51 pass; lint clean but pre-existing docs/keymap.md · concerns: no test catches the settle timer restarting on each repeated done value; until the queue loads after a restart the slot still holds the previous start's row ids; header look left to 06
- 05 · GUI 23aa5b52, marketplace bf06bb2 · diff read in both repos; SKILL.md lock/runs/draft text checked against ledger.py; session-groups plugin-section claims checked against sidebar-order.ts; check_manifests --against origin/main and check_pointers pass on 1.22.0 · concerns: auto-retro/design.md 'a click opens the row's Chat tab' untraced (06's drive checks it); SKILL.md step 10's cancelled branch says go to step 11 before it says commit step 9's drafts
### Contract changes
### Rulings
- Two-repo run: the Review base above is the GUI worktree's tip; the marketplace worktree's review base is 00b90b5 (its tip at preflight, one docs-ahead commit past the plan's 1dbe437) — plan.py takes one sha · lead
- keep_refusal renamed open_candidate_refusal, shared by keep and draft; messages unchanged — the task asked for one shared helper — a caller elsewhere by the old name would break (none found) · group 01 · group 01
- runs --today defaults to None and becomes today inside add, so --today without add is caught — argparse default would hide it — none · group 01 · group 01
- lock acquire retries create when the lock file vanishes between O_EXCL fail and read — race with a release — none · group 01 · group 01
- Marketplace auto-retro rebased onto origin/main 0122bbb (wigley:wrap-up landed mid-run); task 01's commit is 94313b0 after the rebase; marketplace review base is now 0122bbb's child range 0122bbb..auto-retro minus the three docs-ahead commits (9373445, 9af0df4, 1737240) · lead
- startNew takes a fourth argument unattended: boolean to carry the flag from launch to openAndStart — plan left the path open — none · group 02 · group 02
- settle timer starts only when the running row turns done; a repeated done value leaves it running — the spec says set it when it turns true — a restart-per-value would delay closes · group 04 · group 04
- the 30 s restore timer drops the run only while that host still runs — a run that ended meanwhile must not be dropped twice — none · group 04 · group 04
- nextQueue throws on launched while nothing runs — impossible state — a stray launched event would log a failed step · group 04 · group 04
- retro <r> finished is logged when close is called, not when it resolves — none · group 04 · group 04
- main dispose awaits the event chain before stopping — none · group 04 · group 04
- GUI auto-retro rebased onto origin/main e9570be7 (session popups, keymap reflow) before wave 3; task commits now 02 a9ed659b, 03 dea1e6cb, 04 a4ea61a2; the lead resolved the union conflicts in sessions (layout.css and consumer-view comments, consumer-view test counts, sessions-view-fakes options, start.ts helper and comment) — the markers in fakes and start.ts slipped into dea1e6cb and are removed in 6d0e8ed5; typecheck 0, 86 test files / 2216 tests across sessions, chat, auto-retro, session-log, session-stash, shared/layouts pass, npm run lint passes (docs/keymap.md fixed upstream) · lead
- Marketplace auto-retro rebased again onto origin/main 7b3e8c4 (version now 1.21.2); the lead resolved the SKILL.md conflict in the docs-ahead commit (now 9599887) by keeping the plan's steps 6-10 and carrying main's question wording into step 10 (summary carries the candidate's summary, context the home, occurrences and draft); task 01's commit is now 0211e71; marketplace review range 7b3e8c4..auto-retro · lead
- GUI review range after the rebase: 94b63304..HEAD (94b63304 is the rewritten 946a8cda, the plan's last commit before task 02); the Review base line keeps the pre-rebase sha, which plan.py will not replace · lead
### Review rounds
### Test gate
- Picked the suites owning every changed file in both ranges: GUI npm test over src/plugins/{chat,sessions,auto-retro,session-log,session-stash} — 84 files / 2172 pass; typecheck 0; lint pass; filtered selftest chat+sessions+session-log+session-stash all passed (teardown 'Stopped python3' from context-sources after the result); marketplace retro unittest 180 OK, check_manifests --against origin/main, check_pointers, claude plugin validate pass · lead
