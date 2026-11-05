# 09 — Core picker and folder services

Status: not started
Type: Task
Wave: 8 · Depends on: 08
Plan: [plan.md](plan.md)

All paths are under `src/`.

## Files

- create `contracts/list-picker.ts`
- create `shared/page/fake-list-picker-service.test-support.ts`
- modify `contracts/plugin.ts`, `contracts/bridge.ts`
- modify `shared/page/list-picker.ts` · test `shared/page/list-picker.test.ts`
- modify `shared/plugin-part-harness.test-support.ts`
- modify `preload/preload.ts` · test `preload/preload.test.ts`
- modify `main/main.ts`
- modify `renderer/renderer.ts`
- modify `renderer/plugins/page-api.ts` · test `renderer/plugins/page-api.test.ts`
- modify `plugins/chat/page/picker.ts`, `plugins/chat/page/start.ts`
- modify `plugins/chat/page/start-prompt.ts` · test `plugins/chat/page/start-prompt.test.ts`
- modify `plugins/chat/contract.ts`, `plugins/chat/main/start.ts`
- modify `plugins/settings/page/settings-view.ts`, `plugins/settings/page/start.ts`
- modify `plugins/backlog/page/backlog-view.ts`, `plugins/backlog/page/start.ts` · test `plugins/backlog/page/backlog-view.test.ts`
- modify `plugins/docs/page/docs-dialogs.ts` · test `plugins/docs/page/docs-dialogs.test.ts`
- modify `plugins/docs/page/docs-view.ts`, `plugins/docs/page/start.ts`
- modify `plugins/docs/page/doc-view.ts` · test `plugins/docs/page/doc-view.test.ts`
- modify `plugins/docs/contract.ts`, `plugins/docs/main/start.ts`
- modify `plugins/sessions/page/start.ts` · test `plugins/sessions/page/start.test.ts`
- modify `plugins/notes/page/popup.ts`, `plugins/notes/page/start.ts` · test `plugins/notes/page/popup.test.ts`
- test: each of `plugins/{settings,backlog,docs,notes,chat}/page/start.test.ts` where the part now needs a picker fake

## Consumes

- `createListPicker`, `ListPicker`, `ListPickerRequest`, `DrawRowInput`, `DrawnPickerRow`, `qualify`, `trackedEditor`, `MainServices.window.chooseFolder`, `MainServices.openExternal`: already in the tree
- `PageApi['keys']` and the page API's `trackedPushedScope`: already in the tree; task 08's `api.keys` shape is the one in force

## Produces

`contracts/list-picker.ts` takes these types from `shared/page/list-picker.ts`, unchanged: `ListPickerRequest<T>`, `DrawRowInput`, `DrawnPickerRow`, `ListPicker`. It adds:

```ts
export interface ListPickerOptions {
  // The owner's short scope pushed while the list shows, read at each push. Default 'picker'.
  scope?: string | (() => string);
  // Adds the filter box above the list, on the plugin's editor service. Default false.
  filter?: boolean;
  // The element the list goes in. Default: the window's overlay.
  parent?: HTMLElement;
}
export interface ListPickerService {
  create(options?: ListPickerOptions): ListPicker;
}
```

`contracts/plugin.ts`, on `PageServices`:

```ts
picker: ListPickerService;
chooseFolder(): Promise<string | null>;
openExternal(url: string): Promise<void>;
```

`contracts/bridge.ts`:

```ts
// BRIDGE_CHANNELS gains chooseFolder: 'bridge:choose-folder', openExternal: 'bridge:open-external'
chooseFolder(): Promise<string | null>;
openExternal(url: string): Promise<void>;
```

`renderer/plugins/page-api.ts`: `PageApiServices` omits `picker` too. The page API builds `services.picker` per plugin.

`shared/page/fake-list-picker-service.test-support.ts`:

```ts
// A real createListPicker over a fake matcher. `scopes` records each scope pushed.
export function fakeListPickerService(): ListPickerService & { scopes: string[]; created: ListPickerOptions[] };
```

## Decisions

### The members, from the sites

1. The wiring at each site, measured at plan time (re-verify with `grep -rn 'createListPicker(\|createPicker(' src/plugins`):

