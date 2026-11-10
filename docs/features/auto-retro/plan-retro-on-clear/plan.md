# Retro on clear — plan

Feature: auto-retro · Implements: none · Ticket: none
Target: main · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the run changes for the user.
- **Architecture** — the plugin and files touched.
- **Preconditions** — repository facts the plan rests on, with the command that checks each.
- **Docs written ahead** — the docs already changed, and their commits.
- **Mandatory Reads** — what every worker reads first.
- **Design Overview** — the after-state flow, decisions and out-of-scope items.
- **File Structure** — every file the run changes.
- **Tasks** — the wave checklist.
- **Run log** — written by `wigley:make`.

## Goal

A `/clear` in a session ends a conversation. The auto-retro plugin queues a retro of that conversation at the clear,
the same way it queues one when the user closes a row. Today the plugin holds the pre-clear ids until the row closes,
and drops them when the last conversation sent nothing.

## Architecture

One plugin changes: `auto-retro` in wigley-ai-gui (`src/plugins/auto-retro/main/`). Chat's `chat.sessionCleared`
event already carries every field the plugin needs (`profile`, `titles`, `sent`), so chat does not change.

## Preconditions

Re-run each command before the first dispatch.

- `chat.sessionCleared` carries `profile`, `titles` and `sent`:
  `grep -n -A9 "sessionCleared: {" src/plugins/chat/contract.ts` shows `profile: string`, `titles: SessionTitles` and
  `sent: boolean`.
- The emit sends the titles of the row and `sent` of the conversation that the clear ended:
  `grep -n -B12 -A8 "deps.emit('sessionCleared'" src/plugins/chat/main/chat-sessions.ts` shows `sent: wasSent`, read
  before `session.sent = false`.
- Only `auto-retro` reads the queue's `cleared` field:
  `grep -rn "\.cleared\b\|cleared:" src --include=*.ts | grep -v "src/plugins/auto-retro/"` prints no queue use.

## Docs written ahead

Commit `eaa438b1` on this branch:

- `docs/features/auto-retro/design.md` — § Intent, § Flow, § The queue (What queues, What a run gets), § Done, and
  the new decision "A retro at the clear, not at the close".
- `AGENTS.md` — the `auto-retro/` line of the Architecture tree.

In wigley-ai-marketplace: `plugins/wigley/skills/retro/SKILL.md` — the description and the `auto <session ids>` row of
§ Modes.

## Mandatory Reads

- `AGENTS.md` (repo root): § Intent ("One user, no backwards compatibility"), § Architecture "A plugin", "A slot", "An
  event", § Running and testing (`npm test`, `npm run lint`).
- `docs/features/auto-retro/design.md`, whole.
- `~/wigley-agents/AGENTS.md`.

## Design Overview

```
chat.sessionClosed (reason user, sent) ─┐
                                        ├─► nextQueue: is the row a retro row?
chat.sessionCleared (sent)  ────────────┘     yes → no item (a retro row's clear still remaps `launched` and `running`)
                                              no, sent → queued += { hostIds: [the ended id], profile, title }
                                              no, not sent → no item
                                        ──► commit → launch one at a time (unchanged)
```

Decisions:

- A clear whose ended conversation sent a message queues one item: `hostIds` holds only the old host id. The item
  takes the event's `profile` and `editableTitle(titles)`, the same as a close.
- A close queues only the row's current host id. The queue no longer keeps the earlier ids of a row.
- `RetroQueue.cleared` is deleted from the type, `EMPTY_QUEUE`, `parseQueue` and every test. No migration: the repo
  takes no backwards compatibility (`AGENTS.md` § Intent). A `queue.json` that still holds a `cleared` key parses, since
  the shape check ignores keys it does not read, and the next save drops the key.
- The retro-row check is the same for a clear and a close: the old host id is in `launched`, or
  `titles.firstMessage` opens with `` `${RETRO_COMMAND} ` ``. Put that check in one function that both paths call.
- A clear of a retro row keeps today's behaviour: `launched` and `running.hostSessionId` move to the new host id.
- A queued clear logs the same line a queued close logs: `queued retro of <host ids> (<n> queued)`.

Out of scope:

- A retro row in the Retro section for the retros started by hand on 2026-11-09 (they ran as `claude -p` outside the
  app).
- The open follow-ups on auto-retro in `docs/features/followups.md` (selection after close, done before first turn,
  restored rows).

## File Structure

Modified:

- `src/plugins/auto-retro/main/retro-queue.ts` — the `cleared` event carries the fields that queue an item; the
  `cleared` map is deleted.
- `src/plugins/auto-retro/main/start.ts` — the `chat.sessionCleared` listener passes the new fields; the queued-item
  log covers a clear.
- `src/plugins/auto-retro/main/retro-queue.test.ts`, `src/plugins/auto-retro/main/start.test.ts` — rows for the new
  behaviour; rows that assert the `cleared` map are rewritten or deleted.

No new files.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Queue a retro at each clear](01-queue-retro-at-clear.md)

### Wave 2
- [ ] [Doc re-read](02-doc-re-read.md) — after 01

### Wave 3
- [ ] [Final verification](03-final-verification.md) — after 02

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
