# 05 — Keys leave with a restarted page part

Status: not started
Type: Task
Wave: 2 · Depends on: 04
Plan: [plan.md](plan.md)

Closes the follow-up "A restart leaves a page part's keys with no handler" in `docs/features/followups.md`. Today
`restart` in `src/main/plugins/plugin-switch.ts` stops the page parts, then the main parts, then starts them again,
and the served keymap keeps every bind all the way through. A key pressed in the gap runs a command with no handler,
on the page and in main. The switch-off has no gap because it sets the applied list and pushes the served config
before the first stop. The restart does the same through a second list, which strips binds only.

Files:
- modify `src/shared/plugin-manifests.ts` · test `src/shared/plugin-manifests.test.ts`
- modify `src/main/plugins/applied-plugins.ts` · test `src/main/plugins/applied-plugins.test.ts`
- modify `src/main/plugins/plugin-switch.ts` · test `src/main/plugins/plugin-switch.test.ts`
- modify `src/main/main.ts` (`served()` passes the paused list; one line)
- modify `AGENTS.md` § Architecture, bullet "A disabled plugin" (one sentence on the restart)

Consumes: nothing from another task. It depends on 04 only for the wave order of its shared files.

Produces:
- In `src/shared/plugin-manifests.ts`:
  - `export function dependentsOf(pluginId: string, disabled: readonly string[], manifests: readonly PluginManifest[]): string[]`
    returns every plugin that `disabled` does not name and that depends on `pluginId`, directly or through another
    dependent, through `dependsOn.main` or `dependsOn.page`. The ids come in `manifests` order, without `pluginId`.
    It is `neededBy` taken to its closure, and `reads` needs nothing, as for `neededBy`.
  - `withAppliedList(config: AppConfig, disabled: readonly string[], paused: readonly string[] = []): AppConfig`.
    The binds of the plugins in `disabled` or `paused` are dropped, on both sides. `plugins.disabled`, `commands`
    and `scopes` follow `disabled` alone, as today.
- In `src/main/plugins/applied-plugins.ts`, `AppliedPlugins` gains `paused(): readonly string[]` (the plugins whose
  parts restart now, `[]` at creation) and `setPaused(ids: readonly string[]): void` (keeps its own copy).

Decisions:
- **Mechanism: a paused list in the served config, set by main's switch.** This is the switch-off's path, with a
  second list. Rejected alternatives:
  - A page-only fix (the page re-applies its push without the stopping parts) leaves main's app, intercept and
    global binds in the gap. `main.stop` is awaited between the stop and the start.
  - Adding the restarting ids to the applied list would serve them as `plugins.disabled`. The page's load path would
    then stop them, and Settings would show them off.
- **Paused binds only.** A paused plugin keeps its commands and key scopes in the served config, so help, which-key
  and the palette do not flicker through a restart.
- **The restart order** in `restart(pluginId)`, inside its queue as today:
  1. Set `paused = [pluginId, ...dependentsOf(pluginId, applied.disabled(), manifests)]` and call
     `deps.servedChanged()`, before the page stop.
  2. Page stop, main stop, main start, as today.
  3. Set `paused = []` and call `deps.servedChanged()`, after the main start and before the page start. Main's keys
     so return once its handlers exist. The page strips the binds of page parts it has not started yet
     (`startedPluginsConfig`), and the page start's `reapplyPush` brings them back, as for a switch-on.
  4. Page start, as today.
- **A failed restart.** The `finally` clears the paused list and calls `deps.servedChanged()` once more, after
  `startWhatStopped`, only when the list is still set. A main part that does not start again keeps its binds with no
  handler, as after a failed restart today, and the failure is logged and rejected as today.
- **Off or unknown ids** reject before step 1, so they push nothing (`restart_OffOrUnknown_Rejects` keeps
  `calls: []`).
- **The `servedChanged` push order holds.** Main sends the config push and the plugin parts request over the same
  page IPC pipe (`livePage(window)?.send`), so the page applies the push before it handles the next request.
