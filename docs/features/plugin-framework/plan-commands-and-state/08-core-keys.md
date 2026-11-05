# 08 — keysFor, anchor and box focus in the core keys API

Status: not started
Type: Task
Wave: 7 · Depends on: 07
Plan: [plan.md](plan.md)

All paths are under `src/` unless a line says otherwise.

## Files

**Moves** (each with `git mv`, its test beside it)

- `plugins/keys/page/anchors.ts` → `renderer/key-anchors.ts`, and `anchors.test.ts` → `renderer/key-anchors.test.ts`
- `plugins/keys/page/keys-for.ts` → `shared/keys-for.ts`, and `keys-for.test.ts` → `shared/keys-for.test.ts`
- `plugins/keys/page/vim-keys.ts` → `shared/vim-keys.ts`, and `vim-keys.test.ts` → `shared/vim-keys.test.ts`

**Create**

- `renderer/box-focus.ts` · test `renderer/box-focus.test.ts`
- `renderer/anchor-wiring.ts` · test `renderer/anchor-wiring.test.ts`

**Modify, core**

- `contracts/keymap.ts`, `contracts/plugin.ts`
- `renderer/renderer.ts`
- `renderer/page-keys.ts` · test `renderer/page-keys.test.ts`
- `renderer/pending-keys.ts` · test `renderer/pending-keys.test.ts`
- `renderer/editor-binds.ts` · test `renderer/editor-binds.test.ts`
- `renderer/plugins/page-api.ts` · test `renderer/plugins/page-api.test.ts`
- `renderer/shell/shell.ts` · test `renderer/shell/shell.test.ts`
- `renderer/shell/shell-chrome.ts` · test `renderer/shell/shell-chrome.test.ts`
- `shared/plugin-part-harness.test-support.ts`
- `shared/page/ui/key-anchors.ts` (its comment that names the keys plugin)
- `scripts/check-layers.mts` (repo root)

**Modify, keys plugin**

- `plugins/keys/page/start.ts` · test `plugins/keys/page/start.test.ts`
- `plugins/keys/page/unplaced.ts`, `plugins/keys/page/unplaced-log.ts`
- delete `plugins/keys/contract.ts`
- `plugins/page.ts`

**Sweep** — every file in the sweep table below.

## Consumes

- `keysFor(command, scope?, where?, arg?)`, `AnchorOptions.arg`, `commandTarget`, `Anchors.placedIn` returning target strings ← 07
- `coreScopeSlot` and the keys plugin's scope listener as task 06 left it ← 06
- `api.keys.keymap`, `api.keys.onKeymapChanged`, `EditorHost.contains`, `createScopeStack`, `createLiveConfig`: already in the tree

## Produces

`contracts/keymap.ts` takes these from `plugins/keys/contract.ts`, unchanged:

```ts
export type HintWhere = 'page' | 'box';
export interface AnchorOptions { scope?: ViewScope; where?: HintWhere; label?: boolean | string; arg?: CommandArg; }
```

`contracts/plugin.ts`:

```ts
// What a view needs to show keys. PageApi['keys'] extends it.
export interface KeyHints {
  keysFor(command: CommandId, scope?: ViewScope, where?: HintWhere, arg?: CommandArg): string | null;
  anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable;
  onKeymapChanged(listener: (keymap: Keymap) => void): Disposable;
}
```

`PageApi['keys']` gains, beside `KeyHints`:

```ts
where(): HintWhere;
onWhereChanged(listener: (where: HintWhere) => void): Disposable;
// Hides or shows every anchored hint. The latest handle's dispose shows them again. An older handle's dispose does nothing.
setHintsShown(shown: boolean): Disposable;
// The placement check's source: command targets anchored in `scope` or with no scope during this page load.
placedIn(scope: ViewScope): ReadonlySet<string>;
```

`renderer/box-focus.ts`:

```ts
export interface BoxFocus {
  where(): HintWhere;
  onChanged(listener: (where: HintWhere) => void): Disposable;
}
export function createBoxFocus(document: Document, editors: Pick<EditorHost, 'contains'>): BoxFocus;
```

`renderer/key-anchors.ts`: `createAnchors(deps: AnchorDeps): Anchors`, as moved. `AnchorDeps` loses `showHints()`. `Anchors` gains `setShown(shown: boolean): void` and `reveal(): void`.

`renderer/anchor-wiring.ts`:

