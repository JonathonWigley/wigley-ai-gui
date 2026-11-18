# 09 — Shell steps and skips

Status: not started
Type: Parallel
Rung: hard · the reference pattern (`page/demo-steps.ts` over `services.demoSteps`) has no instance in the tree yet, and three page parts change shape to hand their internals to the step
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files paths are written from the `ai` repo root; every other path in this document is relative to `wigley-ai-gui/`.

Files:
- create `wigley-ai-gui/src/plugins/keys/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/keys/page/start.ts`
- test `wigley-ai-gui/src/plugins/keys/page/start.test.ts`
- create `wigley-ai-gui/src/plugins/gallery/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/gallery/page/start.ts`
- test `wigley-ai-gui/src/plugins/gallery/page/start.test.ts`
- create `wigley-ai-gui/src/plugins/settings/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/settings/page/start.ts`
- modify `wigley-ai-gui/src/plugins/settings/page/settings-view.ts`
- test `wigley-ai-gui/src/plugins/settings/page/settings-view.test.ts`
- modify `wigley-ai-gui/src/plugins/window/manifest.ts`
- modify `wigley-ai-gui/src/plugins/markdown-blocks/manifest.ts`
- modify `wigley-ai-gui/src/plugins/claude-code/manifest.ts`
- modify `wigley-ai-gui/src/plugins/scoped-agents/manifest.ts`

This task adds no new plugin part, so 07's part lists gain nothing from it.

