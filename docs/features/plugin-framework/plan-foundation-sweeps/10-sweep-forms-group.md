# 10 — Sweep: forms, primer, sessions, settings, keys, gallery

Status: done
Type: Parallel
Wave: 6 · Depends on: 06, 07
Plan: [plan.md](plan.md)

Six items, one per plugin. Each item applies plan.md § Plugin sweep pattern to the plugin's main part and page part,
and touches only files under `src/plugins/<id>/`. The items share no file, so they run in parallel.

Counts are measured at plan time, re-verify. A two-argument log count below is every call
`log('<source>', …)`, `deps.log('<source>', …)`, `services.log('<source>', …)` or `log(SOURCE, …)` in the plugin's
non-test `.ts` files, a call split over two lines included. Re-verify each with
`grep -rn -A1 -E "log\($|log\('" src/plugins/<id> --include='*.ts' | grep -v '\.test\.ts'`.

A module whose deps declare `log: Log` and that calls it with a source takes `PluginLog` and calls `log(message)`. A
module that only hands `log` on to a shared helper (`keys/page/layout/keys-parts.ts`,
`gallery/page/layout/gallery-parts.ts`, `sessions/page/layout/sessions-parts.ts`, `forms/page/kinds/item-format.ts`,
measured) declares the type that helper takes once 04 and 06 land.

Files:     each item names its own. Every file is under that item's plugin folder.
Consumes:  `api.dependency(key)` with `sessionsMainKey`, `sessionsPageKey`, `chatMainKey`, `keysPageKey` ← 01
           `Registrations` (`consumer.track`) and `exports?(consumer: Registrations): unknown` ← 01
           `PageStart.dispose` ← 01
           `PluginLog` from `src/contracts/log.ts` ← 04
           `PushedScope extends Disposable`, `ModeHandle extends Disposable`, and the page API recording of every
           handle `api` hands out, with the single-slot rule for pane targets and the transparency override ← 02
           the main API recording of `channel.handle`, `events.on`, `layouts.register` and `drive` adds, and the
           per-plugin `services.alerts` view that zeroes the plugin's open counts at stop ← 04
           `SessionsMainExports.contributeTools` and `addCloseGuard` returning `Disposable`, filed under the consumer
           in sessions' main `exports(consumer)` ← 05
           the `Disposable` returns task 06 gives the shared modules: the agent form service's `dispose` (ends every
           live session it started, which clears its deadline timers and abort listeners), `startAutosave`'s return,
           the editor boxes' `dispose` (destroys every mounted editor), the reducer store's `subscribe` return ← 06
           `src/shared/plugin-part-harness.test-support.ts`: the harness's start, stop and restart, and its report
           of live registrations, listeners, observers and timers ← 07. Its options gain `parts?: readonly (MainPart |
           PagePart)[]` (real provider parts the real host starts before the part under test). Its
           `PagePartHarness` gains `showLayouts<L>(shown: ShownLayouts<L>): void` (calls `setLayouts` of each captured
           `layouts.show` options object) and `pushKeymap(keymap: Keymap): void` (runs each live
           `keys.onKeymapChanged` listener).
Produces:  `SessionList.endAll(): void` in `src/plugins/sessions/main/session-list.ts`
           `GalleryView.dispose(): void` in `src/plugins/gallery/page/gallery-view.ts`
           `createLayoutPreview(deps): { open(): void } & Disposable` in `src/plugins/forms/main/preview/layout-preview.ts`
           `createPrimerPreview(deps): { open(): void } & Disposable` in `src/plugins/primer/main/preview/primer-preview.ts`
           `startRoundAutosave(deps): Disposable` in `src/plugins/forms/page/autosave.ts`
           `RelayServerDeps.log: PluginLog` in `src/plugins/sessions/main/relay/relay-server.ts`
           keys page `exports(consumer)` filing `anchor` and `onChanged`; forms page `exports(consumer)` filing
           `addCardPart` and `addReviewColumn`