```ts
export function wireAnchors(deps: {
  live: Pick<LiveConfig, 'onChanged'>;
  scopeStack: { onChange(listener: () => void): Disposable };
  anchors: Pick<Anchors, 'redraw' | 'applyVisibility'>;
}): void;
```

`renderer/editor-binds.ts`:

```ts
// Runs the bind in force and returns true. A miss logs for a normal-mode bind and returns false.
export function runEditorBind(
  binds: EditorBind[],
  fired: TextEditor,
  deps: { scope(): ViewScope; run(bind: EditorBind, fired: TextEditor): void; log: Log },
): boolean;
```

`renderer/page-keys.ts`: `installPageKeys` loses its `binds` and `report` parameters. It starts with no binds, and `setBinds` installs them. It takes `boxFocus: BoxFocus` in place of its own read of `document.activeElement`. Its result gains `onPendingKeys(listener: (keys: string[], scope: ViewScope) => void): Disposable`.

`renderer/pending-keys.ts`: `PendingSources.page` gains that `onPendingKeys`. `PendingKeysHub` loses `reportPage`.

`renderer/shell/shell.ts`: `mountShell` takes `keys: KeyHints` as a parameter, and `setKeys` goes. `renderer/shell/shell-chrome.ts`: `mountShellChrome`'s `services` take `keys`, and `setKeys` and `NO_KEYS` go.

## Decisions

### Where the code goes

1. `keys-for.ts` and `vim-keys.ts` go to `src/shared`, since both the core and the keys plugin's `unplaced.ts` read them, and a plugin imports no core renderer file. `anchors.ts` goes to `src/renderer`: only the core makes it, and the keys plugin reaches it through the API.
2. `plugins/keys/contract.ts` holds nothing after the move. Delete it. Six plugins have no contract at plan time (measured at plan time, re-verify).
3. Which-key, help and the placement check stay in the keys plugin, as plan.md decides. `PLACEMENT_CHECK_EVENT` and `shared/placement-check.ts` do not change.

### showHints

4. The keys plugin keeps the `showHints` setting. The core does not read it, because a core read of `pluginSettings.keys` is the same reach by id that this task removes.
5. The core holds a boolean, default true. The keys plugin calls `keys.setHintsShown(api.settings().showHints)` as it starts, and again in its `onSettingsChanged` listener. It keeps one handle: it disposes the old handle after each new call. Decision 6 makes that order safe.
6. `setHintsShown` calls `Anchors.setShown`, which runs `applyVisibility`. The handle is filed in the part's registrations. The latest handle wins:
   - The core remembers the handle of the last call.
   - The dispose of that handle sets the value to true.
   - The dispose of an older handle does nothing. So "new call, then dispose old" keeps the new value.
7. With the keys plugin disabled or stopped, hints show. This is the item's goal: the chrome's hints do not vanish with `keys`.
7a. No hint shows until the parts have started, so `showHints` off gives no flash at page load.
    - `createAnchors` holds every anchor hidden until `reveal()`. The hidden test becomes: not revealed, or not shown, or out of scope.
    - Before `reveal`, an anchor still draws its keys and still records its placement.
    - `renderer.ts` calls `anchors.reveal()` right after `startPlugins` returns, at the place of today's `setKeys` block. The chrome's hints therefore appear at the same moment as today.

### Core wiring in renderer.ts

8. Create `scopeStack` and `createAnchors` before `mountShell`, right after `live`. Move line 179 up. `createAnchors` reads:
   - `keysFor`: `promptKeysFor(live.current().keymap, command, scope, live.current().platform.os, where, arg)`, read at each call. Anchors use `promptKeysFor`, as they do today, because a prompt skips vim's own keys.
   - `label`: `live.current().commands[id]?.label ?? id`
   - `scope`: `scopeStack.current()`
   - `platform`: `live.current().platform.os`, the OS string task 01 gives every key-hint function
9. Redraw and visibility wiring moves from `plugins/keys/page/start.ts` to `wireAnchors` in `renderer/anchor-wiring.ts`, and `renderer.ts` calls it once, right after `createAnchors`. On `live.onChanged`, when the keymap differs as JSON from the previous one, it calls `anchors.redraw()`. On `scopeStack.onChange`, it calls `anchors.applyVisibility()`.
10. Pass `{ anchor, keysFor, onKeymapChanged }` to `mountShell` and `mountShellChrome` at their creation. Delete `KEYS_PLUGIN_ID`, `shellRegistrations`, `keysExports` and the two `setKeys` calls (`renderer.ts:68-69, 309-317`).
11. `renderer/shell/shell.ts`: delete `createForwardingAnchor`. The side bar handle's prompt anchors through `keys.anchor` directly. `NO_ANCHOR` stays for the divider no key moves.
12. `renderer/shell/shell-chrome.ts`: `keys` is fixed at mount. Its first draw writes the hints, and they show at `reveal` (decision 7a). Delete the redraw that `setKeys` ran.
13. `base-kit.ts` does not change here. `BaseKitDeps['keys']` already fits `KeyHints`. Task 10 makes `recordAnchor` required.

