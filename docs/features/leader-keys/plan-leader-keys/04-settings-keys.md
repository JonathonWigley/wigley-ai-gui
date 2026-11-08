# 04 — Settings Keybindings section

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 03
Plan: [plan.md](plan.md)

Settings mode's Keymap section becomes the **Keybindings** section of `docs/features/settings/design.md` § Keybindings and Leader
menu sections › Keybindings: one-line command rows with their keys at the end, reassign and add by recording the key pressed
(`api.keys.captureKey`, Tab to type), clear, reset, the `f` filter chips, `?` find by key, and an Advanced box that no
longer edits `groups`. This task registers only Keybindings in the side bar; Task 05 adds Leader menu with its drawing, so no
section ever draws an empty placeholder.

This plan runs after keyboard-reach (`docs/features/keyboard-reach/plan-every-pane/`) has landed. Its Task 05 gives
`SettingsView` `focusSideBar` / `focusMain`, the `settings.openKeepingFocus` command on `l` in `settings.sections`,
Enter on a section focusing the rows, and the `sections focused` / `rows focused` log lines; its Task 08 moves the
settings picker onto the shared list-picker commands (`ListPickerCommand`) with `filter: true`. Re-read
`settings-view.ts`, `start.ts`, `manifest.ts`, `selftest-script.ts` and the settings block of `keymap.ts` first and
work against the code as they leave it; this document names members, not lines.

Files:     modify `src/plugins/settings/page/settings-view.ts` · modify `src/plugins/settings/page/keymap-view.ts` ·
           modify `src/plugins/settings/page/keymap-rows.ts` · modify `src/plugins/settings/page/keymap-edits.ts` ·
           modify `src/plugins/settings/page/row-filter.ts` · modify `src/plugins/settings/page/row-prompt.ts` ·
           create `src/plugins/settings/page/key-recorder.ts` · modify `src/plugins/settings/page/start.ts` ·
           modify `src/plugins/settings/page/layout/read-layout.ts` · modify `src/plugins/settings/page/layout/settings-kit.ts` ·
           modify `src/plugins/settings/layouts/layout.d.ts` · modify `src/plugins/settings/layouts/default/layout.js` ·
           modify `src/plugins/settings/layouts/default/layout.css` · modify `src/plugins/settings/manifest.ts` ·
           modify `src/plugins/keymap.ts` · modify `src/plugins/settings/main/selftest-script.ts` ·
           modify `docs/features/layouts/design.md` (the settings row of § Adopters) ·
           test `src/plugins/settings/page/key-recorder.test.ts` · test `src/plugins/settings/page/keymap-rows.test.ts` ·
           test `src/plugins/settings/page/keymap-edits.test.ts` · test `src/plugins/settings/page/keymap-view.test.ts` ·
           test `src/plugins/settings/page/row-filter.test.ts` · test `src/plugins/settings/page/row-prompt.test.ts` ·
           test `src/plugins/settings/page/settings-view.test.ts` · test `src/plugins/settings/page/start.test.ts` ·
           test `src/plugins/settings/page/layout/read-layout.test.ts`

Consumes:
- `captureKey(onKey: (keys: string) => void, onCancel: () => void): Disposable` on the page plugin API's `keys` ← 01
  (plan.md § File Structure: one capture at a time, arming a second cancels the first through its `onCancel`, Esc runs
  `onCancel` and is never captured, a bare modifier is skipped, dispose disarms with no callback; `keys` is one key or
  chord in vim notation as a bind writes it).
- `src/plugins/keymap.ts` as Task 03 leaves it (03 adds `<Leader>/`; this task adds settings binds beside it).
- keyboard-reach Task 05's `SettingsView.focusMain()` / `focusSideBar()` and Task 08's shared picker commands (in the
  tree before this plan runs).

Produces:
- `withMovedBind(layer: UserKeymap | null, line: BindLine, to: KeyBind, schema: UserConfigSchema): UserKeymap` in
  `src/plugins/settings/page/keymap-edits.ts`. The types are `UserKeymap` (`src/contracts/keymap.ts`) and
  `UserConfigSchema` (`src/contracts/user-config.ts`); `BindLine` is in `keymap-rows.ts`.
- `KEYS_SECTION = { id: 'keymap', title: 'Keybindings' }` in `settings-view.ts`, replacing `KEYMAP_SECTION`. The id is
  `keymap`, not plan.md's `keys`: the `keys` plugin declares settings, so the schema already holds a section with id
  `keys` (title `Keys`), and `drawRows` finds a schema section by id first. Task 05 adds `LEADER_SECTION`.