| Site | Scope | Filter box | Placed in | After |
|---|---|---|---|---|
| `plugins/settings/page/settings-view.ts:357` | `picker` | no | overlay, `deps.addOverlay` | `create()` |
| `plugins/backlog/page/backlog-view.ts:321` | `picker` | no | overlay, `deps.addOverlay` | `create()` |
| `plugins/docs/page/docs-dialogs.ts:464` | `picker` | no | overlay, through `dialogs.elements` and `docs-view.ts:596` | `create()` |
| `plugins/sessions/page/start.ts:673` | `picker` | no | overlay | `create()` |
| `plugins/notes/page/popup.ts:591` | `picker` | yes | `dialog.element` | `create({ filter: true, parent: dialog.element })` |
| `plugins/chat/page/picker.ts:102` | `picker` or `resume`, read at each push | yes | overlay | `create({ scope: () => scope, filter: true })` |

2. Those three options cover every site. A site still sets its request's `title`, `items`, `label`, `drawRow`, `chosen` and the rest on `open`, as today.

### The service

3. `create` builds through `createListPicker`, with these deps:
   - `pushScope`: `trackedPushedScope(deps.scopeStack.push(qualify(manifest.id, name)), registrations)`, with `name` read from `options.scope` at each push.
   - `log`: the plugin's scoped log.
   - `matcher`: `deps.services.fuzzy`.
   - `filterEditor`: the plugin's tracked editor, when `filter` is true.
4. `create` places `picker.element`:
   - with no `parent`, through `areas.overlay.contribute`, filed in the part's registrations;
   - with a `parent`, by `parent.append`.
5. `create` files one registration that calls `picker.close()`, so a part's stop closes an open list and hears no cancel.
6. A scope name the manifest does not declare throws `Plugin "<id>" declares no scope "<name>"`. For a string, it throws at `create`. For a function, it throws at the push. `PageServices` is not generic on the manifest, so this replaces the compile check `pushScope` had. Each site's scope is declared at plan time (measured at plan time, re-verify).
7. The `ListPicker` a plugin gets is the same object `createListPicker` returns. It adds no method.
8. `src/contracts` imports nothing outside it. The moved types are DOM types and types of its own. `shared/page/list-picker.ts` imports them from `contracts/list-picker.ts`, and keeps `ListPickerDeps` and `createListPicker`. Importers of the moved types change their import.

### What goes at each site

9. A deps field a site no longer reads goes:
   - `addOverlay` stays where the view uses it for other dialogs: settings, backlog, docs.
   - `matcher` stays where a filter or another view still reads it. Otherwise it goes.
   - `pushScope` stays where other scopes use it.
   - Each view's deps gain `picker: ListPickerService`, and each `start.ts` passes `services.picker`.
10. Docs: `dialogs.elements` loses `picker.element`. `elements` holds `[box.element, confirm.element]`. The picker contributes at `create`, which runs before those two contribute, so it stays under them.

### What chat's wrapper keeps

11. `plugins/chat/page/picker.ts` stays chat's. It keeps:
    - the `PickerRequest` shape: `title`, `name`, `sessionBound`, `scope`, `archiveState`, `rowInput`, `picked`
    - `PickerHandle.isOpen()`
    - `closeSessionBound`
    - the header key hints and the cursor row's `x archive` and `x restore` prompts
    - the `pickerRow` part draw
    - the redraw on each layout change
    - open-replaces-open with the scope kept
    - the `picker closed: <title>` log line
12. Only the wiring at `picker.ts:102-108` changes: `deps.picker.create({ scope: () => scope, filter: true })`. `PickerDeps` loses `overlay`, `editor`, `matcher` and `pushScope`, and gains `picker: ListPickerService`. `log` stays: line 174 reads it. `plugins/chat/page/start.ts:144-150` passes `picker: services.picker`.

### chooseFolder and openExternal

13. Main's handlers go in `main/main.ts`, beside `BRIDGE_CHANNELS.savePasted`. They call the same `services.window.chooseFolder()` and `services.openExternal(url)` the plugins' handlers call.
14. The preload reaches them as it reaches `savePasted`, so a rejection carries main's own error text.
15. `renderer/renderer.ts` sets `chooseFolder` and `openExternal` on `services`, each calling the Bridge.
16. The scheme check stays inside `MainServices.openExternal`, which rejects a URL that is not http or https. The page service holds no check of its own.
17. Delete from chat:
    - `chooseFolder` in `ChatChannel.invoke` (`plugins/chat/contract.ts:172`)
    - the handler at `plugins/chat/main/start.ts:396`