Consumes:
- `DemoStep`, `DemoStage`, `DemoBeat`, `DemoPageContext` in `src/contracts/demo.ts` ← 01
- `PageServices.demoSteps: DemoStepRegistry<DemoStep>` ← 01 (it files each `register` handle in the part's registrations, as `services.agentHarnesses` does, and checks the `<plugin id>.` prefix)
- `PluginManifest.demoSkip?: string`, accepted by `definePlugin` ← 01
- the page-part harness (`startPagePart` in `src/shared/plugin-part-harness.test-support.ts`) gives a working `services.demoSteps` whose `list()` returns the registered steps ← 01
- tree members: `whichKeyModel` (`src/plugins/keys/page/which-key.ts:45`), `mountWhichKeyView` (`src/plugins/keys/page/which-key-view.ts:14`), `pageKeysFor` (`src/shared/key-notation.ts:70`), `ListPicker.open/close/isOpen/focusFilter` (`src/contracts/list-picker.ts:88`), `PageTransparency` (`src/contracts/plugin.ts:761`), `nextTransparency` (`src/plugins/gallery/page/transparency-toggle.ts`), `testShellLayout` (`src/plugins/gallery/page/test-shell-layout.ts`), `SettingsView.openSectionAt` (`src/plugins/settings/page/settings-view.ts:347`) and the view's private `openSection(index, filter, cursorKey, leaderCursors)` (`:1162`), `SettingsPlace` and `settingsPlaceSlot` (`src/plugins/settings/contract.ts:123`, `:131`)

Produces:
- `export function registerDemoSteps(services: PageServices, deps: KeysDemoDeps): Disposable` and `export interface KeysDemoDeps` in `src/plugins/keys/page/demo-steps.ts`
- `export function registerDemoSteps(services: PageServices, deps: GalleryDemoDeps): Disposable` and `export interface GalleryDemoDeps` in `src/plugins/gallery/page/demo-steps.ts`
- `export function registerDemoSteps(services: PageServices, deps: SettingsDemoDeps): Disposable` and `export interface SettingsDemoDeps` in `src/plugins/settings/page/demo-steps.ts`
- `openSectionById(id: string): void` and `returnToPlace(place: SettingsPlace | undefined): void` on `SettingsView` in `src/plugins/settings/page/settings-view.ts`
- `demoSkip` in the four manifests below

## Reference pattern

Each plugin with a step does the same three things:

1. `page/demo-steps.ts` exports `registerDemoSteps(services, deps)`. It calls `services.demoSteps.register(step)` once per step and returns that handle (one step per plugin in this task, so the one handle is the return value).
2. The step's `enter(context)` builds the stage: it reads what it must restore at leave, then returns `{ beats, dispose }`. It does not show beat 0: the demo calls `beats[0].show()`.
3. `page/start.ts` calls `registerDemoSteps(services, deps)` once, after it built what `deps` names. It keeps no handle, since `services.demoSteps` files the registration in the part's registrations.

Rules for every stage in this task:

- Each beat's `show()` sets the whole state of its beat, so the demo can show the beats in any order (next, previous, reset). A beat first undoes what the other beats of the stage set, then sets its own.
- `dispose()` undoes everything the stage set and nothing else. A state that the user had before `enter` stays as it was.
- No step writes `settings.json`, `keymap.json` or `uiState`, and no step runs a command that does.
- No step has a main half: each shows what the page already holds.

## Per-plugin values

### keys — step `keys.hints`

| Field | Value |
|---|---|
| section | `shell` |
| order | `1` |
| title | `Key hints` |
| caption | `Every action has a key, and the app shows the keys as they are typed.` |
| files | `src/plugins/keys/page/start.ts`, `src/plugins/keys/page/which-key.ts`, `src/plugins/keys/page/help-sections.ts`, `src/plugins/keys/page/leader-search.ts`, `src/plugins/keys/layouts/default/layout.js` |

Beats, in order:

| name | show() |
|---|---|
| `Which-key` | close help and the picker; show the which-key panel for the leader prefix |
| `Help` | hide the which-key panel and close the picker; open help |
| `Leader search` | hide the which-key panel and close help; open the leader search with its filter not focused |

`KeysDemoDeps` (built in `page/start.ts`):

```ts
export interface KeysDemoDeps {
  whichKey: WhichKeyView;            // the one view `startWhichKey` draws in
  whichKeyModel(): WhichKeyModel | null; // the leader prefix's model, read now
  openHelp(): void;
  closeHelp(): void;
  isHelpOpen(): boolean;
  openLeaderSearch(): void;          // opens the picker, filter not focused
  closeLeaderSearch(): void;         // `picker.close()` when `picker.isOpen()`
}
```

Changes in `src/plugins/keys/page/start.ts`:

- Keep the result of `mountWhichKeyView(api.areas.overlay, parts)` in a `const` and hand the same object to `startWhichKey` and to `deps.whichKey`.
- `whichKeyModel()` calls `whichKeyModel({ where: 'page', keys: pageKeysFor('<Leader>', keys.keymap().editor.leader), scope: keys.scope() }, keys.keymap(), keys.command, keys.label, platform)`.
- Split `toggleHelp`: a new `openHelp(editor: { blur(): void } | null)` holds what the open branch does now (save the focus, push the `help` scope, `onBaseChanged`, blur the editor, `help.show()`, emit `helpOpened`). `toggleHelp(context)` calls `closeHelp()` when help is open, else `openHelp(context.editor ?? null)`. `deps.openHelp` calls `openHelp(null)` when help is closed. `closeHelp` stays as it is.
- Split `searchLeader`: a new `openLeaderSearch()` holds the `picker.open({...})` call. `searchLeader` calls `openLeaderSearch()` then `picker.focusFilter()`, as now. The step does not focus the filter: a focused filter box takes the `Space d` keys as text.

`dispose()` hides the which-key panel when the stage showed it, closes help when the stage opened it, and closes the picker when the stage opened it. When `whichKeyModel()` returns null (a keymap with no leader binds), the `Which-key` beat shows nothing and logs `which-key: no leader binds`.

### gallery — step `gallery.mode`

| Field | Value |
|---|---|
| section | `shell` |
| order | `2` |
| title | `Gallery` |
| caption | `Gallery mode shows every design primitive in every state.` |
| files | `src/plugins/gallery/page/start.ts`, `src/plugins/gallery/page/gallery-view.ts`, `src/plugins/gallery/page/test-shell-layout.ts`, `src/plugins/gallery/layouts/default/layout.js` |

Beats, in order (every beat first shows Gallery mode when it is not shown):

| name | show() |
|---|---|
| `Every primitive` | transparency back to the value found at `enter`; the stage's swap undone |
| `Transparency` | the stage's swap undone; transparency set to `nextTransparency(found)` |
| `Shell layout swap` | transparency back to the found value; the shell swapped to the test layout, when no swap is in force |

`GalleryDemoDeps` (built in `page/start.ts`):

```ts
export interface GalleryDemoDeps {
  showMode(): void;                                   // `mode.show()` when not shown
  transparency(): 'full' | 'reduced' | null;          // `api.transparency.overridden()`
  setTransparency(value: 'full' | 'reduced' | null): void; // `api.transparency.override(value)` then `view.showTransparency(value)`
  isSwapped(): boolean;                               // `swappedLayout !== null`
  swap(): void;                                       // the swap half of `swapShellLayout`
  restore(): void;                                    // the restore half of `swapShellLayout`
}
```

`PageTransparency.overridden()` returns the same `'full' | 'reduced' | null` that `view.showTransparency` takes.

Changes in `src/plugins/gallery/page/start.ts`: split `swapShellLayout` into `swap()` and `restore()`, each with its log line as now (`shell layout swapped`, `shell layout restored`); `swapShellLayout` calls one of them. The step and the command share the one `swappedLayout` variable.

The stage records `found = deps.transparency()` at `enter`, and a flag `didSwap`, false at `enter`. The `Shell layout swap` beat calls `swap()` only when `isSwapped()` is false, and sets `didSwap` to true only when it called `swap()`. "The stage's swap undone" (the `Every primitive` and `Transparency` beats) means: when `didSwap` is true and `isSwapped()` is true, call `restore()`; then set `didSwap` to false in every case. `dispose()` sets the transparency back to `found`, then undoes the stage's swap the same way. So a swap the user made before `enter`, or between beats, stays. The stage does not change the shown mode back.

### settings — step `settings.mode`

| Field | Value |
|---|---|
| section | `shell` |
| order | `3` |
| title | `Settings` |
| caption | `Settings mode edits every setting, plugin and key bind in place.` |
| files | `src/plugins/settings/page/start.ts`, `src/plugins/settings/page/settings-view.ts`, `src/plugins/settings/page/plugin-rows-view.ts`, `src/plugins/settings/page/keymap-view.ts`, `src/plugins/settings/page/leader-menu-view.ts` |

Beats, in order (every beat first shows Settings mode when it is not shown):

| name | show() |
|---|---|
| `Every setting` | `openSectionAt(0)` |
| `Plugins` | `openSectionById('plugins')` |
| `Keybindings` | `openSectionById('keymap')` |
| `Leader menu` | `openSectionById('leader')` |

`SettingsDemoDeps` (built in `page/start.ts`):

```ts
export interface SettingsDemoDeps {
  showMode(): void;                          // `mode.show()` when not shown
  place(): SettingsPlace | undefined;        // `placeWriter.get()`
  openSectionAt(index: number): void;        // `view.openSectionAt`
  openSectionById(id: string): void;         // `view.openSectionById`
  returnToPlace(place: SettingsPlace | undefined): void; // `view.returnToPlace`
}
```

New `SettingsView.openSectionById(id)`: finds the index of `id` in `sectionList()` and runs what `openSectionAt(index)` runs. An id no section holds logs `no section <id>` and opens nothing. Put its comment beside `openSectionAt` in the interface.

New `SettingsView.returnToPlace(place)`: puts a place back on the view without a fresh open. It runs `openSection(index, place.filter, place.cursorKey, place.leaderCursors)`, where `index` is the index of `place.openSectionId` in `sectionList()`, and sets the sections cursor to `place.sectionsCursor`, clamped to the sections there are. It does not call `focusSections()` or `sectionPicked()`. When `place` is undefined, or its section is not in `sectionList()`, it runs `openSection(0)` and sets the sections cursor to 0. `openSectionAt` cannot do this job: its `openSection(index)` clears the filter, the row cursor and the Leader menu cursors, and it moves focus. Put its comment beside `restorePlace` in the interface, and say how the two differ: `restorePlace` acts before the first show, `returnToPlace` on a shown view.

The stage records `found = deps.place()` at `enter`. It is undefined when Settings mode did not open a section on this page. `dispose()` calls `returnToPlace(found)`. So the user's section, filter, row cursor and Leader menu cursors come back, with no focus move; with `found` undefined, the first section shows, as a first show of Settings mode opens it. The view's own `reportPlace` then writes that place to `settings.place` again. The step reads the user's config as Settings mode always does and writes no setting; it opens sections only (Decisions).

### Plugins with `demoSkip`

Add the field after the manifest's top-level `description` (not a `settingInfo` entry's `description`; `claude-code` and `scoped-agents` hold several), verbatim:

