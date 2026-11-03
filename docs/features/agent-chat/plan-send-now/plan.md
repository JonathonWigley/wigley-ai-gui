# Send a pending message now — plan

Feature: agent-chat · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user sends a pending (queued) chat message now, mid-turn, instead of waiting for the turn to end: Cmd+Enter on
the focused pending row sends that row; Cmd+Enter in the box sends the box and every unsent pending message, in the
order written (as Enter while idle). Claude takes it into the running turn. Every user
entry joins the transcript when the agent takes the message in, not when it is written.

## Architecture

- **Harness seam** (`src/contracts/agent.ts`): `AgentProcess.send` returns the id of the user entry the harness adds
  when the agent takes the message in; `AgentProcessEvents.messageDropped(entryId)` reports a message the agent let go
  without taking in. Adapters: Claude Code (`src/main/claude-code/claude-code-harness.ts`) and the fake
  (`src/shared/fake-agent-harness.ts`).
- **Chat main** (`src/plugins/chat/main/chat-sessions.ts`, channel in `src/plugins/chat/contract.ts`): a `sendNow`
  and a `sendAllNow`
  invoke; sent rows held in the queue until their entry arrives; dropped messages returned to the box.
- **Chat page** (`src/plugins/chat/page/`, `manifest.ts`, `src/plugins/keymap.ts`) and the chat layout
  (`src/plugins/chat/layouts/`): the two key routes and the `sending` label.

## Preconditions

- `AgentProcess.send` has one caller: `grep -rn "process?.send\|process.send" src --include='*.ts' | grep -v test`
  → `src/plugins/chat/main/chat-sessions.ts` (`deliver`) only. Re-run before task 02.
- `<Leader>cs` is unbound: `grep -n "Leader>cs" src/plugins/keymap.ts` → no match.
- The Claude adapter already decodes lifecycle lines: `grep -n "lifecycle" src/main/claude-code/stream-decoder.ts`
  → `DecodedLine.lifecycle: { uuid; state } | null`.
- **The chat-bar run lands first**: a peer's `wigley:make` run of `docs/features/chat-bar/plan-strip-and-status-line/`
  edits `src/plugins/chat/contract.ts`, `chat/page/{entry-list,chat-view,chat-commands}.ts`, `chat/main/start.ts`,
  `src/plugins/keymap.ts` and the docs, all of which this plan touches. Start only once that plan folder is gone
  (`test -d docs/features/chat-bar/plan-strip-and-status-line && echo still running`) and
  `git status --short src/` is empty. Otherwise stop and ask the user. A peer's hunks are never committed or reverted
  on the peer's behalf.
- **Commits use explicit pathspecs** (`git commit -m … -- <paths>`): another session may have files staged in this
  tree.

## Docs written ahead

