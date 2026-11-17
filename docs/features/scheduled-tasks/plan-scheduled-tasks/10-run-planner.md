# 10 — Run planner

Status: in progress
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     create `src/plugins/scheduling/main/planner.ts` · test `src/plugins/scheduling/main/planner.test.ts`
Consumes:  `ScheduledTask`, `RunHistoryEntry`, `TaskSchedule` in `src/plugins/scheduling/contract.ts` ← 03 ·
           `nextOccurrence`, `latestOccurrence` in `src/plugins/scheduling/schedule.ts` ← 03
Produces:  in `src/plugins/scheduling/main/planner.ts`:
           ```ts
           export interface PlannedRun {
             taskId: string;
             occurrence: number;
             at: number;
             skipWhileBusy: string | null; // the processId of the task's newest history entry with one
           }
           export function planRuns(input: {
             tasks: readonly ScheduledTask[];
             history: readonly RunHistoryEntry[];
             runNow: readonly string[]; // task ids pressed since the last plan
             now: number;
             // No catch-up window starts before it; null for no floor. 17 passes its start time when history.json
             // failed to load, so a history it could not read fires no catch-up.
             catchUpFloor: number | null;
           }): PlannedRun[];
           ```

## Decisions

The planner is pure: it reads no clock, file or timer. It holds every time rule of firing, so the main part (17)
only wires it. Rules, per task, in this order:

1. **Paused.** A paused task plans nothing, a Run now press included. Reason: a press on a paused task is a user
   error that the page prevents (12); the planner does not undo the pause.
2. **Run now.** When `runNow` holds the task's id, plan `{ occurrence: now, at: now }`. Reason: settled design, a
   Run now is a run at the press time; its history entry's `occurrence` is the press time (plan.md
   `RunHistoryEntry`).
3. **Catch-up.** Let `since` be the latest of `task.updatedAt`, the greatest `occurrence` among the task's history
   entries (any outcome), and `catchUpFloor` when it is not null. When `latestOccurrence(task.schedule, since, now)` is not null, plan `{ occurrence: <that
   time>, at: now }`. Older missed times are dropped. Reason: settled design (one run for the most recent missed
   time) and plan.md's decision (a resumed or edited task does not catch up times from before the change). A pause
   and a resume both write `updatedAt` (11), so a resume catches up nothing from before it.
   - **`catchUpFloor`.** Reason: a `history.json` that fails to load gives an empty history (11). With no floor, every
     task whose `updatedAt` is older than its latest occurrence fires a catch-up at each app start while the file
     stays broken, and each catch-up is a real agent run.
   - **A hand-written task** keeps the `updatedAt` the user wrote (11). With no history, one whose `updatedAt` is older
     than its latest occurrence fires one catch-up at the next plan; this is the catch-up rule as stated, and the
     design doc says so (task 20 checks it). An `updatedAt` later than `now` gives no catch-up: `latestOccurrence`
     returns null when `after >= notAfter` (03), so rule 4 applies.
4. **Next.** Else, when `nextOccurrence(task.schedule, now)` is not null, plan `{ occurrence: <that time>, at: <that
   time> }`. Else (a spent one-time task) plan nothing.

- **One run per task.** The result holds at most one `PlannedRun` per task, in the order of `input.tasks`.
- **An occurrence already in history is never planned again.** Rule 3's window starts after the newest history
  occurrence, and rule 4 looks strictly after `now`, so an occurrence equal to `now` that history already holds is in
  neither. This is what keeps a host-fired run that the app adopted from firing twice.
- **`skipWhileBusy`.** The `processId` of the task's history entry with the greatest `at` among entries whose
  `processId` is not null; null when there is none. Skipped and failed entries carry no `processId`, so they never
  hide the last real run. The host decides at `at` whether that process is busy (07); the planner does not.
- **History of other tasks.** Entries whose `taskId` matches no task are ignored.
- **A Run now id that names no task, or a paused task,** plans nothing for it and is not an error. The main part
  clears its press list after each plan.