| Manifest | `demoSkip` |
|---|---|
| `src/plugins/window/manifest.ts` | `'Its global summon shortcut acts from outside the window.'` |
| `src/plugins/markdown-blocks/manifest.ts` | `'Its blocks draw inside the chat, forms and docs steps.'` |
| `src/plugins/claude-code/manifest.ts` | `'It runs every real session; the real-session step shows it.'` |
| `src/plugins/scoped-agents/manifest.ts` | `'Its panes show in the Demo panel and the Backlog and Practice steps.'` |

Decisions:
- One step per plugin: keys, gallery and settings each show one feature (task brief).
- Keys, gallery and settings have no main half: the keymap, the gallery's samples and the settings schema are already on the page (task brief: a main half only where sample data lives in main).
- The leader search opens with its filter not focused, so the `Space d` keys keep working while it shows.
- The which-key beat draws the panel through the same `WhichKeyView` the controller uses, not through a fake key press: the page API has no call that starts a pending sequence (`src/contracts/plugin.ts:910-912` has `onPending`, `holdPending`, `cancelPending` only).
- The gallery step never undoes a swap the user made; it undoes only its own. The `didSwap` flag clears each time the stage undoes its swap, so a swap the user makes between beats is the user's.
- The settings step shows the user's live config read-only: it opens sections and moves no value. Settings mode has no sample config to load, and the view reads the user config layers through its channel.
- The settings step puts the user's place back at leave (section, filter, row cursor, Leader menu cursors), since the place is saved per page (`settings.place`). It uses a new `returnToPlace`, not `openSectionAt` plus `moveToRow`, because those clear the filter and cursors and move focus.

