# 05 — Settings Leader menu

Status: done
Type: Task
Wave: 4 · Depends on: 01, 04
Plan: [plan.md](plan.md)

Settings mode gains the **Leader menu** section of `docs/features/settings/design.md` § Keybindings and Leader menu sections
› Leader menu: the leader tree as which-key shows it, edited in two panes, groups on the left and the selected group's
items on the right, moved between with `Alt+h` / `Alt+l` through the view's focus target. A pure module,
`leader-tree.ts`, builds the groups and items from the schema and the user layer; `leader-menu-view.ts` draws the
panes and runs their actions; every write goes through `keymap-edits.ts` and `ctx.commitKeymap`.

Re-read `settings-view.ts`, `keymap-view.ts`, `key-recorder.ts`, `start.ts`, the settings layout files and the
settings block of `keymap.ts` as Task 04 and keyboard-reach leave them; this document names members, not lines.

Files:     create `src/plugins/settings/page/leader-tree.ts` · create `src/plugins/settings/page/leader-menu-view.ts` ·
           modify `src/plugins/settings/page/settings-view.ts` · modify `src/plugins/settings/page/keymap-edits.ts` ·
           modify `src/plugins/settings/page/start.ts` · modify `src/plugins/settings/page/layout/settings-kit.ts` ·
           modify `src/plugins/settings/page/layout/read-layout.ts` · modify `src/plugins/settings/layouts/layout.d.ts` ·
           modify `src/plugins/settings/layouts/default/layout.js` · modify `src/plugins/settings/layouts/default/layout.css` ·
           modify `src/plugins/settings/manifest.ts` · modify `src/plugins/keymap.ts` ·
           modify `src/plugins/settings/main/selftest-script.ts` · modify `src/contracts/user-config.ts` ·
           modify `src/main/config/user-config.ts` · modify `src/shared/key-hints.ts` ·
           modify `src/plugins/keys/page/which-key.ts` · modify `docs/keymap.md` (the Ctrl+n list in § Layers) ·
           modify `docs/features/layouts/design.md` (the settings row of § Adopters) ·
           test `src/plugins/settings/page/leader-tree.test.ts` · test `src/plugins/settings/page/leader-menu-view.test.ts` ·
           test `src/plugins/settings/page/keymap-edits.test.ts` · test `src/plugins/settings/page/settings-view.test.ts` ·
           test `src/main/config/user-config.test.ts` · test `src/plugins/settings/page/layout/read-layout.test.ts` ·
           test every fixture that builds a `UserConfigSchema` (`defaultLeader:` in `keymap-edits.test.ts`,
           `keymap-rows.test.ts`, `keymap-view.test.ts`, `settings-view.test.ts`, `start.test.ts` under
           `src/plugins/settings/page/`; measured at plan time, re-verify with `grep -rln "defaultLeader:" src`.
           `src/main/config/user-keymap.test.ts` is not one: its `defaultLeader` is `user-keymap.ts`'s own names type)

Consumes:
- `captureKey` on the page plugin API's `keys` ← 01, reached only through Task 04's recorder.
- From 04: `withMovedBind(layer, line, to, schema)`; `KEYS_SECTION`; `RowContext.recordKey` / `recording`;
  `RecordRequest`, `Judgement`, `Recording`, `RecordingInput`; `PickRequest.keysOf` and `PickerRowInput.keys`;
  `scopeTitle`, `openScopePicker` and `ScopePickRequest` from `keymap-view.ts`; `buildRow`'s scope argument.
- From the tree: `keymapRows`, `BindLine`, `firesAnywhere`, `keymapLeader` (`keymap-rows.ts`); `withAddedBind`,
  `withRemovedBind`, `withCommandReset`, `tidied` (`keymap-edits.ts`); `vimTokens`, `normalVimKeys`,
  `formatVimKeys` (`src/shared/key-hints.ts`); `parseChord` (`src/shared/chord-notation.ts`); `commandLabel`
  (`src/shared/plugin-manifests.ts`).

Produces:
- `withGroupName(layer: UserKeymap | null, prefix: string, name: string | null): UserKeymap` in `keymap-edits.ts`:
  sets `groups[prefix] = name`, or deletes the entry for null;
  `tidied`, so an emptied `groups` drops.
- `LEADER_SECTION = { id: 'leader', title: 'Leader menu' }` in `settings-view.ts`; `sectionList()` ends
  `KEYS_SECTION, LEADER_SECTION`; `sectionFile()` returns `'keymap'` for both.
- `UserConfigSchema.defaultGroups: KeyGroups` in `src/contracts/user-config.ts`, filled in
  `src/main/config/user-config.ts` from the `defaultKeyLayers` it already builds: each layer's `groups` in layer
  order, a later layer's name replacing an earlier one's on the same prefix.
- `unnamedGroupName(commandGroups: Iterable<string | undefined>): string` in `src/shared/key-hints.ts`: the distinct
  defined groups in first-seen order joined by `, `. `which-key.ts`'s `entry` returns the bare `unnamedGroupName(…)` for an unnamed prefix (03 dropped the `+`; the layout
  draws the `›`), so which-key and the Leader menu share one fallback.
