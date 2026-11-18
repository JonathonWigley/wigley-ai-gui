# 03 — Scheduling skeleton, schedule and task file

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/scheduling/manifest.ts` · create `src/plugins/scheduling/contract.ts` ·
           create `src/plugins/scheduling/schedule.ts` · test `src/plugins/scheduling/schedule.test.ts` ·
           create `src/plugins/scheduling/task-file.ts` · test `src/plugins/scheduling/task-file.test.ts` ·
           modify `src/plugins/manifests.ts` · create `src/contracts/login-start.ts` (types only, see Decisions)
Consumes:  `StartTarget` in `src/plugins/chat/contract.ts` (tree) ·
           `SessionControl` in `src/contracts/agent.ts` (tree) · `SlotKey` in `src/contracts/state.ts` (tree) ·
           `ChannelShape` in `src/contracts/plugin.ts` (tree) · `definePlugin` in `src/shared/define-plugin.ts` (tree)
Produces:  in `src/plugins/scheduling/manifest.ts`: `export const schedulingManifest`
           in `src/contracts/login-start.ts`: `LoginStartState`, `LoginStartStatus` and `LoginStart`, verbatim from
           plan.md § Shared names and shapes › Login start (06 consumes them)
           in `src/plugins/scheduling/contract.ts`: every type and constant of plan.md § Shared names and shapes ›
           Scheduling contract, written as given there, except `ScheduledRunRecord` (task 17 owns it, see
           Decisions): `TaskSchedule`, `ScheduledTask`, `TaskFile`, `TASK_FILE_NAME = 'scheduled-tasks.json'`,
           `RunOutcome`, `RunHistoryEntry`, `ScheduledTaskView`, `SchedulingState`,
           `schedulingStateSlot: SlotKey<SchedulingState, 'main', 'scheduling'>` (`{ id: 'scheduling.state', process:
           'main', kind: 'value' }`), `TaskDraft`, `EditorChoices`, `SchedulingChannel`
           in `src/plugins/scheduling/schedule.ts`:
           `export function readSchedule(value: unknown): TaskSchedule | string`
           `export function nextOccurrence(schedule: TaskSchedule, after: number): number | null`
           `export function latestOccurrence(schedule: TaskSchedule, after: number, notAfter: number): number | null`
           `export function scheduleText(schedule: TaskSchedule): string`
           in `src/plugins/scheduling/task-file.ts`:
           `export function readTaskFile(text: string): TaskFile | string`
           `export function taskFileText(file: TaskFile): string`

## Decisions

- **The plugin.** Copy the shape of `src/plugins/auto-retro/manifest.ts`. `id: 'scheduling'`, `label: 'Scheduled
  tasks'`, a one-line `description` ("Runs agent tasks on a schedule as new headless sessions, also while the app is
  closed."). `dependsOn: { main: ['chat', 'sessions'], page: ['sessions'] }`, `reads: { main: [], page: [] }`,
  `commands: {}`, `scopes: {}` (task 12 adds the commands and scopes), `settings: { layout: 'default' }` with a
  `settingInfo.layout` entry in auto-retro's wording, `themeTokens: {}`. The comment above the manifest says what
  the plugin does and why it names each dependency, as auto-retro's does.
- **`manifests.ts`.** Add `schedulingManifest` to `builtInManifests` after `autoRetroManifest`. This task adds no
  part to `src/plugins/main.ts` or `src/plugins/page.ts` (tasks 12 and 17 add them). If the catalog refuses a manifest
  with no part, report it as a concern and do not add a stub part.
- **No import from a later task.** This task is in wave 1, and every later group's proof runs the typecheck, so
  `contract.ts` imports nothing that a later task creates:
  - `ScheduledRunRecord` imports `AdoptRequest`, which task 14 (wave 3) adds, and only the main part reads a run
    record. So `contract.ts` leaves it out, and task 17 declares it in `src/plugins/scheduling/main/run-records.ts`.
  - `SchedulingState.loginStart` needs `LoginStartStatus`. This task creates `src/contracts/login-start.ts` with the
    three login-start types, copied verbatim from plan.md, and nothing else: no adapter, no fake, no `MainServices`
    member. Task 06 then modifies that file only where it must, and adds the rest.

  plan.md's file tables and Shared names record both (the lead's ruling).
