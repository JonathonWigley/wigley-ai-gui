# 10 — Switch over the catalog, with reload

Status: not started
Type: Task
Wave: 3 · Depends on: 03, 05, 08
Plan: [plan.md](plan.md)

Files:
- modify `src/main/plugins/plugin-switch.ts` · test `src/main/plugins/plugin-switch.test.ts`
- modify `src/main/plugins/plugin-switch-drive.ts` · test `src/main/plugins/plugin-switch-drive.test.ts`
- modify `src/main/plugins/applied-plugins.ts` · test `src/main/plugins/applied-plugins.test.ts`
- modify `src/main/page-parts.ts` (empty replies of the two new request kinds)
- modify `src/contracts/core-state.ts`, `src/contracts/bridge.ts`
- modify `scripts/check-layers.mts`: the `src/main/plugins` entry gains the `src/shared/plugin-catalog` layer, for
  `handlerProblems`. No other wave-3 task edits this file.
- modify the `status()` test helpers that build a `PluginStatus` so they compile: `src/plugins/settings/page/plugin-rows.test.ts`
  and `src/plugins/settings/page/settings-view.test.ts` (add `origin: 'built-in', problem: null` as defaults). Task 12
  edits these files later in wave 4.

Consumes:
- `PluginCatalog`, `CatalogEntry`, `CatalogProblem`, `CatalogChange`, `PluginOrigin` ← 08
- `PluginHost.add(part)`, `remove(pluginId): Promise<string[]>` ← 03, and `PluginHost<Started, Part>`
- `handlerProblems(manifest, process, commands)` in `src/shared/plugin-catalog/validate-manifest.ts` ← 02
- `AppliedPlugins.paused()`, `setPaused(ids)`, `dependentsOf` in `src/shared/plugin-manifests.ts`, and the restart's
  pause-then-push order ← 05
- `ConfigStore.plugins()`, `setPlugins(entries)`, `pluginProblems()`, `setPluginProblems(problems)` ← 09

Produces:
- `src/contracts/core-state.ts`: `PluginStatus` gains `readonly origin: PluginOrigin;` and
  `readonly problem: string | null;`. Replace the whole `corePluginsSlot` comment (`core-state.ts:73` at plan time,
  "Every built-in plugin, in manifests order: …") with: "Every plugin in the catalog, in catalog order, then each
  plugin that failed its first load: its label, its description, its origin, whether a version of it runs now, the
  ids of the plugins that run now and depend on it, and its problem or null. Main's plugin switch writes it at start
  and after each change."
- `src/contracts/bridge.ts`: `PluginPartsRequest` gains
  `| { kind: 'reload'; id: string } // reply: { reloaded: readonly string[] }` and
  `| { kind: 'remove'; id: string } // reply: { stopped: readonly string[] }`. `PluginPartsReply` gains
  `| { reloaded: readonly string[]; problem: string | null }` (`problem`: why the page could not load the new
  `page.js`, null when it loaded). The `start` reply `{ started: readonly string[] }` in `PluginPartsReply` becomes
  `{ started: readonly string[]; problems: readonly CatalogProblem[] }` (`problems`: page-side load and start
  failures, one per id), and the `start` request kind's comment reads
  `// reply: { started: readonly string[]; problems: readonly CatalogProblem[] }`. `page-parts.ts`' `emptyReply`
  answers `{ reloaded: [], problem: null }`, `{ stopped: [] }`, and `{ started: [], problems: [] }` for `start`.
- `src/main/plugins/plugin-switch.ts`:
  - `PluginSwitchDeps`: `manifests` goes. It gains
    `catalog: Pick<PluginCatalog, 'entries' | 'problems' | 'onChanged'>`,
    `config: Pick<ConfigStore, 'plugins' | 'setPlugins' | 'pluginProblems' | 'setPluginProblems'>` and
    `configDisabled(): readonly string[]` (the `plugins.disabled` the config holds now). `main` becomes
    `Pick<PluginHost<MainStart<PluginManifest>, MainPart>, 'start' | 'stop' | 'mayStop' | 'started' | 'add' | 'remove'>`.
  - `PluginSwitch` gains `settled(): Promise<void>` — resolves once the switch's queue holds no work.
  - `export function heldAtStart(entries: readonly CatalogEntry[]): string[]` — every entry whose origin is not
    `built-in`, and every entry that depends (`dependsOn.main` or `.page`, transitively) on one, in entry order.
