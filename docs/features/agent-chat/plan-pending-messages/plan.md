# Pending messages — plan

Feature: agent chat · Implements: none · Ticket: none
Target: main · Written: 2026-10-30

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A message the user sends while the session's turn runs waits in the app instead of going to the agent. The Chat tab
shows it as a pending row after the last entry. The user can pull it back into the message box to edit it: Enter or
a click on the row, or `<Leader>cp` from the box for the newest. When the turn ends, chat main writes the oldest
pending message to the agent as its own turn. Ctrl+C and a process exit pull every pending message back into the
box.

## Architecture

Systems touched:

- **Chat channel contract** (`src/plugins/chat/contract.ts`): `QueuedMessage`, `ChatSessionState.queued`, the
  `queued` and `returned` messages, and the `pullBack` invoke.
- **Chat main** (`src/plugins/chat/main/chat-sessions.ts`, `start.ts`, `preview/`): the per-session queue, sending
  the oldest message when the turn ends, pull-back, and returning every message on interrupt and on exit. No harness
  adapter changes: the queue is harness-neutral.
- **Chat layout contract** (`layouts/layout.d.ts`, `page/read-chat-layout.ts`, the built-in `layouts/default/layout.js`):
  a new `queuedMessage` part.
- **Chat page** (`page/entry-list.ts`, `chat-view.ts`, `chat-commands.ts`, `manifest.ts`, `src/plugins/keymap.ts`):
  pending rows as cursor stops after the entries, Enter, click and `<Leader>cp` pull-back, and returned messages put
  back into the box.
- **Self-test** (`src/plugins/chat/main/selftest-script.ts`): steps over the fake harness's `fake: hold` turn.

## Preconditions

Each was run at plan time from `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`. `wigley:make` runs them again
before the first dispatch.

| Claim | Command | At plan time |
|---|---|---|
| The activity-line plan has closed: tasks 02 and 03 build on its `activity-runs.ts` stops, its `activity` part and its rewritten `entry-list.ts` | `test ! -d docs/features/agent-chat/plan-activity-line && test -f src/plugins/chat/page/activity-runs.ts && echo closed` | **not yet**: the plan was mid-run (tasks 04–10 open), so this run waits for it |
| `chat-sessions.ts` names permission calls `pending`, so the new queue takes the name `queued` | `grep -n "pending: Map<string, PendingPermission>" src/plugins/chat/main/chat-sessions.ts` | one hit |
| Today a send while working writes straight to the process | `grep -n "session.process?.send(message)" src/plugins/chat/main/chat-sessions.ts` | one hit, in `deliver` |
| The fake harness has a turn that holds until an interrupt | `grep -n "fake: hold" src/plugins/chat/main/start.ts` | one hit, in the drive action's description |
| `<Leader>cp` is free | `grep -n "Leader>cp" src/plugins/keymap.ts` | no hit |
| The page's put-back helper exists | `grep -n "^function putBack" src/plugins/chat/page/chat-commands.ts` | one hit |

Other plans that touch the same files: `docs/features/chat-panes/plan-chat-panes/` (`chat-view.ts`) and
`docs/features/agent-tower/plan-subagent-lines/` (`contract.ts`, `chat-sessions.ts`, `start.ts`). Run this plan
before or after them, never at the same time in this tree. Line references in the task documents were measured
before the activity-line plan closed: re-verify them.

## Docs written ahead

Commit `cb9591f`:

- `docs/features/agent-chat/design.md`: § Chat plugin › Pending messages (new), the Chat tab keys line, and § Layouts'
  part list (`queuedMessage`)
- `docs/keymap.md`: the `c` leader row (`cp`)

## Mandatory Reads

