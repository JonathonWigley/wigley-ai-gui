# Working block — plan

Feature: agent-chat · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

While a chat session works on a turn, the Chat tab shows one working block under the last entry. The block shows
the turn's time, a state word, a box of the latest tool calls and the turn's tool counts. The block goes when the
turn ends. The live activity line draws as its summary line. The result entry shows its cost in cents.

## Architecture

Systems touched, all in the chat plugin's page side:

- `src/plugins/chat/layouts/layout.d.ts` — the chat layout contract gets the `working` part and its input.
- `src/plugins/chat/page/working-turn.ts` (new) — a pure module: the session's entries in, the working input out.
- `src/plugins/chat/page/entry-list.ts` — the list draws the working slot and ticks it.
- `src/plugins/chat/layouts/default/layout.js` and `src/plugins/chat/page/chat.css` — the built-in look.

No main-side, adapter or contract (`src/contracts/`) change. The Claude adapter is not touched.

## Preconditions

Each was verified at plan time on 2026-11-02. `wigley:make` runs each again before the first dispatch.

- The chat layout has an `activity` part with `ActivityInput`:
  `grep -n "export interface ActivityInput" src/plugins/chat/layouts/layout.d.ts` → one hit.
- The part set is a closed record: `grep -n "const PART_SET" src/plugins/chat/page/read-chat-layout.ts` → one hit.
- `ChatPartName` derives from `ChatLayout`'s keys:
  `grep -n "export type ChatPartName" src/plugins/chat/page/chat-layouts.ts` → `Exclude<keyof ChatLayout, 'entries'>`.
- The entry list ticks only a live run today: `grep -n "const runTick" src/plugins/chat/page/entry-list.ts` → one hit.
- The self-test's chat script takes the `activity-live` screenshot:
  `grep -n "activity-live" src/plugins/chat/main/selftest-script.ts` → one hit.
- The default layout is typed complete, so a new part needs a default:
  `grep -n "CompleteChatLayout" src/plugins/chat/layouts/default/layout.js` → one hit.
- The agents self-test lists the live shortlist's ellipsis box:
  `grep -n "'.chat-activity-step'" src/plugins/agents/main/selftest-script.ts` → one hit.
- `npm test` is `vitest run` only; typecheck and lint are their own scripts:
  `grep -n '"test"\|"typecheck"\|"lint"' package.json` → three hits.
- `plan-turn-tracking/` (another plan in this feature folder) changes only main-side files in
  `src/main/claude-code/` and `src/main/main.ts`, so it shares no file with this plan:
  `grep -n "Systems touched" docs/features/agent-chat/plan-turn-tracking/plan.md`. Its fix makes a turn Claude starts
  on its own show as working; task 01's turn rule covers that turn.

## Docs written ahead

`docs/features/agent-chat/design.md` — § Chat plugin › Activity line (Live run), the new § Working block, § Layouts
(the `working` part) and § Plans (Plan G); `DESIGN.md` § Surfaces, the Chat bullet. Commits: `44bf74fd` and the
commit that closes the cold read's gaps.

## Mandatory Reads

- `AGENTS.md` (repo root)
- `DESIGN.md` — every task that draws or styles (02)
- `docs/features/agent-chat/design.md` § Chat plugin › Activity line and › Working block, § Layouts

## Design Overview

```
session entries ──► working-turn.ts  workingInput(entries, now)
   (chat-view)          │   turn = from the later of the last user entry
                        │          and the entry after the last result
                        │   state = waiting > working > writing > thinking
                        ▼
entry-list.ts ── while working: one working slot after the last entry,
   │              before the pending rows; not a cursor stop;
   │              redrawn on every change, `now` sent again each second
   ▼
layout `working` part (default: layout.js)
   ┌──────────────────────────────────────┐
   │ 1:05 Working…                         │  header: m:ss time, state word
   │ ┌──────────────────────────────────┐ │
   │ │ Read chat-kit.ts                 │ │  box: latest 5 tool calls,
   │ │ Edit design.md                   │ │       newest highlighted
   │ │ Bash npm test                    │ │
   │ └──────────────────────────────────┘ │
   │ Read 3 Bash 2 Edit 1                  │  counts: most used first
   └──────────────────────────────────────┘
layout `activity` part: live or finished, one summary line
layout `result` entry: `end_turn · $0.50 · 4.2 s`
```

Out of scope:

- Any cost in the block. Claude reports cost only at turn end (user, round 2).
- A live cost estimate from token counts (user, round 1).
- A spinner. The cube and sphere in the sketch are doodles (user, round 1).
- Any change to the finished activity line, the open line, or the result line except its cost format.

Decisions:

- One block per turn, under the latest entry, while the session works (round 1).
- State words: Thinking, Writing, Working, Waiting (round 1).
- The built-in box lists tool calls only. The part's input carries every step of the turn (round 1, design review).
- The block goes when the turn ends (round 1).
- No cost slot in the block. The result line shows cost as `$0.00` (round 2, user note round 1).
- Timer `m:ss`, `h:mm:ss` past an hour. Box shows 5 lines. Counts always carry a number. File paths show as file
  names. All Decided notices, not overridden.
- The live run's activity line draws the summary line (Decided, round 2).
- The turn starts at the later of the last user entry and the entry after the last result, so a turn Claude starts
  on its own gets a fresh time (cold read).
- The newest box line is highlighted even after its tool finishes (cold read).
- The block sits before the pending rows, and is not a cursor stop (Decided, round 2).
- The time starts at the turn's user entry (Decided, round 2).

## File Structure

Modified:

- `src/plugins/chat/layouts/layout.d.ts` — `WorkingState`, `WorkingInput`, the `working?` part on `ChatLayout`.
- `src/plugins/chat/page/read-chat-layout.ts` and its test — `working: true` in `PART_SET`.
- `src/plugins/chat/page/entry-list.ts` and `entry-list.test.ts` — the working slot and its tick.
- `src/plugins/chat/page/chat-view.ts` — one comment.
- `src/plugins/agents/main/selftest-script.ts` — `.chat-working-action` replaces `.chat-activity-step` in
  `scrollsItself`.
- `src/plugins/chat/layouts/default/layout.js` and `layout.test.ts` — the `working` part, the summary-only
  `activity` part, the result line's cost format.
- `src/plugins/chat/page/chat.css` — the working block's classes; the live shortlist's classes go.

New:

- `src/plugins/chat/page/working-turn.ts` and `working-turn.test.ts` — the turn and state rule. It is pure and owns
  one rule, the same shape as `activity-runs.ts`, so the rule has one seam and one table test.

Boundary rules: `working-turn.ts` imports only `src/contracts/agent` and `../layouts/layout` types. The layout reads
only its input and the base kit.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Working turn input](01-working-turn-input.md)

### Wave 2
- [x] [Default layout look](02-default-layout-look.md) — after 01
- [x] [Entry list working slot](03-entry-list-working-slot.md) — after 01

### Wave 3
- [x] [Doc re-read](04-doc-re-read.md) — after 02, 03

### Wave 4
- [x] [Final verification](05-final-verification.md) — after 04

## Run log

Review base: 578c0d08

### Groups
- 01 · 955b4304 · diff read: every Produces present; typecheck clean; worker ran the three tests 71/71 and lint · concerns: AGENTS.md's chat layout part list omits working (outside Files); ActivityInput open/live comments run ahead of layout.js until 02
- 03 · f12a2964 · diff read: slot, place, tick, rebuild and dispose per spec; worker ran src/plugins/chat/page 265 pass and lint; typecheck errors only in 02's in-progress layout.test.ts, full compile re-run after 02 · concerns: none in its own files
- 02 · 5df9b792 · diff read: working part, toolCounts, summary-only activity, toFixed(2), CSS and selftest entry present; full typecheck and lint clean after 02 and 03; worker ran layout and agents tests 86 pass · concerns: chat/main/selftest-script.ts:592 activity-line why still says live header and shortlist (outside Files)
- 04 · 3f41d091 · diff read: four stale lines fixed, DESIGN.md and layout comments already true; typecheck and lint clean · concerns: two design.md lines now run past the file's wrap width
- 05 · 3f41d091 · typecheck, lint, npm test 5629 pass; selftest chat and agents all passed; chat-activity-live.png shows the block under the last entry (0:00 Thinking…, box of 5 tool lines with Bash npm test current and Bash false failed, counts Read 3 Bash 2 Edit 1) under a one-line live summary; chat-activity-finished.png shows no block and the summary line · concerns: none
### Contract changes
### Rulings
- Every bounds row asserts now, not one row — stronger than asked — a slightly longer table · group 01 · group 01
- AGENTS.md's chat-layout surface-part list joins task 04's doc re-read, since 01's worker found it omits working — the doc stays true — one more file in 04 · lead · group 01
- followLiveRun renamed followWorking; runTick always re-arms while working, the timer cleared when working goes false — a block with no live run keeps ticking — if wrong the tick stops after one second · group 03 · group 03
- Changes table gains a streaming-assistant row (update writing []) so a dropped state clause in isWorkingChanged is caught — the plan's tool-result row changes steps and state together · group 03 · group 03
- working part declared (parent, input), dropping the unused kit — the part draws nothing through it — a one-word change if wrong · group 02 · group 02
- Box card: card-background, radius-md, space-2 space-3 padding; is-failed after is-current so a failed current line shows error — a visual retune if wrong · group 02 · group 02
- src/plugins/chat/main/selftest-script.ts (the activity-line why) joins task 04's doc re-read, as 02's worker found it stale — keeps the self-test's prose true — one more file in 04 · lead · group 02
### Review rounds
### Test gate