- `src/main/plugins/plugin-switch-drive.ts`: `PluginSwitchActionDeps.manifests` becomes `ids(): readonly string[]`;
  it gains `pluginSwitch: Pick<PluginSwitch, 'restart' | 'settled'>` and `reload(id: string): Promise<void>`. New drive
  action `reloadPlugin` (full name `core.reloadPlugin`).
- `src/main/plugins/applied-plugins.ts`: no new member beyond task 05's. Its comment states that the switch adds and
  removes catalog ids from the list.

Decisions:
- **Live lists.** Known ids, labels and the start order (`dependencyOrder`) are read from `config.plugins()` (the
  admitted entries) at each use, never kept from creation.
- **Switch state.** The switch keeps these, per id:
  - `handled: Map<string, CatalogEntry>` — the catalog entry the switch last acted on, a failed or refused one
    included. It is the baseline of every catalog job. Seed it at creation from `config.plugins()`.
  - `withheld: Set<string>` — ids the switch keeps in the applied list that the user did not disable: a held id
    before its launch start, an added id before its start, and every id that runs no version after a failed start,
    a refusal or a `Needs plugin` skip. Seed it at creation with the applied list minus `configDisabled()`.
  - `startProblems: Map<string, string>` — the start problem of each id (texts below).
  - `lastGood: Map<string, CatalogEntry>` — the entry whose code last started cleanly. Set it on each clean start.
    Seed it at creation with each admitted entry that runs (in `main.started`, or with no main part, and not in the
    applied list). The held ids get theirs at their launch start.
  - `inPlace: Map<string, CatalogEntry>` — the last good entry that runs in place of the catalog's entry after a
    failed reload (Reloaded, step 7).
  The applied list (task 05) is always the user's disabled ids that are admitted, plus `withheld`. It means "binds
  withheld", never "failed".
- **What the config admitted.** Every `config.setPlugins` call hands `catalog.entries()` with each `inPlace` entry
  in place of the catalog's entry for that id. After each call resolves, the switch reads `config.plugins()`. For an
  id the job acts on, the id is:
  - admitted, when `config.plugins()` holds the exact catalog entry (`===`);
  - refused, when it holds another entry for the id (the store kept its last admitted entry) or none.
  A refused id is a failed load. Nothing new starts for it, and the row shows the store's text from
  `config.pluginProblems()`. The switch records no start problem for a refusal.
- **One queue.** A catalog change queues in the same queue as `apply` and `restart`, so it runs after the work before
  it. The catalog listener only queues. The queued job reads `catalog.entries()` when it runs and works out the three
  groups against `handled`: `added` = an id in `catalog.entries()` and not in `handled`; `removed` = an id in
  `handled` and not in `catalog.entries()`; `reloaded` = an id in both whose catalog entry is not the `handled` entry
  (`!==`). So two changes queued back to back act once on the newest state, and a change of `problems()` alone (three
  empty lists) reloads nothing. The job runs `removed` first (reverse start order), then `reloaded` (start order),
  then `added` (start order over the admitted entries after its `setPlugins`). It sets or deletes `handled` for each
  id it acts on, also when the id fails.
- **Start at launch.** Task 13 starts the main host with `heldAtStart(...)` in the applied list. The switch, at
  creation, queues one job: for each held id that `configDisabled()` does not name, in start order, a guarded start
  with page start (below). A held id the user disabled stays in the applied list. Then the same job runs one catalog
  job, so a catalog change between the store load and the switch's creation is not lost. Then the status and problem
  writes.
- **A replacement that fails at launch.** At launch no `lastGood` exists for a replacement of a built-in, because the
  built-in did not run. When the replacement's start fails, the id stays stopped with its problem, and its dependents
  get `Needs plugin`. The built-in does not come back. This matches the config store's rule for a replacement it
  refuses at load (task 09). At runtime, the built-in entry that ran is the `lastGood`, so step 7 below brings it
  back.
- **When a dependency counts as started.** A dependency (`dependsOn.main` or `.page`) of id `x` counts as started
  when it is admitted, it is not in the applied list, and it is in `main.started` or its admitted entry has
  `main === null`. The switch checks no page status: page parts of dependencies stop in a reload between steps 3
  and 9.