- `src/plugins/settings/page/leader-tree.ts`:
  - `LeaderItem { key: string; keys: string; line: BindLine; command: CommandInfo; arg?: CommandArg }` — `key` the
    one token after the group's prefix as the bind writes it (`d`, `<Leader>`, `;`), `keys` the bind's whole keys.
  - `LeaderEntry = { type: 'item'; item: LeaderItem } | { type: 'group'; key: string; prefix: string }`
  - `LeaderGroup { prefix: string; path: readonly string[]; name: string; isNamed: boolean; isSet: boolean;
    entries: readonly LeaderEntry[] }` — `prefix` is `<Leader>` for the top level, else `<Leader>` and the path
    (`<Leader>b`, `<Leader>zl`).
  - `leaderTree(schema: UserConfigSchema, layer: UserKeymap | null): LeaderGroup[]`
  - `KeyTaken = { type: 'item'; item: LeaderItem } | { type: 'group'; group: LeaderGroup }`
  - `keyTaken(tree: readonly LeaderGroup[], group: LeaderGroup, key: string, scope: ViewScope | null,
    moving: BindLine | null): KeyTaken | null`
  - `freeKeys(group: LeaderGroup): string[]`
  - `groupTitle(group: LeaderGroup, leader: string, platform: OsName): string`
- `src/plugins/settings/page/leader-menu-view.ts`: `createLeaderMenuView(deps: LeaderMenuDeps): LeaderMenuView`,
  with `LeaderMenuView { draw(parent: HTMLElement): void; focus(): void; blur(): void; reset(): void;
  drawnRow(key: string): BuiltRow | undefined; commands: Record<LeaderMenuCommand, () => void> }` and
  `LeaderMenuCommand = 'down' | 'up' | 'top' | 'bottom' | 'open' | 'addBind' | 'removeBind' | 'reset' | 'renameGroup'
  | 'changeKey' | 'moveToGroup'`.
- Manifest scopes `leaderGroups: 'In the leader menu groups'`, `leaderItems: 'In the leader menu items'`; commands
  `renameGroup: { label: 'rename the group', group: 'settings', runsIn: 'page' }`,
  `changeKey: { label: 'change the key', group: 'settings', runsIn: 'page' }`,
  `moveToGroup: { label: 'move to another group', group: 'settings', runsIn: 'page' }`.
- Layout parts `leaderPanes`, `leaderGroupRow`, `leaderItemRow`, `leaderAddRow` with their inputs and
  `LeaderPanesKit` (below).

## Decisions

### The tree (`leader-tree.ts`, pure)

- **Which binds**: every line of `keymapRows(schema, layer)` that `firesAnywhere`, whose keys' first token
  (`vimTokens(keys, '<Leader>')`) is `<Leader>` ignoring case, and that has at least one token after it. Each keeps
  its row's `command` and `arg`. A removed or displaced default is left out, as which-key leaves it out.
- **Groups**: a group is a prefix some bind runs past: for tokens `[<Leader>, t1 … tn]` every `[t1 … tk]` with
  `1 ≤ k < n`, plus every prefix the user layer's `groups` names (an empty group the user added). A default `groups`
  entry with no bind past it is not listed (which-key shows none). Tokens compare through `normalVimKeys` (`<CR>` and
  `<Enter>` are one key); the first spelling seen is kept.
- **Top level**: always first, `prefix` `<Leader>`, `path` `[]`, name `Top level`, `isNamed` false, never set.
- **Name** of any other group: the user's `groups[prefix]`, else `schema.defaultGroups[prefix]` (`isNamed` true for
  either, `isSet` true for the user's), else `unnamedGroupName` over the `CommandInfo.group` of every item under the
  prefix at any depth, in the tree's order (`isNamed` false). Prefixes match through `normalVimKeys`.
