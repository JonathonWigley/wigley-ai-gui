# 11 — Task and history stores

Status: done
Type: Batch
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     create `src/plugins/scheduling/main/task-store.ts` · test `src/plugins/scheduling/main/task-store.test.ts` ·
           create `src/plugins/scheduling/main/history-store.ts` · test
           `src/plugins/scheduling/main/history-store.test.ts`
Consumes:  `ScheduledTask`, `TaskFile`, `TaskDraft`, `RunHistoryEntry`, `TASK_FILE_NAME` in
           `src/plugins/scheduling/contract.ts` ← 03 · `readTaskFile`, `taskFileText` in
           `src/plugins/scheduling/task-file.ts` ← 03 · `readSchedule` in `src/plugins/scheduling/schedule.ts` ← 03 ·
           `Files`, `FileWatch`, `readIfPresent`, `isMissingFile` in `src/contracts/files.ts` (tree) · `Paths` in
           `src/contracts/paths.ts` (tree) · `Clock`, `RandomHex` in `src/contracts/ambient.ts` (tree) · `Disposable`
           in `src/contracts/disposable.ts` (tree)
Produces:  in `src/plugins/scheduling/main/task-store.ts`:
           ```ts
           export interface TaskStoreDeps {
             files: Files;          // absolute paths (`services.files`)
             paths: Paths;
             configFolder: string;  // the user config folder, absolute
             clock: Clock;
             randomHex: RandomHex;
             log(line: string): void; // 17 passes the part's log
           }
           export interface TaskStore {
             load(): Promise<void>;
             tasks(): ScheduledTask[];
             error(): string | null;
             onChanged(listener: () => void): Disposable;
             save(draft: TaskDraft): Promise<string>;
             setPaused(id: string, paused: boolean): Promise<void>;
             remove(id: string): Promise<void>;
             settled(): Promise<void>;
             dispose(): void; // disposes the watch; 17's `dispose` calls it
           }
           export function createTaskStore(deps: TaskStoreDeps): TaskStore;
           ```
           in `src/plugins/scheduling/main/history-store.ts`:
           ```ts
           export const HISTORY_FILE = 'history.json';
           export const HISTORY_PER_TASK = 20;
           export interface HistoryStore {
             load(): Promise<void>;
             entries(): RunHistoryEntry[]; // newest `at` first
             add(entry: RunHistoryEntry): void;
             update(taskId: string, occurrence: number, change: Partial<RunHistoryEntry>): void;
             settled(): Promise<void>;
           }
           export function createHistoryStore(files: Files, log: (line: string) => void): HistoryStore;
           ```

The main part's `dispose` calls the task store's `dispose()`, then awaits `settled()` on both stores, as auto-retro's
does its queue file.

## Decisions

Task store:

- **The file.** `paths.join(configFolder, TASK_FILE_NAME)`. The main part (17) passes
  `paths.join(services.homeDir, '.config', 'wigley-ai-gui')`, the same folder `configFolder` in `src/main/main.ts`
  names; in the self-test and a drive run `homeDir` is the run's temp home, so the run reads the user's file only
  when the drive run's `--user-config` copied it there (task 21 removes that copy before the first start).
- **`load`.** Makes the config folder (`files.makeFolder`), watches the folder with `{ recursive: false }`, then
  reads the file. It watches first so that an edit between the read and the watch is not lost. It reacts only to a
  change whose path is the task file. The watch passes `onMissed`, which re-reads the file as a watch event does
  (the Node adapter calls it on macOS when it may have dropped changes), and `onError`, which logs
  `scheduled-tasks.json not watched: <errorText>`. A `watch` call that throws is logged the same way, and `load`
  goes on to read. After a watch failure, hand edits reach the app at the next app start or plugin reload; the
  store's own writes still update `tasks()`. `dispose()` disposes the watch. A missing file reads as no tasks and
  no error, at `load` and on a watch event: a user who deletes the file empties the list. An editor that saves by
  delete then rename makes the list empty for one read, and the next event reads it back; the main part re-plans
  twice, which is harmless. Text that `readTaskFile` refuses keeps the last good tasks (none at the first load) and sets `error()` to
  its reason. A read that fails for any other reason sets `error()` to `scheduled-tasks.json not read: <errorText>`
  and keeps the last good tasks.
