# Session row clock — plan

Feature: Session clock · Implements: none · Ticket: none
Target: main · Written: 2026-11-03

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Make each Sessions side-bar row more compact, and show on it the session's active run time and whether its prompt
cache is cold. The run time counts only while a turn works or background work runs. Other plugins can read the same
clock.

## Architecture

Systems touched:

- `src/shared/` — a new pure `ActiveTime` module.
- chat main (`chat-sessions.ts`, `open-sessions.ts`) — owns each session's clock and saves its total.
- chat contract and chat page — carry the clock to the page, offer it to other plugins, and draw the run time as a
  sessions row part through a new chat layout part.
- usage page and usage layout — a new `usage.rowCache` row part and `rowCache` layout part; the row line's token
  text drops its limit.
- sessions `default` layout — the compact row, and the order of the row parts.

## Preconditions

Re-run each command before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| No `active-time` module exists | `test ! -e src/shared/active-time.ts && echo absent` | `absent` |
| `SavedSession` has `hostSessionId, projectDir, profile, sent, busy, titles` | `sed -n 7,17p src/plugins/chat/main/open-sessions.ts` | as listed |
| Chat main has an injected `Clock` | `grep -n "clock: Clock" src/plugins/chat/main/chat-sessions.ts` | line 84 |
| Chat page computes row activity from `activity` and `background` | `grep -n "export function rowActivity" src/plugins/chat/page/chat-state.ts` | one hit |
| No `settings.json` layout pick hides a `default` change | `grep -c '"layout"' ~/.config/wigley-ai-gui/settings.json` | `0` |
| The peer plan `session-groups` task 05 edits the sessions layout files | `grep -n "layout.css" docs/features/session-groups/plan-session-groups/05-layout-parts.md` | one hit; not landed |

Task 05 edits `src/plugins/sessions/layouts/default/layout.js` and `layout.css`, which the peer plan's task 05 also
edits. The lead starts task 05 only when one of these is true:

- the peer task 05 box is ticked in `docs/features/session-groups/plan-session-groups/plan.md`, or that plan folder
  was closed after it landed (`git log --oneline -- src/plugins/sessions/layouts/default/layout.css` shows its
  commit);
- the user says the peer plan is dropped. Then task 05 runs on the files as they are.

Otherwise wait at task 05; tasks 01–04 do not touch those files. Do not edit those files in parallel with the peer
run. Task 06 re-reads `DESIGN.md` at `main`'s tip, since the peer plan edits the same side-bar paragraph.

## Docs written ahead

Commits `f6131b2c` and `ecfe52df`:

- `docs/features/session-clock/design.md` — the whole design.
- `docs/features/usage/design.md` — the flow lines and surface bullets for `usage.rowLine` and `usage.rowCache`.
- `docs/features/agent-chat/design.md` — `activeMs` in the saved sessions line.
- `DESIGN.md` § Surfaces — the compact Sessions row sentence.

## Mandatory Reads

- `AGENTS.md` (repo root) — Intent, Architecture, Running and testing.
- `DESIGN.md` — before any CSS or layout edit (tasks 03, 04, 05).
- `docs/features/session-clock/design.md`.
- `docs/features/layouts/design.md` — before a new layout part (tasks 03, 04).
- Every `AGENTS*.md` under a touched folder: `find src docs -name 'AGENTS*.md'`.

## Design Overview

```
chat main (chat-sessions.ts)
  turn activity + background count ──▶ isActive = activity === 'working' || background > 0
  on each change of isActive ──▶ startActiveTime / stopActiveTime (src/shared/active-time.ts)
  ──▶ channel message activeTime {sessionId, activeTime}  ──▶ save() with activeMs = activeMsAt(now)
        │
        ▼
chat page ──▶ ChatPageExports.activeTime(sessionId)  +  event chat.activeTimeChanged
          ──▶ sessions.addRowPart('chat.rowClock') ──▶ chat layout part rowClock({text, isRunning})
                                                         redrawn once a second while running

usage page ──▶ sessions.addRowPart('usage.rowLine')  meter + used tokens (`121k`)
           ──▶ sessions.addRowPart('usage.rowCache') usage layout part rowCache({isCold, tooltip})

sessions default layout: row = line 1 (title, activity) / line 2 (status, rowLine, rowClock, rowCache), no wrap
each plugin orders its own wrapper: usage.css rowLine 2, rowCache 4 · chat.css rowClock 3 + margin-left: auto
```

