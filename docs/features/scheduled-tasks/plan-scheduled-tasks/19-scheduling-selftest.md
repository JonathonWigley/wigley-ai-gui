# 19 — Scheduling self-test

Status: done
Type: Task
Wave: 5 · Depends on: 12 (drives 12's mode), 16 (drives 16's section), 17
Plan: [plan.md](plan.md)

Read first, beyond plan.md § Mandatory Reads: `src/plugins/session-stash/main/selftest-script.ts` and
`src/plugins/session-stash/main/start.ts` (the pattern: a deps object, an idempotent `open`, groups with a `why`, the
hand-over through `services.selfTest?.run`), and `SelfTestScript`, `SelfTestGroup`, `SelfTestStep` in
`src/contracts/plugin.ts`.

Files:
- create `src/plugins/scheduling/main/selftest-script.ts`
- modify `src/plugins/scheduling/main/start.ts` (hands the script: `services.selfTest?.run(schedulingSelfTestScript(…))`)

Consumes:
- `schedulingStateSlot`, `TaskDraft`, `ScheduledTask` in `src/plugins/scheduling/contract.ts` ← 03
- `ScheduledRunRecord` in `src/plugins/scheduling/main/run-records.ts` ← 17
- the task store's `save(draft: TaskDraft): Promise<string>`, `tasks(): ScheduledTask[]` and
  `remove(id): Promise<void>` (`createTaskStore`, `src/plugins/scheduling/main/task-store.ts`) ← 11, handed by the
  main part ← 17
- the adoption step the main part runs for each `HostedRun` it hears through `onRunStarted` or reads through
  `listRuns`, handed to the script as `adoptRun(run: HostedRun): Promise<void>` ← 17 (plan.md § Shared names › Main part
  hand-over).
- `ChatMainExports.prepareLaunch(request: LaunchRequest, env): PreparedLaunch` ← 14; tree:
  `ChatMainExports.closeSessionsIn(projectDir: string): Promise<void>`
- `HostedRun`, `HostedExit` in `src/contracts/session-host.ts` ← 07 / tree
- the page log lines pinned in 12 (`mode shown`, `task selected`, `editor opened`, `editor closed`, `task saved`,
  `save refused`, `paused`, `resumed`, `run row opened`) and in 16 (`run rows`, `run row done`, `run row viewed`)

Produces:
```ts
export interface SchedulingSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  now: () => number;
  chat: Pick<ChatMainExports, 'prepareLaunch' | 'closeSessionsIn'>;
  store: { save(draft: TaskDraft): Promise<string>; tasks(): ScheduledTask[]; remove(id: string): Promise<void> };
  adoptRun(run: HostedRun): Promise<void>;
}
export function schedulingSelfTestScript(deps: SchedulingSelfTestDeps): SelfTestScript;
```
in `src/plugins/scheduling/main/selftest-script.ts`.

Decisions:
- **Coverage** (plan.md § Tasks, coverage decision): the script covers Schedules mode, its keys and its channel round
  trips, and the Scheduled runs section, over the fake harness, with fixture runs fed through the main part's own
  adoption step. It does not cover a host-fired run, `Run now` or the closed-app path: those are task 21 (Final
  verification) drive checks. No step presses `r`, since a Run now queues a spawn on the self-test's real session
  host.
- **The host keeps no entry.** The self-test fires (`runMode !== 'live'`), so an active fixture task would leave a
  pending entry that keeps the self-test's session host alive. The fixture task is saved paused, every group that
  resumes it pauses it again, and `problems` fails the run when the task is not paused at the end:
  `the fixture task was left active, so the session host keeps a pending run`.
- **Fixture**, in `open` (idempotent; `open` runs on each page load):
  1. Make `<real home>/scheduling-selftest` (`SELFTEST_PROJECT_NAME = 'scheduling-selftest'`).
  2. `chat.closeSessionsIn(projectDir)`, then `store.remove` each task named `Self-test task`.
  3. `store.save` one task: name `Self-test task`, target `{ projectDir }`, profile `work`, prompt
     `scheduled self-test`, schedule `{ kind: 'daily', time: '09:00' }`, controls `{}`, paused `true`, id null.
     `work` is chat's default profile (`src/plugins/chat/manifest.ts`, the `profiles` default), and the script's
     settings are `{}`, so `work` is in `EditorChoices.profiles` and group 3's unchanged save passes `draftOf`, and
     `prepareLaunch` accepts it. Other self-tests (`agent-lines`, `context-sources`) rely on the same default.
  4. Three runs, each through `adoptRun`, in this order, so history lists them newest first as failed, skipped,
     finished:
     - finished: `chat.prepareLaunch({ projectDir, profile: 'work', message: { text: 'scheduled self-test', images:
       [] }, headless: true }, {})`; run `{ id: spawn.id, record: { taskId, occurrence: now - 3 h, adopt }, startedAt:
       now - 3 h, skipped: false, exit: { code: 0, signal: null, error: null } }`. The process is gone, so `adopt`
       opens a resting row and main records it finished and unviewed.
     - skipped: a second `prepareLaunch`; `{ …, occurrence: now - 2 h, startedAt: now - 2 h, skipped: true, exit:
       null }`.
     - failed: a third `prepareLaunch`; `{ …, occurrence: now - 1 h, startedAt: now - 1 h, skipped: false, exit:
       { code: null, signal: null, error: 'spawn ENOENT' } }`.
  5. `shownLine: '[scheduling] run rows: 1'`; `alsoShown: [/^\[scheduling\] run row done: \S+$/]`.
  6. `result` resolves to `{ isPaused: () => boolean }`, reading `store.tasks()` for `Self-test task`.