- **Guarded start of one id**, `guardedStart(id, { pageStart: boolean })` (used at launch, for `added`, for a
  withheld id that a reload or a switch-on starts, and in a reload):
  1. If a dependency does not count as started: record the start problem `Needs plugin "<dep>", which did not
     start` (the first such dependency in `main` then `page` order), add the id to `withheld`, and skip it.
  2. Else `main.start([id])` when it has a main part. A throw records `Did not start: <error text>`.
  3. For a non-built-in with a main part, after the start, run `handlerProblems(manifest, 'main', started.commands)`.
     A non-empty list records `Commands and handlers differ: <items joined by ", ">` and stops the part with
     `main.stop(id)`.
  4. On a failure in steps 2 or 3: add the id to `withheld` (it runs no version). Return false.
  5. On success: set `lastGood` to the entry. Clear the id's start problem, except when the id has an `inPlace`
     entry (the restored last good version, step 7 of Reloaded). Only when the id was in `withheld`: delete it from `withheld`, write the
     applied list, and call `servedChanged()`. Then, when `pageStart` is true, page `start` `[id]`. Log `on <id>`
     as today. Return true.
- **Retry of withheld dependents.** At the end of each catalog job, run `guardedStart(id, { pageStart: true })` for
  each id in `withheld`, in start order, whose start problem begins `Needs plugin`, whose dependencies now count as
  started, and that `configDisabled()` does not name. So a fixed dependency brings its dependents back.
- **Added.** Add each added id to `withheld` and write the applied list, so its binds are not served before its
  handlers exist. Then `config.setPlugins(...)`. For each added id, in start order:
  - Refused: no `main.add`, no start. The id stays in `withheld`.
  - Admitted: `main.add(entry.main)` when it has one. An id `configDisabled()` names leaves `withheld` (the user's
    off now holds it) and starts nothing. Every other id gets `guardedStart(id, { pageStart: true })`.
  Log `added <id>`.
- **Removed**, in reverse start order, as a switch-off: add the ids to the applied list and `servedChanged()`; page
  `remove` each id; `main.remove(id)` each (it resolves `[]` for an id the host does not hold, task 03);
  `slots.clearOwner(id)` each; then `config.setPlugins(...)` and drop the ids from the applied list, `withheld`,
  `startProblems`, `lastGood`, `inPlace` and `handled`. Log `removed <id>`. A removed plugin is never refused by
  `mayStop`: its folder is gone.
- **Reloaded**, one id at a time. `next` is the id's catalog entry. Delete the id's `inPlace` entry first.
  1. **Off or withheld.** When `configDisabled()` names the id, or the id is in `withheld`: `config.setPlugins(...)`.
     When `next` is admitted: `main.remove(id)`, then `main.add(next.main)` when it has one. When the id is in
     `withheld` and `configDisabled()` does not name it, run `guardedStart(id, { pageStart: true })`. Log
     `reloaded <id>` when `next` is admitted. Done. This is how a fixed save or `core.reloadPlugin` starts a plugin
     whose earlier start failed.
  2. **Running.** Pause the id and its dependents (`setPaused([id, ...dependentsOf(...)])`) and `servedChanged()`,
     as task 05's restart does.
  3. `config.setPlugins(...)`. When `next` is refused: clear the pause, `servedChanged()`, and log
     `reload of <id> failed: <the store's problem text>; the last good version runs`. Done: nothing stopped, and the
     old part runs. The store still serves its last admitted entry for the id (task 09). When the store holds no
     entry for the id at all, the old part has no served config: clear the pause, stop the id as Removed stops it
     (its slots included, its `handled` entry kept), and add it to `withheld`.
  4. Page `stop` `[id]` → `pageStopped`.
  5. `main.remove(id)` → `mainStopped` (stop order). `main.add(next.main)` when `next` has one.
  6. For each id of `mainStopped`, in start order: `guardedStart(each, { pageStart: false })`.
  7. If the reloaded id failed in step 6, and `lastGood` holds an entry for it that is not `next`: set
     `inPlace[id]` to that entry, `main.remove(id)`, `main.add(lastGood.main)`, `config.setPlugins(...)`, and run
     step 6 again over the ids of `mainStopped` that do not run. The id's start problem stays: it is the new revision's problem. Then:
     - The last good part starts: log `reload of <id> failed: <message>; the last good version runs`.
     - The store refuses the last good entry, or its start fails too: the id stays stopped in `withheld`, its row
       shows the first message, and the log holds
       `reload of <id> failed: <message>; the last good version failed too: <second message>`.
     With no last good entry, the id stays stopped in `withheld` with its problem.
  8. Clear the pause and `servedChanged()`.
  9. When `next` runs (step 6 started it, or it has no main part): page `reload` `{ id }`. A reply whose `problem` is
     not null records it as the id's start problem, verbatim (the page keeps its old part, task 11). When the last
     good version runs, or nothing runs, send no `reload`: the page keeps its old part. Then page `start` with
     `pageStopped` minus each id in `withheld`.
  10. When `next` runs, log `reloaded <id>`.