- `AGENTS.md`
- `DESIGN.md` (task 02: tokens and primitives; the pending row's look itself is in `docs/features/agent-chat/design.md` § Pending messages)
- `docs/keymap.md` (task 03)
- `docs/features/agent-chat/design.md` § Chat plugin › Pending messages and § Layouts
- `docs/features/layouts/design.md` (task 02: a new part's contract and its `default` layout)

## Design Overview

```
 page                                     chat main                              agent process
 ────                                     ─────────                              ─────────────
 send ──► invoke send ──► turn running? ──no──► deliver ──────────────────────► send (user entry)
                              │yes
                              ▼
                         queued.push ──► msg queued{list} ──► entry list: pending rows (cursor stops)

 harness activity idle ──► queued non-empty? ──yes──► shift oldest ──► msg queued ──► deliver ──► next turn
                                 │no                    (shown activity stays working; no turn-finished alert)
                                 ▼
                           shown idle, alert as today

 Enter / click on a pending row ┐
 <Leader>cp (newest)            ├─► invoke pullBack(id) ──► in queue? ──no──► log "queued message <id> already sent"
                                ┘                             │yes
                                                              ▼
                                         remove ──► msg queued ──► msg returned[msg] ──► page puts it in the box

 Ctrl+C ──► invoke interrupt ──► return every queued message (msg queued [], msg returned[all]) ──► process.interrupt()
 process ended ──────────────► return every queued message ──► exit notice, rest (as today)
```

### Decisions

- **The app holds the queue** (round 1): measured Claude behaviour cannot take a queued message back
  (`claude-stream.md` § Queued messages), so chat main writes one message per turn and holds the rest.
- **Each queued message runs as its own turn, in the order sent** (round 1).
- **Pending rows sit after the last entry**, in the entry list's scroller, each drawn by the layout's
  `queuedMessage` part (round 1). A following focus keeps them in view as it does the latest entry.
- **Pull-back** (round 1): pending rows are cursor stops after the entries; Enter or a click pulls the row back;
  `<Leader>cp` in the box pulls back the newest.
- **Ctrl+C pulls every queued message back** into the box (round 1, the user's choice over leaving them queued), then
  interrupts. It pulls them back even when the interrupt itself does nothing.
- **The queue lives in chat main** beside each `HeldSession` (round 1 notice): a page reload redraws it from
  `sessions`, and no harness adapter changes.
- **A queued message joins the transcript when it is written to the agent** (round 1 notice): the harness emits its
  user entry then, as it does for any send.
- **A pulled-back message goes into the box ahead of any draft** through the existing `putBack` path (round 1
  notice). Several returned at once land oldest at the top: put back newest first.
- **A process exit pulls every queued message back** (round 1 notice): nothing is written to a process started later.
- **The queue is not saved across a quit** (round 1 notice); closing the row drops it silently.
- **Code name `queued`, UI label `pending`** (design review): `pending` already names chat main's permission calls
  (`HeldSession.pending`), `historyPending` and `oldestPendingPermission`; `queued` matches `claude-stream.md`.
- **The drain hides the idle in between** (design review): when the harness reports `idle` with messages queued,
  chat main writes the oldest and leaves `harnessActivity` as it was, so the shown activity never flickers to idle,
  `save()` sees no turn boundary and the turn-finished alert waits for the last message.
- **"Turn running" for queueing** is `state.running && state.activity !== 'idle'`, so a turn waiting on a permission
  (`waiting`) queues too (design review).
- **One return path** (design review): every pull-back, interrupt and exit reaches the page as the `returned` message;
  the page does not care which caused it. A page reload between a return and its message loses nothing that main
  still holds; a message already returned is not resent.
- **The drain is guarded** (cold read): Claude reports `idle` before `ended` when its process closes mid-turn, so a
  write that throws puts the message back at the queue's head and the report counts as a normal idle.
- **Pending slots stay last in the `ol`** (cold read): new entry slots go in before the first pending slot.
- **`returned` is handled in page `start.ts`** (cold read), which holds both the view and the command deps.
- **No new module for the queue** (design review, deletion test): a queue is an array and three call sites inside
  `chat-sessions.ts`; a module of its own would be shallow.
- **The `queuedMessage` part's kit is the plain `BaseKit`** through `surfaceBaseKit`, as the `activity` part's is
  (design review); its input is the text and an image count, not the images: the row shows no thumbnails.
- **App slash commands never queue**: they run on the page before `send` is invoked, as today (design review).

### Out of scope

- A pending count in the sidebar row's status or the composer bar.
- Editing a pending message in place; pull-back then send is the edit.
- Joining queued messages into one turn.
- Saving the queue across a quit.

## File Structure

Modified:

- `src/plugins/chat/contract.ts` — 01
- `src/plugins/chat/main/chat-sessions.ts`, `chat-sessions.test.ts`, `start.ts`, `preview/chat-preview.ts`, and every
  `ChatSessionState` literal the compiler names, page side included (`chat-view.ts`, `composer-kit.test.ts`,
  `composer-input.test.ts`, `chat-commands.test.ts`, `layouts/default/layout.test.ts`), given `queued: []` — 01
- `src/plugins/chat/layouts/layout.d.ts`, `layouts/default/layout.js`, `layouts/default/layout.test.ts`,
  `src/plugins/chat/page/read-chat-layout.ts`, `read-chat-layout.test.ts`, `src/plugins/chat/page/chat.css` — 02
- `src/plugins/chat/page/entry-list.ts`, `entry-list.test.ts`, `chat-view.ts`, `chat-commands.ts`,
  `chat-commands.test.ts`, page `start.ts`, `src/plugins/chat/manifest.ts`, `src/plugins/keymap.ts` — 03
- `src/plugins/chat/main/selftest-script.ts` — 04

Created: none.

Shared names (more than one task uses them):

- `export interface QueuedMessage extends UserMessage { id: string }` — `src/plugins/chat/contract.ts` (01)
- `ChatSessionState.queued: QueuedMessage[]` — `contract.ts` (01)
- `ChatChannel.invoke.pullBack(sessionId: string, queuedId: string): void` — `contract.ts` (01)
- `ChatChannel.messages.queued: { sessionId: string; queued: QueuedMessage[] }` — `contract.ts` (01)
- `ChatChannel.messages.returned: { sessionId: string; messages: UserMessage[] }` — `contract.ts` (01)
- `export interface QueuedMessageInput { text: string; imageCount: number }` — `layout.d.ts` (02)
- `ChatLayout.queuedMessage?(parent: HTMLElement, input: QueuedMessageInput, kit: BaseKit): PartView<QueuedMessageInput>`
  — `layout.d.ts` (02)
- Log lines the self-test waits on, both page side (03): `<n> pending message(s) in <session name>` and `pulled back
  <n> message(s) in <session name>`
- `export function putBack(deps: Pick<ChatCommandDeps, 'tabs' | 'log'>, session: ChatSession, messages: readonly UserMessage[]): void`
  — `src/plugins/chat/page/chat-commands.ts` (03)

Boundary rules:

- No file under `src/main/claude-code/` or `src/shared/fake-agent-harness.ts` changes: the queue is chat's.
- The built-in layout stays plain JS under `// @ts-check`, importing types only from `../layout`.
- `npm run lint`'s layer and style checks hold: no raw colour, length or font in CSS.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Chat main queue and the channel](01-main-queue.md)

### Wave 2
- [ ] [The queuedMessage layout part](02-queued-message-part.md) — after 01 (shares `layout.test.ts`)

### Wave 3
- [ ] [Pending rows, pull-back keys and put-back on the page](03-page-pending-rows.md) — after 01, 02

### Wave 4
- [ ] [Self-test steps](04-selftest-steps.md) — after 03

### Wave 5
- [ ] [Doc re-read](05-doc-re-read.md) — after 04

### Wave 6
- [ ] [Final verification](06-final-verification.md) — after 05

## Run log
Review base: 7f62c7d