- **Groups**, in this order. The keys, `expect` lines, `alsoExpect` patterns and screenshot names are pinned; the
  `why` lines may be reworded. The Scheduled runs section has no group of its own: `open`'s `shownLine` and
  `alsoShown` prove the section and the done mark, and group 4's `run-row` screenshot shows the section in Sessions
  mode.
  1. `schedules mode` — why: Space k t shows Schedules mode with the paused task, its details and its three history
     rows.
     - keys `[' ', 'k', 't']`, expect `[scheduling] mode shown: 1 tasks`, screenshot `mode`.
     - keys `['k']`, expect `[scheduling] task selected: new`.
     - keys `['j']`, expect `[scheduling] task selected: Self-test task`.
     - keys `['Enter']`, expect `[scheduling] details focused: Self-test task`, screenshot `details`.
  2. `pause and resume` — why: p resumes and pauses the selected task through main's store, and the page shows it.
     - keys `['p']`, expect `[scheduling] resumed: Self-test task`.
     - keys `['p']`, expect `[scheduling] paused: Self-test task`, screenshot `paused`.
  3. `editor` — why: the editor opens with the task's values, saves through main, and refuses a new task with no
     name.
     - keys `['i']`, expect `[scheduling] editor opened: Self-test task`, screenshot `editor`.
     - keys `['<D-Enter>']`, expect `[scheduling] task saved: Self-test task`, alsoExpect
       `[/^\[scheduling\] editor closed$/]`.
     - keys `['a']`, expect `[scheduling] editor opened: new`.
     - keys `['<D-Enter>']`, expect `[scheduling] save refused: Name is empty.`, screenshot `refused`.
     - keys `['Escape']`, expect `[scheduling] editor closed`.
  4. `open a run row` — why: the finished history row opens its run row in Sessions mode, and viewing it clears the
     done mark.
     - keys `['Enter']` would open the newest row (the failed run, unlinked), so the step moves to the oldest first:
       keys `['G', 'Enter']`, expect `[chat] Chat tab shown in scheduling-selftest`, alsoExpect
       `[/^\[scheduling\] run row opened: \S+$/, /^\[scheduling\] run row viewed: \S+$/]`, screenshot `run-row`.
       Focus is on the details after group 3's `Escape` closes the editor (12: `focusMain` gives the details their
       scope); if it is not, the step fails, and that is a finding against 12. The `[chat] Chat tab shown in …` line
       comes from chat's page (`chat-view.ts`, the tab's `shown`), which logs it before it asks for history, so a
       resting row whose history is pending and has no transcript on disk logs it too. If it does not come, the step
       fails, and that is a finding against 14's resting adopted row.
- **Settings**: `{}`. `pageBinds: []`. `scrollsItself: []`, unless the fit check flags the prompt's mono text; then
  the selector of the details pane's prompt value.

GIVEN the fixture WHEN the self-test runs `--plugin scheduling` THEN every group passes and `problems` returns `[]`
GIVEN a run that leaves the task active WHEN `problems` runs THEN it returns the pinned problem line

Tests: none in Vitest: the script is the test. `npm run selftest -- --plugin scheduling` runs it.

Done when: `npm run lint` and `npm run typecheck` exit 0; `npm run selftest -- --plugin scheduling` passes, and the
saved screenshots `.selftest/screenshots/scheduling-mode.png`, `-details.png`, `-paused.png`, `-editor.png`, `-refused.png` and
`-run-row.png` are read against `DESIGN.md` § Surfaces (the Schedules bullet) with each mismatch fixed or reported.

Commit: one commit for the group — "Add the scheduling self-test: Schedules mode keys, editor round trips and the
Scheduled runs section over fixture runs".

## Proof

Commit dae39230b · proof: diff read: Produces present; wave 5 typecheck and lint pass; AGENTS.md self-test list gains the script (lead) · concerns: a failed fixture adopt shows only as missing lines (serial catches); group 4 assumes details keep focus after Escape; scrollsItself [] until the fit check runs