- **A replaced built-in** and its return arrive as `reloaded` (task 08 reports id presence). They take the reload
  path. Their slots are kept, as a restart keeps them.
- **apply with withheld ids.** `applyNow` reads `next` = the `configDisabled()` ids that are admitted. A withheld id
  that `next` names leaves `withheld`: the user's off now holds it. `applyNow` works out `on` and `off` only over ids
  not in `withheld`, and every `applied.set` writes `next` plus `withheld`. So a later unrelated
  `plugins.disabled` edit never starts or stops a failed id. In `switchOn`, the built-in `on` ids start in the batch,
  as today. Each other `on` id first goes into `withheld`, and after the batch's page start it gets
  `guardedStart(id, { pageStart: true })`, in start order. A failed user start then records its problem, and the
  apply still resolves null.
- **Page start problems.** Every page `start` the switch sends reads the reply's `problems`: the guarded start's
  page start (launch, added, a withheld id, switch-on), `switchOn`'s batch page start, `restart`'s page start and
  `startWhatStopped`, and step 9 of Reloaded. (Today's sends are at `plugin-switch.ts` lines 180, 304 and 349.) Each
  item's `message` is recorded verbatim as the start problem of its `id`, as the `reload` reply's `problem` is. The
  id's main part keeps running and its `on` does not change. A reply with
  no `problems` field (an older fake) counts as `[]`.
- **Problems.** The switch owns three sources: `startProblems`, `catalog.problems()`, and `config.pluginProblems()`.
  A start problem clears on the id's next clean start of an entry other than the restored last good one (guarded
  start, step 5), and on removal. After each job, the switch calls `config.setPluginProblems` with the start
  problems, then the catalog problems (a catalog problem for an id is kept even when a start problem also exists).
  A row's `problem` is the first of: start problem, catalog problem, config problem; else null.
  An id can hold an entry and a catalog problem at once: a user entry whose newer load failed (its last good load
  shows), or a built-in entry shown in place of a held-back replacement (task 08, problem
  `needs plugin "<dep>", which is not loaded`). The switch treats the entry as any other: it starts or keeps it by
  the rules above, and the catalog problem only shows on the row and in the config problems. A held-back
  replacement that gives way to its built-in arrives as `reloaded` with the built-in entry, and its return as
  `reloaded` again. The catalog keeps each entry object between loads, so the `!==` test against `handled` is
  exact.
- **Status rows.** One per `catalog.entries()` entry, in catalog order, then one per catalog problem whose id has no
  entry (a failed first load). An id with an entry and a catalog problem gets one row: the entry's, with the
  problem. For an entry: `label`, `description` and `origin` come from the id's admitted entry
  in `config.plugins()`, else from the catalog entry; `neededBy` is worked out over the admitted manifests. For a
  failed first load: `label` = id, `description` = `''`, `origin` = `'user'`, `neededBy` = `[]`.
  `on` is true when the id is admitted and not in the applied list: it says whether a version of the plugin runs,
  and never follows the problem. So after a failed reload whose last good version runs, the row has `on: true` and
  the problem; a plugin that runs no version has `on: false` and the problem. Task 12 draws both.
- **mayDisable and restart** keep their texts. `restart` of an unknown id rejects `No plugin "<id>"` against the live
  list.