- **Channel form.** `SchedulingChannel` follows `ChatChannel` in `src/plugins/chat/contract.ts`: `invoke` holds the
  five methods and `messages: Record<never, never>`. A main handler must return the declared type, so the methods
  whose main side writes the task file return promises: `saveTask(draft: TaskDraft): Promise<string>`,
  `setPaused(id: string, paused: boolean): Promise<void>`, `removeTask(id: string): Promise<void>`. `runNow(id:
  string): void` and `editorChoices(): EditorChoices` stay plain. plan.md gives the channel in this form.
- **`RunHistoryEntry.viewed`** is written as plan.md gives it, with its comment: the unviewed mark lives in history so
  it survives an app restart.
- **Local time.** `schedule.ts` reads and builds local times only through `Date`'s local methods (`new Date(y, m, d,
  h, min)`, `getHours()` and the rest). It reads no clock: every time comes in as an argument. Occurrences fall on
  second 0, millisecond 0 of a local minute.
- **DST.** A local time that a DST gap skips does not occur: when `new Date(y, m, d, h, min)` gives a different local
  hour or minute than asked, that candidate is not an occurrence. A local time that a DST overlap repeats occurs
  once, at the first instance. This holds for every kind, `hourly` included: in the repeated hour, `hourly` at `:15`
  occurs at the first 01:15 only.
- **`readSchedule` rules.** `value` is an object with a `kind` of the six in `TaskSchedule` and exactly that kind's
  fields; an unknown or missing key is an error. `minute` is a whole number 0–59. `time` is `HH:MM`, two digits each,
  00–23 and 00–59. `day` is a whole number 0–6. `at` is `YYYY-MM-DDTHH:MM`, its year 1970 or later, and names a real
  calendar date. Reason for the year floor: `new Date(y, …)` reads a year 0–99 as 1900–1999. An `at` whose local time
  a DST gap skips (by the DST rule below) is refused: the reason names `schedule.at` and says the local time does not
  occur that day. Reason: a one-time task at a skipped time would never fire and show no reason. A `cron` `line` is
  five fields split on runs of spaces or tabs, trimmed; every number in it matches `^\d+$` (no sign, no decimal
  point). The reason string names the bad field (`schedule.time`, `schedule.line minute field`, and so on) and the
  bad value.
- **Cron dialect.** Fields in order: minute 0–59, hour 0–23, day of month 1–31, month 1–12, day of week 0–7 (0 and 7
  are Sunday). Each field is `*` or a comma list of items; an item is a number, a range `a-b` with `a <= b`, `*/n`, or
  `a-b/n`, with `n` at least 1. No names, no `L`, `W`, `?` or `#`, no `a/n`. A field is restricted when it does not
  start with `*`. When day of month and day of week are both restricted, a day matches when either matches (vixie
  cron); otherwise a day matches when both match. `readSchedule` rejects a line that no date can ever match: day of
  week unrestricted and every listed day of month past the last day of every listed month (`0 0 30 2 *`). The reason
  names `schedule.line day of month`.
- **Search horizon.** `nextOccurrence` and `latestOccurrence` search at most 8 years from their start point (366 × 8
  days), which covers a 29 February that skips the year 2100. Past the horizon they return null. `latestOccurrence`
  also stops at `after`, and returns null when `after >= notAfter`.
- **`scheduleText` copy (pinned).** `Hourly at :15` (minute two digits), `Daily at 09:00`, `Weekdays at 09:00`,
  `Mondays at 09:00` (weekly: the English day name plus `s`: Sundays, Mondays, Tuesdays, Wednesdays, Thursdays,
  Fridays, Saturdays), `Once on 2026-11-20 at 14:30`, `Cron 0 9 * * 1-5` (`Cron ` and the line as written, trimmed,
  with each run of spaces or tabs made one space).