Commits `2445145b`, `d035a2db` and the plan's own last commit: `docs/features/agent-chat/design.md` § Pending messages (Sending, Send now, Pulling back,
Interrupt and exit, and the `queuedMessage` part line) and `docs/keymap.md` (the `c` leader row's `cs`). They are the spec for every task below.

## Mandatory Reads

- `AGENTS.md` (repo root): the Intent and Architecture sections, and the layer check
- `DESIGN.md`: for task 03's layout and label change
- `docs/keymap.md`: for task 03's key routes
- `docs/features/agent-chat/design.md` § Pending messages, and `claude-stream.md` § Queued messages and
  § Message lifecycle

## Design Overview

```
pending row ──Cmd+Enter──► page sendQueuedNow(id)      (box ──Cmd+Enter──► sendAllNow: every unsent row, then the box)
        │                                          │ invoke sendNow(sessionId, queuedId)
        ▼                                          ▼
                                   chat main: row unsent? ─no─► log, nothing
                                          │ yes
                                          ▼
                     entryId = process.send(message)   (throws → row stays unsent, log)
                     row.sentEntryId = entryId; send 'queued' (label: sending)
                                          │
              Claude adapter: write stdin user line with uuid; hold the entry draft by uuid
                     │                                   │
     lifecycle `started` (or write, no lifecycle)   terminal state with no `started`
                     ▼                                   ▼
       emit user entry (id = entryId)          events.messageDropped(entryId)
                     ▼                                   ▼
   chat main: drop the row whose sentEntryId     chat main: return the message to the box,
   matches; send 'queued'                        drop its row; log `sent message <id> returned: never taken in`
```

- Claude folds a mid-turn message into a tool turn at the next model request, or runs it after a turn with no tool
  call; nothing in the app decides which.
- Ctrl+C returns only unsent rows; sent rows stay and run after the interrupt. Exit returns every held message.
- Out of scope: cancelling a sent message (Claude's `interrupt_cancel_queued_v1` is unmeasured); a click route for
  send-now.

Decisions (rounds 1–2 and the design review):

- Cmd+Enter on a focused pending row sends it now; anywhere else Cmd+Enter is unchanged (round 1 notice)
- Only that message jumps the queue (round 1 notice)
- ~~`<Leader>cs` in the box sends the newest pending message now (round 1, Q1)~~ — replaced in round 3
- Round 3 (user, relayed by session ai-dev-2e during the run): Cmd+Enter in the box, while busy, sends the box text plus every unsent pending message into the running turn in the order written; while idle, as Enter. Cmd+Enter on a focused pending row still sends that row only. No `<Leader>cs`, no `chat.sendQueuedNow`
- The user entry lands when the agent takes the message in, for every send (round 1, Q2)
- `send` returns the entry id; chat matches rows by it (round 2 notice)
- A sent row reads `sending` and cannot be pulled back (round 2 notice)
- Ctrl+C leaves sent rows with Claude (round 2, Q1)
- Dropped messages come back through a harness event, not an idle guess: an idle shows in the gap after an
  interrupt while Claude still holds the message (design review)
- Chat main holds every message it writes, idle sends included, until its entry arrives, so a dropped idle send
  also returns to the box (design review)

## File Structure

Modified:

- `src/contracts/agent.ts` — `AgentProcess.send(message: UserMessage): string`; `AgentProcessEvents.messageDropped(entryId: string): void`; doc comments
- `src/main/claude-code/claude-code-harness.ts` (+ `.test.ts`) — entry on `started`, `messageDropped`
- `src/main/claude-code/turn-tracker.ts` (+ `.test.ts`) — `mode()`
- `src/shared/fake-agent-harness.ts` (+ `.test.ts`) — returns its entry id
- `src/plugins/chat/contract.ts` — `QueuedMessage.sentEntryId: string | null`; channel `sendNow(sessionId: string, queuedId: string): void` and `sendAllNow(sessionId, message | null): void`
- `src/plugins/chat/main/chat-sessions.ts` (+ `.test.ts`) — 01's `messageDropped` stub; 02's `sendNow`, sent rows, held messages, dropped and exit returns
- `src/plugins/chat/main/start.ts` (+ `start.test.ts`) — the `sendNow` channel handler, ignored in the preview
- `src/plugins/chat/page/chat-commands.ts` (+ `.test.ts`) — Cmd+Enter on a pending row, `sendQueuedNow`
- `src/plugins/chat/page/chat-view.ts` — `ChatSession.isBoxFocused()`
- `src/plugins/chat/page/entry-list.ts` (+ `.test.ts`) — `queuedInput` and `isQueuedChanged` carry `sent`
- `src/plugins/chat/main/selftest-script.ts` — a Cmd+Enter send-now step
- `src/plugins/chat/manifest.ts`, `src/plugins/keymap.ts` — `chat.sendNow`, Cmd+Enter in `chat.chat` bound to it
- `src/plugins/chat/layouts/layout.d.ts`, `src/plugins/chat/layouts/default/layout.js` (+ `layout.test.ts`) — `QueuedMessageInput.sent: boolean`, label

No new files. Boundary rule: nothing outside `src/main/claude-code/` names lifecycle states or Claude.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Harness seam: entry on take-in, send returns its id](01-harness-seam.md)

### Wave 2
- [ ] [Chat main: sendNow and sent rows](02-chat-main.md) — after 01

### Wave 3
- [ ] [Chat page: key routes and the sending label](03-chat-page.md) — after 02

### Wave 4
- [ ] [Doc re-read](04-doc-re-read.md) — after 03

### Wave 5
- [ ] [Final verification](05-final-verification.md) — after 04

## Run log

Review base: 495866206a2877ebce1a939c301f551fbe01d49b

### Groups
- 01 · 2db2f106 · diff read: send(): string and messageDropped on AgentProcess/AgentProcessEvents in agent.ts, TurnTracker.mode() and TurnMode exported; whole-tree tsc clean; worker's three test files pass (159 tests) · concerns: chat-sessions stub comment names the plan (task 02 replaces it); whole-tree lint stops on peer files outside this task, oxfmt clean on the 8 touched files
### Contract changes
- TurnTracker exports: mode() and TurnMode → plus TERMINAL_STATES exported · why: the adapter reads the same terminal set rather than copying it · consumers: none · group 01
### Rulings
- Round 3 key routes folded into 02–05 (user decision relayed by session ai-dev-2e): <Leader>cs and chat.sendQueuedNow dropped; Cmd+Enter in the box runs chat.sendNow → sendAllNow (every unsent row then the box message while busy, as Enter while idle); 02 gains sendAllNow because the box route needs main support; Enter/Shift+Enter in insert mode left to ai-dev-2e's own change — cost if wrong: 02/03 rework before they start · lead
- hold released right after tracker.read, before the line's entries, so messageDropped and the held entry precede syncActivity — cost if wrong: order differs only on a line carrying both lifecycle and entries, which command_lifecycle lines never do · group 01 · group 01
- held drafts cleared in markClosed (close and never-spawned error), so a lifecycle line after close releases nothing — cost if wrong: none · group 01 · group 01
- harness test recordingEvents gained a timeline to check entry/userMessage/skillStarted/messageDropped/activity order; drop rows send a successResult first so the terminal line causes the idle activity — cost if wrong: none · group 01 · group 01
### Review rounds
### Test gate
