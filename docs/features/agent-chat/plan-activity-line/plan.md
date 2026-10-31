# Activity line — plan

Feature: agent chat · Implements: none · Ticket: none
Target: main · Written: 2026-10-30

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The Chat tab groups the agent's steps (`tool`, `thinking` and `raw` entries) between two other entries into one
**activity line**: a live header with a 5-line shortlist while the session works on it, one dim summary line once it
is finished, and a plain list of step rows when the user opens it. The chat's focus outlines change: the focused
message box draws no frame and marks no entry, and the focused entry shows a thin left bar once the box loses focus.
Prose reads a new `text-prose` token that a new `fonts.proseSize` setting overrides.

## Architecture

Systems touched:

- **Theme and settings** (`src/config/`, `src/contracts/settings.ts`, `src/shared/theme-variables.ts`,
  `src/renderer/theme.ts`, `src/shared/page/markdown.css`): one new token and one new font setting, on the same path
  as `fonts.uiSize` → `text-ui`.
- **Shared collapsible primitive** (`src/shared/page/ui/card.ts`, `card.css`, the gallery): a `plain` variant.
- **Chat layout contract** (`src/plugins/chat/layouts/layout.d.ts`, `read-chat-layout.ts`, `chat-kit.ts`, the
  built-in `layouts/default/layout.js`): a new `activity` part and a new `collapsibleRow` kit member.
- **Chat entry list** (`src/plugins/chat/page/entry-list.ts`) over a new pure module, `activity-runs.ts`, that turns
  the session's entries into list rows and cursor stops; `entry-focus.ts` stays the pure focus model over stop ids.
- **Chat view and commands** (`chat-view.ts`, `chat-state.ts`, `chat-commands.ts`): the working flag into the list,
  the box-focus class, and the stop-aware key logs.
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

## Docs written ahead

Commit `80ed832` (on `main`): `DESIGN.md` (Type: `text-prose` and `fonts.proseSize`; Keys and focus: the chat
exception; Primitives: the plain collapsible; Surfaces, Chat: the activity line; Motion wording),
`docs/features/agent-chat/design.md` (Vocabulary: step, run, live run, activity line; Chat plugin: Chat tab keys and
§ Activity line; Layouts: the `activity` part and `collapsibleRow`; Plans: plan E), `docs/features/layouts/design.md`
(the chat adopter row and the `Space z l c` preview row), `AGENTS.md` (§ Architecture, the chat layout paragraph),
`docs/features/ui-design/design.md` (Mocha's prose size).

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
                          (input: steps, current, live, open; kit: BaseKit; click toggles open)
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
  shared `createCollapsibleCard` (open question 1 in the hand-off; this plan takes its recommendation).
- **The preview stays idle** and shows finished activity lines only; the live look is captured from the fake's held
  steps turn in the self-test (open question 2 in the hand-off; this plan takes its recommendation).

### Out of scope

- Per-step duration: tracked in `docs/features/followups.md` ("Per-tool-call duration on chat tool cards").
- Grouping permission prompts, notices or the turn result into a run (the user's answer: they stay entries).
- Any change to other views' focus ring.

## File Structure

Modified:

- `src/config/theme-tokens.ts`, `src/config/themes/catppuccin-mocha.json`, `src/contracts/settings.ts`,
  `src/shared/theme-variables.ts`, `src/renderer/theme.ts`, `src/renderer/theme.test.ts`, `src/config/settings.ts`,
  `src/shared/page/markdown.css` — 01
- `src/plugins/chat/page/chat.css` — 02, 05
- `src/plugins/chat/page/chat-view.ts` — 02, 07
- `src/shared/page/ui/card.ts`, `src/shared/page/ui/card.css`, `src/plugins/gallery/page/gallery-view.ts` — 03
- `src/plugins/chat/page/entry-focus.ts`, `entry-focus.test.ts` — 04
- `src/plugins/chat/layouts/layout.d.ts`, `src/plugins/chat/layouts/default/layout.js`, `layout.test.ts`,
  `src/plugins/chat/page/read-chat-layout.ts`, `read-chat-layout.test.ts`, `chat-kit.ts`, `chat-kit.test.ts` — 05
- `src/plugins/chat/page/entry-list.ts`, `entry-list.test.ts`, `chat-commands.ts`, `chat-commands.test.ts` — 06
- `src/plugins/chat/page/chat-state.ts`, `chat-state.test.ts` — 07
- `src/shared/fake-agent-harness.ts`, `src/shared/fake-agent-harness.test.ts`,
  `src/plugins/chat/main/selftest-script.ts` — 08

Created:

- `src/plugins/chat/page/activity-runs.ts` and `activity-runs.test.ts` — 04. Justification: the grouping and the
  stop list are pure rules over entries with their own tests; inside `entry-list.ts` they would be reachable only
  through a fake DOM.

Shared names (more than one task uses them):

- `type StepEntry = Extract<ChatEntry, { kind: 'tool' | 'thinking' | 'raw' }>` — `activity-runs.ts` (04)
- `type ListRow = { kind: 'entry'; entry: ChatEntry } | { kind: 'run'; runId: string; steps: StepEntry[]; live: boolean }`
  — `activity-runs.ts` (04)
- `type ListStop = { kind: 'entry'; entry: ChatEntry } | { kind: 'activity'; runId: string; steps: readonly StepEntry[] }`
  — `activity-runs.ts` (04)
- `type StepInput = ToolInput | ThinkingInput | RawInput` and `interface ActivityInput` — `layout.d.ts` (05)
- `ChatKit.collapsibleRow(parent: HTMLElement, options: CollapsibleCardOptions): CollapsibleCard` — `layout.d.ts` (05)
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
- [ ] [Prose size token and setting](01-prose-size.md)
- [ ] [Chat focus outlines](02-chat-focus-outlines.md)
- [ ] [Plain collapsible primitive](03-plain-collapsible.md)
- [ ] [Runs model and focus on close](04-runs-model.md)

### Wave 2
- [ ] [Activity part, collapsibleRow and the built-in layout](05-activity-contract-and-layout.md) — after 02, 03

### Wave 3
- [ ] [Entry list draws activity lines, commands read stops](06-entry-list-runs.md) — after 04, 05

### Wave 4
- [ ] [Chat view feeds the working flag](07-view-working.md) — after 02, 06
- [ ] [Fake steps turn and self-test steps](08-fake-steps-and-selftest.md) — after 06

### Wave 5
- [ ] [Doc re-read](09-doc-re-read.md)

### Wave 6
- [ ] [Final verification](10-final-verification.md)

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