- **Entries** of a group: every item whose keys are the prefix plus one token, and one `group` entry per nested group
  directly under it, sorted by key, an item before a group on the same key, items on one key by scope: `any` first,
  then the scopes in `schema.scopes` order, then unknown scopes by id. So `<Leader><Leader>` in forms and in the
  primer is two top-level items on the one key, each with its scope tag.
- **Key order**: a letter before anything else, compared case-insensitively with the lowercase one first
  (`a A b B …`); then digits; then other single characters by code point; then `<…>` tokens by text.
- **Group order**: Top level, then every group depth-first, children in key order, so `zl` follows `z`'s own place.
- **`keyTaken`**: in `group`, the first item on `key` (through `normalVimKeys`) whose line is not `moving` and whose
  scope overlaps `scope` — two scopes overlap when equal or either is `any`; `scope` null (no scope chosen yet) is
  overlapped only by an `any` item — else a nested group on `key`; else null.
- **`freeKeys`**: `a`…`z`, then `0`…`9`, each with no entry on it in any scope. Uppercase is not offered (an
  uppercase key is a variant of its lowercase one, `docs/keymap.md` § Layers); recording still takes it.
- **`groupTitle`**: `Top level`, else `<path printed with formatVimKeys> — <name>` (`b — session`, `z l — layout
  previews`).

### The panes (`leader-menu-view.ts`)