- `ConfigFile` stays `'settings' | 'keymap'`; `sectionFile()` returns `'keymap'` for `KEYS_SECTION.id`.
- `src/plugins/settings/page/key-recorder.ts`:
  - `RecordRequest { key: string; replacing: number | null; prompt: string; confirm: 'enter' | 'press';
    judge(keys: string): Judgement; keep(keys: string): void; type?(typed: string): void; cancelled?(): void }`
  - `Judgement = { type: 'free' } | { type: 'moves'; note: string; from: readonly string[] } |
    { type: 'refused'; note: string; reason: 'leader' | 'taken' | 'group' | 'chord' }`
  - `Recording { key: string; replacing: number | null; keys: string | null; prompt: string; note: string | null;
    isRefused: boolean }`
  - `KeyRecorder { start(request: RecordRequest): void; current(): Recording | null; cancel(): void }`
  - `createKeyRecorder(deps: { captureKey(onKey: (keys: string) => void, onCancel: () => void): Disposable;
    changed(): void; log(line: string): void }): KeyRecorder`
- `RowContext.recordKey(request: RecordRequest): void` and `RowContext.recording(): Recording | null` in
  `settings-view.ts`; `SettingsViewDeps.captureKey` with the 01 signature; `SettingsView.hidden(): void`.
- `PickRequest.keysOf?(item: T): string | null` in `settings-view.ts` (05 fills it; this task passes it through to the
  `pickerRow` input).
- `export function scopeTitle(ctx: RowContext, scope: ViewScope): string` and
  `export function openScopePicker(ctx: RowContext, request: ScopePickRequest): void` in `keymap-view.ts`, with
  `ScopePickRequest { keys: string; command: CommandId; arg?: CommandArg; preselected: ViewScope;
  chosen(scope: ViewScope, expectedText: string | null): void; cancelled?(): void }` — today's private `scopeTitle` and
  the scope picker inside `addBind`, exported for Task 05.
- `KeyFilter = 'all' | 'bound' | 'unbound' | 'changed'`, `KEY_FILTERS: readonly KeyFilter[]` (that order) and
  `matchesKeyFilter(row: CommandRow, filter: KeyFilter): boolean` in `keymap-rows.ts`.
- `keyMatch(row: CommandRow, keys: string, leader: string): 'runs' | 'starts' | null` in `row-filter.ts`.
- `KeysViewState { filter: KeyFilter; findKeys: string | null }` in `keymap-view.ts`;
  `keymapSection(ctx: RowContext, query: string, state: KeysViewState): SectionDrawing`.
- `SectionEntry` gains `{ type: 'keyFilters'; input: KeyFiltersInput }`.
- Layout contract (`layout.d.ts`): `RecordingInput`, `KeyRowInput.group` and `KeyRowInput.recording`,
  `KeyFiltersInput`, `KeyFilterChipInput`, `PickerRowInput.keys`, part `keyFilters`; `SettingsKitScope` and
  `buildRow` take the kit scope (below).
- Manifest commands `cycleKeyFilter` and `findByKey`; `SettingsCommand` gains both.

## Decisions

### The section and its rows

- **Side bar**: `sectionList()` is the schema sections, then `KEYS_SECTION`. `drawRows` checks
  `openSectionId === KEYS_SECTION.id` before looking up a schema section; no plugin id is `keymap` (the manifest ids,
  measured at plan time, re-verify with `grep -rh "^  id: '" src/plugins/*/manifest.ts`).
- **Order**: the Leader row first, the `keyFilters` bar above it (the first entry), then each plugin's command rows
  under its group header as today (`keymapRows`), then the Advanced row last.
- **A command row is one line** (`keyRowInput`): label (capitalised, as today), then `group` (the manifest
  `CommandInfo.group`) as a dim detail, then each line in force at the row's end as Kbd, separated by `·`.
  `bindLine`'s tags change: the scope's title only when the scope is not `any` (no `Everywhere` tag), then `where`
  printed as written (`page`, `box`, `both`) when set, `mode` when set, `Set` for a user bind, then `coverTexts`.
  Accelerator lines are unchanged. A row with no lines draws `—` in `fg-tertiary` (the default layout's `Not bound`
  goes).
