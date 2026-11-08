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
| GUI worktree on branch `auto-retro`, based on `main` | `git -C /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-auto-retro log --oneline 9ea97ead..auto-retro` | the docs-ahead and plan commits only, ending `b218590b` |
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

- GUI commits `6a8180ca`, `d2303908` and `3946121e` on `auto-retro`:
  - `docs/features/auto-retro/design.md` (new)
  - `AGENTS.md`: the `sessions` page entry (`addSection`), the new `auto-retro/` entry, chat's `launch`/`close` exports
  - `docs/features/session-log/design.md`: the `closed` row names the `finished` reason
  - `docs/features/layouts/design.md` Adopters and `DESIGN.md` § Side bar: plugin sections
  - `docs/features/agent-chat/design.md` § Chat plugin: **Saved sessions** (`unattended`, which closes remove a
    record) and **Permissions** (an unattended row denies at once), in `d2303908`
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
- [ ] [Retro scripts: lock, runs, drafts, short sessions](01-retro-scripts.md)
- [ ] [Chat: unattended launch and close by id](02-chat-unattended-close.md)
- [ ] [Sessions: sidebar section registration](03-sessions-sections.md)

### Wave 2
- [ ] [The auto-retro plugin](04-auto-retro-plugin.md) — after 02, 03

### Wave 3
- [ ] [Doc re-read](05-doc-re-read.md) — after 01, 04

### Wave 4
- [ ] [Final verification](06-final-verification.md) — after 05

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