GIVEN a daily 09:00 task edited at 08:00 and no history WHEN the planner runs at 08:30 THEN it plans today's 09:00 at
09:00
GIVEN a daily 09:00 task last edited three days ago, whose newest history occurrence is two days ago, WHEN the planner
runs at 12:00 THEN it plans one catch-up for today's 09:00 at now
GIVEN today's 09:00 is already in history WHEN the planner runs at 12:00 THEN it plans tomorrow's 09:00
GIVEN a paused task WHEN the planner runs, Run now pressed or not, THEN it plans nothing for it
GIVEN a one-time task whose time is in history WHEN the planner runs THEN it plans nothing for it
GIVEN a task whose newest entry with a processId is `p-2` and whose newest entry overall is a skip WHEN the planner
runs THEN `skipWhileBusy` is `p-2`
GIVEN a daily 09:00 task last edited three days ago, no history, and `catchUpFloor` at 10:00 today WHEN the planner
runs at 12:00 THEN it plans tomorrow's 09:00, not a catch-up

## Tests

`planner.test.ts`, one table, `planRuns_Input_PlansOneRunPerTask` (`it.each` of `{ name, task, history, runNow, now,
catchUpFloor, expected }`, `expected` a `PlannedRun` or `null`; `catchUpFloor` null unless a row says otherwise). Each row builds its task with a builder that varies one field.
Times are UTC epoch ms written as `Date.parse('…Z')`; the rows use `hourly` and `once` schedules plus `daily` with
`process.env.TZ = 'UTC'` set in `beforeAll` and restored in `afterAll`, so a row's expected time reads directly. The
DST rules belong to `schedule.test.ts` (03), not here.

Rows:

- next occurrence: daily 09:00, `updatedAt` 08:00, no history, now 08:30 → occurrence and `at` 09:00 today
- catch-up, latest only: daily 09:00, `updatedAt` three days back, history occurrence two days back, now 12:00 →
  occurrence 09:00 today, `at` now
- catch-up window starts at `updatedAt`: daily 09:00, `updatedAt` 10:00 today, no history, now 12:00 → 09:00
  tomorrow, not a catch-up
- already in history: daily 09:00, history occurrence 09:00 today, now 12:00 → 09:00 tomorrow
- occurrence at now exactly, not in history: daily 09:00, `updatedAt` yesterday, now 09:00 → occurrence 09:00, `at`
  09:00
- occurrence at now exactly, in history: same, history occurrence 09:00 → 09:00 tomorrow
- Run now: daily 09:00, `runNow` [id], now 12:00 → occurrence and `at` 12:00
- Run now beats catch-up: as the catch-up row, with `runNow` [id] → occurrence and `at` now
- paused: daily 09:00, `paused: true`, `runNow` [id] → null
- spent one-time: once at 09:00 today, history occurrence 09:00, now 12:00 → null
- one-time edited after its time: once at 09:00 today, `updatedAt` 10:00, no history, now 12:00 → null
- one-time in the future: once tomorrow 14:30 → occurrence and `at` tomorrow 14:30
- `skipWhileBusy` from the newest entry with a processId: history entries `{ at: t1, processId: 'p-1' }`, `{ at: t2,
  processId: 'p-2' }`, `{ at: t3, outcome: 'skipped', processId: null }` with t1 < t2 < t3 → `skipWhileBusy: 'p-2'`
- `skipWhileBusy` null with no history → null
- history of another task ignored: history occurrence 09:00 today under another `taskId`, daily 09:00, `updatedAt`
  yesterday, now 12:00 → catch-up 09:00
- floor blocks the catch-up: daily 09:00, `updatedAt` three days back, no history, `catchUpFloor` 10:00 today, now
  12:00 → 09:00 tomorrow
- floor before the missed time: same, `catchUpFloor` 08:00 today → catch-up 09:00 today, `at` now
- hand-written stale `updatedAt`: daily 09:00, `updatedAt` 0, no history, now 12:00 → catch-up 09:00 today, `at` now
- `updatedAt` in the future: daily 09:00, `updatedAt` tomorrow 08:00, now 12:00 → 09:00 tomorrow

One more test, `planRuns_TwoTasks_KeepsTaskOrderAndOneRunEach`: three tasks (one paused) give two runs in task order.

Done when: compiles; the test gate runs `planner.test.ts`.
Commit:    one commit for the group

## Proof