- **Cursor prompt** (`row-prompt.ts`, `PROMPT_LABELS` in `settings-view.ts`): `PromptAction` gains `open`. A key row
  (one with `addBind`) shows `open`, `addBind`, `removeBind`, `reset`; every other row shows `edit`, `reset`. Labels:
  `open` → `reassign`, `addBind` → `add key`, `removeBind` → `clear`, `edit` → `edit`, `reset` → `reset`. The `open`
  anchor is made like the others: `anchored('open', 'rows', 'reassign')`. So the cursor row reads
  `↩ reassign  a add key  d clear  r reset`.
- **Main command rows** (`settings.show`, `window.summon`): unchanged; every edit key toasts
  `Accelerators are edited in the advanced box`.

### Recording a key

- **`key-recorder.ts`** owns one recording at a time over `captureKey`; `settings-view.ts` creates it with
  `changed: () => draw()` and `log`, and exposes it as `RowContext.recordKey` / `recording`. Behaviour, in order:
  - `start` cancels a running recording first (its `cancelled` runs), arms `captureKey`, logs `recording <key>`, and
    calls `changed`.
  - Each captured `keys`: when `confirm` is `'enter'`, an accepted press is already held and `normalVimKeys(keys)` is
    `<CR>` → logs `recording kept <key> <held keys>`, ends the recording, calls `keep(held)`. When `confirm` is
    `'enter'`, `type` is given and `normalVimKeys(keys)` is `<Tab>` → logs `recording typed <key>`, ends, calls
    `type(held ?? '')`. Otherwise it logs `recorded <keys>` and runs `judge(keys)`: `free` holds the keys with no note;
    `moves` holds them with the note and logs `record moves <keys> from <from joined by ', '>`; `refused` shows the
    note, holds nothing new (an earlier accepted press stays held) and logs `record refused <keys>: <reason>`. With
    `confirm: 'press'`, a `free` or `moves` press ends the recording and calls `keep(keys)` at once (no
    `recording kept` line). Every press not ending the recording arms the capture again, so the next key goes to it
    too. A first press of `<CR>` is recorded like any key (nothing is held yet).
  - `onCancel` (Esc) → logs `recording cancelled <key>`, ends, calls `cancelled`.
  - `cancel()` disposes the capture with no callback and logs `recording cancelled <key>`; nothing when idle.
  - Each change calls `changed`.
  - `Recording.prompt` is the request's `prompt` until an accepted press is held; with one held under `'enter'` it is
    `Enter keeps it — Tab types it, Esc cancels` (`— Esc cancels` alone when the request has no `type`).
- **Keybindings row input**: `KeyRowInput.recording` is set when `ctx.recording()?.key` is the row's key:
  `{ line: replacing, keys: <held keys printed with formatVimKeys, or null>, prompt, note, isRefused }`; null
  otherwise. `RecordingInput = { keys: string | null; prompt: string; note: string | null; isRefused: boolean }`, and
  `KeyRowInput.recording: (RecordingInput & { line: number | null }) | null`, `line` being the index into `lines` of
  the bind the recording replaces (null when adding).
- **Default draw** of a recording row: the line at `line` struck (whatever its `isStruck`), the recording right after
  it (at the end of the lines when `line` is null) as `span.settings-recording`: the Kbd of `keys`, then `prompt` in
  `fg-tertiary`; `note` on a second line, `div.settings-row-note`, with `is-refused` (in `status-warning`) when
  `isRefused`, else `fg-secondary`.
