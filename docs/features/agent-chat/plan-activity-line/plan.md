# Activity line — plan

Feature: agent chat · Implements: none · Ticket: none
Target: main · Written: 2026-10-30

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The Chat tab groups the agent's steps (`tool`, `thinking` and `raw` entries) between two other entries into one
**activity line**: a live header with a 5-line shortlist while the session works on it, one dim summary line once it
is finished, and a plain list of step rows when the user opens it. Each line shows how long its run took, ticking
once a second while live; for that, every chat entry carries `at`, the time it first appeared. The chat's focus outlines change: the focused
message box draws no frame and marks no entry, and the focused entry shows a thin left bar once the box loses focus.
Prose reads a new `text-prose` token that a new `fonts.proseSize` setting overrides.

## Architecture

Systems touched:

- **Agent harness seam and its producers** (`src/contracts/agent.ts`, `src/main/claude-code/`, chat main's
  `chat-sessions.ts` and preview, the fake harness): `ChatEntry.at`, stamped through the injected `Clock` live and
  read from each transcript line's `timestamp` for history.
- **Theme and settings** (`src/config/`, `src/contracts/settings.ts`, `src/shared/theme-variables.ts`,
  `src/renderer/theme.ts`, `src/shared/page/markdown.css`): one new token and one new font setting, on the same path
  as `fonts.uiSize` → `text-ui`.
- **Shared collapsible primitive** (`src/shared/page/ui/card.ts`, `card.css`, the gallery): a `plain` variant.
- **Chat layout contract** (`src/plugins/chat/layouts/layout.d.ts`, `read-chat-layout.ts`, `chat-kit.ts`, the
  built-in `layouts/default/layout.js`): a new `activity` part and a new `collapsibleRow` kit member.
- **Chat entry list** (`src/plugins/chat/page/entry-list.ts`) over a new pure module, `activity-runs.ts`, that turns
  the session's entries into list rows and cursor stops; `entry-focus.ts` stays the pure focus model over stop ids.
- **Chat view and commands** (`chat-view.ts`, `chat-state.ts`, `chat-commands.ts`, page `start.ts`): the working
  flag, the page `Timers` and `Clock` into the list, the box-focus class, and the stop-aware key logs.
- **Fake harness and self-test** (`src/shared/fake-agent-harness.ts`, `src/plugins/chat/main/selftest-script.ts`): a
  held turn of steps, and the self-test steps that walk and capture the activity line.

## Preconditions

Each was run at plan time from `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui`. `wigley:make` runs them
again before the first dispatch.