- **Watch reads.** Each watch event re-reads the file. A text equal to the last text read changes nothing and emits
  nothing, so the store's own write and the atomic write's temp file emit no second change. Any other read that
  changes `tasks()` or `error()` emits `onChanged` once. The last text read is the text of the latest read that got
  text, a refused text included; a read that fails for another reason sets it to null. So a later read of the same
  good text after a failed read clears `error()` and emits once.
- **`save(draft)`.** With `draft.id` null: a new task with a fresh `randomHex()` id (drawn again while it collides
  with an existing id), `updatedAt = clock.now()`, appended at the end. With an id: replaces that task in place, with
  `updatedAt = clock.now()`; an unknown id rejects with `No scheduled task <id>.` Resolves to the id. `setPaused` sets
  `paused` and `updatedAt`. `remove` drops the task; an unknown id rejects as `save` does.
- **Checks before a write.** Each mutation builds the new `TaskFile`, then requires `readTaskFile(taskFileText(next))`
  to give a `TaskFile`; when it gives a reason, the call rejects with that reason and writes nothing. Reason: a draft
  from the channel or a tool call is runtime JSON, so a draft with a blank `profile`, a `target` with two keys or a
  non-string `controls` value would write a file the store's own reader refuses at the next start. One rule then
  lives in `readTaskFile` (03). The store does not check that the profile, the project or the control ids exist:
  chat and the harness own those, and the main part and the tools check them before they call `save` (15, 17).
- **No write over a broken file.** While `error()` is not null, `save`, `setPaused` and `remove` reject with
  `scheduled-tasks.json has an error; fix it first: <error>`. Reason: the file is the user's to edit by hand; a write
  from the last good tasks would erase the user's unsaved hand edit. The user sees this reason in the editor (12) and
  in a tool's answer (15).
- **Writes.** Each write is `files.write(path, taskFileText(file))` (atomic), one at a time after every earlier write
  settled. A mutation runs as one step in its turn: check the broken-file rule, build the new file from `tasks()` as
  it is then, check it, write. So two mutations called without an await between them both land, and the second
  builds on the first. After a write resolves, `tasks()` holds the new file, the last text read is the written text, and
  `onChanged` emits once. A write that rejects rejects the call and changes nothing in memory.
- **Hand edits** keep the `updatedAt` the file holds. The store does not stamp it. The planner (10) then treats a
  hand edit as written at that time. Task 20 checks that the design doc's task-file section says so.

History store:

- **The file.** `HISTORY_FILE` in the plugin data (`files` is `api.data`). `load` reads it with `readIfPresent`; a
  missing file is no entries. A file that is not a JSON array of entries with every `RunHistoryEntry` field of the
  right type (`viewed` a boolean included) rejects `load` with the reason, and after that the store keeps entries in memory and writes nothing for
  the rest of the run. Reason: the same rule as auto-retro's `queue.json`: a file the app cannot read is never written
  over in that start.
- **`add`** puts the entry in, replacing an entry with the same `taskId` and `occurrence` (the key `update` finds an
  entry by, so it stays unique), then keeps only the `HISTORY_PER_TASK` entries with the greatest `at` for that
  entry's `taskId`, then writes. **`update`** finds the entry with that `taskId` and `occurrence`, applies `change`
  over it, and writes; with no such entry it does nothing. The main part marks a run viewed through `update` with
  `{ viewed: true }`, so the mark is in the file and survives an app restart (plan.md § Shared names,
  `RunHistoryEntry.viewed`). Writes are `JSON.stringify(entries, null, 2)`, one at a
  time, as the queue file in `src/plugins/auto-retro/main/queue-file.ts` does. A write that rejects is caught: the
  store logs `history.json not written: <errorText>` through `log`, keeps the entry in memory, and the next write
  writes every entry again. `settled()` resolves once every write asked so far has settled, a rejected one included.
- **A failed `load`.** The main part logs it and plans with `catchUpFloor` set to its start time (10, 17), since
  `entries()` then lacks every run before this start.
- **`entries()`** returns every entry, newest `at` first; entries of a removed task stay until 20 newer ones of that
  task push them out, which never happens, so they stay. They cost little, and a run row of a removed task still
  finds its entry.