Decisions (round numbers are the interview's form rounds):

- The clock runs while `activity === 'working'` or `background > 0`; it pauses on `idle` and on `waiting` with no
  background work (round 1).
- Chat owns the clock on the shared `ActiveTime` module and offers it through its page exports (round 1).
- The total is saved with the session; a session opened from Claude's history starts at 0 (round 1).
- `/clear` resets the clock to 0 (round 3).
- Two tight lines: cards stay, padding and gaps shrink, the footer band becomes the card's plain second line; the
  token text drops `/300k` (round 2).
- The cache mark is a cache icon, `fg-secondary` while warm, `status-error` once cold; its tooltip is the minutes
  left (round 2, the user's note: red when cold).
- The run time is formatted with `kit.duration` (`42s`, `3m 05s`, `1h 02m`) and ticks once a second in place while
  running (Decided).
- Chat saves on each clock start and stop, and once in `killAll` before the processes end (Decided).
- A saved file without `activeMs` reads as 0, as a file without `titles` reads as no titles (Decided: the file's
  existing pattern).

Out of scope: moving the activity dock's turn timer and the agent strip's task timers onto `ActiveTime`.

## File Structure

New:

- `src/shared/active-time.ts` — the pure clock record and its functions; shared because chat main and the chat page
  both use it and future clocks build on it.
- `src/shared/active-time.test.ts`.
- `src/plugins/chat/page/row-clock.ts` — the `chat.rowClock` row part and its once-a-second tick.
- `src/plugins/chat/page/row-clock.test.ts`.

Modified: see each task's Files line.

Shared names (word for word in every task):

```ts
// src/shared/active-time.ts
export interface ActiveTime { totalMs: number; since: number | null }
export const NO_ACTIVE_TIME: ActiveTime;            // { totalMs: 0, since: null }
export function startActiveTime(time: ActiveTime, now: number): ActiveTime;
export function stopActiveTime(time: ActiveTime, now: number): ActiveTime;
export function activeMsAt(time: ActiveTime, now: number): number;
```

Boundary rules: `src/shared/active-time.ts` imports nothing. Sessions imports nothing from chat or usage; chat and
usage reach sessions only through `SessionsPageExports.addRowPart`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [ActiveTime module](01-active-time-module.md)
- [x] [Usage row cache mark and short token text](04-usage-row-cache.md)

### Wave 2
- [x] [Chat main owns and saves the clock](02-chat-main-clock.md) — after 01

### Wave 3
- [x] [Chat page exports and the row clock part](03-chat-row-clock.md) — after 02
- [ ] [Compact session row](05-compact-row.md) — after 04, and after the peer plan's task 05 (Preconditions)

### Wave 4
- [ ] [Doc re-read](06-doc-re-read.md)

### Wave 5
- [ ] [Final verification](07-final-verification.md)

## Run log

Review base: 693cb8d04eb48c87e6cba0406a0e2d850f90db54

### Groups
- 01 · 6640b41c · diff read; all Produces present; typecheck clean for the module; its table passes 7 rows · concerns: AGENTS.md src/shared listing omits active-time.ts (task 06 fixes); stop computes through activeMsAt
- 04 · 10d1cf30 · diff read; every Produces signature present; typecheck clean for usage · concerns: layouts design Adopters table omits the cache mark (task 06); rowCacheText and the default part title and is-cold have no test, live check 3 covers them; doubled log prefix row cache session line in, same shape as rowLine
- 02 · 371a1a15 · diff read; every Produces present; typecheck clean; the worker ran the chat main tests · concerns: replay drives the clock at wall time, so a kept run working across a quit is uncounted between quit and relaunch; turn start and stop saves twice, harmless; a background-only clock has no stop record before /clear resets it
- 03 · 017d5cb4 · diff read; every Produces present; typecheck clean; layer check refuses contract.ts importing src/shared, fixed by the contract change landing next · concerns: layouts design Adopters and AGENTS chat prose lag (task 06); preview rows show no run time; empty wrapper keeps margin-left auto and gap, unchecked on screen; row part and layouts.onChange Disposables dropped, chat keeps no registrations
### Contract changes
- ActiveTime: export interface in src/shared/active-time.ts → export interface in src/contracts/active-time.ts · why: scripts/check-layers.mts refuses src/plugins/chat/contract.ts importing src/shared, and AGENTS.md puts records crossing a seam in src/contracts; src/shared/active-time.ts now imports that type, so it no longer imports nothing · consumers: 02, 03 · group 03 fix
### Rulings
- Task 02 final save goes in detachAll, before isDetached = true, in place of the plan's killAll and isKilled — the session host plan replaced them after this plan was written, and detachAll is the quit path (chat/main/start.ts:475) — if wrong, a quit mid-turn loses the open span back to the last save · lead
- usage-row-cache centres on --wg-row-tree line height like usage-row-line — so the mark lines up with the meter — a look change in layout.css if wrong · group 04 · group 04
- /clear saves through its existing finally save, not a second call at the reset — a save at the reset would write the old host id with the new total — a crash in the same tick keeps the stopped total · group 02 · group 02
- the view keeps activeTimes in its own Map set before createTab — addTab draws side-bar rows before the tab is held — one redundant field if wrong · group 03 · group 03
- onActiveTime runs only for a held session — matches the background handler — a listener misses a message arriving before the tab · group 03 · group 03
- Lead: precondition met. session-groups merged to local main at 5b06f4e7, plan folder closed, reported by its run. main merged into row-clock; the UsageTone conflict kept both sides.
### Review rounds
### Test gate