- **Seam with `settings-view.ts`**: settings-view creates the view once with `LeaderMenuDeps { context: RowContext;
  drawPanes; drawRow; anchor; setScope(scope: 'leaderGroups' | 'leaderItems'): void; setFocusTarget(target:
  FocusTarget): void; log }`. While `openSectionId === LEADER_SECTION.id`: `drawRows` hands the rows pane's
  `rowList` to `leaderMenu.draw` in place of the entry loop (settings-view's own `rows` list is empty); its rows-focus
  path (`focusRows`, which `SettingsView.focusMain` runs) still sets `focus = 'rows'` and logs `rows focused`, but
  calls `leaderMenu.focus()` in place of `setScope('rows')` and its own focus target; `focusSections` calls
  `leaderMenu.blur()`; `openSection` of the Leader menu calls `leaderMenu.reset()`. `showBox`, the box move in `draw`,
  its row-gone check and the recording's leaves-the-rows cancel find the row through `leaderMenu.drawnRow(key)` there,
  `drawnRows` elsewhere: the Leader menu's row keys (`group top`, `item …`, `add …`) live only in the view, so a literal
  `rows.some(key)` check would cancel every recording on its first redraw.
  `markCursor` leaves the leader panes to the view.
- **Routing**: with the Leader menu open and `focus === 'rows'`, `settings-view`'s `down`, `up`, `top`, `bottom`,
  `open`, `addBind`, `removeBind` and `reset` commands run `leaderMenu.commands` of the same name (behind the same
  open-box / picker / recording guard); `renameGroup`, `changeKey` and `moveToGroup` run only there. `edit`, `filter`
  and `clearFilter` do nothing in the Leader menu, and `/` does nothing while it is open, whichever pane holds the keys
  (`settings.filter` from the side bar opens no box: `openFilter` is a no-op whenever `openSectionId` is `leader`, since a
  filter box that filters nothing is a dead state). The rows pane's filter hint is hidden while it is open
  (`buildRowsPane` sets `hidden` on the hint when `input.sectionId === 'leader'`).
- **Focus**: the view holds `pane: 'groups' | 'items'` (`groups` after `reset`). `focus()` sets the scope of `pane`,
  hands its target, focuses the pane's list element, logs `leader groups focused` / `leader items focused` when the
  pane holding the keys changes. Its target: groups + `right` → items, true; items + `left` → groups, true; every
  other move false, so `Alt+h` from the groups reaches the side bar through the core (keyboard-reach's `focusSideBar`),
  and `Alt+l` from the side bar returns through `focusMain` to the pane last focused. The view never binds `Alt+hjkl`.
- **Cursors**: one per pane, by row key, kept across redraws; a row that leaves the list hands its cursor to the row
  now in its place, as `drawRows` does. The items pane always shows the groups cursor's group. Each move logs
  `cursor <row key>`. After an edit that moves or adds a bind, the cursor follows it: the groups cursor to its group,
  the items cursor to its new row key. The follow target is set only on the `written` result of `commitKeymap`; a
  `refused` or `changedOnDisk` result or a failed write sets none, so no unrelated redraw applies a stale one.
- **Row keys** (cursor and log lines, box keys, recording keys): Top level `group top`; any other group
  `group <prefix>`; an item `item <scope> <keys>`, with ` set` appended for a user bind (a default's surviving half and
  a user bind can share keys and scope); a nested group row `opens <prefix>`; the add row `add <prefix>`.
- **Groups pane rows** (`leaderGroupRow`): j / k / gg / G move. Enter focuses the items pane, its cursor on the first
  row. `R` (`renameGroup`, not on Top level): a line box on the row, text the name in force when `isNamed`, else
  empty; accept: the trimmed text empty, or equal to `schema.defaultGroups[prefix]`, commits `withGroupName(layer,
  prefix, null)`, else `withGroupName(layer, prefix, text)`, via `{ box }`. `a` (`addBind`, on every group row):
  records the new group's key under the cursor group, then opens a line box on that row (its key the row's key, text
  empty); accept: empty closes the box and writes nothing, else commits `withGroupName(layer, <prefix + key>,
  name)` via `{ box }` and the cursor follows to the new group. `d` (`removeBind`, not on Top level): a group with
  entries toasts `Move or clear its items first` (tone `info`) and logs `group has items <prefix>`; an empty group
  commits `withGroupName(layer, prefix, null)`.
- **Items pane rows**: each entry in order, then the add row. On an item (`leaderItemRow`): Enter
  (`open`) = change action; `c` change key; `d` clear (`withRemovedBind(layer, line, schema)`); `m` move to group;
  `r` reset (`withCommandReset(layer, command.id, schema, arg)`: a moved default is an unbind and a bind, which reset
  only as a pair, so reset works on the item's command as the Keybindings section's does). On a nested group row
  (`leaderItemRow`, `kind: 'group'`): Enter moves the groups cursor to that group (focus stays in the items, cursor on
  its first row). On the add row (`leaderAddRow`) Enter, and `a` anywhere in the items pane, adds.
- **Cursor prompts** (anchors the view makes once per pane, as `settings-view` does for the rows, placed in the
  cursor row's `rowActions` slot): Top level `a add group`; any other group `R rename  a add group  d remove`; an item
  `↩ change action  c change key  d clear  m move to group  r reset`; a nested group row `↩ open`; the add row
  `↩ add`. The `R`, `c`, `m`, `a`, `d` and `r` anchors are what the placement check needs for the new binds.
- **Pickers**: `Action` lists the page command rows of `keymapRows` (core first, then by plugin, in their order),
  label the row's `label` capitalised (`<command label>: <commandArgLabel(arg)>` on an arg row); `keysOf` returns, for a row
  with a line in force under the leader, its first such line's keys printed with `formatVimKeys`, else null, drawn in
  `status-warning` by Task 04's `pickerRow`. `Group` lists every group but the item's own, Top level first, label
  `groupTitle`. `Scope` is 04's `openScopePicker`.
- **Add** (the add row's Enter or `a` in the items pane): records the item key in the selected group (below), then the
  `Action` picker. A chosen row with a line in force under the leader moves that line (`moving`): the scope picker
  preselects `moving.bind.scope`, and the pick commits `withMovedBind(layer, moving, { ...moving.bind, keys,
  scope })`. Any other row: preselects the scope of the row's first default bind, else `any`, and commits
  `withAddedBind(layer, { keys, scope, command, ...arg }, schema)`. Both via `{ expectedText }`; `keys` is the
  group's prefix plus the recorded key.
- **Change action** (Enter on an item): the `Action` picker, preselecting the item's row; the pick commits
  `withMovedBind(layer, line, { ...line.bind, command: row.command.id, arg: row.arg })` (no `arg` member when the row
  has none), keeping the key and scope; the item's own row picked writes nothing. A picked row with another line in
  force under the leader (`moving` in Add's terms, not this item's line) rebinds this item to the picked command and
  removes that command's other leader bind, as Add does: one leader path per command. The `status-warning` key in the
  picker names the bind that will go. The edit is the item's `withMovedBind`, then `withRemovedBind` of the other line
  on the result.
- **Change key** (`c`): records a key in the item's group with `scope` the item's scope and `moving` its line; commits
  `withMovedBind(layer, line, { ...line.bind, keys: prefix + key })`. A key equal to the line's own keys writes nothing
  and closes the recording, as Keybindings' reassign does.
- **Move to group** (`m`): the `Group` picker, then records the key in the chosen group with the item's scope and
  line; commits `withMovedBind` to the chosen prefix plus the key.
- **Recording an item or group key**: a `RecordRequest` with `confirm: 'press'`, no `type`, `replacing: null`, `key`
  the row it draws on (the add row for add, the item row for change key and move, the cursor group row for add
  group). Prompts: add `Press the new item's key — Esc cancels`; change key `Press its new key — Esc cancels`; move
  `Press its key in <groupTitle> — Esc cancels`; add group `Press the new group's key — Esc cancels`. A press with `normalVimKeys(keys) === normalVimKeys(leader)` (`leader` the leader in force, raw) is the key
  `<Leader>`. `judge`, in order:
  - a chord (`parseChord` of the token not null) → refused, reason `chord`, note `A leader item is one key with no
    Ctrl, Alt or Cmd`
  - `keyTaken(…)` a group → refused, reason `group`, note `<full keys printed> opens the <name> group`
  - `keyTaken(…)` an item → refused, reason `taken`, note `<full keys printed> already runs "<label>"`, then
    ` in <scope title>` when the item's scope is not `any` (`commandLabel`, `scopeTitle`)
  - else free.
  For add, `keyTaken`'s `scope` is null; for add group it is `'any'` (a key cannot be both a bind and a prefix), so any
  item on the key refuses; for change key and move it is the item's scope. The recording draws on its row through
  the row input's `recording` (`RecordingInput`, as Keybindings rows read `ctx.recording()`).

### Layout

`layout.d.ts`, `read-layout.ts`'s `LAYOUT_PARTS` and `default/layout.js` gain:

- `leaderPanes?(parent: HTMLElement, input: LeaderPanesInput, kit: LeaderPanesKit): SettingsPane` — the Leader menu,
  drawn into the rows pane's `rowList` once per draw of its rows; `LeaderPanesInput { focused: 'groups' | 'items';
  itemsTitle: string }` (`itemsTitle` is the selected group's `groupTitle`). `LeaderPanesKit extends SettingsKit {
  groupsKit: SettingsKit; itemsKit: SettingsKit; groupRows(parent: HTMLElement): HTMLElement; itemRows(parent:
  HTMLElement): HTMLElement }` — `groupsKit` / `itemsKit` are the base kit in the `leaderGroups` / `leaderItems`
  scope, for edges and hints that show only while their pane holds the keys; `groupRows` is
  `ol.settings-leader-groups` and `itemRows` `ol.settings-leader-items`, slots the app fills on each draw and marks
  `is-pane-inactive` while the other pane (or the side bar) holds the keys. Default: root `li.settings-leader`, a
  two-column grid (`grid-template-columns: minmax(10rem, 14rem) minmax(0, 1fr)`, gap `--wg-space-3`); the groups
  column a `sectionHeader` `Groups` with `groupsKit.edge(…, 'panes.focusLeft', { side: 'start', chevron: '‹
  sections' })` and `groupsKit.edge(…, 'panes.focusRight', { side: 'end', label: 'items' })`, then `groupRows`; the
  items column a `sectionHeader` reading `itemsTitle` with `itemsKit.edge(…, 'panes.focusLeft', { side: 'start',
  chevron: '‹ groups' })`, then `itemRows`. The rows pane's own `‹ sections` edge is a rows-scope anchor, hidden here.
- `leaderGroupRow?(parent, input: LeaderGroupRowInput, kit: RowKit): HTMLElement` — `LeaderGroupRowInput { prefix:
  string; key: string; name: string; isNamed: boolean; isSet: boolean; depth: number; count: number; recording:
  RecordingInput | null }`: `key` the last path token printed (empty on Top level), `depth` `path.length - 1` (0 for
  Top level), `count` the group's entries. Default: one line, indented `depth` steps, the key as Kbd, the name (an
  unnamed group's in `fg-tertiary`), a `Set` tag when `isSet`, the count at the end in `fg-tertiary`, the actions
  slot, then the box slot.
- `leaderItemRow?(parent, input: LeaderItemRowInput, kit: RowKit): HTMLElement` — `LeaderItemRowInput { kind:
  'command' | 'group'; key: string; label: string; command: string | null; tags: readonly string[]; recording:
  RecordingInput | null }`: `key` the item's token printed (`<Leader>` prints as the leader, `Space`); `label` the
  command's label capitalised (a leader item takes no label of its own), or a nested group's name; `command` the
  qualified id with its arg as `commandTarget` prints it, null on a group row; `tags`: the scope's title when not
  `any`, `in a box` when the editor half fires and the page half does not, `Set` for a user bind. Default: the key as
  Kbd, the label, the command dim (`fg-tertiary`, mono), the tags, a nested group's label followed by `›`, the
  actions slot, the box slot, the recording drawn as Task 04's key rows draw it.
- `leaderAddRow?(parent, input: LeaderAddRowInput, kit: RowKit): HTMLElement` — `LeaderAddRowInput { freeKeys:
  readonly string[]; recording: RecordingInput | null }`, the free keys printed. Default: `add…` then the free keys
  space-joined in mono `fg-tertiary`.
- `SettingsKitScope` gains `'leaderGroups' | 'leaderItems'`; the leader rows are drawn through `buildRow` with their
  pane's scope; `buildLeaderPanes` (new, in `settings-kit.ts`, beside `buildRowsPane`) makes the slots and the two
  scoped kits.
- `docs/features/layouts/design.md` § Adopters, the `settings` row adds "the Leader menu's panes, group, item and add
  rows".

### Keys (`src/plugins/keymap.ts`)

- The Settings block's `(['settings.sections', 'settings.rows'] as const).flatMap` keeps `/` and `<Esc>` for those two
  scopes; `j`, `k`, `gg`, `G` and `<CR>` (`settings.down`, `up`, `top`, `bottom`, `open`) are bound in
  `settings.sections`, `settings.rows`, `settings.leaderGroups` and `settings.leaderItems`.
- `settings.leaderGroups`: `a` → `settings.addBind`, `d` → `settings.removeBind`, `R` → `settings.renameGroup`.
- `settings.leaderItems`: `a` → `settings.addBind`, `c` → `settings.changeKey`, `d` → `settings.removeBind`, `m` →
  `settings.moveToGroup`, `r` → `settings.reset`.
- Both new scopes join the `<C-n>` → `chat.startNewSession` scope list; `docs/keymap.md` § Layers' Ctrl+n list reads
  "the Settings sections, rows and Leader menu panes".
- Both scopes are new, so nothing else binds in them; no `any` bind is a plain key, and `R`, `c`, `m` are not in
  `VIM_KEYS` (measured at plan time, re-verify), hence the prompt anchors above.

## Behaviour

GIVEN the Leader menu on group `b` WHEN `c` on `<Leader>bd` then `n` THEN the row says `Space b n already runs "new
session"` and the recording goes on; WHEN `q` THEN keymap.json holds the unbind of `<Leader>bd` and a bind of
`<Leader>bq` to `sessions.closeSession`, and the cursor is on that row.
GIVEN the groups pane WHEN `d` on a group with items THEN `Move or clear its items first` shows and nothing is
written.
GIVEN the groups pane on Top level WHEN `a`, `q`, then `quick` Enter THEN `groups` holds `"<Leader>q": "quick"` and
the empty group is listed under Top level.
GIVEN an item WHEN `m`, a group, then a key THEN the bind moves there and the cursor follows it.
GIVEN the add row WHEN a key, then a command already bound under the leader THEN that bind moves instead of a second
being added.
GIVEN an item `<Leader>bd` WHEN Enter, then a command whose bind is `<Leader>bn` THEN `<Leader>bd` runs the picked
command, `<Leader>bn` is gone, and the picker showed `Space b n` in `status-warning` beside that command.
GIVEN the Leader menu open WHEN `/` is pressed, from either pane or the side bar, THEN no filter box opens.
GIVEN the groups pane WHEN `Alt+l` THEN the items pane holds the keys; WHEN `Alt+h` twice THEN the groups, then the side
bar.

## Tests

- `leader-tree.test.ts` (new), over a small schema and layer:
  - `leaderTree_GroupsAndOrder` — binds `<Leader>bd`, `<Leader>bn`, `<Leader>zg`, `<Leader>zlo`, `<Leader>;` →
    prefixes `<Leader>`, `<Leader>b`, `<Leader>z`, `<Leader>zl` in that order, `<Leader>z`'s entries `g` then the
    `l` group.
  - `leaderTree_GroupName: $case` — the user's entry (`isSet`), a default entry, none (the joined manifest groups),
    Top level.
  - `leaderTree_Listed: $case` — a removed default (left out), a user `groups` entry with no binds (listed, no
    entries), a default `groups` entry with no binds (not listed).
  - `leaderTree_KeyOrder` — keys `d D a 1 ; <Leader>` sort `a d D 1 ; <Leader>`.
  - `leaderTree_OneKeyInTwoScopes_TwoItemsInScopeOrder` — `<Leader><Leader>` in two scopes, `any` first otherwise.
  - `keyTaken_$case` — scope null vs an `any` item (taken) and vs a scoped item (free); equal scopes; `any` vs a
    scope; the `moving` line itself (free); a nested group (group).
  - `freeKeys_ListsUnusedLettersThenDigits`.
- `leader-menu-view.test.ts` (new), over a fake `RowContext` and fake draw deps, as `keymap-view.test.ts` fakes the
  context:
  - `leaderMenu_FocusTarget_MovesBetweenPanes: $pane $direction` — groups right → items, true; items left → groups,
    true; groups left, items right, up, down → false; scopes set `leaderItems` / `leaderGroups`.
  - `leaderMenu_ItemEdit_Commits: $case` — change action, change key, move to group, clear, reset, each asserting the
    literal layer handed to `commitKeymap`, not the pure functions' result, since the view's job is choosing their
    arguments. Literal rows: `c` on default `<Leader>bd` (`sessions.closeSession`, scope `any`) then `q` →
    `{ unbind: [{ keys: '<Leader>bd', scope: 'any' }], binds: [{ keys: '<Leader>bq', scope: 'any', command:
    'sessions.closeSession' }] }`; move `<Leader>bd` to Top level with `q` → the same with keys `<Leader>q`; change
    action on a user bind carrying `arg` to a row with no `arg` → the entry without an `arg` member; change key onto the
    line's own keys → no `commitKeymap` call.
  - `leaderMenu_ChangeAction_MovesAnAlreadyBoundCommand` — item `<Leader>bd`, picked command bound at `<Leader>bn` →
    the literal layer holds the unbind of `<Leader>bn`, the unbind of `<Leader>bd` and a bind of `<Leader>bd` to the
    picked command; the picker's `keysOf` printed `Space b n`.
  - `leaderMenu_Add_MovesAnAlreadyBoundCommand` and `leaderMenu_Add_AddsAnUnboundCommand`.
  - `leaderMenu_Commit_FollowsTheCursorOnlyWhenWritten: $result` — `written` sets the follow target; `refused`,
    `changedOnDisk` and a rejected write leave the cursor where it was after the next redraw.
  - `leaderMenu_RecordJudgement: $case` — chord, group, taken in `any`, taken in a scope with the scope's title, free;
    each note text pinned above.
  - `leaderMenu_GroupEdit: $case` — rename to a name; rename to empty and to the default name (entry removed); add
    group; `d` on a group with items toasts `Move or clear its items first` and commits nothing; `d` on an empty group.
  - `leaderMenu_CursorFollowsTheMovedBind`.
- `keymap-edits.test.ts` new `withGroupName_$case` table: set on no layer, replace, remove one of two, remove the last
  (no `groups` member left).
- `settings-view.test.ts`: new `sectionList_EndsKeysThenLeaderMenu`; new `leaderMenu_Routing_CommandsReachTheView`
  (with the Leader menu open, `down` and `renameGroup` reach the leader view's commands; `filter` opens nothing, also
  from the side bar). A second test, `leaderMenu_Recording_SurvivesRedraw`, starts a recording on an item row and redraws:
  the recording is still running (the leaves-the-rows cancel asks `drawnRow`).
- `user-config.test.ts` new `schema_DefaultGroups_LaterLayerNameWins`.
- `which-key.test.ts` (keys plugin) runs unchanged over the extracted `unnamedGroupName`; its five bare-label rows are
  03's.
- `layout/read-layout.test.ts`: its table gains the four parts if it lists them.

Self-test, `src/plugins/settings/main/selftest-script.ts`. With the Leader menu last in the side bar, every step that
reaches Keybindings with `G` presses `k` after it: keyboard-reach's side bar group step `['<A-h>', 'G', 'l']` becomes
`['<A-h>', 'G', 'k', 'l']`, and the keymap group's first step `['Escape', '<A-h>', 'G', 'Enter']` becomes
`['Escape', '<A-h>', 'G', 'k', 'Enter']`, both still expecting `[settings] section keymap`. Add
`KEYMAP_FILE = '.config/wigley-ai-gui/keymap.json'` beside `SETTINGS_FILE`, and two groups after `keymap`, before
`timeout reset` (whose first `<A-h>` then starts from the groups pane):

`leader groups` (`why`: `In the Leader menu, a adds a named empty group and d removes it, R renames a group and an
empty name removes the entry, and d refuses a group with items.`):
- `{ keys: ['<A-h>', 'G', 'Enter'], expect: '[settings] section leader', alsoExpect: [/^\[settings\] leader groups focused$/], checksFit: true, screenshot: 'leader-menu' }`
- `{ keys: ['a'], expect: '[settings] recording group top' }`
- `{ keys: ['b'], expect: '[settings] record refused b: group' }`
- `{ keys: ['q'], expect: '[settings] box open group top' }`
- `{ keys: [...'quick', 'Enter'], expect: '[settings] wrote keymap.json', alsoExpect: [/^\[settings\] cursor group <Leader>q$/] }`
- `{ keys: ['R'], expect: '[settings] box open group <Leader>q' }`
- `{ keys: [...'quiet', 'Enter'], expect: '[settings] wrote keymap.json' }`
- `{ keys: ['d'], expect: '[settings] wrote keymap.json', why: 'The empty group loses its only entry, leaving keymap.json empty.' }`
- `{ keys: ['g', 'g', 'j'], expect: '[settings] cursor group <Leader>a' }`
- `{ keys: ['d'], expect: '[settings] group has items <Leader>a' }`
- `{ keys: ['j', 'R'], expect: '[settings] box open group <Leader>b' }`
- `{ keys: [...'sessions', 'Enter'], expect: '[settings] wrote keymap.json' }`
- `{ keys: ['R', 'Backspace', 'Enter'], expect: '[settings] wrote keymap.json', why: 'An empty name removes the user entry, leaving keymap.json empty.' }`

`leader items` (`why`: `On session's items, c changes a key, refusing one the group holds, r resets it, m moves an
item to the top level and d clears it, a records a new item's key and opens the action picker, and Alt+h and Alt+l
move between the panes and the side bar.`):
- `{ keys: ['Enter'], expect: '[settings] leader items focused', alsoExpect: [/^\[settings\] cursor item any <Leader>bd$/] }`
- `{ keys: ['c'], expect: '[settings] recording item any <Leader>bd' }`
- `{ keys: ['n'], expect: '[settings] record refused n: taken', screenshot: 'leader-key-taken' }`
- `{ keys: ['q'], expect: '[config] applied a new config', alsoExpect: [/^\[settings\] cursor item any <Leader>bq set$/] }`
- `{ keys: ['r'], expect: '[config] applied a new config' }`
- `{ keys: ['g', 'g'], expect: '[settings] cursor item any <Leader>bd' }`
- `{ keys: ['m'], expect: '[settings] picker shown: Group' }`
- `{ keys: ['Enter'], expect: '[settings] recording item any <Leader>bd', why: 'Top level is the first group listed.' }`
- `{ keys: ['q'], expect: '[config] applied a new config', alsoExpect: [/^\[settings\] cursor item any <Leader>q set$/] }`
- `{ keys: ['d'], expect: '[config] applied a new config', why: 'Clearing the moved user bind leaves the unbind of Space b d behind.' }`
- `{ writeFile: { path: KEYMAP_FILE, text: '{}' }, keys: [], expect: '[settings] redrawn', why: 'An outside write empties keymap.json again.' }`
- `{ keys: ['a'], expect: '[settings] recording add <Leader>' }`
- `{ keys: ['q'], expect: '[settings] picker shown: Action' }`
- `{ keys: ['Escape', 'G'], expect: '[settings] cursor add <Leader>', why: 'Esc closes the action picker writing nothing; G reaches the add row.' }`
- `{ keys: ['<A-h>'], expect: '[settings] leader groups focused' }`
- `{ keys: ['<A-h>'], expect: '[settings] sections focused' }`
- `{ keys: ['<A-l>'], expect: '[settings] leader groups focused', why: 'Alt+l from the side bar returns to the pane last focused.' }`

The keys in these steps rest on Task 02's tree (`b` holds `n r d s X p h`, `a` is the first group, `q` is free at the
top level and under `b`); re-verify against `docs/keymap.md` § Leader groups. The script's result still resolves in
`timeout reset` with both layers empty. Runtime and visual checks of the two panes, the recording rows and the
`status-warning` keys in the `Action` picker defer to `07-final-verification.md`.

Done when: `npm run typecheck`, `npm run lint` and the tests above pass, and `npm run selftest -- --plugin settings`
passes (never the whole self-test).

Commit: one commit for the group.

## Proof

Commit 66d3cf28 · proof: diff read (defaultGroups, unnamedGroupName, withGroupName, LEADER_SECTION, leader-tree, leader-menu-view present) + typecheck clean; settings selftest all passed per worker; settings-leader-menu.png read · concerns: cosmetic: recording row prompt and command columns wrap narrowly, groups header blank space, long command ids wrap mid-word (left for 07); one npx vitest run on the local dev dependency, nothing installed