- **`readTaskFile` rules.** Text that is not JSON gives `scheduled-tasks.json is not JSON: <parser message>`. The top
  level is an object with exactly one key, `tasks`, an array. Each task has exactly the `ScheduledTask` keys, all
  required: `id` 8 lowercase hex characters, unique in the file; `name`, `profile` and `prompt` non-blank strings;
  `target` an object with exactly one of `projectDir` or `project`, a non-blank string; `schedule` as `readSchedule`
  reads it; `controls` an object whose values are strings; `paused` a boolean; `updatedAt` a whole number 0 or more.
  The error names the first bad task by its position from 1 and its `id` when it has a valid one, then the field:
  `task 2 (3f9a01bc): schedule.time must be HH:MM, got "9:00"`. The task file is hand-editable, so a strict reader
  turns a typo (`pasued`) into an error the user sees, not a silent default.
- **`taskFileText`.** `JSON.stringify(file, null, 2)` plus `'\n'`. Keys keep the `ScheduledTask` field order of
  plan.md, since the user reads and edits the file.

GIVEN a schedule of each kind WHEN `readSchedule` reads it THEN it returns the same schedule
GIVEN a bad schedule WHEN `readSchedule` reads it THEN it returns a reason that names the bad field
GIVEN `TZ=America/New_York` and a once schedule at `2026-03-08T02:30` WHEN `readSchedule` reads it THEN it returns a
reason that names `schedule.at`, since that local time does not occur
GIVEN `TZ=America/New_York` and a daily 02:30 schedule WHEN `nextOccurrence` runs after 2026-03-07 03:00 local THEN it
returns 2026-03-09 02:30 local, since 2026-03-08 02:30 does not occur
GIVEN the 2026-11-01 DST overlap WHEN `nextOccurrence` steps a daily 01:30 schedule THEN it returns the first 01:30
only, and the step after it is 2026-11-02 01:30
GIVEN a window with three missed occurrences WHEN `latestOccurrence` runs THEN it returns the latest one only
GIVEN a task file that `taskFileText` wrote WHEN `readTaskFile` reads it THEN it returns the same `TaskFile`

## Tests

Each test sets `process.env.TZ = 'America/New_York'` in `beforeAll` and restores the old value in `afterAll`. Every
expected instant is written as a UTC ISO string (`Date.parse('2026-11-01T05:30:00Z')`), so the expected value does
not come from the local `Date` code under test. Tests use the repo's `subject_Condition_Result` names, as
`src/plugins/auto-retro/main/*.test.ts` do.

`schedule.test.ts`:

- `readSchedule_ValidSchedule_ReturnsIt` — `it.each`, one row per kind: `{ kind: 'hourly', minute: 15 }`,
  `{ kind: 'daily', time: '09:00' }`, `{ kind: 'weekdays', time: '07:45' }`, `{ kind: 'weekly', day: 1, time:
  '09:00' }`, `{ kind: 'once', at: '2026-11-20T14:30' }`, `{ kind: 'cron', line: '*/15 9-17 * * 1-5' }`.
- `readSchedule_BadSchedule_NamesTheField` — `it.each`, each row a value and a substring the reason must hold:
  minute `60` → `schedule.minute`; time `'9:00'` → `schedule.time`; time `'24:00'` → `schedule.time`; weekly day `7`
  → `schedule.day`; once at `'2026-02-30T10:00'` → `schedule.at`; an unknown kind `'yearly'` → `schedule.kind`; an
  extra key `{ kind: 'daily', time: '09:00', minute: 5 }` → `minute`; cron `'0 9 * *'` (four fields) →
  `schedule.line`; cron `'60 * * * *'` → `minute field`; cron `'*/0 * * * *'` → `minute field`; cron `'0 9 * * MON'`
  → `day of week field`; cron `'0 0 30 2 *'` → `day of month`; cron `'+5 * * * *'` → `minute field`; cron
  `'1.5 * * * *'` → `minute field`; once at `'0050-01-01T00:00'` → `schedule.at`; once at `'2026-03-08T02:30'` (a
  DST gap in America/New_York) → `schedule.at`; `null` → `schedule`.
