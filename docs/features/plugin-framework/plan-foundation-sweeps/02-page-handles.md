# 02 — Page-side handles and recording

Status: in progress
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` (page members) · `src/contracts/bridge.ts` · `src/contracts/editor.ts` ·
           `src/preload/preload.ts` · `src/shared/event-bus.ts` · `src/renderer/plugins/page-api.ts` ·
           `src/renderer/key-scope.ts` · `src/renderer/pending-keys.ts` · `src/renderer/shell/modes.ts` ·
           `src/renderer/shell/shell-chrome.ts` · `src/renderer/renderer.ts` (only the `place` callback of
           `createModes`) · `src/renderer/pane-targets.ts` · `src/renderer/codemirror-vim/codemirror-vim-host.ts` ·
           `src/plugins/docs/page/docs-view.ts` (one call)
           create `src/shared/tracked-timers.ts`
           test `src/renderer/plugins/page-api.test.ts` · `src/shared/event-bus.test.ts` · `src/renderer/key-scope.test.ts` ·
           `src/renderer/pending-keys.test.ts` · `src/renderer/shell/modes.test.ts` · `src/renderer/shell/shell-chrome.test.ts` ·
           `src/renderer/pane-targets.test.ts` · create `src/shared/tracked-timers.test.ts`
           fakes that stop compiling: `src/plugins/settings/page/settings-view.test.ts` (line 81),
           `src/plugins/chat/page/sign-in-flow.test.ts` (line 31), and the `EditorHost` fakes in
           `src/plugins/primer/page/primer-view.test.ts`, `src/plugins/forms/page/round-view.test.ts`,
           `src/plugins/forms/page/forms-view.test.ts`, `src/shared/page/editor-boxes.test.ts` (measured at plan
           time, re-verify with `npm run typecheck`)
Consumes:  `Registrations` (`track<T extends Disposable>(handle: T): T`) in `src/contracts/disposable.ts` ← 01
           `createRegistrations(): Registrations & Disposable` in `src/shared/registrations.ts` ← 01
           the `registrations: Registrations` member of `PageApiDeps` (the part's store) ← 01
Produces:  in `src/contracts/plugin.ts`:
           `PageChannel.on(message, listener): Disposable`
           `PluginEvents.on(qualifiedEvent, listener): Disposable`
           `export interface PushedScope extends Disposable { pop(): void; onBaseChanged(listener: (base: ViewScope) => void): Disposable; }`
           `export interface ModeHandle extends Disposable { …the six members it has today… }`
           `Modes.onChanged(listener: (modeId: string) => void): Disposable`
           `PageApi.keys.onScopeChanged(listener): Disposable` · `PageApi.keys.onPending(listener): Disposable`
           in `src/contracts/bridge.ts`: `Bridge.onMessage(pluginId, message, listener): Disposable`
           in `src/contracts/editor.ts`: `EditorHost.onPendingKeys(listener: (keys: string[]) => void): Disposable`
           in `src/shared/event-bus.ts`: `EventBus.on(qualifiedEvent, listener): Disposable`
           in `src/renderer/key-scope.ts`: `ScopeStack.onChange(listener): Disposable`
           in `src/renderer/pending-keys.ts`: `PendingKeysHub.onPending(listener): Disposable`
           in `src/renderer/shell/modes.ts`: `ModesDeps.place(mode: Mode, handle: ModeHandle): Disposable`
           in `src/renderer/shell/shell-chrome.ts`: `ShellChrome.addMode(mode: Mode, handle: ModeHandle): Disposable`
           in `src/renderer/pane-targets.ts`: `PaneTargets.release(target: ResizeTarget | FocusTarget | OuterPanes): void`,
             and `PageApiDeps.paneTargets` picks `'release'` as well
           in `src/shared/tracked-timers.ts`: `export function trackedTimers(timers: Timers, registrations: Registrations): Timers`
Decisions: every handle is a plain `Disposable`; `PageChannel.on`'s `{ remove() }` becomes `dispose()` (plan.md Decisions, agent) ·
           `ModeHandle` extends `Disposable`; disposing the shown mode shows the first remaining mode (plan.md Decisions, agent) ·
           a single-slot target (pane targets, the transparency override) is cleared at stop only while it still holds the
           value this plugin set (plan.md Decisions, agent) · the event bus, layout show, drop targets and areas keep their
           present behaviour; only their returns change (plan.md Decisions, design review) ·
           drafter's calls, where no round decides: disposing a mode does not call its `hidden`; a listener disposed during
           an emit does not run later in that emit, as `PageChannel.on` already behaves; the transparency check compares
           values, as the decision words it ("the value this plugin set"), so a second plugin that set the same value is
           not told apart · the page transparency module (`src/renderer/transparency-override.ts`) does not change: the
           page API's view reads `overridden()`
GIVEN a plugin's page part WHEN its registrations are disposed THEN everything it registered through its `api` is undone:
      channel listeners, event listeners, scope and pending listeners, keymap and settings listeners, pushed scopes,
      modes and mode listeners, area contributions, drop targets, layout shows, `shell.setLayout`, fences, editor
      pending-key listeners, pending timers and live editors
GIVEN a message's last channel registration WHEN it is disposed THEN the channel disposes its bridge listener for that
      message and forgets it; a later `on` for the message takes a new bridge listener
GIVEN the shown mode WHEN its handle is disposed THEN its element, side bar and activity item leave the window, the
      first remaining mode in add order shows as `show` would show it, and `onChanged` listeners hear its id; with no
      mode left, `shown()` throws `No mode is added yet` and the id can be added again
GIVEN a hidden mode WHEN its handle is disposed THEN it leaves the window and the shown mode stays
GIVEN a disposed mode handle WHEN any member runs THEN it does nothing; `isShown` and `sideBarShown` return false
GIVEN a pane slot or the transparency override this plugin set WHEN the registrations are disposed THEN it is cleared
      only while it still holds that value
GIVEN a pushed scope the plugin made through its `api` WHEN the plugin calls `pop` THEN the tracked `dispose` path
      runs, so the store forgets the scope at once; `pop` and `dispose` share one path
GIVEN a pushed scope WHEN it is disposed THEN it pops if not popped; a second dispose, or a dispose after `pop`, does
      nothing; `pop` still throws `Scope <scope> was already popped` on a second call
Tests:     `page-api.test.ts` — `deps()` gains `registrations: createRegistrations()` unless 01 added it, `pendingKeys.onPending`,
           `fakeBridge().onMessage` and every fake now typed to return a handle return `{ dispose: () => {} }`
           (`fakeBridge`'s returns a dispose that removes its entry from `listeners`), and `paneTargets` gains `release`:
           - every `.remove()` becomes `.dispose()`; `stops a listener once its registration is removed, leaving the
             others` is renamed `stops a listener once its registration is disposed, leaving the others`; the other
             channel tests keep their names and assertions
           - `it.each` `disposes what $member returned when the plugin's registrations are disposed` — rows
             `areas.titleBar.contribute`, `areas.panel.contribute`, `areas.statusBar.contribute`,
             `areas.rightBar.contribute`, `areas.overlay.contribute`, `shell.setLayout`, `drops.addTarget`,
             `layouts.show`, `modes.add`, `modes.onChanged`, `keys.onPending`, `services.markdown.addFence`,
             `services.editor.onPendingKeys`; each row's fake dep returns `{ dispose: () => disposed.push(member) }`;
             `disposed` is `[]` after the call and `[member]` after `registrations.dispose()`
           - `it.each` `stops $member hearing once the plugin's registrations are disposed` — rows `channel.on` (then
             `send('p', 'shown', 'a')`), `events.on('q.done')` (then `bus.emit('q.done', 1)`), `keys.onScopeChanged`
             (then `scopeStack.setBase('q.view')`), `keys.onKeymapChanged` (then `config.replace` with
             `keymap('p.up')`), `onSettingsChanged` (then `config.replace` with `pluginSettings.p` `{ delayMs: 2 }`);
             heard is `[]`
           - `pops the scopes the plugin pushed when its registrations are disposed` — `keys.pushScope('review')`, then
             `registrations.dispose()`; `scopeStack.current()` is `'any'`
           - `forgets a pushed scope the plugin popped` — `keys.pushScope('review')`, then `pop()` on the returned
             handle, then `registrations.dispose()`; `scopeStack.current()` is `'any'` and the fake scope stack's `pop`
             ran once (the store does not pop a second time)
           - `clears the plugin's pending timer when its registrations are disposed` — fake `services.timers`; one `set`,
             then dispose; the fake's cleared handles are `[1]`
           - `destroys the editors the plugin created and has not destroyed when its registrations are disposed` —
             fake `services.editor` counting each editor's `destroy`; two `create` and one `createDocument`, the plugin
             destroys the first box; after dispose each editor's count is `1`, and an editor created after the
             dispose has count `1` at once
           - `releases each pane target the plugin set when its registrations are disposed` — set resize `R`, focus
             `F`, outer `O`, then focus `null`; `released` is `[R, O]`
           - `it.each` `clears the transparency override at dispose only while it holds the plugin's value ($case)` —
             a shared fake `{ value, override(v) { value = v; calls.push(v) }, overridden: () => value }` and two APIs
             (`p`, `q`) over it; rows: `still holds` (p sets `'full'`) → calls added by dispose `[null]`;
             `another plugin replaced it` (p `'full'`, q `'reduced'`) → `[]`; `the plugin handed it back` (p `'full'`,
             then `null`) → `[]`
           - `drops the bridge listener of a message once its last registration is disposed, and takes a new one when
             listened again` — `a = on('shown')`, `b = on('shown')`, `a.dispose()`, `b.dispose()`, `on('shown')`;
             `listeners.length` after each of the last three steps is `1`, `0`, `1`
           `event-bus.test.ts` — `it.each` `stops delivering to a registration once it is disposed ($case)`: rows
           `before the emit` (listeners a, b; dispose a; emit) → heard `['b']`; `by an earlier listener during the
           emit` (the first disposes the second's registration) → `['first']`; `one of two registrations of one
           listener` (register `l` twice, dispose the first) → `['l']`
           `key-scope.test.ts` — `it.each` `dispose pops a pushed scope once ($case)`: rows `not popped` and `already
           popped`; push `'a.x'` over `'any'`, then optionally `pop()`, then `dispose()` twice; no throw,
           `current()` is `'any'`, and an `onChange` listener heard `['a.x', 'any']`
           · `stops telling an onChange listener once disposed` — heard `[]` after `setBase('b')`
           · `stops telling an onBaseChanged listener once disposed, leaving the others` — heard `['other b']`
           `pending-keys.test.ts` — `stops telling an onPending listener once disposed` — heard `[]` after
           `reportPage(['g'], 'any')`; the test's editor fake returns `{ dispose: () => {} }`
           `modes.test.ts` — `setup`'s `place` pushes `place <id>` and returns `{ dispose: () => calls.push('unplace <id>') }`:
           - `disposing the shown mode unplaces it, shows the first remaining mode and tells listeners` — add a, b, c,
             clear calls, dispose a; calls `['unplace a', 'marked b', 'side bar hidden', 'context null', 'shown b',
             'changed b']`; `modes.shown()` is `'b'`; `b.element.hidden` is false
           - `disposing a hidden mode unplaces it and keeps the shown mode` — add a, b; dispose b; calls
             `['unplace b']`; `modes.shown()` is `'a'`
           - `disposing the only mode leaves none shown, and its id adds again` — `modes.shown()` throws
             `No mode is added yet`; a second `add` of id a does not throw and calls hold `shown a`
           - `a disposed mode handle does nothing` — after dispose, `dispose`, `show`, `setContext`, `picked` add no
             call; `isShown()` and `sideBarShown()` are false
           - `stops telling an onChanged listener once disposed`
           `shell-chrome.test.ts` — `addMode_Dispose_RemovesTheActivityItem` — two modes, dispose the first's return;
           `parts(activityBar).length` is 1 and clicking `parts(activityBar)[0]` calls `docs.show` once; `handle()`
           gains `dispose: () => undefined`
           `pane-targets.test.ts` — `it.each` `release clears only the slots holding the target ($case)`: rows `the
           resize target` (`resize('left')` reaches no released target's `nudge`), `the outer panes` (`focus('left')`
           reaches no released outer `move`), `another object` (the set target's `nudge` is still called)
           `tracked-timers.test.ts` — `clears only the timers still pending when its registrations are disposed` —
           fake timers numbering handles 1, 2, 3; handle 1 runs, the view clears 2; after dispose the fake's cleared
           list is `[2, 3]` · `runs nothing set after its registrations are disposed` — the run never happens after
           the fake fires every timer
Approach:  `createPageApi` hands out views that file each handle with `deps.registrations.track(...)`: `channel.on`,
           `events.on`, `keys.onScopeChanged`, `keys.onPending`, `keys.onKeymapChanged`, `onSettingsChanged`,
           `keys.pushScope` (the handle the view returns has a `pop` that runs the tracked `dispose` path, so a scope
           popped by its owner leaves the store; `ScopeStack.push`'s own `pop` stays as it is), `modes.add`, `modes.onChanged`, each area's `contribute`, `drops.addTarget` (`savePasted`
           forwards), `layouts.show`, `shell.setLayout`, `services.markdown.addFence`, `services.editor.onPendingKeys`.
           Editors, timers, pane targets and the transparency override are held per plugin and filed as one
           `Disposable` each when `createPageApi` runs, since a store entry per editor would keep every destroyed
           editor's view alive: `services.editor` keeps a set of live editors (a wrapped `destroy` leaves the set),
           `services.timers` is `trackedTimers(deps.services.timers, deps.registrations)`, the panes setters keep the
           last value per slot and the dispose calls `deps.paneTargets.release` for each non-null one in the order
           resize, focus, outer; `transparency.override` keeps the last value this plugin passed and the dispose calls
           `deps.transparency.override(null)` only when that value is not null and `deps.transparency.overridden()`
           equals it. `PaneTargets.release` sets to null every slot that holds `target`, by identity.
           `services.visualFrames`, `services.markup` and `uiState` are forwarded as they are, with no per-plugin view.
           Open frames and markup sessions belong to each plugin, which closes them in its own `dispose`: visual and
           chat in task 08, notes in task 09.
           `pageChannel`: the delivery loop is unchanged; removing a message's last registration disposes the bridge
           listener `Bridge.onMessage` returned and deletes the message's entry. The preload keeps the listener it
           hands `ipcRenderer.on` and the returned `dispose` calls `ipcRenderer.removeListener` with it.
           `createModes.add`: `place` returns the `Disposable` the registry keeps for the mode; renderer's `place`
           returns one `Disposable` over the `areas.main` contribution, the `areas.sideBar` contribution (when the
           mode has a side bar) and `chrome.addMode`'s return. `ShellChrome.addMode` keeps the `Disposable` its
           activity-bar slot's `contribute` returned; its dispose clears the slot, disposes that contribution and
           deletes the item. `ModeHandle.dispose` deletes the mode from `added`, disposes the placement, and when the
           mode was shown sets no mode shown, then reveals the first entry left in `added`, then tells the
           `onChanged` listeners. `ScopeStack.push`'s `dispose` pops through the same path as `pop` when the entry is
           still pushed; `onBaseChanged`'s handle removes its listener from the entry. `EventBus.on`'s handle removes
           its own registration, so two registrations of one listener stay apart; `pluginEvents.on` returns the bus's
           handle. `PendingKeys.listen` in the editor host returns a handle removing its listener.
           Contract comments that say "until the returned handle's `remove`" (`PageChannel`) and `PushedScope`'s
           comment change to name `dispose`. `docs-view.ts` line 1039 `listening.remove()` becomes
           `listening.dispose()`. The four `EditorHost` test fakes return `{ dispose: () => {} }` from
           `onPendingKeys`; the two channel fakes return `{ dispose: … }` in place of `{ remove: … }`.
           The editor host's `PendingKeys.listen` has no unit seam: `codemirror-vim-host.test.ts` covers only
           `insertionOf`, so the `services.editor.onPendingKeys` row above is its test.
Done when: compiles (`npm run typecheck`); the test gate runs the tests above; `npm run lint` passes
Commit:    one commit for the group

## Proof