- **Reassign** (Enter `settings.open` or `i` `settings.edit` on a page command row): the row's lines in force
  (`firesAnywhere`). None → it runs Add key. One → records it. Several → the picker `Key to reassign` over those lines
  (labels as `Key to remove`'s: `<keys> — <scope title>`), then records the chosen one. The request: key = the row's
  key, `replacing` = the line's index among the row's drawn `lines`, prompt `Press a key or chord — Tab types it, Esc
  cancels`, `confirm: 'enter'`.
  - `judge(keys)`: `normalVimKeys(keys) === normalVimKeys(leader)`, `leader` being the leader in force (`keymapLeader`, raw, so
    `<Space>` by default; `normalVimKeys('<Space>')` is `' '`, so both sides are normalised) → refused, reason `leader`,
    note `<leader printed> is the leader — Tab types a leader sequence` (printed with `formatVimKeys(leader, leader,
    platform)`). Else `replacedBy(schema, layer, keys, line.bind.scope, command, arg)` non-empty → `moves`, `from` the
    commands' `commandTarget`s, note `<keys printed> runs "<label>" in <scope title>: it moves here`, where `<scope
    title>` is `scopeTitle`; for scope `any` it reads `<keys printed> runs "<label>" everywhere: it moves here`;
    several commands join as `"A" and "B"` (`andList` of the quoted labels; labels via `commandLabel`). Else `free`.
  - `keep(keys)` → when `normalVimKeys(keys)` equals `normalVimKeys(line.bind.keys)` it writes nothing and closes the
    recording (the recorder has already ended it); else `ctx.commitKeymap(withMovedBind(layer, line, { ...line.bind,
    keys }, schema), null)`; the bind keeps its scope, `where`, `mode` and `arg`. Without the guard a default line
    would gain an `unbind` entry and a user bind on identical keys, a no-op pair `r` must undo.
  - `type(typed)` → the line box of today's `addBind`, with text `typed`, preview `keysPreview` in the bind's scope;
    accept: empty closes the box, else commits `withMovedBind` as `keep` does, via `{ box }`.
- **Add key** (`a`, and Enter / `i` on a row with no lines in force): records with key = the row's key, `replacing:
  null`, the same prompt and `confirm: 'enter'`; `judge` refuses only the leader (as above) and is otherwise `free`,
  since the scope comes after. `keep(keys)` → `openScopePicker` (today's picker: title `Scope`, `any` then every
  scope, each line `<title>` or `<title> — replaces <labels>`, preselecting the scope of the row's first default bind,
  else `any`), chosen → `withAddedBind` with no `where` or `mode`, committed via `{ expectedText }`. `type(typed)` →
  today's add box with text `typed`, its accept unchanged (it opens the same scope picker).
- **Clear** (`d`) and **reset** (`r`): today's `removeBind` and `withCommandReset`, unchanged.
- **What ends a recording**: Esc; `openSection`; `setLayouts` keeps it (the row redraws with its state); the recording
  row leaving the drawn rows on a redraw (the recorder's `cancel`), except the `?` find recording, whose key `find`
  is never a row and so is exempt from that check; `SettingsView.hidden()`, which `start.ts` calls
  from the mode's `hidden` (today `() => undefined`), so a capture never outlives the mode on screen. While a
  recording runs, `runQuietly`'s guard runs no row action, and the row keeps `is-cursor`.
- **Self-test keys reach the capture**: the driver presses through `sendInputEvent` keyDown events
  (`press` in `src/main/drive/page-driver.ts`: a chord as `keyCode` plus modifiers, Space as keyCode `Space` with
  char ` `), which the page sees as `keydown`, the event 01's capture reads. Space arrives as `<Space>` (01's
  spelling; re-verify against 01's tests).

### The filter chips and find by key

- **`f`** (`settings.cycleKeyFilter`, scope `settings.rows`): with the Keybindings section open, focus on the rows and no
  box, picker, text filter box or recording open, it moves the chip All → Bound → Unbound → Changed → All, logs
  `key filter <id>` (`all`, `bound`, `unbound`, `changed`) and redraws; in any other section it does nothing.
- **`matchesKeyFilter`**: `all` every row; `bound` a row with any bind line `firesAnywhere` or any accelerator line
  `active`; `unbound` the rest; `changed` a row with a bind line of origin `user`, a bind half in state `removed`, or
  an accelerator line in state `removed`. A default only replaced by another command's user bind is not `changed`.
- **Chips** (`KeyFiltersInput { chips: readonly KeyFilterChipInput[]; find: { keys: string | null;
  isRecording: boolean } }`, `KeyFilterChipInput { id: KeyFilter; label: string; count: number; isOn: boolean }`):
  labels `All`, `Bound`, `Unbound`, `Changed`; `count` is the command rows that chip would show under the current
  `/` query and find query. The Leader row and the Advanced row show only while the chip is `all` and no find query
  is set; neither counts.
- **`?`** (`settings.findByKey`, scope `settings.rows`): same guards as `f`; starts a recording with key `find`,
  `replacing: null`, prompt `Press a key to find what it runs — Esc cancels`, `confirm: 'press'`, `judge` always
  `free`, `keep(keys)` sets `findKeys`, logs `find by key <keys>` and redraws. `find.isRecording` is
  `ctx.recording()?.key === 'find'` (no command id lacks a dot, so `find` never names a row).
- **`keyMatch`**: the captured keys and each bind line in force (`firesAnywhere`) as `vimTokens(keys, leader)`, each
  token through `normalVimKeys`; equal → `runs`, the bind's tokens starting with the captured ones and longer →
  `starts`; a row takes its best (`runs` over `starts`); accelerators are not matched.
- **With a find query** the section draws no plugin headers: a `groupHeader` titled `<keys printed> runs` over the
  `runs` rows, then `Starts with <keys printed>` over the `starts` rows, each header only when it has rows; chip and
  `/` still apply. No rows → the `empty` part with `query` = the printed keys.
- **Esc** (`settings.clearFilter`) clears the find query first (logs `find by key cleared`, redraws), else the text
  filter as today. `openSection` resets the chip to `all` and the find query to null.
- **Default `keyFilters` draw**: `div.settings-key-filters`, one line: `kit.keyHint(bar, 'cycleKeyFilter')`, the four
  chips as `kit.tag(bar, '<label> <count>', isOn ? 'accent' : 'neutral')`, then at the end: while recording the text
  `Press a key to find what it runs — Esc cancels` in `fg-tertiary`; with keys a `kit.tag(end, 'Finding <keys>',
  'accent')`; else `kit.keyHint(end, 'findByKey', { label: 'find by key' })`. Both hints are rows-scope anchors, which
  the placement check needs for the two new binds.

### Advanced box

- `ADVANCED_SECTIONS` drops `groups`; `advancedText` no longer shows it; `withAdvanced` keeps the layer's `groups` in
  place as it keeps `binds`, and `advancedKeyProblem('groups')` returns `"groups" belongs in the Leader menu`. The
  Advanced row's description becomes `Remaps and accelerators`.

### withMovedBind

- A user `line`: the first `binds` entry equal to `line.bind` (`isSameJson`) is dropped, then `to` is added as
  `withAddedBind` adds it (dropping every user bind sharing a half with `to`). A default `line`: `withRemovedBind`'s
  `keys` unbind entry for it, then `withAddedBind(…, to)`. The result is `tidied`.

### Keys, scopes and the layout plumbing

- `src/plugins/keymap.ts`, Settings block: `{ keys: 'f', scope: 'settings.rows', command: 'settings.cycleKeyFilter' }`
  and `{ keys: '?', scope: 'settings.rows', command: 'settings.findByKey' }`. At plan time `settings.rows` holds `j k
  gg G <CR> / <Esc> i r a d <C-n>` (measured at plan time, re-verify), no `any` bind is a plain key, and neither `f`
  nor `?` is in `VIM_KEYS` (`src/shared/vim-keys.ts`), so both need the anchors above.
- Manifest: `cycleKeyFilter: { label: 'next key filter', group: 'settings', runsIn: 'page' }`,
  `findByKey: { label: 'find by key', group: 'settings', runsIn: 'page' }`.
- `SettingsKitScope` stays `'sections' | 'rows' | 'picker'` here; `buildRow` gains a `scope: SettingsKitScope`
  argument after `rollback` (every row part passes `'rows'`), so Task 05 can draw its rows in its own scopes.
- `read-layout.ts` `LAYOUT_PARTS` gains `keyFilters`; `layout.d.ts` documents it:
  `keyFilters?(parent: HTMLElement, input: KeyFiltersInput, kit: SettingsKit): HTMLElement` — "The Keybindings section's
  first entry, into `rowList`, on each draw of its rows". `RowsInput.sectionId`'s comment: `core`, a plugin id, or
  `keymap`. `keyRow`, `leaderRow`, `advancedRow` and `groupHeader` comments say Keybindings section.
- `PickerRowInput.keys: string | null`: the printed keys `PickRequest.keysOf` returns for the row's item, null when it
  returns null or is left out. The default `pickerRow` draws them before `trailing` as `kit.kbd`, the element given
  `settings-picker-keys` (`color: var(--wg-status-warning)` in `layout.css`).
- `docs/features/layouts/design.md` § Adopters, the `settings` row: "the section list, the setting, key, leader and
  advanced rows, the Keybindings section's filter chips, the problem line, the picker rows".

## Behaviour

GIVEN the Keybindings section on the `keys.toggleHelp` row (one default bind `<Leader>?`) WHEN Enter, then `<A-o>` THEN the
`<Leader>?` line is struck, `⌥O` shows after it, and under the row `⌥O runs "next tab" everywhere: it moves here`;
WHEN Enter THEN keymap.json holds `unbind: [{ keys: '<Leader>?', scope: 'any' }]` and `binds: [{ keys: '<A-o>',
scope: 'any', command: 'keys.toggleHelp' }]`.
GIVEN a recording WHEN Space (the leader) THEN the note reads `Space is the leader — Tab types a leader sequence`,
nothing is held, and the next key is still recorded.
GIVEN a recording WHEN Tab THEN the line box opens with the held keys (empty before a press).
GIVEN a recording WHEN Esc THEN nothing is written and the row draws as before.
GIVEN a row with two binds in force WHEN Enter THEN the `Key to reassign` picker opens before recording.
GIVEN the Keybindings section WHEN `f` four times THEN the chips go Bound, Unbound, Changed, All, the Leader and Advanced
rows showing only under All.
GIVEN the Keybindings section WHEN `?` then `j` THEN the rows are every command bound to `j`, under `j runs`, and Esc clears
it.
GIVEN the Advanced box WHEN its text names `groups` THEN the box shows `"groups" belongs in the Leader menu`.

## Tests

Named per `wigley:writing-tests`: one test per behaviour, cases as table rows.

- `key-recorder.test.ts` (new), over a fake `captureKey` that hands out its `onKey` / `onCancel` and records arms and
  disposes:
  - `recorder_PressSequence_Outcome: $case` — rows over a request keyed `row` (presses → result and log lines): `t`
    then `<CR>` with `'enter'` → `keep('t')`, logs `recorded t`, `recording kept row t`; `<CR>` first → held `<CR>`, no keep;
    `<Tab>` first → `type('')`; `t`, `<Tab>` → `type('t')`; a refused press then `u`, `<CR>` → `keep('u')`, the
    refusal logged as `record refused <keys>: leader`; `<CR>` after only a refused press → no keep; `'press'` with
    `t` → `keep('t')` at once; a `moves` judgement → note held, `record moves t from p.b`. Catches: Enter or Tab
    recorded as the key once a key is held, or a refused press held.
  - `recorder_EndsAndCancels: $case` — Esc (`onCancel`) → `cancelled` runs, logs `recording cancelled row`,
    `current()` null; `cancel()` → capture disposed, no `cancelled` callback; `start` over a running one → the
    first's `cancelled` runs.
- `keymap-rows.test.ts` new `matchesKeyFilter_$filter: $case` table: a row with a firing default (bound ✓, unbound ✗,
  changed ✗), a row with no lines (unbound ✓), a user line (changed ✓), a removed default half (changed ✓, bound ✗),
  a default replaced only by another command's user bind (changed ✗), a removed accelerator (changed ✓).
- `row-filter.test.ts` new `keyMatch_$case` table with leader `<Space>`: `j` vs bind `j` → `runs`; `<Space>` vs
  `<Leader>ks` → `starts`; `<Enter>` vs `<CR>` → `runs`; a struck line → null; `k` vs `j` → null.
- `keymap-edits.test.ts`: new `withMovedBind_$case` table — a user bind → its entry replaced; a default → its unbind
  entry plus `to`; `to` onto another user bind's keys and scope → that bind dropped; a default whose page half a
  later default took → the unbind entry carries `where: 'box'`. `withAdvanced_RejectsBinds` becomes the table
  `withAdvanced_RowOwnedSection_Refused: $key` over `binds`, `leader` (`belongs in the command rows`) and `groups`
  (`belongs in the Leader menu`); `withAdvanced_KeepsRowSections` changes to a layer holding `groups` kept through
  text naming only `remaps`; new `advancedText_LeavesOutGroups`.
- `keymap-view.test.ts`: the `keyRowInput` table's `a default bind in scope any` row expects `tags: []`, and a new
  column checks `group`; new `keymapSection_KeyFilter_RowsShown: $filter` table (which row keys show, and the
  leader and advanced rows only under `all`) with a `chips` column of the four literal counts per chip under no query,
  under a `/` query and under a find query (the Leader and Advanced rows never count); new `keymapSection_FindByKey_HeadersAndRows` (headers `j runs` and
  `Starts with j`, no plugin headers); new `reassign_RecordRequest: $case` table driving the request handed to
  `recordKey` through `judge` / `keep` / `type` with a fake `RowContext` — one bind → `withMovedBind` committed;
  taken keys → `moves` note `⌥O runs "p.b label" everywhere: it moves here` (platform `macos`); the leader → refused note; `type` →
  `openBox` with the typed text; several binds → `openPicker` titled `Key to reassign` first. The existing
  `addBind opens its box under the row key and writes the bind with its argument` becomes
  `addBind_RecordsThenScopePicker_WritesTheBindWithItsArgument` (`recordKey`, then `keep`, then the `Scope` picker,
  then `commitKeymap` with the arg).
- `row-prompt.test.ts`: the table's key-row case expects `['open', 'addBind', 'removeBind', 'reset']`.
- `settings-view.test.ts`: new `keysSection_FilterKey_CyclesChipsAndLogs` (`f` ×4 logs `key filter bound`,
  `unbound`, `changed`, `all`; `f` in a schema section logs nothing); new `keysSection_FindByKey_EscClearsFirst`
  (`?` then a captured `j` logs `find by key j`; `clearFilter` logs `find by key cleared` and keeps a typed text
  filter); new `recording_EndsOnSectionOpenAndHide: $case` (`openSection` and `hidden()` each dispose the capture). New `recording_Find_SurvivesRedraw` (a `?` recording stays armed across a redraw, though key `find` is no row).
  The fake deps gain `captureKey`. `start.test.ts` gains `recording_ModeHidden_DisposesTheCapture`: over the part harness it
  arms a recording, calls the mode's `hidden`, and expects `isCapturing()` false. It uses 01's harness hooks
  (`pressCapture`, `cancelCapture`, `isCapturing`), so they have a consumer; every other test keeps the fake
  `captureKey`.
- `layout/read-layout.test.ts`: its table gains `keyFilters` if it lists the parts.

Self-test, `src/plugins/settings/main/selftest-script.ts`, group `keymap` (`KEYMAP_STEPS`), as keyboard-reach leaves
it; the section's log line stays `section keymap`. Replace the add steps and append:

- `{ keys: ['a'], expect: '[settings] recording keys.toggleHelp' }`
- `{ keys: ['Tab'], expect: '[settings] box open keys.toggleHelp', alsoExpect: [/^\[settings\] recording typed keys\.toggleHelp$/] }`
  — then the existing `[...ADDED_KEYS, 'Enter']` → `picker shown: Scope`, the scope pick, the `d` / `j Enter` remove
  and the `r` → `unchanged` steps stay as they are.
- `{ keys: ['Enter'], expect: '[settings] recording keys.toggleHelp' }`
- `{ keys: ['Escape'], expect: '[settings] recording cancelled keys.toggleHelp' }`
- `{ keys: ['Enter', ' '], expect: '[settings] record refused <Space>: leader' }`
- `{ keys: ['<A-o>'], expect: '[settings] record moves <A-o> from sessions.nextTab', checksFit: true, screenshot: 'key-recording', why: 'Next tab holds Alt+o everywhere, so the row says it moves here before the commit.' }`
- `{ keys: ['Enter'], expect: '[config] applied a new config', alsoExpect: [/^\[settings\] recording kept keys\.toggleHelp <A-o>$/], why: 'Enter keeps the recorded chord, writing the unbind and the bind. The step waits for the apply that follows the write.' }`
- `{ keys: ['r'], expect: '[config] applied a new config', why: 'r resets the help command, leaving keymap.json empty.' }`
- `{ keys: ['f'], expect: '[settings] key filter bound' }`, `{ keys: ['f'], expect: '[settings] key filter unbound' }`,
  `{ keys: ['f'], expect: '[settings] key filter changed' }`,
  `{ keys: ['f'], expect: '[settings] key filter all', screenshot: 'key-filters' }`
- `{ keys: ['Escape'], expect: '[settings] filter "" first row leader' }`
- `{ keys: ['?'], expect: '[settings] recording find' }`
- `{ keys: ['j'], expect: '[settings] find by key j', checksFit: true, screenshot: 'find-by-key' }`
- `{ keys: ['Escape'], expect: '[settings] find by key cleared' }`

The group's `why` becomes: `In the Keybindings section, a records and Tab types a key for the help command under a picked
scope, d removes it and r finds nothing to reset; Enter records a new key in place, refusing the leader and naming
the bind it moves; f cycles the filter chips and ? finds the commands a key runs.` Runtime and visual checks of the
recording row, the chips and the one-line rows defer to `07-final-verification.md`.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass, and `npm run selftest -- --plugin settings`
passes (never the whole self-test).

Commit: one commit for the group.

## Proof