GIVEN no task file WHEN the store loads THEN `tasks()` is empty and `error()` is null
GIVEN a task file the user broke WHEN the watch reads it THEN `tasks()` keeps the last good tasks, `error()` holds the
reason, and `onChanged` emits once
GIVEN a broken task file WHEN `save` runs THEN it rejects and writes nothing
GIVEN a draft with id null WHEN `save` runs THEN the file holds a new task with a fresh id and `updatedAt` now, and
the store's own watch event emits no second change
GIVEN 20 entries for one task WHEN `add` adds a 21st THEN the entry with the smallest `at` of that task is gone and
other tasks' entries stay
GIVEN a history file that is not JSON WHEN `load` runs THEN it rejects, and a later `add` writes nothing
GIVEN `setPaused(a)` and `remove(b)` called without an await between them WHEN both settle THEN the file holds both
changes
GIVEN a draft with a blank profile WHEN `save` runs THEN it rejects with `readTaskFile`'s reason and writes nothing
GIVEN a watch that calls `onMissed` after an outside write it did not report WHEN `onMissed` runs THEN the store reads
the new tasks and emits once

## Tests

Build both stores over `createMemoryFiles(clock)` in `src/shared/memory-files.ts` (the tree's `Files` fake; its
watches hear each write at once) and a fake clock. An outside change is a direct write to the memory files.

`task-store.test.ts`:

- `load_FileStates_ReadsTasksAndError` — `it.each`: no file → `[]`, null; a good file → its tasks, null; a file that
  is not JSON → `[]`, an error holding `not JSON`.
- `watch_FileChanges_KeepsLastGoodAndEmitsOnce` — good file, then a broken write from outside: tasks kept, error
  set, one emit; then a fixed write: new tasks, error null, one emit; then the same text again: no emit; then the
  file deleted: `[]`, error null, one emit.
- `watch_ReadFailsThenSameText_ClearsTheError` — a read that fails (the memory files made to reject one read), then
  the same good text read again: error null, one emit.
- `watch_Missed_RereadsTheFile` — the watch's `onMissed` called after a direct write the fake did not report: the
  new tasks, one emit. If `createMemoryFiles` cannot hold back a report or fail a read, wrap its `Files` in a test
  double that can.
- `dispose_Store_DisposesTheWatch` — after `dispose`, an outside write emits nothing.
- `mutations_Overlapping_BothLand` — `setPaused(a)` and `remove(b)` fired without an await: both effects in the file.
- `save_NewDraft_WritesFreshIdAndUpdatedAt` — `randomHex` answers an existing id first, then a fresh one: the task
  gets the fresh one, `updatedAt` is the clock's time, the file text equals `taskFileText` of the new file, and one
  emit in total across the write and its watch event.
- `save_ExistingId_ReplacesInPlaceAndStamps` — order kept, `updatedAt` new.
- `mutation_Refused_WritesNothing` — `it.each` of the refusals with a substring each: an unknown id for `save`,
  `setPaused` and `remove` → `No scheduled task`; a draft with a bad schedule → `schedule.`; a blank name → `name`;
  a blank profile → `profile`; a `target` with both keys → `target`; a `controls` value `5` → `controls`; any of the
  three while the file is broken → `fix it first`. Each row asserts the file text did not change.
- `setPaused_Task_SetsPausedAndUpdatedAt`.

`history-store.test.ts`:

- `add_PastTheCap_DropsTheOldestOfThatTaskOnly` — `HISTORY_PER_TASK` entries of task A and one of task B, then one
  more of A: A keeps `HISTORY_PER_TASK`, the smallest `at` of A is gone, B's entry stays, the file holds the same
  entries; built from the constant by name.
- `update_Entry_AppliesTheChangeAndWrites` — `running` to `finished`; `viewed` false to true, read back by a new
  store's `load` over the same files; an update for an unknown occurrence changes nothing.
- `load_BadFile_RejectsAndNeverWrites` — not JSON, an entry missing `outcome`, and an entry missing `viewed`: `load` rejects; a later `add` shows
  in `entries()` and leaves the file as it was.
- `entries_Order_IsNewestFirst`.
- `add_SameKey_Replaces` — two `add`s with one `taskId` and `occurrence`: one entry, the second's values.
- `add_WriteRejects_LogsAndKeepsTheEntry` — the files reject the write: `entries()` holds the entry, one
  `history.json not written:` log line, `settled()` resolves; the next `add` writes both entries.

Done when: compiles; the test gate runs the two test files above.
Commit:    one commit for the group

## Proof

Commit b9e0581be · proof: diff read: Produces present; wave 2 typecheck and lint pass after ba5ff01d8 · concerns: a throwing listener logs a line the plan does not pin