### Pending keys and the miss policy

14. Create the page key engine before the hub, with no binds, and remove `let pageKeys … = null` (`renderer.ts:242`). `createPendingKeys` takes the engine directly as `page`. The two depended on each other through `report`. Break the cycle as the editor source does: the hub subscribes to `page.onPendingKeys`, and `reportPage` goes.
15. The check at `renderer.ts:318`, then `installed.setBinds(keymap.page, settings.keySequenceTimeoutMs)`, replaces the install. Setting the binds rejects a key bound twice in one scope, and the page start fails as it does today.
16. Key listeners are live during `startPlugins`, with no binds. A key pressed then matches nothing and reaches nothing, as today.
17. `runEditorBind` holds `editorBindInForce` and the check `editorBindMode(binds[0]) === 'normal'`. The vim host callback in `renderer.ts:208-224` becomes one call. The comment at lines 204-205 moves with it.

### Box focus

18. `createBoxFocus` listens on `focusin` and `focusout` on `document`.
    - On `focusin`, the next value is `box` when `editors.contains(event.target)`.
    - On `focusout`, the next value is `box` when `event.relatedTarget` is in an editor, so moving from box to box tells nothing.
    - `focusout` with a null `relatedTarget` while `document.hasFocus()` is false is a window blur, and no focus move. It is ignored. In a focused window, a null `relatedTarget` gives `page`.
    - The cached value is the last value told. At each event, the listener computes the next value, compares it with the cached value, updates the cache, and tells listeners only when the two differ.
    - The next value comes from the event and not from `document.activeElement`, because the active element is not final during `focusout`.
    - A silent move (decision 19) tells nothing, since no event fires. A later `focusout` to the page also tells nothing, since listeners still hold `page`. The next `focusin` on the box tells `box`.
19. `where()` reads `document.activeElement` live and does not return the cached value. A `focus()` call in an unfocused window moves the active element and fires no event, and `feedKeys` must see the move after a command runs. `editorHasFocus` in `page-keys.ts` becomes `boxFocus.where() === 'box'`.
20. `page-keys.ts` keeps its own `focusin` listener that drops pending keys. It keeps that listener because the drop must fire on every entry to an editor, also from box to box.
21. `api.keys.where` and `api.keys.onWhereChanged` are new. Neither exists in the tree, and `KeysPageExports` holds neither. `docs/features/followups.md:100` asks for `onWhereChanged`, and no plugin in this plan consumes either. `where()` is an addition to the plan's API, because a late reader needs the current value. They are not slots: the plan pins `onWhereChanged`. `keys/page/start.ts:181` `focusedBeforeHelp` is a focus restore and does not change.

### Keys plugin

22. `plugins/keys/page/start.ts`:
    - Delete `createAnchors` and `exports`.
    - `kit.keys` becomes `api.keys`.
    - `closeHint` anchors with `keys.anchor`.
    - `startUnplacedLog` reads `placedIn: keys.placedIn`.
    - `keys.onKeymapChanged` keeps only `help.setSections`.
    - Delete the two `applyVisibility` lines: the scope line as task 06 left it, and the `onSettingsChanged` line.
23. Update the header comment to say the core holds the anchors.

### Start order

24. `plugins/page.ts`: move `keysPagePart` to the head of `pageParts`. Sixteen plugins drop `keys` from `dependsOn.page`, so `dependencyOrder` would start it fifth, after sessions, chat, forms and primer. Today it starts first, and its Keys button contributes to the title bar's end in that order. At the head of the list, the start order is the same as today.
25. Each of the sixteen manifests drops `'keys'` from `dependsOn.page` (measured at plan time, re-verify): agent-lines, agent-skills, agent-strip, backlog, chat, docs, forms, gallery, notes, primer, sessions, settings, unity-pool, usage, visual, workflow.
26. `disabledDependencyProblem` then lets the user disable `keys`. This is the item's goal.

### The sweep