- **The reload holds too.** Task 10's reload has the same stop-then-start shape: page stop, main stop, swap, main
  start, served push, page reload and start. Task 10 sets the paused list (the reloaded id and its `dependentsOf`
  over the catalog's manifests) and pushes before its page stop, and its served push after the main start clears it.
  Task 10 reads this decision and uses `setPaused` and `dependentsOf` by these names.
- `main.ts`'s `served()` becomes `withAppliedList(applySelfTestConfig(…), applied.disabled(), applied.paused())`.
  Task 13 rewrites `main.ts` later and keeps the third argument.
- AGENTS.md "A disabled plugin" gains one sentence: a restart pauses the binds of the plugin and its dependents (the
  applied paused list) and pushes the served config before its page stop, and puts them back before its page
  start.

GIVEN plugin `a` with dependent `b`, both on WHEN `restart('a')` runs THEN the calls are `paused a,b`,
`servedChanged`, `page stop a`, `main stop a`, `main start b,a`, `paused` (empty), `servedChanged`,
`page start b,a`.
GIVEN `paused = ['q']` WHEN `withAppliedList(config, [], ['q'])` runs THEN `q`'s app and page binds are gone, while
its commands, its scope and `plugins.disabled: []` stay.
GIVEN a restart whose main stop rejects WHEN the restart ends THEN the paused list is empty and the last call is
`servedChanged`.
GIVEN a restart whose page start rejects after the unpause WHEN the restart ends THEN `servedChanged` is called no
third time.

Tests:
- `plugin-manifests.test.ts`, `describe('withAppliedList')`: add a `paused` column to the existing table, `[]` on the
  three rows there, and add the row `OnePaused_DropsOnlyItsBinds` (`disabled: []`, `paused: ['q']` → disabled `[]`,
  app `[pApp]`, page `[pPage]`, commands all four, scopes both). It breaks if paused ids reach `commands` or
  `plugins.disabled`.
- `plugin-manifests.test.ts`: add a table test `dependentsOf_ClosureOfOnDependents` with rows: a direct dependent;
  a dependent of a dependent (`c` on `b` on `a` → `['b', 'c']`, in manifests order); a dependent named only in
  `reads` → `[]`; a dependent that is off → `[]`, and its own dependents too. It breaks if the closure stops at one
  level.
- `applied-plugins.test.ts`: extend the existing test with `paused` → `[]` at creation, and the set value after
  `setPaused`, kept as a copy.
- `plugin-switch.test.ts`: the fake `applied` records `paused <ids>` on `setPaused`.
  - Update `restart_KeepsSlotsAndStartsWhatItStopped` to the order in the first GIVEN, with manifest `b` depending
    on `a` so `dependentsOf` finds it. It breaks if the pause comes after the page stop, or the unpause after the
    page start.
  - Setup gains `page.startRejects: string | null`. A page `start` whose ids include it records its call, then
    rejects with `page start of <id> failed`.
  - Write the `calls` of each row of `restart_StepFails_StartsWhatItStopped` in full. The pause list is the plugin
    first, then its dependents in manifests order. The unpause pair comes from the `finally`, after
    `startWhatStopped`:
    - "main stop rejects": `paused a`, `servedChanged`, `page stop a`, `main stop a`, `main start a`,
      `page start a`, `paused`, `servedChanged`.
    - "main start throws": `paused a`, `servedChanged`, `page stop a`, `main stop a`, `main start a`,
      `main start a`, `paused`, `servedChanged`.
    - "one dependent fails to start again" (`z` and `y` depend on `x`; manifests `z`, `x`, `y`): `paused x,z,y`,
      `servedChanged`, `page stop x`, `main stop x`, `main start x`, `main start z`, `main start y`,
      `page start z,x`, `paused`, `servedChanged`.
    - Add the row "page start rejects" (manifests `a`, `b`; `page.startRejects: 'a'`): `paused a`, `servedChanged`,
      `page stop a`, `main stop a`, `main start a`, `paused`, `servedChanged`, `page start a`, `page start a`.
      The second `page start a` is `startWhatStopped`'s. Logs: `[plugin-switch] failed: page start of a failed`.
      It breaks if the `finally` pushes again when the list is already clear.
  - The switch-off, switch-on and dispose tests keep their call lists.
- Self-test: none. The key gap is too narrow to press into from a script. Task 16 checks by name that after
  `core.restartPlugin` a sessions key still runs.

Done when: compiles; the tests named above pass by name; `grep -n "applied.paused()" src/main/main.ts` finds one line. Task 15 removes the follow-up item.

Commit: one commit for the task.

## Proof
