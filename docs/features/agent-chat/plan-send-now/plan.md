# Send a pending message now — plan

Feature: agent-chat · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user sends a pending (queued) chat message now, mid-turn, instead of waiting for the turn to end: Cmd+Enter on
the focused pending row, or `<Leader>cs` in the box for the newest. Claude takes it into the running turn. Every user
entry joins the transcript when the agent takes the message in, not when it is written.

## Architecture

- **Harness seam** (`src/contracts/agent.ts`): `AgentProcess.send` returns the id of the user entry the harness adds
  when the agent takes the message in; `AgentProcessEvents.messageDropped(entryId)` reports a message the agent let go
  without taking in. Adapters: Claude Code (`src/main/claude-code/claude-code-harness.ts`) and the fake
  (`src/shared/fake-agent-harness.ts`).
- **Chat main** (`src/plugins/chat/main/chat-sessions.ts`, channel in `src/plugins/chat/contract.ts`): a `sendNow`
  invoke; sent rows held in the queue until their entry arrives; dropped messages returned to the box.
- **Chat page** (`src/plugins/chat/page/`, `manifest.ts`, `src/plugins/keymap.ts`) and the chat layout
  (`src/plugins/chat/layouts/`): the two key routes and the `sending` label.

## Preconditions

- `AgentProcess.send` has one caller: `grep -rn "process?.send\|process.send" src --include='*.ts' | grep -v test`
  → `src/plugins/chat/main/chat-sessions.ts` (`deliver`) only. Re-run before task 02.
- `<Leader>cs` is unbound: `grep -n "Leader>cs" src/plugins/keymap.ts` → no match.
- The Claude adapter already decodes lifecycle lines: `grep -n "lifecycle" src/main/claude-code/stream-decoder.ts`
  → `DecodedLine.lifecycle: { uuid; state } | null`.
- **Peer work in the tree**: at plan time a peer's uncommitted edits sat in `src/contracts/agent.ts`,
  `src/main/claude-code/stream-decoder.ts` and others (`git status --short`). Before task 01, run
  `git status --short src/contracts/agent.ts src/main/claude-code/`. If those files are still modified, stop and ask
  the user: the peer's hunks are never committed or reverted on the peer's behalf.

## Docs written ahead

Commit `2445145b`: `docs/features/agent-chat/design.md` § Pending messages (Sending, Send now, Pulling back,
Interrupt and exit) and `docs/keymap.md` (the `c` leader row's `cs`). They are the spec for every task below.

## Mandatory Reads

- `AGENTS.md` (repo root): the Intent and Architecture sections, and the layer check
- `DESIGN.md`: for task 03's layout and label change
- `docs/keymap.md`: for task 03's key routes
- `docs/features/agent-chat/design.md` § Pending messages, and `claude-stream.md` § Queued messages and
  § Message lifecycle

## Design Overview

```
box / pending row ──Cmd+Enter / <Leader>cs──► page sendQueuedNow(id)
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
- `<Leader>cs` in the box sends the newest pending message now (round 1, Q1)
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
- `src/shared/fake-agent-harness.ts` (+ `.test.ts`) — returns its entry id
- `src/plugins/chat/contract.ts` — `QueuedMessage.sentEntryId: string | null`; channel `sendNow(sessionId: string, queuedId: string): void`
- `src/plugins/chat/main/chat-sessions.ts` (+ `.test.ts`) — `sendNow`, sent rows, held messages, dropped and exit returns
- `src/plugins/chat/page/chat-commands.ts` (+ test if one exists) — Cmd+Enter on a pending row, `sendQueuedNow`
- `src/plugins/chat/page/entry-list.ts` — `queuedInput` passes `sent`
- `src/plugins/chat/manifest.ts`, `src/plugins/keymap.ts` — `chat.sendQueuedNow`, `<Leader>cs`
- `src/plugins/chat/layouts/layout.d.ts`, `src/plugins/chat/layouts/default/*` (+ `layout.test.ts`) — `QueuedMessageInput.sent: boolean`, label

No new files. Boundary rule: nothing outside `src/main/claude-code/` names lifecycle states or Claude.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Harness seam: entry on take-in, send returns its id](01-harness-seam.md)

### Wave 2
- [ ] [Chat main: sendNow and sent rows](02-chat-main.md) — after 01

### Wave 3
- [ ] [Chat page: key routes and the sending label](03-chat-page.md) — after 02

### Wave 4
- [ ] [Doc re-read](04-doc-re-read.md) — after 03

### Wave 5
- [ ] [Final verification](05-final-verification.md) — after 04

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