27. Thirty-one non-test plugin files name `keysPageKey` or `KeysPageExports`, and fifteen test files do (measured at plan time, re-verify with `grep -rlE 'keysPageKey|KeysPageExports' src/plugins --include='*.ts' | grep -v plugins/keys/`). Twenty-five non-test files call `.anchor(` (measured at plan time, re-verify). They receive anchors through a `keys` deps field and keep calling it. The sweep has one rule per row:

| Kind | Files | Change |
|---|---|---|
| `start.ts` that reads the dependency | `plugins/{agent-lines,agent-skills,agent-strip,backlog,chat,docs,forms,gallery,notes,primer,sessions,settings,unity-pool,usage,visual,workflow}/page/start.ts` | Delete the `keysPageKey` import and `api.dependency(keysPageKey)`. Pass `api.keys` where the local was passed. `keys: { anchor: keys.anchor, keysFor: keys.keysFor }` becomes `keys: api.keys`. |
| View that types its deps | `plugins/settings/page/settings-view.ts`, `plugins/primer/page/primer-view.ts`, `plugins/primer/page/primer-review.ts`, `plugins/forms/page/layout/card-kit.ts`, `plugins/forms/page/forms-view.ts`, `plugins/forms/page/layout/layout-panes.ts`, `plugins/forms/page/kinds/item-format.ts`, `plugins/forms/page/round-view.ts`, `plugins/forms/page/layout/layout-cards.ts`, `plugins/chat/page/chat-layouts.ts`, `plugins/chat/page/dialog-kits.ts`, `plugins/backlog/page/backlog-view.ts`, `plugins/sessions/page/sessions-view.ts`, `plugins/sessions/page/session-tabs-view.ts`, `plugins/notes/page/popup.ts` | `KeysPageExports` becomes `KeyHints` from `contracts/plugin.ts`, or a `Pick` of it where the file already narrows. `AnchorOptions` imports from `contracts/keymap.ts`. |
| The one `onChanged` | `plugins/forms/page/round-view.ts:269` | `deps.keys.onKeymapChanged(() => parts.redrawLayoutHead())`. |
| Test that fakes the dependency | The fifteen test files | Drop `fakeDependency(keysPageKey, …)` and its entry in `dependencies`. Use the harness's fake `api.keys`. |
| Test that starts the real keys page | Any forms or primer `start.test.ts` that lists `keysPagePart` | Drop the real part. |

28. `scripts/check-layers.mts:67,100` list `src/plugins/keys/page` for forms' and primer's `page/start.test.ts`. Delete those two lines. `scripts/layer-rules.test.mts` holds fixtures and stays.
29. Comments that name the keys plugin's exports move with the code: `shared/page/ui/key-anchors.ts:1,8`, `plugins/keys/manifest.ts`, and the `PageApi` doc comment.

### Page API and harness

30. `page-api.ts`: `anchor` is `registrations.track(deps.anchors.anchor(...))`. `keysFor` calls the shared `keysFor` (not `promptKeysFor`): `keysFor(config.current().keymap, command, scope, config.current().platform.os, where, arg)`, read at each call. This is the function `KeysPageExports.keysFor` calls today. `onWhereChanged` and `setHintsShown` are tracked too.
31. `PageApiDeps` gains `anchors: Anchors` and `boxFocus: BoxFocus`.
32. Harness: the fake `keys` gains:
    - `keysFor`, the shared `keysFor` over `world.keymap`;
    - `anchor`, which records `{ element, command, options }` in `world.anchors` and returns a tracked handle;
    - `where`, which reads `world.where`, and `onWhereChanged`;
    - `setHintsShown`, which sets `world.hintsShown`, with decision 6's latest-handle rule;
    - `placedIn`, which reads `world.anchors`.

### Followup wording

33. The followup says `keysFor` returns unformatted hints. Plan.md pins the existing signature, so it still returns the formatted string or null. Task 15 fixes the followup's wording when it reads that entry.

## Behaviour

GIVEN the keys plugin disabled WHEN the page parts have started THEN the shell chrome's hints show.

GIVEN `showHints` off WHEN the page loads THEN no anchor shows at any moment, the chrome's included.

GIVEN `showHints` turns off WHEN the keys plugin disposes its old handle THEN hints stay hidden.

GIVEN `showHints` off and the keys plugin stopped WHEN the handle is disposed THEN hints show.

GIVEN a rebind WHEN the keymap changes THEN every anchor draws its new keys, with no keys plugin involved.