| Claim | Command | Result at plan time |
| --- | --- | --- |
| The target branch is `main` | `git rev-parse --abbrev-ref HEAD` | `main` |
| `main` is not behind origin (it was 1 ahead before the docs commit: the user's own local commit `6beacd0`) | `git fetch -q origin && git rev-list --left-right --count main...origin/main` | `<ahead> 0` |
| One theme file exists, so one theme takes `text-prose` (measured at plan time, re-verify) | `ls src/config/themes/` | `catppuccin-mocha.json  index.ts` |
| `markdown.css` uses `text-14` on two lines, the body and `.md-h3` | `grep -n 'text-14' src/shared/page/markdown.css` | lines 3 and 42 |
| `createCollapsibleCard` has three users | `grep -rln createCollapsibleCard src` | `card.ts`, `chat-kit.ts`, `gallery-view.ts` |
| The layout preview session is idle, so it has no live run | `grep -n "activity: 'idle'" src/plugins/chat/main/preview/chat-preview.ts` | line 74 |
| The fake harness holds a turn open only for `fake: hold` | `grep -n 'isHold' src/shared/fake-agent-harness.ts` | `const isHold = text === FAKE_HOLD_TEXT;` |
| `ProcessActivity` is `'idle' \| 'working' \| 'waiting'` | `grep -n 'ProcessActivity =' src/contracts/agent.ts` | line 20 |
| Transcript `user`, `assistant` and `system` lines carry a top-level ISO `timestamp`; bookkeeping lines do not | `python3 -I` over one `.jsonl` under `~/.claude-personal/projects/`, counting lines per `type` with and without `timestamp` (or `command grep -a -o '"timestamp":"[^"]*"' <file> \| head`) | 248 of 382 lines; every user (60), assistant (70) and system (20) line has it |
| The composition root injects `Clock` and the page gets `Timers` and `Clock` | `grep -n 'const clock' src/main/main.ts; grep -n 'timers: Timers\|clock: Clock' src/contracts/plugin.ts` | `main.ts:287`; `PageServices.timers`, `PageServices.clock`, `MainServices.clock` |
| `Timers.set` is one-shot (`setTimeout`) | `sed -n 59,62p src/renderer/renderer.ts` | `window.setTimeout` |
| `read-chat-layout.test.ts` has an accepted-parts table and a malformed table | `grep -n 'it.each' src/plugins/chat/page/read-chat-layout.test.ts` | two tables |

## Docs written ahead

Commit `80ed832` (on `main`): `DESIGN.md` (Type: `text-prose` and `fonts.proseSize`; Keys and focus: the chat
exception; Primitives: the plain collapsible; Surfaces, Chat: the activity line; Motion wording),
`docs/features/agent-chat/design.md` (Vocabulary: step, run, live run, activity line; Chat plugin: Chat tab keys and
§ Activity line; Layouts: the `activity` part and `collapsibleRow`; Plans: plan E), `docs/features/layouts/design.md`
(the chat adopter row and the `Space z l c` preview row), `AGENTS.md` (§ Architecture, the chat layout paragraph),
`docs/features/ui-design/design.md` (Mocha's prose size).

Commit `fc51bc8` (on `main`), the timer:
`docs/features/agent-chat/design.md` (Vocabulary: `at` on a chat entry; § Activity line: the run's time;
§ Layouts: the part's time fields), `DESIGN.md` (Surfaces, Chat: the time on the line), `AGENTS.md` (§ Architecture,
the agent harness paragraph: `at`), `docs/features/followups.md` (the per-step duration item).

## Mandatory Reads

- `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui/AGENTS.md` (the repo holds no `CLAUDE*.md`, no other
  `AGENTS*.md` and no `.claude/rules/`; check with `find . -name 'AGENTS*.md' -not -path './node_modules/*'` and
  `ls .claude/rules` before the first dispatch)
- `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui/DESIGN.md`
- `docs/features/agent-chat/design.md` § Vocabulary, § Chat plugin (Chat tab, Activity line), § Layouts
- `docs/features/layouts/design.md`

## Design Overview

### After-state flow

```
 chat main ── entry / entries / activity / sessionRunning / sessionRested ──► chat-view (HeldTab)
                                                                               │ put / rebuild / setWorking
                                                                               ▼
                                                                         entry-list
   activity-runs.listRows(entries, working) ──► ListRow[]  (entry | run{runId, steps, live})
   activity-runs.cursorStops(rows, openRuns) ──► stop ids ──► entry-focus (moveFocus, focusAfterChange,
                                                                            focusAfterClose)
        │
        ├─ entry row ─► li.chat-entry-slot ─► entry builder (user, assistant, permission, result, notice)
        └─ run row   ─► li.chat-entry-slot.chat-activity-slot ─► layout part `activity`
                          (input: steps, current, live, open, startedAt, endedAt, now; kit: BaseKit; click toggles open; a 1 s page timer updates only the live run's now)
                        then one li.chat-entry-slot.chat-step-slot per step, `hidden` while the run is closed
                          ─► entry builder tool / thinking / raw ─► kit.collapsibleRow (plain one-line row)

 chat-commands: j/k/gg ─► EntryList.move/first ─► ListStop ─► "focused activity line" | "focused <kind> entry"
                Enter  ─► EntryList.toggleFocused ─► run: open/close ("expanded|collapsed activity line")
                                                     entry: its expanders (as today)

 theme: fonts.proseSize ─► FONT_TOKENS.proseSize ─► --wg-text-prose ─► markdown.css body and .md-h3
```

### Decisions

- **Runs are a pure model.** `activity-runs.ts` holds the grouping and the stop list as pure functions over
  `ChatEntry[]`; the entry list only draws them. `entry-focus.ts` stays id-based: a stop id is an entry id or a run
  id (design review).
- **Run id** is `activity:<id of the run's first step>`. A run never loses its first step, since entries are only
  appended or replaced in place with the same kind, so the id is stable as the run grows (design review).
- **A run of one step is still a run** and draws as an activity line (`1 step · Read`), per the settled definition
  "a run = consecutive steps" (design review).
- **Live** is `running && activity === 'working'` and the run is the last row. `waiting` is not working: a pending
  permission is the last entry then, so it ends the run anyway (design review).
- **The open state** lives in the entry list, a set of run ids, kept across `rebuild` (layout reload, history read)
  and across a run turning from live to finished; dropped on `dispose` (design review).
- **Step slots are always built** and carry `hidden` while their run is closed, so a step's kit, its open expanders
  and its updates work as today; the run's slot sits right before its first step's slot (design review).
- **Open line**: the `activity` part draws only its header while open (the live header, or the finished summary
  line); the app shows the step slots under it. The live shortlist shows only while the run is closed (design
  review).
- **Click** on the activity slot toggles it open or closed and does not move the cursor, as a click on a collapsible
  card does today. A click inside a step row reaches that row only, since step slots are siblings (design review).
- **Closing a run** with the cursor on one of its steps moves the cursor to the run (`focusAfterClose`), keeping
  `following` (design review).
- **Log lines** for a run stop: `focused activity line`, `expanded activity line`, `collapsed activity line`.
  Step rows log as entries do (`focused tool entry`, `expanded tool entry`).
- **The activity part's kit is the plain `BaseKit`**, made by `surfaceBaseKit(deps.kit, 'chat', rollback)`: it
  needs `statusDot` and the text parts only (design review).
- **A user `activity` part that throws** draws with `default` through `chatPartDraws`, logged, with no toast, as
  every other non-entry part does. A `default` draw that throws is logged as `default layout activity failed:
  <error>` and leaves the bare line `div.chat-entry.chat-raw` reading `activity`, as a failed default entry builder
  does (design review).
- **`EntryListDeps.layouts` becomes the full `ChatLayouts`**, so the list makes the `activity` part's
  `chatPartDraws`; `chat-layouts.ts` does not change (design review).
- **Finished summary**: tool names ordered by count, most first, ties by first use; a count of 1 prints the name
  alone; `thinking` and `raw` steps count toward `N steps` but are not named; `· N failed` counts tool steps whose
  result `isError`. `1 step`, otherwise `N steps` (design review).
- **Current action text**: a tool's `name · summary` (the name alone when the summary is empty), `Thinking`, or
  `Raw event`, as the built-in builders already word them (design review).
- **The shortlist** holds the latest 5 steps, the current (last) one included at the bottom in `fg`, the older ones in
  `fg-tertiary`, a failed tool step in `status-error`; `LIVE_STEP_LINES = 5` is a constant in `layout.js` (user's
  answer: in the layout, not a setting).
- **Focus outline mechanics**: chat-view toggles `is-box-focused` on `div.chat-tab` from the box's existing
  `focused` / `blurred` callbacks; `chat.css` hides the cursor bar under it and draws the focused box frame at its
  resting `input-border`. The `.ui-input:focus-within` rule elsewhere does not change (design review).
- **Prose `h3`**: both `text-14` uses in `markdown.css` (the body and `.md-h3`) take `text-prose`, per the user's
  "in place of `text-14`"; `h1`/`h2` keep `text-16` and `h4`–`h6` keep `text-13` (design review).
- **Plain step rows** draw through a new `ChatKit.collapsibleRow(parent, options)`, backed by a `plain` option on the
  shared `createCollapsibleCard` (the user's answer, round 3).
- **The preview stays idle** and shows finished activity lines only; the live look is captured from the fake's held
  steps turn (the user's answer, round 3).
- **Entry time** (the user's requirement): every `ChatEntry` carries `at`, epoch ms of its first appearance; a later
  version of an entry keeps it. The Claude adapter stamps live entries through an injected `Clock`
  (`entry-stamp.ts`); the decoder builds `EntryDraft`s without `at`. History reads each transcript line's
  `timestamp`; a line without one takes the time of the entry before it. Chat main's own notices and permission
  entries, the preview and the fake take their clock's time. Layout entry inputs do not gain `at` (design review).
- **Run time** (the user's requirement): from the entry before the run (or the first step's `at` when the run opens
  the list) to the entry after it; live, to now; a finished run that is the last row ends at its last step's `at`
  (design review). `ActivityInput` carries `startedAt`, `endedAt` (null while live) and `now`; the built-in layout
  formats `8s`, `42s`, `1m 05s`, `1h 02m` in tabular numerals, the time last on the line, after `· 1 failed`.
- **The tick**: the entry list holds one pending page timer while a live run is drawn; each second it updates only the
  live run's part with a new `now`. `now` is not part of the update comparison; every other input field is, each step
  compared by identity (design review: an earlier parallel tool's result changes the summary).

### Out of scope

- Per-step duration inside an open line: still a follow-up in `docs/features/followups.md`, now resting on `at`.
- Grouping permission prompts, notices or the turn result into a run (the user's answer: they stay entries).
- Any change to other views' focus ring.

## File Structure

Modified:

- `src/contracts/agent.ts`, `src/main/claude-code/{claude-code-harness,stream-decoder,tool-entries,transcripts}.ts`,
  `src/main/main.ts`, `src/plugins/chat/main/{chat-sessions,start}.ts`, `src/plugins/chat/main/preview/{chat-preview,preview-session}.ts`,
  their tests, and every test file whose `ChatEntry` literals gain `at` — 04 (`src/shared/fake-agent-harness.ts` and
  its test also 08)
- `src/config/theme-tokens.ts`, `src/config/themes/catppuccin-mocha.json`, `src/contracts/settings.ts`,
  `src/shared/theme-variables.ts`, `src/renderer/theme.ts`, `src/renderer/theme.test.ts`, `src/config/settings.ts`,
  `src/shared/page/markdown.css` — 01
- `src/plugins/chat/page/chat.css` — 02, 06
- `src/plugins/chat/page/chat-view.ts` — 02, 07
- `src/shared/page/ui/card.ts`, `src/shared/page/ui/card.css`, `src/plugins/gallery/page/gallery-view.ts` — 03
- `src/plugins/chat/page/entry-focus.ts`, `entry-focus.test.ts` — 05
- `src/plugins/chat/layouts/layout.d.ts`, `src/plugins/chat/layouts/default/layout.js`, `layout.test.ts`,
  `src/plugins/chat/page/read-chat-layout.ts`, `read-chat-layout.test.ts`, `chat-kit.ts`, `chat-kit.test.ts` — 06
  (`layout.test.ts` and `chat-kit.test.ts` also 04)
- `src/plugins/chat/page/entry-list.ts`, `entry-list.test.ts`, `chat-commands.ts`, `chat-commands.test.ts`,
  `chat-state.ts`, `chat-state.test.ts`, `src/plugins/chat/page/start.ts` — 07 (the tests also 04)
- `src/shared/fake-agent-harness.ts`, `src/shared/fake-agent-harness.test.ts`,
  `src/plugins/chat/main/selftest-script.ts` — 08

Created:

- `src/main/claude-code/entry-stamp.ts` and `entry-stamp.test.ts` — 04. Justification: the first-arrival `at` per id is
  a rule with its own test, apart from the process plumbing.
- `src/plugins/chat/page/activity-runs.ts` and `activity-runs.test.ts` — 05. Justification: the grouping and the
  stop list are pure rules over entries with their own tests; inside `entry-list.ts` they would be reachable only
  through a fake DOM.

Shared names (more than one task uses them):

- `ChatEntry.at: number` — `src/contracts/agent.ts` (04)
- `type StepEntry = Extract<ChatEntry, { kind: 'tool' | 'thinking' | 'raw' }>` — `activity-runs.ts` (05)
- `type ListRow = { kind: 'entry'; entry: ChatEntry } | { kind: 'run'; runId: string; steps: StepEntry[]; live: boolean; startedAt: number; endedAt: number | null }`
  — `activity-runs.ts` (05)
- `type ListStop = { kind: 'entry'; entry: ChatEntry } | { kind: 'activity'; runId: string; steps: readonly StepEntry[] }`
  — `activity-runs.ts` (05)
- `type StepInput = ToolInput | ThinkingInput | RawInput` and `interface ActivityInput { steps; current; live; open;
  startedAt: number; endedAt: number | null; now: number }` — `layout.d.ts` (06)
- `ChatKit.collapsibleRow(parent: HTMLElement, options: CollapsibleCardOptions): CollapsibleCard` — `layout.d.ts` (06)
- `createFakeAgentHarness(clock: Clock)` — `src/shared/fake-agent-harness.ts` (04)
- `FAKE_STEPS_TEXT = 'fake: steps'` — `src/shared/fake-agent-harness.ts` (08)

Boundary rules:

- `activity-runs.ts` and `entry-focus.ts` import no DOM and no layout host; they import types only from
  `src/contracts/agent.ts`.
- The built-in layout stays plain JS under `// @ts-check`, importing types only from `../layout`.
- `npm run lint`'s layer and style checks hold: no raw colour, length or font in CSS.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Prose size token and setting](01-prose-size.md)
- [x] [Chat focus outlines](02-chat-focus-outlines.md)
- [x] [Plain collapsible primitive](03-plain-collapsible.md)
- [x] [Entries carry their time](04-entry-times.md)

### Wave 2
- [x] [Runs model, run times and focus on close](05-runs-model.md) — after 04
- [x] [Activity part, collapsibleRow and the built-in layout](06-activity-contract-and-layout.md) — after 02, 03, 04

### Wave 3
- [x] [Entry list draws activity lines; commands and the view wired to it](07-entry-list-and-wiring.md) — after 02, 05, 06

### Wave 4
- [ ] [Fake steps turn and self-test steps](08-fake-steps-and-selftest.md) — after 04, 07

### Wave 5
- [ ] [Doc re-read](09-doc-re-read.md)

### Wave 6
- [ ] [Final verification](10-final-verification.md)

## Run log

Review base: e2dbd6596bdd144fcd436c37ef19db140c258f9a

### Groups
- 01 · faa0754 · diff read matches every Produces; lint and theme.test.ts pass; tsc clean in group files (repo-wide errors only from 04's in-progress at field) · concerns: none beyond the in-progress 04 typecheck noise
- 02 · 7255717 · diff read matches Produces and Decisions; lint passes; tsc clean in group files · concerns: is-box-focused follows the same focused/blurred callbacks as isBoxFocused, so a redraw that destroys the editor without blurred would leave both set
- 03 · cff8715 · diff read matches Produces; lint passes; tsc clean in group files · concerns: body left edge lines up past the chevron, not past a leading status dot; the live look in 10 settles it
- 04 · 9ee97fa · diff read: every Produces present (at on every variant, EntryDraft + createEntryStamp, clock deps on harness/sessions/preview, createFakeAgentHarness(clock)); tsc and lint clean · concerns: stamp spreads use an as ChatEntry cast (TS cannot see Omit-union + at as ChatEntry)
- 05 · e49d51c · diff read: every Produces present in activity-runs.ts and entry-focus.ts; typecheck clean; 34 tests pass per worker (gate reruns) · concerns: lint's oxfmt flags DESIGN.md and docs/keymap.md, from a peer session's commits, not this run
- 06 · 21d87f4 · diff read: every Produces present (StepInput, ActivityInput, collapsibleRow, ChatLayout.activity, PART_SET activity, kit collapsibleRow, layout.js activity and steps on collapsibleRow); typecheck clean · concerns: .chat-step-slot overrides .chat-entry-slot margin/padding only by source order, so it holds only while step slots also carry chat-entry-slot
- 07 · 928abc4 · diff read: every Produces present (EntryListDeps layouts/timers/clock, setWorking, move/first/focused ListStop, toggleFocused {stop,result}, isWorking, ChatViewDeps timers/clock); typecheck clean; worker ran the 3 named test files · concerns: opening the last run while the focus follows recomputes via focusAfterChange and jumps the cursor to the run's last step, so a second Enter toggles that step, not the run; the START_FOCUS case of GIVEN 1 is unreachable through EntryList (focus is never null with entries)
### Contract changes
- pairToolResult: (Map<string, ToolEntry>) → ToolEntry → generic <E extends ToolEntry>(Map<string, E>) → E, and ToolEntry is now Extract<EntryDraft, {kind:'tool'}> · why: the decoder pairs drafts and transcripts pairs stamped entries · consumers: none outside 04 · group 04
- layout.d.ts re-export: export type { DotStatus } → export type { BaseKit, DotStatus } · why: layout.js imports types only from ../layout and the activity part's JSDoc names BaseKit · consumers: none beyond 06 · group 06
### Rulings
- the chat-exception comment sits above .chat-entry-slot and .ui-input.chat-box:focus-within beside .chat-box in the composer section — placement only — a wording tweak · group 02
- plain body keeps the given padding and adds padding-left calc(space-2*2 + icon-size) to meet the align-with-summary clause — the spec gave both — with a leading dot the body sits under the dot, not the text · group 03
- the fake harness keeps its own id-to-first-at map and EntryDraft alias, since check-layers forbids src/shared importing src/main — two copies of a small rule; moving entry-stamp to src/shared would fix it · group 04
- transcript fallback reads the entry before as the last entry pushed, so a timestamped line that yields no entry does not carry its time forward — a slightly early at after a dropped line · group 04
- start.test and chat-preview.test assert at: 5000 on their notice, proving the clock reaches it — none · group 04
- test tables named in prose (vitest naming) rather than listRows_RunTimes_<case> — a rename if wanted · group 05
- a run ended by a non-step entry is never live whatever working is — matches the Live decision · group 05
- summary line is spans (chat-activity-steps, -failed, -time) in a flex row with a space-1 gap — the spans need separation — copied text loses the spaces · group 06
- renamed thinking_expanderBodyRefilledInPlace and raw_expanderShowsTheEvents to thinking_rowBodyRefilledInPlace and raw_rowShowsTheEvents — names fit the code — a gate filter on old names finds nothing · group 06
- a step both current and failed shows status-error (is-failed after is-current) — none · group 06
- a click on the run slot runs the same toggle as Enter, focusAfterClose included (GIVEN 3 needs it); it does not put the cursor on the clicked line — none · group 07
- a bare-line run slot redraws on a recompute where the run changed but not on a tick, so a broken default does not log every second — none · group 07
- put never removes a run slot (entries only append or replace same-kind); rebuild disposes and redraws every run slot — a stale slot if that invariant ever breaks · group 07
### Review rounds
### Test gate