- **Dispose.** `dispose()` also disposes the `catalog.onChanged` registration. Every queued job, the launch job and
  catalog jobs included, checks `isDisposed` when it starts and after each awaited page request and `setPlugins`,
  and returns at once when it is set. So a job that a quit interrupts makes no later `setPlugins`, host or page call.
- **Drive action** `reloadPlugin`: description
  `Loads user plugin id again from its folder with no file change, stopping and starting its dependents.`, args
  `{ id: string }`. It checks the args' shape only (text `reloadPlugin takes { id: string }`, as `pluginIdOf`
  words it). It does not check the id against `ids()`: a plugin whose first load failed or that the config refused
  has no admitted entry, and reloading it is the main use. `reload(id)` rejects an unknown id with
  `No plugin "<id>"` and a built-in with its own text; each rejection passes through. Then it awaits
  `pluginSwitch.settled()` and returns null. The existing description of the actions in the file's comment names all
  four.

GIVEN user plugin `u` added with no disabled entry WHEN the switch handles the change THEN calls run in order
`applied +u`, `setPlugins`, `main add u`, `main start u`, `applied -u`, `servedChanged`, `page start u`
GIVEN running `u` with dependent `d` WHEN `u` reloads THEN calls run `paused [u,d]`, `servedChanged`, `setPlugins`,
`page stop u`, `main remove u`, `main add u`, `main start u`, `main start d`, `paused []`, `servedChanged`,
`page reload u`, `page start <pageStopped>`
GIVEN running `u` WHEN a reload hands revision 2 and the config keeps revision 1 THEN calls run `paused [u]`,
`servedChanged`, `setPlugins`, `paused []`, `servedChanged`; no page stop and no main remove run; the row of `u` shows
`on: true` and the store's problem
GIVEN the new `u` throws at start and an old `u` ran WHEN it reloads THEN the old part is added and started again,
`d` starts, the row of `u` shows `on: true` and `Did not start: <error>`, and the log holds
`reload of u failed: Did not start: <error>; the last good version runs`
GIVEN the case above WHEN a later catalog change holds only a problem of another id THEN `u` does not reload, and the
`setPlugins` call hands the old `u` entry
GIVEN the new `u` and the old `u` both throw at start WHEN it reloads THEN `u` stays stopped, its row shows `on: false`
and the first message, and the log holds `reload of u failed: Did not start: <first>; the last good version failed
too: Did not start: <second>`
GIVEN `u` failed its launch start WHEN a fixed revision reloads THEN `u` starts with its page part, its row shows
`on: true` and no problem, and its dependent `d` with `Needs plugin "u", which did not start` starts after it
GIVEN `u` failed its launch start WHEN an unrelated `plugins.disabled` edit applies THEN `main start u` does not run
GIVEN a started user part missing a declared handler WHEN it starts THEN it is stopped and its row shows
`Commands and handlers differ: missing <cmd>`
GIVEN a page-only plugin `p` and user plugin `u` that depends on `p` WHEN `u` starts THEN `u` starts, with no
`Needs plugin` problem
GIVEN `u`'s folder deleted WHEN the switch handles the change THEN `servedChanged` runs before `page remove u`, then
`main remove u`, then `clearOwner u`
GIVEN one job that holds `removed` `x`, `reloaded` `y` and `added` `z` THEN the removal runs first, then the reload,
then the add
GIVEN a change arriving while an `apply` runs WHEN both settle THEN the change ran after the apply
GIVEN a running user replacement `chat` whose dependency `z` is deleted WHEN the catalog shows the built-in `chat`
with the problem `needs plugin "z", which is not loaded` THEN `chat` takes the reload path to the built-in entry, and
its one row shows origin `built-in`, `on: true` and that problem
GIVEN a catalog problem for an id with no entry THEN `core.plugins` holds a row for it with `on: false` and the problem
GIVEN the switch disposed WHEN a queued catalog job runs THEN it makes no `setPlugins`, host or page call

Tests (extend the existing `setup` fake: the catalog fake holds entries and problems and fires `onChanged`; the
config fake records `setPlugins` and `setPluginProblems`, and its `plugins()` returns what a test sets, so a test can
refuse an entry; the main fake records `add` and `remove`):
- new `catalogChange_Added_StartsInOrder` — rows: no main part; main and page; named by `configDisabled()` (stays
  off, no start); dependency not started (`Needs plugin "a", which did not start`); refused by the config (no `main
  add`, no start, row `on: false` with the config problem); two added ids, the dependent first in catalog order
  (the dependency starts first); the page `start` reply carries
  `{ id: 'u', message: 'Page part did not start: boom' }` (the row of `u` shows that text). Asserts `calls`.