- `nextOccurrence_Schedule_ReturnsTheFirstAfter` — `it.each` of `{ schedule, after, expected }`, times local
  America/New_York:
  - hourly `:15`, after 2026-11-09 10:20 → `2026-11-09T16:15:00Z`
  - daily 09:00, after 2026-11-09 09:00 exactly → `2026-11-10T14:00:00Z` (strictly after)
  - weekdays 09:00, after Friday 2026-11-13 09:00 → Monday `2026-11-16T14:00:00Z`
  - weekly day 1 at 09:00, after Monday 2026-11-09 08:59 → `2026-11-09T14:00:00Z`
  - once `2026-11-20T00:00`, after 2026-11-09 12:00 → `2026-11-20T05:00:00Z`
  - once `2026-11-20T00:00`, after `2026-11-20T05:00:00Z` → `null`
  - cron `0 0 20 * 1` (vixie OR), after Monday 2026-11-09 12:00 → Monday `2026-11-16T05:00:00Z`
  - cron `0 0 20 * 1`, after `2026-11-16T05:00:00Z` → the 20th, `2026-11-20T05:00:00Z`
  - cron `0 0 * * 7` (7 is Sunday), after Monday 2026-11-09 12:00 → `2026-11-15T05:00:00Z`
  - cron `0 0 29 2 *`, after 2026-03-01 00:00 → `2028-02-29T05:00:00Z`
  - DST gap: daily 02:30, after 2026-03-07 03:00 → `2026-03-09T06:30:00Z`
  - DST overlap: daily 01:30, after 2026-10-31 12:00 → `2026-11-01T05:30:00Z` (the first 01:30)
  - DST overlap: daily 01:30, after `2026-11-01T05:30:00Z` → `2026-11-02T06:30:00Z`
  - DST overlap: hourly `:15`, after `2026-11-01T05:15:00Z` → `2026-11-01T07:15:00Z` (the repeated 01:15 at 06:15Z
    does not occur)
- `latestOccurrence_Window_ReturnsTheLatestInside` — `it.each` of `{ schedule, after, notAfter, expected }`: daily
  09:00 over 2026-11-06 12:00 → 2026-11-09 12:00 gives `2026-11-09T14:00:00Z` (three missed, latest only); an
  occurrence at `notAfter` exactly is returned; an occurrence at `after` exactly is not; a window with none gives
  `null`; once `2026-11-20T00:00` over a window after it gives `null` when `after` is past it; cron `0 9 1 * *` over a
  two-year window gives the last first-of-month inside it; `after` later than `notAfter` gives `null`.
- `scheduleText_Schedule_ReadsAsPinned` — `it.each`, one row per kind, the pinned strings above; the cron row writes
  the line with two spaces between fields and expects one.

`task-file.test.ts`:

- `taskFileText_ThenReadTaskFile_ReturnsTheSameFile` — a file of two tasks, one with `projectDir: '~/dev/a'` and
  one with `project: 'games'`, one paused, different schedule kinds; the text also ends with `'\n'`.
- `readTaskFile_BadFile_NamesTheTaskAndField` — `it.each`, each row a text and substrings the error must hold: not
  JSON → `not JSON`; `{"tasks": {}}` → `tasks`; a task with id `ABC` → `task 1`, `id`; two tasks with one id → `task
  2`, `id`; `target` with both keys → `target`; a blank `prompt` → `prompt`; `schedule.time` `'9:00'` → `task 1 (<id>)`,
  `schedule.time`; a `controls` value `5` → `controls`; an unknown key `pasued` → `pasued`; `updatedAt` `-1` →
  `updatedAt`.

Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs the two test files above.
Commit:    one commit for the group

## Proof

Commit 498d9bc9f · proof: diff read: Produces present; wave 1 typecheck and lint pass after 8b8a40c12 · concerns: TZ set at runtime relies on vitest forks pool; DST expectations checked with Python zoneinfo, not the code
