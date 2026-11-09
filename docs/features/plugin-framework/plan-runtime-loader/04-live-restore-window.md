# 04 — A restore window per live start

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Closes the follow-up "A page part started live gets no restore window" in `docs/features/followups.md`, its Sessions
mode symptom included. Design: `docs/features/plugin-framework/design.md` § Runtime loader (Wave 4 step 3), last
bullet: every live start opens a restore window, parts that prune saved places prune on `api.restores.onSettled`, and
`ready()` keeps its shape.

Files:
- modify `src/renderer/page-restores.ts` (with its header comment over `PageRestoresHost`) · test
  `src/renderer/page-restores.test.ts`
- modify `src/renderer/plugin-parts-answer.ts` · test `src/renderer/plugin-parts-answer.test.ts`
- modify `src/renderer/renderer.ts` (the answer's deps; the `restores settled` log moves into `page-restores.ts`)
- modify `src/renderer/shell/modes.ts` · test `src/renderer/shell/modes.test.ts`
- modify `src/contracts/plugin.ts` (the `PageRestores` doc, the `restores` line of the page API doc, the `Modes` doc)
- modify `src/plugins/sessions/page/start.ts` · test `src/plugins/sessions/page/start.test.ts`
- modify `src/plugins/sessions/contract.ts` (the `sessionsPlaceSlot` doc)
- modify `src/plugins/chat/page/start.ts` · test `src/plugins/chat/page/start.test.ts`
- modify `src/plugins/chat/main/start.ts` (the `restored` handler) · `src/plugins/chat/contract.ts` (`ChatChannel`)
- modify `src/plugins/docs/page/start.ts` · test `src/plugins/docs/page/start.test.ts`
- modify `src/shared/plugin-part-harness.test-support.ts` (doc wording only: the `PagePartHarness` comment, lines
  191-193, and the `holdsRestores` option comment, line 244)
- modify `src/shared/page/place-slot.ts` (the `pruneKeys` doc, line 28)
- modify `src/renderer/plugins/page-api.ts` (the `restores` doc, line 89)
- modify `src/plugins/notes/page/start.ts`, `src/plugins/notes/page/popup.ts` (doc wording only: "the page load's
  restores" becomes "the restore window's")
- modify `AGENTS.md` § Architecture, bullet "A slot" (the restore-window sentences) and the `page-restores.ts` line
  of the source map (line 214)

Consumes: nothing from another task. The host's `start(ids)` already calls `ready()` on each part it started
(`src/shared/plugin-host.ts`).

Produces:
- `PageRestoresHost.reopen(): void` in `src/renderer/page-restores.ts`, exactly as `plan.md` § Shared names gives it.
  Only the `start` answer calls it. Task 11's `reload` answer swaps the part and starts nothing; the switch sends
  `start` after it, and that `start` opens the window.
- `PluginPartsAnswerDeps.restores: Pick<PageRestoresHost, 'reopen' | 'partsReady'>` in
  `src/renderer/plugin-parts-answer.ts`.
- `ChatChannel.invoke.restored(): Promise<void>` in `src/plugins/chat/contract.ts`.

Decisions:
- **Window rules** (`createPageRestores`):
  - The host is created with one window open, as today (the page load's).
  - `reopen()` after the window settled opens a new one: not settled, parts not ready, pending count 0, no listeners.
  - `reopen()` while a window is still open keeps that window, its pending restores and its listeners, sets "parts
    not ready" again and clears its cap timer. The next `partsReady()` sets a new cap. A live start during the load
    window (the load path's own `start` for parts the last push turned on) so joins the load window.
  - A restore belongs to the window it was tracked in. A restore from a settled window that settles later changes
    nothing in a newer window. Today, a restore still pending at the cap would lower the next window's count.
  - `track()` with no open window (settled, no `reopen()` since) is ignored, as today. Write this in the
    `PageRestores` doc.
  - `onSettled(listener)` while a window is open waits for that window. With no open window it calls the listener at
    once, as today. A listener added after `reopen()` so waits for the next `partsReady()`, then for the window to
    settle.
  - The host logs `restores settled` (source `page`) each time a window settles, and the cap line stays as it is.
    Remove `renderer.ts`'s own `onSettled` log listener, so the log line shows for every window and not only the
    load's.
- **The page side of a live start.** In `answerPluginParts`, the `start` case calls `deps.restores.reopen()` before
  `host.start(ids)`, and `deps.restores.partsReady()` after it, before `deps.reapplyPush()`. `partsReady()` runs even
  when `host.start` throws, so a failed start still settles its window. The `stop` and `mayStop` cases touch no
  window. The load path in `renderer.ts` keeps `pageHost.ready(); restores.partsReady()` as it is. Its later
  `answerPluginParts` start for `toStart` reopens through the rule above.
- **Prune on settle.** Each part that prunes saved places adds its prune with `api.restores.onSettled` in `start`,
  and its `ready()` no longer prunes. The handle is filed in the part's registrations, so a part stopped before its
  window settles never prunes.
  - sessions: `pruneKeys(places, …)` moves out of `ready()`. `ready()` keeps `apply(currentState())`.
  - chat: `pruneEndedPlaces()` moves out of `ready()`. `ready()` keeps `view.ready()`.
  - docs: the `pruneKeys(placeWriter, …)` call moves out of `ready()`. `ready()` keeps its `followRows`.
- **Chat's main restore is a tracked restore.** On a live restart of sessions or chat, chat's main part reopens the
  saved rows asynchronously (`restored` in `src/plugins/chat/main/start.ts`). A prune on settle drops their places
  unless the window waits for that restore. Add `restored(): Promise<void>` to `ChatChannel.invoke`. Main handles it
  with `api.channel.handle('restored', () => restored)`. `restored` already catches its own error, so the reply never
  rejects. The chat page part calls `api.restores.track(api.channel.invoke('restored'))` in `start`, next to its
  `loaded` invoke. Main sends each row's slot write to the page before the reply, both over the page's one IPC
  pipe, so the rows are in the page's mirror when the tracked restore settles.
  - At a page load the reply can also pend. `restored` starts in main's `start` and waits for `saved.load()` and
    `listHostedProcesses` (a child process), so it can still run when the page loads. The page does not answer it
    early: the load window waits for main's restore too, at most `RESTORES_CAP_MS`. This is wanted. The same prune
    rule then holds at a page load and at a live start, and a place for a row main has not reopened yet stays.
- **Other parts and load-only restores.** These need no edit beyond doc wording:
  - forms and primer track their open-forms read, and docs tracks its reopened doc. With a window per live start,
    these reads now hold a live window as they hold the load's.
  - notes sets `restoresSettled` from `onSettled` in `start`, so a restarted notes part waits for its own window.
  - The search for `pruneKeys`, `onSettled`, `partsReady` and `restores.track` under `src/plugins` finds no other
    part.
- **The Sessions mode after a restart** (cause: `src/renderer/shell/modes.ts`). A stop disposes sessions' mode handle.
  Because that mode was shown, `dispose` shows the first remaining mode in add order (Gallery). The restarted part's
  `add` then adds Sessions hidden, since a mode now shows. Fix in the registry, not in sessions, so every mode plugin
  (docs, settings, backlog) gets it:
  - When `dispose` takes away the shown mode and the registry holds no give-way id, the registry keeps that mode's
    id as the mode that gave way. It keeps the id also when no mode remains.
  - When `dispose` takes away the shown mode and the registry holds a give-way id already, the registry keeps the
    older id. The disposed mode was a fallback that `dispose` showed, not the user's pick. Example: a stop disposes
    dependents first. When `b` (shown, a dependent of `a`) gives way and the fallback is `a`, the stop then disposes
    `a`, and the registry keeps `b`.
  - An `add` of the give-way id shows the added mode, as `show` would: the shown mode's element and side bar hide,
    it hears `hidden`, the added mode is revealed and hears `shown` before `add` returns, and `onChanged` listeners
    hear its id. With no mode shown, the existing first-mode reveal shows it. In both cases the registry then forgets
    the id.
  - Only a `show` that changes the shown mode also makes the registry forget the id. The reveal that `dispose` does
    through `showFirstRemaining` is not a `show`, and it keeps the id. An empty registry keeps the id.
  - The result: the mode shown before a stop is shown after the start, for a restart and for a switch-off then
    switch-on with no other mode picked in between. Write this rule in the `Modes` doc in `src/contracts/plugin.ts`.
- Doc text: the `PageRestores` doc, the page API's `restores` line, `page-api.ts` line 89, the header comment over
  `PageRestoresHost` in `page-restores.ts` ("The page load's one `PageRestores`"), the `sessionsPlaceSlot` doc,
  `place-slot.ts` line 28, the comments over chat's and docs' prune, and AGENTS.md "A slot" say: restores
  belong to a restore window, which a page load or a live start opens. AGENTS.md drops "a part started live later
  gets no new restore window", and the prune sentences drop "on a live restart … not reopened yet". The
  `page-restores.ts` header says: the one host of the page's restore windows; the composition root and the `start`
  answer call `partsReady` once every part they started ran `ready()`. The harness comments say: each start of the
  part under test (`startPagePart` and `restart`) opens a restore window, held until `settleRestores` when the
  options hold the restores. The harness code does not change.

GIVEN restores settled and `reopen()` ran WHEN a restore is tracked and `partsReady()` runs THEN `onSettled` listeners
added after `reopen()` fire only once that restore settles, and `restores settled` is logged once more.
GIVEN a restore pending at the cap of a settled window WHEN it settles inside a newer open window THEN the newer
window's count is unchanged.
GIVEN a live `start` request WHEN the page answers it THEN it calls reopen, starts the parts (each `ready()` ran),
calls partsReady, then reapplies the push, in that order.
GIVEN sessions shown WHEN its mode handle is disposed and a mode with id `sessions` is added again with no `show` in
between THEN Sessions shows and listeners hear `sessions`.
GIVEN a saved place for a row that chat's restore has not reopened yet WHEN the part starts live THEN the place stays
until the window settles, and the prune keeps it once the row is in.
GIVEN `b` shown and the fallback `a` WHEN a stop disposes `b`, then `a`, and the start adds `a`, then `b` THEN `b`
shows.

Tests:
- `page-restores.test.ts`: add a table test
  `reopen_OpensANewWindowThatSettlesOncePartsReadyAndItsRestoresSettle` with rows: "nothing tracked" (settles at the
  next `partsReady`), "one tracked, pending" (unsettled), "a restore left from the capped window settles" (the newer
  window's pending restore still holds it unsettled), "reopen before the load window settled" (the load window's
  pending restore still holds it, and the listener from before `reopen` waits too). It breaks if `reopen` keeps
  `isSettled` true, or if the count is shared across windows. Extend the `logged` column of
  `onSettled_FiresOncePartsReadyAndNoTrackedRestorePendingOrAtTheCap` with `restores settled` on each settled row
  (it breaks if the log stays in `renderer.ts`). Keep `track_AfterSettled_IsNotWaitedOn` as the no-open-window rule.
- `plugin-parts-answer.test.ts`: extend the existing table. Add a `steps` column recorded by the fake host and fake
  deps (`reopen`, `start <ids>`, `partsReady`, `reapply`), replacing the `reapplied` count. Rows: start →
  `['reopen', 'start a,b', 'partsReady', 'reapply']`; a start that throws partway →
  `['reopen', 'start a,b,c', 'partsReady', 'reapply']`; stop and mayStop rows → `[]`. It breaks if `partsReady` runs
  before `start`, or is skipped on a throw.
- `modes.test.ts`, under `describe('disposing a mode')`: add a table test
  `add_IdOfTheModeThatGaveWay_ShowsItAgain` with rows:
  - re-add `a` after the shown `a` gave way → `shown a`, `changed a`, `b` hidden.
  - a `show` of `c` in between → `a` added hidden.
  - adding `d` (another id) → hidden.
  - the last mode `a` disposed (registry empty), then `d` added, then `a` added → `a` shown, `d` hidden.
  - the shown `b` gave way, the fallback `a` disposed too, then `a` added, then `b` added → `b` shown, `a` hidden.
  It breaks if the remembered id is never cleared, if `add` keeps the first-mode-only rule, if an empty registry
  forgets the id, or if a fallback's give-way replaces the older id.
- `sessions/page/start.test.ts`: rename `prune_waits_for_ready` to `prune_WaitsForTheRestoresToSettle`. Use the
  harness's `holdsRestores`: set the live row after `ready()` and before `settleRestores()`, and assert both keys
  stay after `ready()` and only `s-live` stays after `settleRestores()`. It breaks if the prune stays in `ready()`.
- `chat/page/start.test.ts`: add `restoredInvoke_IsTracked` (the harness's `restores` holds the promise of the
  `restored` invoke, read through the harness's `invoke` option). It breaks if chat stops tracking it. Keep
  `row_gone_during_reload_is_pruned` green.
- `chat/page/start.test.ts`: add `prune_WaitsForTheRestoresToSettle`. `startChatPage`'s options object gains
  `holdsRestores`, passed to `startPagePart`. Hold the restores, seed a place and images for row `r` through
  `reloadWith` with no row `r` in `sessionsRowsSlot`, then add row `r` to the rows, then call `settleRestores()`.
  Assert that `r`'s place and images stay after the restart and after `settleRestores()`. It breaks if the prune
  stays in `ready()` or runs before the window settles.
- `docs/page/start.test.ts`: keep `rowGone_DeletesItsPlace_KeepsTheOthers` green. Add a row to it, or one case beside
  it, with the harness's `holdsRestores`: a place for row `r`, no row `r` at the restart, row `r` added before
  `settleRestores()` → the place stays. It breaks if the prune stays in `ready()`.
- Self-test: none here. Task 16 runs the live checks by name: a live restart of sessions keeps chat's and docs' places
  and each session's place, and Sessions mode stays shown.

Done when: compiles; the tests named above pass by name; no `ready()` of sessions, chat or docs calls `pruneKeys`
or `pruneEndedPlaces`; `grep -c "reopen" src/renderer/page-restores.ts` prints at least 1. Task 15 removes the follow-up item.

Commit: one commit for the task.

## Proof