- new `catalogChange_Removed_StopsLikeASwitchOff` — asserts the order above and `clearOwner`.
- new `catalogChange_Reloaded_RunsTheReloadOrder` — rows: running with a dependent; off (swap only); a replaced
  built-in (origin changes in the status row); a page-only dependency (no `Needs plugin`).
- new `catalogChange_ReloadRefusedByConfig_StopsNothing` — the config fake keeps the old entry; asserts calls, the
  row (`on: true`, the config problem) and the log line verbatim. Breaks if the switch starts code the config did
  not admit.
- new `catalogChange_ReloadStartFails_RestartsTheLastGood` — rows: start throws; handlers differ; no last good (stays
  stopped, `on: false`, with the problem); the last good start throws too (stays stopped, both messages in the log
  line). Asserts calls, status rows (`on` and `problem`) and the log line verbatim.
- add a row to `catalogChange_ReloadStartFails_RestartsTheLastGood`: the page's `reload` reply carries
  `problem: 'page.js failed: boom'`; the row shows that text and the page `start` still runs.
- new `catalogChange_AfterFailedReload_BaselineIsTheHandledEntry` — after a failed reload, a problems-only change
  reloads nothing, and the next `setPlugins` hands the last good entry. Breaks if the bad id reloads on every change.
- new `catalogChange_WithheldId_FixedRevisionStarts` — rows: a failed launch start, then a fixed revision (starts
  with its page part; its `Needs plugin` dependent starts after it); a config-refused add, then an admitted
  revision. Breaks if a failed start is stuck for good.
- new `catalogChange_OneJobAllThreeGroups_RemovedReloadedAdded` — asserts the group order in `calls`.
- new `catalogChange_DuringApply_RunsAfterIt`.
- new `apply_WithheldId_LeftAlone` — rows: an unrelated disabled edit with a failed id (no `main start` of it); the
  user disables the failed id (it leaves `withheld`); switching a user plugin on whose start throws (apply resolves
  null, the row shows the problem).
- new `launch_HeldIds_StartGuardedOneByOne` — one held id fails; the others start; the failed id's dependent gets the
  `Needs plugin` problem; a replacement of a built-in that fails stays stopped (no built-in comes back); the page
  `start` reply carries `{ id: 'u', message: 'Page part did not start: boom' }` (the row of `u` shows
  `Page part did not start: boom`).
- new `dispose_QueuedCatalogJob_DoesNothing` — a change queued behind a held page request, then `dispose()`; the job
  makes no later call, and a later `onChanged` queues nothing.
- add rows to `status_AfterApply_HoldsEachPlugin` for `origin`, `problem`, a failed-first-load row, and a built-in
  entry with a held-back catalog problem (one row, `on: true`, the problem).
- new `problems_MergedAndHandedToConfig` — start, catalog and config problems; order and the row's pick.
- `heldAtStart` table test `heldAtStart_UserIdsAndTheirDependents` — rows: none; one user id; a built-in depending on
  a replaced built-in id; a transitive dependent.
- `plugin-switch-drive.test.ts`: add `reloadPlugin` rows to `args_BadOrUnknown_Rejects`: bad args
  (`reloadPlugin takes { id: string }`), and an unknown id whose `reload` fake rejects `No plugin "zz"` (the text
  passes through; `ids()` is not read). New `reloadPlugin_ReloadsThenWaitsForTheSwitch` (order: `reload u`, then
  `settled`); a row for an id that `ids()` does not hold but `reload` accepts.

Done when: compiles; `npm run typecheck` passes; the tests above and `applied-plugins.test.ts` pass. Runtime checks 3,
6, 7 and 8 of [16-final-verification.md](16-final-verification.md) cover the live wiring.
Commit:    one commit for the group.

Concerns: task 05 names `setPaused`, `paused` and `dependentsOf` (from drafter-page's report); match 05's document
if it differs. The page's answer to `reload` and `remove` is task 11's; this task only adds the request kinds and
`page-parts.ts`' empty replies.

## Proof
