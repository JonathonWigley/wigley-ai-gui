# Message delivery state — plan

Feature: agent-chat · Implements: none · Ticket: none
Target: main · Written: 2026-11-04

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the user sees.
- **Architecture** — the systems this plan touches.
- **Preconditions** — repository state, with the commands that check it.
- **Docs written ahead** — the instruction change outside this repo.
- **Mandatory Reads** — the files to read first.
- **Design Overview** — the flow, the rules, and what is out of scope.
- **File Structure** — the files and the shared type.
- **Tasks** — the wave checklist.
- **Run log** — written by `wigley:make`.

## Goal

A chat message shows `Sent` under its bubble. It shows `Received` only after the model starts a
response to an API request that Claude Code names as holding that message. It shows `Not received`
when the message ends with no such response. `Received` shows on the latest user message only.
`Sent` and `Not received` stay on every message that holds them.

## Architecture

- `src/main/claude-code`: the stream decoder and the session fold find the delivery state.
- `src/contracts/agent.ts`: the user `ChatEntry` carries the state.
- `src/plugins/chat`: the page gives the state to the layout, and the default layout draws it.

No new harness event is added. `src/contracts/agent.ts` states that an entry sent again with the
same id replaces the earlier one, so the fold sends the user entry again when its state changes.
Chat main (`upsertEntry`) and the attach replay (`replayPipeLog`, last version of each id) already
handle this.

## Preconditions

- `git status --short src/main/claude-code/session-fold.ts src/main/claude-code/stream-decoder.ts src/contracts/agent.ts src/plugins/chat/page/entry-list.ts src/plugins/chat/layouts/default/layout.js`
  prints nothing. Checked at plan time.
- `git show HEAD:src/main/claude-code/claude-code-harness.ts` has a misplaced `},` in `interrupt`,
  at plan time. A peer's uncommitted edit to that file fixes it. Before the first dispatch, run
  the type check from `package.json`. If that file does not compile, stop and report to the user.
  This plan does not edit that file, and a peer owns the edit.
- `docs/features/agent-chat/claude-stream.md` § Queued messages records the
  `system/status` line with `status: "requesting"` and `user_message_uuids`. Checked at plan time
  against the local session-host logs: 14 of 14 messages that reached the model had such a line
  that named the message, then a main-conversation `message_start`. `/compact` had neither. The
  sample holds 15 messages from 6 sessions, measured at plan time.

## Docs written ahead

- `~/wigley-agents/AGENTS.md` § Communication: a reply says what became of every user message
  taken in since the last reply. It is in the `wigley-agents` repo, in its own commit. No code
  depends on it, so no doc re-read task is needed.

## Mandatory Reads

- `AGENTS.md` at the repo root.
- `docs/features/agent-chat/claude-stream.md` § Queued messages.
- The `wigley:writing-code` and `wigley:writing-tests` skills.

## Design Overview

```
stdin user line ──► heldMessages (lifecycle mode, no bubble)
                        │ command_lifecycle started
                        ▼
                    entry delivery: 'sent' ──► awaiting (by uuid, isRequested: false)
                        │ main status 'requesting' names the uuid
                        ▼
                    awaiting (isRequested: true)
                        │ next main message_start
                        ▼
                    entry delivery: 'received', leaves awaiting

awaiting + terminal lifecycle for its uuid, or the process closes:
    text starts with '/'  ──► entry delivery: null, leaves awaiting
    any other text        ──► entry delivery: 'notReceived', leaves awaiting
```

Rules:

- The match is by message uuid. A response that follows a `requesting` line that does not name the
  message does not mark it received. Subagent lines (`parent_tool_use_id` is a string) never count.
- `message_start` is the signal. `message_start` does not always carry the message's uuid for a
  message folded into a running turn, so the `requesting` line is the only source of the uuid.
- Fallback mode (no `msg_lifecycle_v1`) gives `delivery: null`. That mode has no uuid evidence, so
  the app claims nothing. This covers `pushUserMessage` from `foldUserLine` and from
  `releaseAllHeldMessages`.
- Entries from a saved transcript, and fake and preview entries unless a task states otherwise, have
  `delivery: null`.
- A message that ends without `started` stays as `messageDropped` does today. It never gets a bubble.
- Queued, sending and held rows do not change.

Out of scope: any change to queued rows; any retry of a `Not received` message; a change to how the
message returns to the composer.

Copy, verbatim: `Sent`, `Received`, `Not received`.

## File Structure

Shared type, in `src/contracts/agent.ts`:

`export type UserDelivery = 'sent' | 'received' | 'notReceived';`

The user `ChatEntry` gets a required member `delivery: UserDelivery | null`. The member is required
so that the compiler finds every place that builds a user entry.

- Modify `src/contracts/agent.ts`, `src/main/claude-code/stream-decoder.ts`,
  `src/main/claude-code/session-fold.ts`, `src/main/claude-code/transcripts.ts`,
  `src/plugins/chat/main/preview/preview-session.ts`, `src/shared/fake-agent-harness.ts`.
- Modify `src/plugins/chat/layouts/layout.d.ts`, `src/plugins/chat/layouts/default/layout.js`,
  `src/plugins/chat/layouts/default/layout.css`, `src/plugins/chat/page/entry-list.ts`.
- No new source files.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Delivery state in the fold](01-delivery-in-fold.md)

### Wave 2
- [x] [Draw the delivery state](02-draw-delivery.md) — after 01

### Wave 3
- [x] [Final verification](03-final-verification.md) — after 02

## Run log

Review base: 37c3020e57be67f8aa41edfbb3e771c5eacebfee

### Groups
- 01 · d5951325 · diff read: every Produces item present; tsc clean · concerns: started before init with an unadvertised lifecycle would leave sent outside fallback; a reply with no message_start ends notReceived; saved records hold no delivery at runtime
- 02 · 41fd97f4 · diff read: Produces present on UserInput; tsc and lint clean · concerns: label look unchecked on screen until task 03; an older received entry's redraw refills its whole card, so thumbnails could flicker
- 03 · none · preview draws all three labels, Received on the last only; 10 real logs: 36 of 36 named messages received, 5 /wigley:* among them, typed /compact null, no mismatch; notReceived has no real-log evidence · concerns: notReceived and an early interrupt are unproved against real lines
### Contract changes
### Rulings
- Three test files outside the task's list took delivery: null or a new close assertion, since literal toEqual fixtures turned red — the compiler does not name them — a wider diff · group 01 · group 01
- attach_ClosedDuringAttach now expects a notReceived entry before sessionEnded, since its log has started and no requesting line — follows the rule as written — the test pins that state · group 01 · group 01
- No guard for an undefined delivery: SavedSession holds no ChatEntry and every constructor sets the field — so undefined cannot reach the page — an empty label if wrong · group 02 · group 02
- Redraw also runs holdBlocks and the label has margin-top space-1, neither named by the plan — the cursor would hold detached blocks, and the label would sit flush — one line each · group 02 · group 02
### Review rounds
### Test gate
- stream-decoder, session-fold, transcripts, claude-code-harness, fake-agent-harness (the fold and every entry source), layout-contracts (UserInput contract), src/plugins/chat/ (entry-list, layout, preview, literal fixtures) · 46 files, 1821 tests passed, no type errors