GIVEN the gallery step entered with no transparency override and no swap WHEN the `Transparency` beat then the `Shell layout swap` beat show and the stage is disposed THEN the override is null again and the shell layout is restored.
GIVEN the user swapped the shell layout before the gallery step WHEN the stage is disposed THEN the swap stays.
GIVEN the gallery stage swapped on beat 2 WHEN beat 0 shows, then the user runs `gallery.swapShellLayout`, then the stage is disposed THEN the user's swap stays.
GIVEN Settings mode shown with section `keymap`, filter `save` and a row cursor WHEN the settings stage shows its beats and is disposed THEN section `keymap` shows with filter `save` and the same row cursor, and `sectionPicked` is not called by the dispose.
GIVEN the user opened help before the keys step WHEN the stage shows `Help` and is disposed THEN help stays open.
GIVEN a keymap with no leader binds WHEN the `Which-key` beat shows THEN the panel shows nothing and the log holds `which-key: no leader binds`.
GIVEN Settings mode with section `keymap` open WHEN `openSectionById('plugins')` runs THEN the Plugins section opens and `sectionPicked` is called once; WHEN `openSectionById('nope')` runs THEN it logs `no section nope` and opens nothing.

Tests:
- `src/plugins/settings/page/settings-view.test.ts`: `it.each` `openSectionById_Id_OpensAndCallsSectionPicked: $name`, in the shape of the `openSectionAt_Index_OpensAndCallsSectionPicked` table (line 818), rows `{ name: 'a held id', id: 'keymap', opened: 'section keymap', picks: 1 }` and `{ name: 'an id with no section', id: 'nope', opened: 'no section nope', picks: 0 }`. Break it catches: an id lookup that opens section 0 on a miss.
- `src/plugins/settings/page/settings-view.test.ts`: `it.each` `returnToPlace_Place_OpensItWithItsFilterAndCursors: $name`, on a shown view with section `plugins` open and focus on the rows. Rows: `{ name: 'a held place', place: { sectionsCursor: <keymap's index>, openSectionId: 'keymap', cursorKey: <a key the keymap section draws>, filter: 'save', leaderCursors: <the view's current cursors> }, opened: 'section keymap', filter: 'save' }`, `{ name: 'no place', place: undefined, opened: 'section <the first section id>', filter: '' }`, `{ name: 'a section the schema lacks', place: { …, openSectionId: 'gone' }, opened: 'section <the first section id>', filter: '' }`. Each row asserts the log line `opened`, the filter box value `filter`, `sectionPicked` not called, and focus still on the rows; the first row also asserts the last `placeChanged` value equals `place`. Breaks it catches: a leave that clears the user's filter or cursor, a leave that moves focus or closes a narrow window's side bar.
- `src/plugins/gallery/page/start.test.ts`: `it.each` `'demo stage dispose restores what the stage changed: $name'`, entering the registered `gallery.mode` step through the harness's `services.demoSteps.list()`, showing beats 1 and 2, then disposing. The harness's `api.shell.setLayout` returns an inert handle and `swappedLayout` is private, so each row reads the swap state through the command: after the dispose, run `gallery.swapShellLayout` once and assert the last line in `harness.logs` is `shell layout restored` (a swap was still in force) or `shell layout swapped` (none was). Rows: `{ name: 'no swap before', swappedBefore: false, lineAfter: 'shell layout swapped' }` and `{ name: 'the user swapped before', swappedBefore: true, lineAfter: 'shell layout restored' }` (for the second row, run `gallery.swapShellLayout` before `enter`). Each row also asserts the harness's transparency is back to the value it held before `enter` (`api.transparency.overridden()` reads the harness's value, `plugin-part-harness.test-support.ts:1573`). Breaks it catches: a dispose that restores the user's swap, a dispose that leaves the stage's swap or the override set.
- `src/plugins/gallery/page/start.test.ts`: `demoStage_UserSwapsBetweenBeats_TheSwapStays`: enter, show beat 2, show beat 0, run `gallery.swapShellLayout`, dispose, run `gallery.swapShellLayout` once more; the last log line is `shell layout restored`. Break it catches: a `didSwap` that stays true after the stage undid its swap, so the dispose takes the user's swap.
- `src/plugins/keys/page/start.test.ts`: `it.each` `'keys demo stage: $name'`, entering the registered `keys.hints` step through `services.demoSteps.list()`, on the file's `KEYMAP` (it holds no binds). Rows: `{ name: 'help the user opened stays open' }`: run `toggleHelp` before `enter`, show beat 1 (`Help`), dispose, run `toggleHelp` again; `dataEmitted(harness, 'keys.helpOpened')` is `[null]` (the second toggle closed help, so the dispose left it open). `{ name: 'no leader binds' }`: show beat 0; `harness.logs` holds `which-key: no leader binds`. Breaks it catches: a dispose that closes help the user opened, a which-key beat that throws on a null model.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass; `grep -l "demoSkip" src/plugins/window/manifest.ts src/plugins/markdown-blocks/manifest.ts src/plugins/claude-code/manifest.ts src/plugins/scoped-agents/manifest.ts | wc -l` prints `4` (task 15 adds a fifth `demoSkip`, in `docs-session-tab`, so a count over every manifest depends on whether 15 landed).

Commit: one commit for the group.

## Proof