GIVEN focus moves from the page into a box THEN `onWhereChanged` hears `box` once.

GIVEN focus moves from one box to another THEN `onWhereChanged` hears nothing.

GIVEN focus is in a box WHEN the window loses focus THEN `onWhereChanged` hears nothing.

GIVEN a command that focuses a box in an unfocused window WHEN keys remain to replay THEN they are typed into the box, since `where()` reads the active element live.

GIVEN the placement check event WHEN the keys plugin handles it THEN it logs from `keys.placedIn` and every line reads as it does after task 07.

GIVEN the app starts WHEN page parts start THEN they start in the same order as before this task.

## Tests

- `renderer/box-focus.test.ts`:
  - `onChanged_PageToBoxAndBack_TellsOncePerChange`.
  - `onChanged_BoxToBox_TellsNothing`. Catches a flicker through `page` on each box move.
  - `where_FocusMovedWithNoEvent_ReadsTheActiveElement`. Catches a cached value breaking key replay.
  - `onChanged_SilentMoveThenFocusoutThenFocusin_TellsBoxOnce`. Catches a change compared with a stale value, which tells listeners a change they cannot place.
  - `onChanged_WindowBlur_TellsNothing`. Catches a window blur read as a move to the page.
- `renderer/anchor-wiring.test.ts`:
  - `keymapChanged_JsonDiffers_Redraws`, with an equal keymap as a second case. Catches anchors that keep their old keys after a rebind, and a redraw on each push.
  - `scopeChanged_AppliesVisibility`. Catches a dropped subscription, which the compiler cannot see.
- Rows added to `renderer/key-anchors.test.ts`:
  - `setShown_False_HidesEveryAnchor`.
  - `setShown_True_ShowsAnchorsInScopeOnly`. Catches a true value that overrides the scope rule.
  - `anchor_BeforeReveal_DrawsKeysAndStaysHidden`. Catches the flash when `showHints` is off.
  - `reveal_ShownFalse_StaysHidden`. Catches `reveal` overriding the setting.
- Rows added to `renderer/editor-binds.test.ts`:
  - `runEditorBind_BindInForce_RunsAndReturnsTrue`.
  - `runEditorBind_NormalModeMiss_LogsAndReturnsFalse`.
  - `runEditorBind_InsertModeMiss_ReturnsFalseAndLogsNothing`. Catches Enter logging a miss on each new line.
- Row added to `renderer/page-keys.test.ts`: `setBinds_FirstCall_KeysStartFiring`. Catches an engine that needs binds at creation.
- Rows in `renderer/pending-keys.test.ts` that call `reportPage` fire the fake page source's `onPendingKeys` instead. The cases stay.
- Rows added to `renderer/plugins/page-api.test.ts`:
  - `setHintsShown_PartStops_ShowsHintsAgain`.
  - `setHintsShown_OldHandleDisposedAfterNewCall_KeepsTheNewValue`. Catches a `showHints` change to off that ends with hints shown.
- Row added to `plugins/keys/page/start.test.ts`: `start_ShowHintsOff_CallsSetHintsShownFalse`, with the settings-change case in one table. Delete rows that read `exports`. Delete `start_ScopeSlotChanges_AppliesAnchorVisibility`, which task 06 added: `anchor-wiring.test.ts` holds that behaviour now.
- Rows in `renderer/shell/shell.test.ts:937` and `renderer/shell/shell-chrome.test.ts:196`: rewrite to pass `keys` at mount. Keep the assertion that only a registered command anchors. Delete the case of a second `setKeys`.
- New row in the existing `plugins` order test, or a new `plugins/page.test.ts` if none owns it: `pageParts_DependencyOrder_KeysStartsFirst`. Catches the title bar order moving.

Runtime checks go to [16 — Final verification](16-final-verification.md).

## Done when

- `npm run typecheck` and `npm run lint` pass.
- `grep -rnE 'KEYS_PLUGIN_ID|keysPageKey|KeysPageExports|keys/contract' src` prints nothing.
- `grep -n "'keys'" src/plugins/*/manifest.ts` prints only `src/plugins/keys/manifest.ts`.
- `grep -n 'setKeys\|NO_KEYS\|createForwardingAnchor' src/renderer/shell/shell.ts src/renderer/shell/shell-chrome.ts` prints nothing.
- `grep -n 'pageKeys' src/renderer/renderer.ts` shows no nullable variable.
- The test gate runs the tests above.

## Commit

One commit for the group.

## Proof