18. `start-prompt.ts:155` calls `deps.chooseFolder()`. `plugins/chat/main/start-session-tool.ts:84` is a separate local function, and it stays.
19. Delete from docs:
    - `openExternal` in `DocsChannel.invoke` (`plugins/docs/contract.ts:321`)
    - the handler at `plugins/docs/main/start.ts:325-331`
    - the `EXTERNAL_SCHEME` import in `plugins/docs/main/start.ts`
20. `EXTERNAL_SCHEME` stays in `plugins/docs/links.ts`, which `resolveLink` reads. `doc-view.ts:545` calls `deps.openExternal(target.url)`, with the same log line and toast.
21. What the user sees does not change. `resolveLink` gives an `external` target only for an http or https href, so the deleted docs message `Only http and https links open outside the app` cannot reach the toast from this path.

### Harness

22. The fake `services` default is `picker: notFaked<ListPickerService>('picker')`, as `fuzzy` is. `chooseFolder` and `openExternal` throw `part harness: services.<name> is not faked; pass it in options` when called. A test that starts a part which creates a picker passes `services: { picker: fakeListPickerService() }`. It drops `fuzzy` when the part no longer reads it.

## Behaviour

GIVEN a part that calls `services.picker.create()` WHEN the list opens THEN the part's `picker` scope is pushed, and the list sits in the overlay.

GIVEN chat opens a `resume` request over an open `picker` request THEN the scope read at the push is `chat.resume`.

GIVEN notes opens its list THEN the list is inside the popup's dialog, and its filter box takes text.

GIVEN an open list WHEN its part stops THEN the list closes, the scope pops, and `cancelled` does not run.

GIVEN `create({ scope: 'nope' })` WHEN the manifest declares no such scope THEN it throws at the call.

GIVEN a page plugin calls `services.chooseFolder()` WHEN the user dismisses the dialog THEN it resolves null, and chat's start prompt returns to its folder step.

GIVEN `services.openExternal('file:///x')` WHEN it runs THEN it rejects with main's own text.

GIVEN a link in a doc WHEN the user follows it THEN it opens in the default app, and the log reads `opened link <url>`.

## Tests

- Rows added to `renderer/plugins/page-api.test.ts`:
  - `picker_Create_PushesTheQualifiedScopeAndPlacesInOverlay`, with the `parent` case in one table. Catches a list placed twice, or the short scope pushed unqualified.
  - `picker_ScopeFunction_ReadAtEachPush`. Catches chat's `resume` scope frozen at `create`.
  - `picker_UndeclaredScope_Throws`.
  - `picker_PartStops_ClosesWithNoCancel`.
  - `picker_FilterOption_UsesThePluginsEditor`.
  - `chooseFolder_And_openExternal_ReachTheBridge`, one table.
- Row added to `preload/preload.test.ts`: the two new members, with a rejection carrying main's text, as `savePasted`'s row does.
- `plugins/chat/page/start-prompt.test.ts:311-346`: the three `chooseFolder_*` rows read the fake `deps.chooseFolder`, and no longer assert `run.invoked`. The cases stay.
- `plugins/docs/page/doc-view.test.ts`: if a row asserts the external link through the channel, move it to `deps.openExternal`. If none does, add `followLink_ExternalTarget_CallsOpenExternalAndLogs`. Catches a link that stops opening.
- `plugins/docs/page/docs-dialogs.test.ts:74` and the backlog, notes and sessions tests read `picker.element` through the fake service. Their assertions stay.

Runtime checks go to [16 — Final verification](16-final-verification.md).

## Done when

- The type check and `scripts/check-layers.mts` pass.
- `grep -rn 'createListPicker(' src/plugins` prints nothing.
- `grep -rn "'chooseFolder'\|'openExternal'" src/plugins` prints nothing.
- `grep -n 'chooseFolder\|openExternal' src/plugins/chat/contract.ts src/plugins/docs/contract.ts` prints nothing.
- The test gate runs the tests above.

## Commit

One commit for the group.

## Proof