Decisions: - Sessions' provider side (`contributeTools`, `addCloseGuard`, and the page's `addTab`, `addRowPart`,
             `addBarPart`, `setActivity` under `consumer.track`) is task 05's. This task sweeps only sessions'
             consumer side, its `dispose`, its page part and its log lines (lead's brief for this task).
           - Stopping sessions leaves `endpoint.json` and `tools.json` in place (plan.md Decisions).
           - Sessions' relay lines log under `sessions`; a self-test line that matched `[relay]` moves with them
             (plan.md Decisions). None matches today (measured: `grep -rn "\[relay\]" src scripts` gives nothing).
           - A part's `dispose` writes no second guard for what the recording closes (plan.md § Plugin sweep pattern
             item 4). Each item below says which resources the recording closes.
           - Forms main keeps `registerLayoutsAfter`'s handle in `dispose`, because disposing it before the fixture
             write lands stops the late `api.layouts.register` call from running at all. Without it the call would
             run after stop, start the layout watch and send a layout set, and the store would then dispose it
             (decided by the drafter).
           - A page part whose start waits on a channel read (forms and primer `openForms`, sessions `state`)
             applies nothing from a read that lands after stop: `dispose` sets a flag the read's `then` checks. The
             late read otherwise dispatches into the store, which creates editors (forms, primer), or sets the
             `idle` key scope, emits `activeChanged` and writes uiState `panes` (sessions) (decided by the drafter,
             plan.md § Plugin sweep pattern item 4 "promises it waits on").
Done when: compiles (`npm run typecheck`); the test gate runs the tests below; `npm run lint` passes
Commit:    one commit per plugin item, its message naming the plugin and what its `dispose` now undoes

## forms

Files: modify `src/plugins/forms/main/start.ts`, `src/plugins/forms/main/preview/layout-preview.ts`,
`src/plugins/forms/page/start.ts`, `src/plugins/forms/page/autosave.ts`, and each module that logs with a source
(listed below) · test `src/plugins/forms/main/start.test.ts`, `src/plugins/forms/main/preview/layout-preview.test.ts`
· create `src/plugins/forms/page/start.test.ts`

Main part (`formsMainPart`):
- Keys: `api.dependency<SessionsMainExports>('sessions')` becomes `api.dependency(sessionsMainKey)`;
  `api.dependency<ChatMainExports>('chat')` becomes `api.dependency(chatMainKey)`.
- `sessions.contributeTools(FORMS_TOOLS, …)` keeps its call and drops nothing: its `Disposable` ← 05 is filed under
  forms in sessions' consumer view, so forms keeps no handle.
- `createForms` returns `{ forms, preview, dispose }`. It keeps the two `createAgentFormService` returns before
  `withKnownLayouts` wraps them; its `dispose` calls the agents' service's `dispose` ← 06, then the preview service's
  `dispose` ← 06.
- `createLayoutPreview` returns `{ open(): void } & Disposable`. It hands `createAgentFormPreview` a `sessions` whose
  `connect` keeps the `PreviewConnection` it returns; `dispose` calls that connection's `end()` when one is kept and
  forgets it. A later `end` from the preview's own settle path then reaches `ConnectedSession.end`, which does
  nothing for an ended session (`session-list.ts` `end` returns on `entries.delete` false).
- `dispose` now: `driveActions?.dispose(); return layouts.dispose();`. After: it calls the `createForms` `dispose`,
  then `preview.dispose()`, then `driveActions?.dispose()`, then returns `layouts.dispose()`. The `layouts` variable in `start.ts` (the
  `registerLayoutsAfter` result) stays, and forms keeps `return layouts.dispose()`; primer drops its own.
  `driveActions` stays:
  besides its `host.add` handles, which `api` records, it ends the drive sessions it connected.
