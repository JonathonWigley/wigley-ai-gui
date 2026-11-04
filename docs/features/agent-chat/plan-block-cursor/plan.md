# Chat block cursor — plan

Feature: chat block cursor · Implements: none · Ticket: none
Target: main · Written: 2026-11-04

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the user gets.
- **Architecture** — the systems this plan touches.
- **Preconditions** — the tree facts this plan rests on, with their commands.
- **Docs written ahead** — the docs that describe the code before it lands.
- **Mandatory Reads** — read these before work starts.
- **Design Overview** — the flow, the rules, what stays out.
- **File Structure** — the files and the names that tasks share.
- **Tasks** — the wave checklist.
- **Run log** — written by `wigley:make`.

## Goal

In a Chat tab, `j` and `k` move the cursor through message blocks: each paragraph, heading, top-level
list item, code block, table and quote. `J` and `K` jump between messages. `V` starts or ends a range.
`y` copies the block or range as markdown source. The cursor stays on screen when the transcript
scrolls. A plain click moves the cursor to the block under it.

This plan also closes the follow-up "One rule for the chat cursor, scroll and keys".

## Architecture

- **Markdown renderer** (`src/renderer/markdown-it/`): `block` output marks each cursor block with its
  source line range.
- **Cursor model** (`src/plugins/chat/page/entry-focus.ts`): a pure module. It holds the focus, the
  range anchor and the move rules.
- **Entry list** (`src/plugins/chat/page/entry-list.ts`): it reads block elements from drawn slots, owns
  the stop order, draws the marks, and handles scroll and click.
- **Chat commands and keys** (`chat-commands.ts`, `manifest.ts`, `keymap.ts`): the new keys.
- **Visual plugin** (`src/plugins/visual/page/visual-commands.ts`): `v` reads the block under the cursor.

## Preconditions

Each command ran at plan time. `wigley:make` runs them again before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| The `J`, `K` and `V` keys have no bind | `grep -n -E "keys: '(J\|K\|V)'" src/plugins/keymap.ts` | no match |
| `y` binds only `chat.allowPermission` in `chat.chat` | `grep -n "keys: 'y', scope: 'chat.chat'" src/plugins/keymap.ts` | one match |
| `chat.chat` has no page-level `<Esc>` bind | `sed -n 125,135p src/plugins/keymap.ts` | `<Esc>` is `chat.leaveBox`, box only |
| The turn divider is on the target | `git log --oneline --grep="Mark each turn's end" -1` | `818013f8` |

## Docs written ahead

Commit: see `git log -1 -- docs/features/agent-chat/plan-block-cursor/plan.md` and the docs commit before it.

- `DESIGN.md` § Keys and focus
- `docs/features/agent-chat/design.md`, the Chat tab keys paragraph

These docs are hypotheses until task 05 re-reads them against the landed code.

## Mandatory Reads

- `AGENTS.md`
- `DESIGN.md` § Keys and focus
- `docs/features/agent-chat/design.md`, the Chat tab keys paragraph and § Activity line
- `.agents/skills/drive/SKILL.md`, for task 06

## Design Overview

```
kit.markdown draws an entry
        │  html carries data-md-lines="start,end" on each cursor block
        ▼
entry list reads [data-md-lines] in user and assistant slots
        │
        ▼
stop order: u1#0 u1#1 a1#0 a1#1 a1#2 p1 n1 …       (dividers have no stop)
        │
        ▼
entry-focus.ts ── focus { stopId, following, anchorId } ── pure rules
        │
        ▼
entry list draws is-cursor and is-range on the block or the slot
        │
        ├── j k G gg J K V <Esc> y   chat commands
        ├── scroll event             the cursor moves to a visible stop
        └── plain click              the cursor moves to the clicked stop
```

### Rules the user settled

- Stops: `j` and `k` skip turn dividers and compaction dividers. User and assistant messages both split
  into blocks.
- Copy: `y` copies markdown source, not rendered text.
- Scroll: the cursor stays on screen. When the view scrolls, the cursor moves to the nearest visible stop.
- Click: a plain click moves the cursor. A drag that selects text and a click on a link or control do not.

### Rules the agent settled, shown to the user as Decided notices

- With a permission prompt open, `y` allows. With no prompt open, `y` copies.
- Each top-level list item is one stop, with its nested list inside it. A table, a quote and a code block
  are each one stop.
- Permission cards, notices, pending rows and activity lines keep one stop each.
- `Enter` toggles the entry that holds the cursor. `v` opens the visual under the cursor, else the first
  visual of the entry.
- `V` starts or ends a range. `y` copies and ends the range. `<Esc>` cancels the range. A range can cross
  messages. The copy puts one blank line between blocks.
- A layout gets block stops when it draws user or assistant text with `kit.markdown`. An entry with no
  marked block has one stop.
- A cursor on the last step of an open run stays there through a redraw.

### Out of scope

- Line-by-line stops.
- Stops inside the body of a thinking, tool or raw entry.
- A range that starts from the mouse.

## File Structure

Modified:

- `src/contracts/markdown.ts` — `block` doc comment
- `src/renderer/markdown-it/markdown-it-renderer.ts` — block marks
- `src/plugins/chat/page/entry-focus.ts` — the cursor model
- `src/plugins/chat/page/entry-list.ts` — stops, marks, scroll, click, copy
- `src/plugins/chat/page/chat.css` — cursor and range marks on a block
- `src/plugins/chat/page/chat-commands.ts`, `src/plugins/chat/manifest.ts`, `src/plugins/keymap.ts` — keys
- `src/plugins/chat/page/chat-kit.ts` — the Allow button's command name
- `src/plugins/chat/page/chat-view.ts`, `src/plugins/chat/contract.ts` — `focusedBlock`
- `src/plugins/visual/page/visual-commands.ts` — `v` reads the focused block

New: none. Each change has a module that owns its rule today.

Boundary rule: `entry-focus.ts` reads no DOM. The entry list is the only module that reads block elements.

Shared names:

- HTML attribute `data-md-lines="<start>,<end>"`: zero-based source lines, `end` exclusive, the same as
  markdown-it's `token.map`.
- `EntryFocus { stopId: string | null; following: boolean; anchorId: string | null }`.
- Block stop id: `` `${entryId}#${blockIndex}` ``, written by `blockStopId(entryId, blockIndex)` in
  `entry-focus.ts`.
- Command names: `chat.nextMessage`, `chat.prevMessage`, `chat.toggleRange`, `chat.cancelRange`,
  `chat.allowOrCopy`. `chat.allowOrCopy` replaces `chat.allowPermission`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Renderer block marks](01-renderer-block-marks.md)
- [ ] [Cursor model](02-cursor-model.md)

### Wave 2
- [ ] [Entry list block stops](03-entry-list-block-stops.md) — after 01, 02

### Wave 3
- [ ] [Commands and keys](04-commands-and-keys.md) — after 03

### Wave 4
- [ ] [Doc re-read](05-doc-re-read.md) — after 04

### Wave 5
- [ ] [Final verification](06-final-verification.md) — after 05

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
