# Clear command — plan

Feature: agent chat · Implements: none · Ticket: none
Target: main · Written: 2026-10-31

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Typing `/clear` (or Claude's names for it, `/reset` and `/new`) in a Chat tab empties the tab to one info notice,
`Conversation cleared`, and restarts the row's agent process under a new host session id, so the harness loads its
plugins, skills, MCP servers and settings again. The row keeps its place, tabs and app id; its saved record, sidebar
row, relay join and docs source follow the new id. Every process start in a row carries the control values the row
holds (model, effort, mode), so a clear, and a resume after the process exits, keep what the user set.

## Architecture

Systems touched:

- **Agent contract** (`src/contracts/agent.ts`): `AgentStart.controls`.
- **Claude adapter** (`src/main/claude-code/claude-launch.ts`, `claude-code-harness.ts`): control values become
  `--model`, `--effort` and `--permission-mode` launch flags and seed the controls the process reports first; the
  fake harness seeds the same way.
- **Sessions plugin** (`src/plugins/sessions/contract.ts`, `main/session-list.ts`, `page/tabs.ts`, `page/start.ts`):
  `OwnedSession.setHostSessionId`, the main `hostSessionChanged` event and the page `sessionHostChanged` event.
- **Docs plugin** (`src/plugins/docs/main/start.ts`): a session's docs source follows `hostSessionChanged`.
- **Notes plugin** (`src/plugins/notes/page/start.ts`): its cached host id follows `sessionHostChanged`.
- **Chat main** (`src/plugins/chat/main/chat-sessions.ts`, `start.ts`, `src/plugins/chat/contract.ts`): `clear`, the
  `clear` channel invoke, and control values passed at every start.
- **Chat page** (`src/plugins/chat/page/clear-commands.ts`, `start.ts`): the three app slash commands.
- **Self-test** (`src/plugins/chat/main/selftest-script.ts`): a clear step over the fake harness.

## Preconditions

Each was run at plan time from `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`. `wigley:make` runs them again
before the first dispatch.

| Claim | Command | At plan time |
|---|---|---|
| The activity-line and pending-messages plans have closed: both edit chat main, the chat contract and the chat page this plan edits, and task 03 builds on the pending-messages exit path that pulls queued messages back | `test ! -d docs/features/agent-chat/plan-activity-line && test ! -d docs/features/agent-chat/plan-pending-messages && echo closed` | **not yet**: activity-line mid-run; pending-messages waits on it. This run waits for both |
| No other session holds uncommitted edits in the files this plan touches | `git status --short -- src/contracts/agent.ts src/main/claude-code src/plugins/sessions src/plugins/docs/main/start.ts src/plugins/chat src/shared/fake-agent-harness.ts` | edits in `src/plugins/chat/page/chat-commands.ts`, `chat-view.ts` (another session's) |
| `AgentStart` has no `controls` field yet | `grep -n "controls" src/contracts/agent.ts` | only `controls(controls: SessionControl[])` in `AgentProcessEvents` |
| `OwnedSession` holds only `session` and `end` | `grep -n -A3 "export interface OwnedSession" src/plugins/sessions/contract.ts` | `session: AgentSession; end(): void;` |
| No app slash command named `clear`, `reset` or `new` exists | `grep -rn "name: '\(clear\|reset\|new\)'" src/plugins/chat` | no hits |
| `claude` takes the three launch flags with the control values as they are (`manual` included) | `claude --help \| grep -E -- "--(effort\|model\|permission-mode)"` | 2.1.314: `--effort` (low…max, xhigh), `--model`, `--permission-mode` (acceptEdits, auto, bypassPermissions, manual, …) |
| The launch pins `--permission-mode auto` today | `grep -n "'auto'" src/main/claude-code/claude-launch.ts` | one hit |

## Docs written ahead

`docs/features/agent-chat/design.md` — glossary (App slash command), § Flow Saved sessions (control values at every
start), § Flow Clear (new), § Plans (Plan F). Commit `e485c3b`.

## Mandatory Reads

- `AGENTS.md` (repo root) — architecture, layers, running and testing, the self-test and drive.
- `DESIGN.md` — only for task 05 if it touches anything drawn (it should not).
- `docs/features/agent-chat/design.md` — § Flow Clear, § Saved sessions, § App slash commands.
- Every `AGENTS*.md` under the touched folders: `find src docs -name 'AGENTS*.md'`.

## Design Overview

```
box: /clear | /reset | /new
   │  app slash command (page, clear-commands.ts) — nothing goes to the agent
   ▼
channel.invoke('clear', sessionId)
   ▼
chat main ChatSessions.clear(sessionId)
   ├─ old process: interrupt if a turn runs, then end(); row marked resting, shown idle, no alert;
   │  its later events are ignored (not live)
   ├─ waiting permission calls cancelled; queued messages pulled back to the box (the exit path)
   ├─ newId = randomUuid()
   ├─ owned.setHostSessionId(newId) ──► sessions: row.hostSessionId, relay joins by newId,
   │                                     emits hostSessionChanged ──► docs: session source re-keyed
   │                                     page state ──► sessionHostChanged ──► notes: cached host id
   ├─ held.hostId = newId · sent = false · historyPending = false · save()
   ├─ entries = [notice "Conversation cleared"] ──► send('entries')
   ├─ startProcess(resume false, controls = row's held values) ──► claude --session-id newId
   │                                                                --model/--effort/--permission-mode
   └─ log "conversation cleared in <folder>"
```

Every start (new, resume, resting-row send, clear) passes `AgentStart.controls` from the row's held controls.

Decisions (interview 2026-10-31, two rounds):

- The app intercepts the clear and restarts the process (round 1): Claude's own clear keeps the process, so plugins
  and settings stay as loaded, and moves to a session id the row would miss.
- Control values carried as launch settings on every start (round 2), which also fixes the loss on resume after exit.
- `/clear`, `/reset`, `/new` all clear (Decided). The fresh process starts at once (Decided). A clear during a turn
  stops it (Decided). The notice is `Conversation cleared`, info tone (Decided). Resume after a clear shows only the
  post-clear conversation; the earlier one stays in the past-sessions list (Decided).
- Design review: `OwnedSession.setHostSessionId` over closing and reopening the row (keeps app id, tabs, place);
  `hostSessionChanged` as an event any plugin can hook, over the docs plugin reading a mutated `info` (extension
  point, no hidden mutation); clear lives in `ChatSessions` beside `send` and `interrupt` (locality: it needs the held
  state, the process and `startProcess`); `AgentStart.controls` is harness-neutral (`id → value`), each adapter maps
  it.

Out of scope:

- Saving control values across an app relaunch: a restored row holds none until its process reports them.
- Claude's in-process `conversation_reset` line: the app never sends Claude `/clear`, so it is not decoded.
- Clearing the layout preview row: chat main does not hold it; `clear` for it logs and does nothing, like `send`.

## File Structure

Modified:

- `src/contracts/agent.ts` — `AgentStart.controls`.
- `src/main/claude-code/claude-launch.ts` (+ test) — flags from `controls`.
- `src/main/claude-code/claude-code-harness.ts` (+ test) — starting control values from `request.controls`.
- `src/shared/fake-agent-harness.ts` (+ test) — the same seeding; test literals gain `controls`.
- `src/plugins/sessions/contract.ts`, `src/plugins/sessions/main/session-list.ts` (+ test) — host id change, event.
- `src/plugins/sessions/page/tabs.ts` (+ `tabs.test.ts`), `src/plugins/sessions/page/start.ts` — the page event.
- `src/plugins/docs/main/start.ts` (+ test) — follows the main event.
- `src/plugins/notes/page/start.ts` — follows the page event.
- `src/plugins/chat/contract.ts` — `clear` invoke.
- `src/plugins/chat/main/chat-sessions.ts` (+ test) — controls at every start (01), `clear` (03).
- `src/plugins/chat/main/start.ts` — the `clear` channel handler.
- `src/plugins/chat/page/start.ts` — registers the clear commands.
- `src/plugins/chat/main/selftest-script.ts` — clear step.

New:

- `src/plugins/chat/page/clear-commands.ts` — the three app slash commands, beside `account-commands.ts`, same shape.

Shared names (word for word across tasks):

- `AgentStart.controls: Readonly<Record<string, string>>` — control id → value, only controls with a non-null value.
- `OwnedSession.setHostSessionId(hostSessionId: string): void`
- `SessionsMainEvents.hostSessionChanged: AgentSession` (emitted as `sessions.hostSessionChanged` on the app bus)
- `SessionsPageEvents.sessionHostChanged: { sessionId: string; hostSessionId: string | null }`
- `rowChanges(...)` returns `{ added, removed, changed }`
- `ChatSessions.clear(sessionId: string): void`
- `ChatChannel` invoke `clear(sessionId: string): void`
- Notice text `Conversation cleared`; log line `conversation cleared in <folder basename>` (scope `chat`).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the task document in
> the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Control values at launch](01-control-values-at-launch.md)
- [x] [Owned session host id change](02-owned-host-id.md)

### Wave 2
- [ ] [Chat main clear](03-chat-main-clear.md) — after 01, 02
- [ ] [Docs source and notes follow the host id](04-docs-follows-host-id.md) — after 02

### Wave 3
- [ ] [Clear commands and self-test step](05-clear-commands.md) — after 03

### Wave 4
- [ ] [Doc re-read](06-doc-re-read.md)
- [ ] [Final verification](07-final-verification.md)

## Run log

Review base: 54aed2e

### Groups
- 01 · 446d54e + fmt f12ceae · diff read: AgentStart.controls present; typecheck and lint clean; 609 wave-1 tests pass · concerns: test line numbers drifted from plan (3 extra toEqual literals needed controls: {}); claudeLaunch destructures Record<string,string> without noUncheckedIndexedAccess (runtime-correct); design.md:73 still shows --permission-mode auto (true for no held mode)
- 02 · d79c347 + fmt f12ceae · diff read: setHostSessionId, hostSessionChanged, sessionHostChanged, rowChanges.changed present; typecheck and lint clean; 609 wave-1 tests pass · concerns: chat-sessions.test.ts OwnedSession double (task 01's file) needed setHostSessionId, added by 01's worker on the lead's note; worker ran npx --version once (nothing installed)
### Contract changes
### Rulings
- fake startingControls(launchValues) takes request.controls; launch value replaces the fixed starting value — keeps the rule in the function the task names — small move if wrong · group 01
- setHostSessionId on a live session whose row was closed updates info and sends no state, as end does — a missing row means no state change — none lost · group 02
- setHostSessionId(currentId) skips the self-holding check and still emits — harmless — one extra event · group 02
- drive's started map typed StartedSession = Pick<OwnedSession,'session'|'end'> since it also holds ConnectedSession — avoids stubbing connected handles — none · group 02
### Review rounds
### Test gate
