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
| Dividers already have no cursor stop | `grep -n "isCursorRow" src/plugins/chat/page/activity-runs.ts` | present, from `5d6800f2` |

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
- `V` starts or ends a range. `y` copies and ends the range. `<Esc>` cancels the range. `G` and `gg` keep an
  open range, as in vim. A range can cross messages. The copy puts one blank line between blocks.
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
- `src/plugins/chat/page/chat-view.ts`, `src/plugins/chat/contract.ts`, `src/plugins/chat/page/start.ts` — `focusedBlock`, the clipboard adapter
- `src/shared/page/test-dom.ts` — the fake DOM the entry list tests need
- `src/shared/fake-agent-harness.ts` — a multi-block reply for the drive check
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
- [x] [Renderer block marks](01-renderer-block-marks.md)
- [x] [Cursor model](02-cursor-model.md)

### Wave 2
- [x] [Entry list block stops](03-entry-list-block-stops.md) — after 01, 02

### Wave 3
- [x] [Commands and keys](04-commands-and-keys.md) — after 03

### Wave 4
- [x] [Doc re-read](05-doc-re-read.md) — after 04

### Wave 5
- [x] [Final verification](06-final-verification.md) — after 05

## Run log

Review base: e976884ea34536afc67f149b90cdf9797c672647

### Groups
- 01 · 20e52afa · diff read, Produces present, 68 filtered tests pass, typecheck clean in its files · concerns: stock code_block attribute placement not read from node_modules, the indented row proves the mark lands on <pre>; about 25 exact-output rows now carry literal marks
- 02 · 8a95529d · diff read, all Produces present, 85 filtered tests pass, typecheck clean in its files; entry-list errors expected until 03 · concerns: an open anchor clears when its entry's block count changes, during streaming too; docs/features/followups.md near line 150 names the old onLine row, for task 05
- 03 · 5788fdcf · diff read, all Produces present, 104 filtered tests pass, typecheck clean; chat.css staged by hunk past a peer's edits · concerns: pullBack is async, so a click on a pending row moves the cursor onto it and the row's removal then follows the latest stop, and pending_ClickRow_PullsBackWithoutMovingTheCursor only passes because the fake click does not bubble; rectTop lives in test-dom.ts not entry-list.test.ts; SourceLineFakeElement's selector now duplicates the base fake
- 04 · a4f91d8e · diff read, Produces present, 187 filtered tests pass, typecheck and lint clean · concerns: docs stale for task 05 (design.md type hint, keymap.md y/n and the Shift layer); a session closed during the clipboard write gets cancelRange on a disposed list; status line width with four more prompts is for the live run
- 05 · 341909ba · diff read; follow-up gone, no line outside the plan names it · concerns: none
- 06 · eea9e6ef, 9767eb09, 4d9709f7 · 10 live checks read; 5, 8 and 9 failed then fixed and re-driven, filtered self-test rerun at the gate · concerns: bar not seen on tables, quotes, details or headings; queuedSlots spread in stopIdOfTarget now unreachable; a self-test y in an empty session stays off the clipboard only because the session is empty; whole self-test placement check not run
### Contract changes
### Rulings
- An ordered-list row and an indented-code case added beyond the five GIVEN rows — the Decisions name both and no row caught a break — one extra row if unwanted · group 01 · group 01
- entryIdOfStop removes a trailing #<digits> only, per Decisions over the Produces line — the Decisions line is explicit — an id like tool#x stays whole · group 02 · group 02
- focusStop sets following to exactly stopId === last id, clearing it on an earlier stop — a kept flag would pull the cursor back on the next redraw — a click from a following focus stops following · group 02 · group 02
- moveToMessage keeps anchorId — matches G and gg keeping an open range — one line to clear it on J and K · group 02 · group 02
- When any block of an entry ends past its line count, every stop of that entry in the range gives the whole text once — a mixed slice plus whole text would duplicate — only under a layout that draws other text · group 03
- A whitespace-only part is dropped and not counted — the reading of no part remains — a whitespace-only pending message does not copy · group 03
- Unchanged scrollTop returns early, following included — the reading of leaves the focus alone — a same-position event no longer refreshes following · group 03
- J, K and V get on-screen anchors, a gap the plan left: they are not in VIM_KEYS and the self-test's placement check fails an unplaced bind — the project rule is that a new key ships with its place on screen — the placement is a look the user can override · lead
- J, K, V and y prompts sit in the status line's type hint, hidden with it while the box has focus — the existing place for page keys the box takes over, no new part or CSS — moving them touches only composer-kit.ts · group 04
- The y prompt reads to copy or allow — it shows during a permission too, where a plain to copy would misstate it — slightly longer copy · group 04
- DESIGN.md needed no edit — each block cursor line matches chat.css and entry-focus.ts — one stale line stays if wrong · group 05
- The status line's J, K, V and y prompts move into their own group that hides when the chat tab is too narrow for it — the type hint overflowed at minimum width, 17 fit failures in the filtered self-test — those keys show in help alone in a narrow tab · lead
- A stop is visible only wholly in the band within 1px, or overlapping when taller than it — replaces the plan's overlap rule, which left a sliver with no bar against the user's rule that the cursor stays on screen — a cursor moves slightly sooner on scroll · group 06
- A click on a pending row leaves the cursor — pullBack is async so the row is still a stop when the click bubbles, against the plan's rule — none, the row's own click still pulls back · group 06
- List items draw the bar and tint on a ::before and p uses margin plus padding — a list marker follows the item's box edge — a little more CSS if wrong · group 06
### Review rounds
### Test gate
