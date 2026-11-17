# 01 — Restored step header shows no duration for an unknown time

Status: not started
Type: Task
Rung: hard · changes the chat layout contract (`ActivityInput.startedAt` becomes nullable), which every user chat layout reads
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md` § Bugs seen in use, "A restored chat's first step header reads hundreds of thousands of hours".

Files:
- modify `src/plugins/chat/page/activity-runs.ts`
- test `src/plugins/chat/page/activity-runs.test.ts`
- modify `src/plugins/chat/layouts/layout.d.ts`
- modify `src/plugins/chat/layouts/default/layout.js`
- test `src/plugins/chat/layouts/default/layout.test.ts`
- modify `docs/features/agent-chat/design.md`

Preconditions (run from `wigley-ai-gui/`):

| Claim | Command | Expected |
|---|---|---|
| A run's start falls back to its first step's `at` | `grep -n 'startedAt: previousAt ?? steps\[0\].at' src/plugins/chat/page/activity-runs.ts` | one line (86) |
| The Claude adapter pins `at: 0` for untimed leading entries, so the backfill route is closed | `grep -c 'at: 0' src/main/claude-code/transcripts.test.ts` | 3 or more |
| The contract's start is a plain number | `grep -n '  startedAt: number;' src/plugins/chat/layouts/layout.d.ts` | three lines; the first (≈140) is `ActivityInput`'s |
| The default layout draws the time unconditionally | `grep -n 'kit.duration((input.endedAt ?? input.now) - input.startedAt)' src/plugins/chat/layouts/default/layout.js` | one line (≈289) |
| No user chat layout is on disk to orphan | `ls ~/.config/wigley-ai-gui/layouts/chat` | `layout.d.ts` only (the app writes it at start) |
| `entry-list.ts` copies the row's times through unchanged | `grep -n 'startedAt: row.startedAt' src/plugins/chat/page/entry-list.ts` | one line (≈1321) |

Lane H (`lane-h-harness-seams`) also edits `activity-runs.test.ts`, `layout.d.ts`, `layout.js`, `layout.test.ts` and
`agent-chat/design.md`, in hunks away from this task's (its test-helper types, harness entry kinds, session facts and
dialog copy). Merge on the newer tip and keep both.

Consumes: nothing from another task. `ListRow`, `listRows` in `activity-runs.ts`; `ActivityInput` in `layout.d.ts`
(tree).

Produces:
- `ListRow`'s run variant: `startedAt: number | null` (in `src/plugins/chat/page/activity-runs.ts`)
- `ActivityInput.startedAt: number | null` (in `src/plugins/chat/layouts/layout.d.ts`)

Decisions:
- **The `listRows` route, not the backfill.** The follow-up's default was backfilling untimed leading lines in
  `transcripts.ts`, unless a test pins `0` for them. `transcripts.test.ts` pins `at: 0` for leading entries, and Lane H
  moves that file, so the fix is the other route the item names: a time of 0 is unknown, and the run draws no duration.
- **0 means unknown.** The Claude adapter stamps an entry before the transcript's first timestamped line with `at` 0,
  and every later entry carries the last time seen, so times never fall after the first real one. A run's start is
  unknown exactly when `previousAt ?? steps[0].at` is 0; its end is then also 0 or a real time, and either way no
  duration is true. `listRows` sets `startedAt: null` in that case and leaves `endedAt` as it is now.
- **The contract carries the unknown.** `ActivityInput.startedAt` becomes `number | null`; the comment above it says
  null means the transcript held no time for the run's start (an entry restored from a line with no timestamp), and
  that the default layout then draws no time. `entry-list.ts` passes `row.startedAt` through as it does now, with no
  edit: the type flows from `ListRow`.
- **The default layout draws the summary without its time span.** `fillActivity` builds the
  `span.chat-activity-time` only when `input.startedAt !== null`; `activitySummary` takes the time element as
  `HTMLElement | null` and appends it only when not null. Nothing else in the line changes.
- **The dock and the turn line stay as they are.** `workingInput` and `doneInput` (`working-turn.ts`) start a turn at
  the last user entry, which the transcript always times; a turn starting at 0 needs a transcript with no user entry
  at all. Out of scope.
- **No user layout to migrate.** `~/.config/wigley-ai-gui/layouts/chat/` holds only the app-written `layout.d.ts`, so
  the AGENTS.md rule on a contract change orphans nothing; the report says so.

GIVEN a restored session whose first run's steps and the entry before them have `at` 0, and the entry after the run
has `at` 43000
WHEN `listRows` folds the entries
THEN that run's `startedAt` is null and its `endedAt` is 43000

GIVEN the same run drawn by the default layout
WHEN `layout.activity` draws it
THEN the summary line holds the step text and no `span.chat-activity-time`

GIVEN a run whose entry before it has a real time
WHEN `listRows` folds the entries
THEN its `startedAt` is that time, as today

Tests:
- `activity-runs.test.ts`, rows added to the `listRows times a run with $given → $expected` table:
  - `'a run opening a restored list at 0'`: `entries('tool:t1@0', 'thinking:k@0', 'assistant:a@43000')`, working
    false → `{ startedAt: null, endedAt: 43000 }`
  - `'a run after an untimed user entry'`: `entries('user:u@0', 'tool:t1@0', 'assistant:a@5000')`, working false →
    `{ startedAt: null, endedAt: 5000 }`
- `layout.test.ts`, a row added to the `activity_Default_$state` table: `state: 'Unknown start'`, input
  `{ ...finishedRun([toolStep('Read', 'a.ts')], 8000), startedAt: null }`, lines
  `['chat-activity', 'span.chat-activity-steps:1 step · Read']`

Done when: compiles (`npm run typecheck` passes, `layout-contracts.test.ts` included); `npm test` runs the rows
above and they pass; `docs/features/agent-chat/design.md` § the `activity` part's input (≈line 575) reads
"`startedAt` (null when the transcript holds no time for the run's start, and the default layout then draws no
time)".

Commit: one commit, "chat: a run with no known start draws no duration (restored 498246h header follow-up)".

## Proof