- The recording closes, so `dispose` adds nothing for: the four `channel.handle` registrations (`openPreview`, and
  the presenter's `openForms`, `draft`, `finish`) and `events.on('sessions.ended')` ← 04; the presenter's
  `addCloseGuard` ← 05; the `forms` open count, zeroed by the per-plugin `alerts` view ← 04. Ending the services'
  sessions ← 06 also clears every deadline timer and abort listener.
- Log: 2 two-argument calls, both `'forms'`: `start.ts` (`api.services.log('forms', message)` becomes
  `api.services.log`) and `preview/layout-preview.ts` `nextRound`. `nextRound` and `createLayoutPreview` take
  `PluginLog` in place of `Log`.
- `logSource` values task 06 moves: `start.ts:70` (`createFolderFormStore`), `preview/layout-preview.ts:60`
  (`createAgentFormPreview`). The source arguments of `createChatFormWake(chat, services.log, 'forms')` go with
  whatever shape 06 gives `createChatFormWake`; a `logSource` or source argument still in place after 06 is a
  concern for the lead, since only a shared-file edit can move it.

Page part (`formsPagePart`):
- Keys: `api.dependency<SessionsPageExports>('sessions')` becomes `api.dependency(sessionsPageKey)`;
  `api.dependency<KeysPageExports>('keys')` becomes `api.dependency(keysPageKey)`.
- `exports(consumer)`: `addCardPart: (part) => consumer.track(contributions.addCardPart(part))` and the same for
  `addReviewColumn`. `activeRound` and `answers` stay as they are. No plugin outside forms calls either member
  today (measured: `grep -rn "addCardPart\|addReviewColumn" src --include='*.ts'` outside `src/plugins/forms/`).
- `startRoundAutosave` returns the `Disposable` from `startAutosave` ← 06 in place of void.
- `PageStart.dispose` (new): sets the stopped flag `listenForRounds`' `openForms` read checks, then disposes the
  autosave, the `store.subscribe(() => layoutShow.refresh())` subscription ← 06 and `boxes` ← 06.
- The recording closes, so `dispose` adds nothing for: `channel.on('formShown')`, `channel.on('formClosed')`,
  `events.on('sessions.activeChanged')`, `events.on('sessions.sessionRemoved')`, `layouts.show`,
  `areas.overlay.contribute(confirm.element)`, every `drops.addTarget`, the pushed `confirm` scope, the resize target
  and the `services.timers` handles ← 02; every `keys.anchor` and `keys.onChanged` handle round views and card kits
  drop, filed under forms by keys' consumer view (this task, keys item); every `addTab` and `setActivity` through
  sessions' consumer view ← 05.
- Log: 20 two-argument calls, all `'forms'`: `forms-commands.ts` 8, `forms-events.ts` 4, `layout/card-kit.ts` 3,
  `layout/layout-cards.ts` 1, `layout/layout-panes.ts` 1, `round-view.ts` 1, `start.ts` 1, `view-model.ts` 1.
  Each becomes `log(message)`. Each module whose deps declare `log: Log` takes `PluginLog`: `autosave.ts`,
  `forms-commands.ts`, `forms-events.ts`, `forms-view.ts`, `layout/layout-panes.ts`, `round-view.ts`,
  `view-model.ts`, each as the rule above says.
- `logSource` values task 06 moves: `forms-commands.ts:70`, `forms-view.ts:148`, `forms-view.ts:273`, `boxes.ts:56`,
  `layout/layout-cards.ts:96`, `layout/layout-panes.ts:134`, `layout/layout-panes.ts:156`, `autosave.ts:39`.

GIVEN forms main started over the sessions main part WHEN forms stops THEN the harness reports nothing live, and a
second start succeeds (the second `contributeTools` of `ask_round` no longer throws "Two tool contributions both name
the tool").
GIVEN the layout preview open WHEN forms main stops THEN the preview's session ends and its row leaves.
GIVEN the `openForms` read pending WHEN the page part stops and the read lands THEN no round shows and no forms page
event fires.
GIVEN a dependent added a card part or review column WHEN the dependent's registrations dispose THEN the part or
column is gone.

Tests:
- `stops with nothing live and starts again` in `src/plugins/forms/main/start.test.ts` (new `describe('forms main
  part')`): the harness starts `formsMainPart` with `parts: [sessionsMainPart]` (`runMode: 'selfTest'`, so no relay) and
  a fake `chat` export; after stop the harness reports 0 live registrations, listeners, observers and timers; the
  restart does not throw. The restart's second `contributeTools` of `ask_round` does not throw, which only the real
  sessions part can show.
- `stop before the fixture write lands registers no layout` in `src/plugins/forms/main/start.test.ts`: the harness
  starts `formsMainPart` with `parts: [sessionsMainPart]` in `runMode: 'selfTest'`; `stop()` runs before the fixture
  write settles; after the write settles the harness reports 0 live registrations, and no layout set was sent. This
  pins `return layouts.dispose()`.
- `dispose ends the connection the preview holds, once` in
  `src/plugins/forms/main/preview/layout-preview.test.ts`, `it.each` rows over a fake `sessions` whose `connect`
  returns `{ session, end: vi.fn() }`: `opened, disposed` → `end` called 1 time; `opened, disposed twice` → 1 time;
  `never opened, disposed` → 0 times.
- `stops with nothing live and starts again` in `src/plugins/forms/page/start.test.ts`: the harness starts
  `formsPagePart` with `parts: [sessionsPagePart, keysPagePart]`; after stop 0 live registrations, listeners, observers, timers
  and editors; the restart does not throw.
- `an open-rounds read that lands after stop shows nothing` in `src/plugins/forms/page/start.test.ts`: the harness
  holds `openForms` pending; stop; resolve it with one form; no `forms.roundShown` event fires and the harness
  reports 0 editors.
- `a dependent's contribution leaves when the dependent stops` in `src/plugins/forms/page/start.test.ts`, `it.each`
  rows `addCardPart` and `addReviewColumn`: a consumer view from `exports(createRegistrations())` adds id `probe`;
  disposing those registrations, then adding id `probe` through a second consumer view does not throw "is already
  added".
- Every existing test of a module that now takes `PluginLog` (in `forms/main` and `forms/page`) changes its fake log
  to one argument and drops the `'forms'` source from its expected lines.

## primer

Files: modify `src/plugins/primer/main/start.ts`, `src/plugins/primer/main/preview/primer-preview.ts`,
`src/plugins/primer/page/start.ts`, `src/plugins/primer/page/primer-commands.ts`,
`src/plugins/primer/page/primer-events.ts`, `src/plugins/primer/page/primer-view.ts` · test
`src/plugins/primer/main/start.test.ts`, `src/plugins/primer/main/preview/primer-preview.test.ts` · create
`src/plugins/primer/page/start.test.ts`

Main part (`primerMainPart`):
- Keys: `sessionsMainKey` and `chatMainKey` in place of the two `api.dependency<…>('…')` calls.
- `createPrimerPreview` returns `{ open(): void } & Disposable`, the same wrapper as forms' `createLayoutPreview`:
  `dispose` ends the kept `PreviewConnection` once.
- `dispose` now: `driveActions?.dispose(); layouts.dispose();`. After: the primer service's `dispose` ← 06, the
  preview service's `dispose` ← 06, `preview.dispose()`, `driveActions?.dispose()`. The `layouts` handle goes:
  `api.layouts.register` is recorded ← 04, and primer kept it only to dispose it.
- The recording closes, so `dispose` adds nothing for: the four `channel.handle` registrations,
  `events.on('sessions.ended')`, the `primer` open count ← 04; the contribution and the close guard ← 05.
- Log: 0 two-argument calls in `primer/main` (measured). `PrimerPreviewDeps.log` takes `PluginLog`.
- `logSource` values task 06 moves: `start.ts:88`, `preview/primer-preview.ts:39`; `createChatFormWake(chat,
  services.log, 'primer')` as forms.

Page part (`primerPagePart`):
- Keys: `sessionsPageKey` and `keysPageKey`.
- `PageStart.dispose` (new): sets the stopped flag `listenForPrimers`' `openForms` read checks, then disposes the
  `startAutosave` return ← 06 and `boxes` ← 06.
- The recording closes, so `dispose` adds nothing for: `channel.on` ×2, `events.on` ×2, `layouts.show` (its result
  is dropped today and stays dropped), `areas.overlay.contribute(confirm.element)`, every `drops.addTarget`, the
  pushed `confirm` scope, the resize and focus targets, the `services.timers` handles ← 02; anchors through keys'
  consumer view; tabs and activities through sessions' consumer view ← 05.
- Log: 28 two-argument calls: `primer-commands.ts` 23 and `primer-events.ts` 3 (all `SOURCE`), `primer-view.ts` 1,
  `start.ts` 1 (both `'primer'`). Each becomes `log(message)`. `const SOURCE = 'primer'` goes from
  `primer-commands.ts:73` and `primer-events.ts:12` once neither file reads it (06 moves the `logSource: SOURCE` at
  `primer-commands.ts:79`). Each module whose deps declare `log: Log` takes `PluginLog`: `primer-commands.ts`,
  `primer-events.ts`, `primer-view.ts`.
- `logSource` values task 06 moves: `boxes.ts:64`, `start.ts:197`, `primer-view.ts:328`, `:517`, `:1003`, `:1026`,
  `:1050`, `:1168`, `primer-commands.ts:79`.

GIVEN primer main started over the sessions main part WHEN primer stops THEN the harness reports nothing live, and a
second start succeeds.
GIVEN the primer preview open WHEN primer main stops THEN the preview's session ends.
GIVEN the `openForms` read pending WHEN the page part stops and the read lands THEN no primer shows.

Tests:
- `stops with nothing live and starts again` in `src/plugins/primer/main/start.test.ts` (new `describe('primer main
  part')`): as forms main, with `primerMainPart` and `parts: [sessionsMainPart]`.
- `dispose ends the connection the preview holds, once` in
  `src/plugins/primer/main/preview/primer-preview.test.ts`: the same three `it.each` rows as forms.
- `stops with nothing live and starts again` in `src/plugins/primer/page/start.test.ts`: as forms page, with
  `primerPagePart` and `parts: [sessionsPagePart, keysPagePart]`.
- `an open-primers read that lands after stop shows nothing` in `src/plugins/primer/page/start.test.ts`: as forms
  page; no `primer.primerShown` event fires and the harness reports 0 editors.
- Existing tests of `primer-commands.ts`, `primer-events.ts`, `primer-view.ts` and the preview change their fake log
  to one argument.

## sessions

Files: modify `src/plugins/sessions/main/start.ts`, `src/plugins/sessions/main/session-list.ts`,
`src/plugins/sessions/main/relay/relay-server.ts`, `src/plugins/sessions/page/start.ts`,
`src/plugins/sessions/page/rename-dialog.ts` · test
`src/plugins/sessions/main/start.test.ts`, `src/plugins/sessions/main/session-list.test.ts`,
`src/plugins/sessions/main/relay/relay-server.test.ts` · create `src/plugins/sessions/page/start.test.ts`

Main part (`sessionsMainPart`):
- Keys: none. The main part calls no `api.dependency` (measured); sessions' main `exports(consumer)` is task 05's.
- `SessionList.endAll(): void` (new): ends every entry the list holds, connected and owned, each as its own `end()`
  does (tool sessions end, the row leaves, `ended` emits once). A second `endAll` does nothing.
- `dispose` now: `layouts.dispose(); driveActions?.dispose(); opened?.relay.close();`, returning void. After:
  `driveActions?.dispose()`, then `list.endAll()`, then `return opened?.relay.close()`, so the host awaits the
  relay's close. The order is fixed: sessions end first, then the relay closes. The `layouts` handle goes (`api.layouts.register` is recorded ← 04).
- `dispose` leaves `endpoint.json` and `tools.json` in `endpointDir`.
- The recording closes, so `dispose` adds nothing for: `channel.handle` ×4 (`state`, `activate`, `closeSession`,
  `setUserTitle`), `events.on('sessions.ended')` and the drive adds ← 04.
- Log: 16 two-argument calls: `session-list.ts` 13 `'sessions'`, `relay/relay-server.ts` 3 `'relay'`
  (`refuse` at line 93, `acceptConnection`'s `socket.on('error')` at 128, `server.on('error')` at 159). Each becomes
  `log(message)`, so the three relay lines log under `sessions`. `SessionListDeps.log` and `RelayServerDeps.log`
  take `PluginLog` in place of `Log`. Self-test lines that change: none (measured above).

Page part (`sessionsPagePart`):
- Keys: `api.dependency<KeysPageExports>('keys')` becomes `api.dependency(keysPageKey)`.
- `PageStart.dispose` (new): sets the stopped flag the `api.channel.invoke('state')` read checks before `apply`.
- The recording closes, so `dispose` adds nothing for: the `api.onSettingsChanged` handle start drops (the comment
  "The page part lives for the page load, so the subscription is never disposed." at lines 371–372 goes, since it
  is no longer true), `modes.add`, `areas.overlay.contribute` ×2 (rename dialog, picker), `channel.on('activated')`,
  `channel.on('stateChanged')`, `layouts.show`, the pushed `rename` and `picker` scopes, `setOuterPanes` while it
  still holds `view.panes.outer`, the `services.timers` handles ← 02; the `keys.anchor` handles through keys'
  consumer view. uiState `panes` stays saved: it is the user's layout, not a registration.
- Log: 28 two-argument calls, all `'sessions'`: `start.ts` 26 (the `previewToggle` lambda
  `(message) => log('sessions', message)` becomes `log`), `rename-dialog.ts` 2. `RenameDialogDeps.log` takes `PluginLog`.
- `logSource` value task 06 moves: `start.ts:638` (`createListPicker`, `sessionsManifest.id`).

GIVEN sessions main started and a session connected WHEN sessions stops THEN that session ends and `endpoint.json`
stays.
GIVEN the `state` read pending WHEN the page part stops and the read lands THEN nothing applies.

Tests:
- `endAll ends every connected and owned session once` in `src/plugins/sessions/main/session-list.test.ts`: connect
  `host-1`, open `host-2`; `endAll()`; the `ended` emits carry both sessions' ids, 2 emits; `state().rows` is `[]`;
  a second `endAll()` adds 0 emits.
- `stops with nothing live and starts again` in `src/plugins/sessions/main/start.test.ts` (in `describe('sessions
  main part')`): the harness starts `sessionsMainPart` with `runMode: 'selfTest'`; after stop 0 live registrations,
  listeners, observers and timers; the restart does not throw.
- `stop ends a session connected before it` in the same `describe`: `connect({ sessionId: 'host-1', projectDir:
  null, deadlineSeconds: null, harness: 'claude' })` on the exports; stop; one `sessions.ended` event with that
  session's id.
- `stop_ConnectedThroughRelay_EndsOnce` in the same `describe`: `runMode` is not `selfTest`, so the relay opens; a
  session connects through the relay as `relay-server.test.ts` connects one; stop; the `sessions.ended` event for
  that session's id was emitted exactly once. This pins the order in `dispose`: `list.endAll()` ends the sessions, then
  the relay closes and finds nothing left to end.
- `relay-server.test.ts`: each assertion on a logged `['relay', …]` call becomes the message alone.
- `stops with nothing live and starts again` in `src/plugins/sessions/page/start.test.ts`: the harness starts
  `sessionsPagePart` with `parts: [keysPagePart]`.
- `a state read that lands after stop changes nothing` in `src/plugins/sessions/page/start.test.ts`: `state`
  pending; stop; resolve with `{ rows: [<one row, sessionId 's1'>], selectedSessionId: 's1' }`; no
  `sessions.activeChanged` event fires and uiState `panes` is not written.

## settings

Files: modify `src/plugins/settings/main/start.ts`, `src/plugins/settings/page/start.ts`,
`src/plugins/settings/page/settings-view.ts` · create `src/plugins/settings/main/start.test.ts`,
`src/plugins/settings/page/start.test.ts`

Main part (`settingsMainPart`):
- Keys: none.
- `dispose` now disposes `layouts` and `changed`. After: it disposes `changed` only. `changed` is the
  `services.userConfig.onChanged` handle, a service listener `api` does not record. The `layouts` handle goes ← 04.
- The recording closes: `channel.handle` ×4 (`schema`, `read`, `writeSettings`, `writeKeymap`) ← 04. The `show`
  command is unregistered by the host ← 01.
- Log: 0 two-argument calls in `settings/main` (measured).

Page part (`settingsPagePart`):
- Keys: `api.dependency(keysPageKey)`.
- No `dispose`: the recording closes `modes.add`, `layouts.show`, `channel.on('changed')`, `channel.on('show')`,
  every `addOverlay` contribution, the pushed prompt and `picker` scopes, the focus target and the editors through
  `services.editor` ← 02; the `keys.anchor` handles through keys' consumer view.
- Log: 3 two-argument calls, all `'settings'`: `start.ts` 2 (`shown`, `not loaded`), `settings-view.ts` 1. Each
  becomes `log(message)`; `SettingsViewDeps.log` takes `PluginLog`.
- `logSource` value task 06 moves: `settings-view.ts:358` (`createListPicker`).

Tests:
- `stops with nothing live and starts again` in `src/plugins/settings/main/start.test.ts` and in
  `src/plugins/settings/page/start.test.ts` (the page with `parts: [keysPagePart]`).
- Existing settings-view tests change their fake log to one argument.

## keys

Files: modify `src/plugins/keys/main/start.ts`, `src/plugins/keys/page/start.ts`,
`src/plugins/keys/page/unplaced-log.ts`, `src/plugins/keys/page/which-key-controller.ts` · create `src/plugins/keys/main/start.test.ts`,
`src/plugins/keys/page/start.test.ts`

Main part (`keysMainPart`): `dispose: () => layouts.dispose()` goes, and with it the `layouts` local: start returns
`{ commands: {} }` (`layouts.register` is recorded ← 04).

Page part (`keysPagePart`):
- Keys: none. Keys is the provider.
- `exports(consumer)`: `anchor: (element, command, options) => consumer.track(anchors.anchor(element, command,
  options))` and `onChanged: (listener) => consumer.track(keys.onKeymapChanged(() => listener()))`. `keysFor` stays.
  Forms' `round-view.ts:269` is the one `onChanged` caller outside keys (measured).
- `PageStart.dispose` (new): removes the `document` listener for `PLACEMENT_CHECK_EVENT`. Start keeps the listener
  in a const so `dispose` passes `document.removeEventListener` the same function.
- The recording closes, so `dispose` adds nothing for: `keys.onPending` (which-key), `keys.onScopeChanged` ×2,
  `keys.onKeymapChanged`, `onSettingsChanged`, `areas.titleBar.contribute`, the two overlay contributions of the
  which-key and help views, `layouts.show`, the pushed `help` scope and its `onBaseChanged` listener, and the
  which-key `delay` and `timeout` handles through `services.timers` ← 02.
- Log: 3 two-argument calls, all `'keys'`: `unplaced-log.ts` 1, `which-key-controller.ts` 2. Each becomes
  `log(message)`; `UnplacedLogDeps.log` and `WhichKeyDeps.log` take `PluginLog`.

GIVEN the keys page started WHEN it stops THEN its placement-check listener is gone.
GIVEN a dependent anchored an element or heard `onChanged` WHEN the dependent's registrations dispose THEN the
anchor is gone and the listener hears no further change.

Tests:
- `stops with nothing live and starts again` in `src/plugins/keys/main/start.test.ts` and in
  `src/plugins/keys/page/start.test.ts`.
- `stop removes the placement-check listener` in `src/plugins/keys/page/start.test.ts`: `vi.spyOn(document,
  'addEventListener')` and `removeEventListener`; start then stop; `removeEventListener` was called with
  `PLACEMENT_CHECK_EVENT` and the function `addEventListener` got for it.
- `a dependent's handle ends when the dependent stops` in `src/plugins/keys/page/start.test.ts`, `it.each` rows over
  a consumer view from `exports(createRegistrations())`: `anchor` on a `span` for `keys.toggleHelp` → after the
  registrations dispose the span lacks the class `ui-key-anchor`; `onChanged` with a `vi.fn()` → the
  `onChanged` row first calls `harness.pushKeymap(keymap)` and asserts the `vi.fn()` ran once; after the
  registrations dispose, a second `pushKeymap(keymap)` adds 0 calls (the count stays `1`).

## gallery

Files: modify `src/plugins/gallery/main/start.ts`, `src/plugins/gallery/page/start.ts`,
`src/plugins/gallery/page/gallery-view.ts` · create
`src/plugins/gallery/main/start.test.ts`, `src/plugins/gallery/page/start.test.ts`

Main part (`galleryMainPart`): as keys main, start returns `{ commands: {} }`.

Page part (`galleryPagePart`):
- Keys: `api.dependency(keysPageKey)`.
- `GalleryView.dispose(): void` (new): disposes every handle `keptHScrollers.disposables` holds (each sample's
  scroller and its `ResizeObserver` disconnect) and `kept.split`. Today they are disposed only by the next
  `hScrollerCells` or `splitSample` draw.
- `PageStart.dispose` (new): `view.dispose()`.
- The recording closes, so `dispose` adds nothing for: the `transparency.override` value while it still holds the
  one gallery set, the `shell.setLayout` handle, `modes.add`, `layouts.show`, the resize target and the
  `services.timers` handles ← 02; anchors through keys' consumer view. `swappedLayout` stays: `swapShellLayout`
  reads it to swap back.
- Log: 7 two-argument calls, all `'gallery'`: `start.ts` 6, `gallery-view.ts` 1. Each becomes `log(message)`;
  `GalleryViewDeps.log` takes `PluginLog`.

GIVEN the gallery page started with its HScroller samples drawn WHEN it stops THEN every sample's observer is
disconnected.

Tests:
- `stops with nothing live and starts again` in `src/plugins/gallery/main/start.test.ts` and in
  `src/plugins/gallery/page/start.test.ts`.
- `stop disconnects every HScroller sample observer` in `src/plugins/gallery/page/start.test.ts`:
  `vi.stubGlobal('ResizeObserver', <a fake recording observe and disconnect>)`; start, call
  `harness.showLayouts({ layouts: new Map([['default', defaultLayout]]), user: 'default' })` so the
  samples draw (`defaultLayout` is the import `../layouts/default/layout.js` that `start.ts` uses); stop; every fake that observed has `disconnect` called at least once.

## Seams for the lead

- The harness ← 07: its start, stop and restart members and its live-handle report. A test that needs the real
  sessions or keys provider passes it as `options.parts`. A test holds a channel `invoke` pending with
  `options.invoke` over a deferred promise (page) or a fake `sessions.connect` (main). `showLayouts` delivers a
  layout set and `pushKeymap` delivers a keymap change.
- The `Disposable` names ← 06: the agent form service's `dispose`, the editor boxes' `dispose`, and whether the
  reducer store gives `subscribe` a `Disposable` return or a store `dispose`.
- The per-plugin `services.timers` and `services.editor` views: this task assumes the page recording ← 02 clears the
  timers and destroys the editors a plugin made through them.

## Proof

Commit 1600d93c 81607cda 4198f2c9 7aa5b684 c7e992dc e2a11ba1 · proof: Diff read of every main and page start, session-list, sessions-view, preview and check-layers; whole-tree typecheck clean; whole-tree lint clean (1029 layer, 694 style files); workers ran 540 tests in keys, sessions, settings, gallery, and 847 in forms, primer and the real-provider tests; grep finds no two-argument log or string dependency in src/plugins · concerns: No test pins settings' closeBox disposing its scope, and closeFilter still pops. Late continuations in settings and sessions after stop run against detached elements. SessionsView.dispose covers the pane tree only, and frames' bars and parts stay undisposed, unexercised. Nothing pins the relay log lines. endAll iterates entries directly, so an entry an ended listener adds is also ended. No test goes red on removing boxes.dispose, autosave.dispose or the form service dispose calls in forms and primer. Probe parts and fakes are copied across test files. Seven plugin tests import another plugin's part through exact-file layer rules.
