# 03 — Which-key shelf (A3) and leader search

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Re-read every file below before editing: keyboard-reach lands first and changes `keymap.ts` and the keys help.
Members and banner sections are named here; line numbers were measured at plan time, re-verify.

Files:     modify `src/plugins/keys/page/which-key.ts` · modify `src/plugins/keys/page/which-key-view.ts` (its
           comment) · modify `src/plugins/keys/page/keys.css` (`.ui-floating.which-key`) · modify
           `src/plugins/keys/page/start.ts` · modify `src/plugins/keys/manifest.ts` · modify
           `src/plugins/keys/layouts/layout.d.ts` · modify `src/plugins/keys/layouts/default/layout.js` · modify
           `src/plugins/keys/layouts/default/layout.css` · modify `src/plugins/keys/page/layout/keys-parts.ts` ·
           modify `src/plugins/keys/page/layout/read-keys-layout.ts` · create `src/plugins/keys/page/leader-search.ts`
           · modify `src/plugins/keymap.ts` (`// ── Help ──` banner section) · modify
           `src/plugins/forms/main/selftest-script.ts` · modify `docs/features/layouts/design.md` (§ Adopters, the
           `keys` row) · test `src/plugins/keys/page/which-key.test.ts` · test
           `src/plugins/keys/page/leader-search.test.ts` (create) · test `src/plugins/keys/page/start.test.ts` · test
           `src/plugins/keys/page/layout/keys-parts.test.ts`
Consumes:  the `<Leader>b` group named `session` ← 02 (the self-test step). `services.picker`
           (`ListPickerService`, `src/contracts/list-picker.ts`), `PluginCommands.run`, `formatKeys`, `joinKeys`
           (`src/shared/key-hints.ts`), `pageKeysFor` (`src/shared/key-notation.ts`) from the tree.
Produces:  `keys.searchLeader` — page command in the keys manifest, no argument, group `help`, label "Search leader
           actions"; bound `<Leader>/`, scope `any` (plan.md File Structure, word for word)
           `name: string | null` on `WhichKeyModel` (`which-key.ts`) and on `WhichKeyInput` (`layout.d.ts`)
           `export function leaderActions(keymap: Keymap, scope: ViewScope, label: CommandLabel, platform: OsName):
           LeaderAction[]` and `export interface LeaderAction { command: CommandId; arg?: CommandArg; label: string;
           keys: string }` in `src/plugins/keys/page/leader-search.ts`
           `leaderSearchRow?(parent: HTMLElement, input: LeaderSearchRowInput, kit: KeysKit): HTMLElement` on
           `Layout`, `export interface LeaderSearchRowInput { label: string; keys: string }` in `layout.d.ts`, and
           `leaderSearchRow(parent: HTMLElement, input: LeaderSearchRowInput): Drawn` on `KeysParts`

## Decisions

### The shelf (A3, `docs/features/leader-keys/design.md` § The popup)

- **Placement is the app's** (the contract keeps "the which-key panel's placement"): `keys.css`
  `.ui-floating.which-key` becomes a full-width shelf on the window's bottom edge, over the content and over the
  status bar: `bottom: 0; left: 0; right: 0;`, top corners rounded `border-radius: var(--wg-radius-lg)
  var(--wg-radius-lg) 0 0;`, and only the top edge drawn (`border-bottom: 0; border-left: 0; border-right: 0;`).
  Keep `position: fixed`, `max-height: 50vh`, `overflow: hidden`, `pointer-events: none !important` and the
  `z-index`. The glass is `floatingPanel()`'s `material-floating` as today; nothing new draws the material. Update
  the comments in `keys.css` and on `mountWhichKeyView` ("docked above the status bar while it shows…") to say
  this. `mountWhichKeyView`'s code does not change.
- **The look is the `default` layout's** (`layout.js` `whichKey` and `whichKeyEntry`, `layout.css`):
  - `whichKey` draws `div.which-key-pane` holding `div.which-key-header`, then `div.which-key-list`. The header is
    `kit.kbd(header, input.title)` followed, when `input.name` is not null, by `span.which-key-name` holding the
    name sentence-cased: `Space b` then `Session`. No `kit.sectionHeader`.
  - `whichKeyEntry` draws `div.which-key-entry.is-<kind>` holding `kit.kbd(entry, input.keys)` then
    `span.which-key-label` (the label sentence-cased) and, for `kind` `prefix` only, `span.which-key-more` holding
    `›`. No `kit.row`, no key-cap box, no count, no icon.
  - Sentence case is a helper in `layout.js`: the first character upper-cased, the rest as written
    (`new session` → `New session`, `Search leader actions` unchanged). It is the layout's choice, so the model and
    the log keep the keymap's own text.
  - `layout.css`: `.which-key-pane { padding: var(--wg-space-3) var(--wg-space-4) var(--wg-space-4); }`;
    `.which-key-header { display: flex; gap: var(--wg-space-3); align-items: baseline; margin-bottom:
    var(--wg-space-2); }`; `.which-key-name { color: var(--wg-fg); font-weight: var(--wg-weight-medium); }`;
    `.which-key-list { columns: calc(var(--wg-space-8) * 7) 4; column-gap: var(--wg-space-6); }` (up to four
    columns, each at least the width the list uses today); `.which-key-entry { display: flex; gap:
    var(--wg-space-3); align-items: baseline; break-inside: avoid; padding: var(--wg-space-1) 0; }`;
    `.which-key-entry .ui-kbd { min-width: calc(var(--wg-space-8) * 2); }` (the Kbd primitive already draws
    `fg-tertiary` `font-mono`); `.which-key-entry.is-command .which-key-label { color:
    var(--wg-keys-which-key-command); }`; `.which-key-entry.is-prefix .which-key-label, .which-key-entry.is-prefix
    .which-key-more { color: var(--wg-keys-which-key-prefix); }`. Drop the old `.which-key-row` rules. Every value
    is a token or `0`, so `scripts/check-styles.mts` (in `npm run lint`) passes.
  - Theme token defaults in `keysManifest.themeTokens`: `which-key-command` → `var(--wg-fg-secondary)` (a single
    action's label); `which-key-prefix` → `var(--wg-accent)` (a group's label and its `›`). The design: "No counts,
    icons or accent until a row is a group", read as accent on group rows only.
- **The model's prefix label drops its `+`**: `entry` in `which-key.ts` returns the bare group name (`session`),
  or without a `groups` name the joined command groups (`questions, review`); the layout draws the `›`. Every
  consumer of `WhichKeyEntry.label` / `WhichKeyEntryInput.label` (measured at plan time, re-verify with `grep -rn
  "kind: 'prefix'\|which-key-row\|WhichKeyInput" src`): `which-key.ts`, `layout.d.ts`, `layouts/default/layout.js`,
  `layouts/default/layout.css`, `which-key.test.ts` (the five `+…` rows), `keys-parts.test.ts`
  (`setLayouts_WhichKeyShown_PanelUnchangedNextShowUsesNewSet`'s model, already bare). A user layout in
  `~/.config/wigley-ai-gui/layouts/keys/` that prints the `+` is the user's to edit (AGENTS.md § Intent, one user,
  no backwards compatibility).
- **The header's name**: `WhichKeyModel` gains `name: string | null`, the `groups` name of the pending keys
  themselves (`groupName(pending.keys, groups)`, the function `which-key.ts` already has), null when the pending
  keys are no named prefix (the bare leader, an unnamed prefix). `WhichKeyInput` gains the same member, documented
  in `layout.d.ts`. `title` stays the keys alone, so the log line `which-key shows <title>` and every self-test step
  that waits on it are unchanged (`[keys] which-key shows Space`, `[keys] which-key shows Space z`).
- **Esc** cancels the sequence as today; no back step (plan.md Decisions).

### Leader search (`Space /`)

- **Command and bind**: `keysManifest.commands.searchLeader: { label: 'Search leader actions', group: 'help', runsIn:
  'page' }`. In `keymap.ts`'s `// ── Help ──` section, after `<Leader>?`: `{ keys: '<Leader>/', scope: 'any',
  command: 'keys.searchLeader' }`. It is a leader bind, so it fires on the page and, in vim normal mode, in a box;
  which-key shows it as the `/` entry and the placement check leaves it out.
- **Which binds count** — settled: the page binds (`keymap.page`) whose first key is the leader's page key
  (`pageKeysFor('<Leader>', keymap.editor.leader)[0]`) and whose scope is the scope in force or `any`, leaving out
  `keys.searchLeader` itself. The scope is `keys.scope()` read when the command runs, before the picker pushes
  its own scope. The same list opens from a box: a leader bind with no `where` expands into both a page and a box
  bind, so the box's leader actions are on it; box-only binds (`where: 'box'`, such as forms' `Space a 1`…`a 9` and
  chat's `Space c m`) are left out, since the picker takes focus from the box and a box command run from it would
  act on no box. This is `leaderActions` in `leader-search.ts`, pure, so its test owns the rule.
- **Rows**: one row per command and argument (`arg` compared by value: a number, a string, or a record compared
  field by field), in keymap order of its first bind. `label` is `label(command)` (the `keys.label` the part
  already has); `keys` is each of the row's binds printed by `formatKeys(bind.keys, platform)` and joined by
  `joinKeys`: `sessions.closeSession` reads `Space ; / Space b d`.
- **Picker**: `start.ts` creates one picker at start, `services.picker.create({ filter: true })`, under the keys
  plugin's new scope `picker` (`keysManifest.scopes.picker: 'In the leader search'`). `searchLeader` opens it with
  `title: 'Leader actions'`, `items: leaderActions(...)`, `label: (action) => action.label`, `headerEnd`: an element
  anchored to `keys.pickerFilter` in scope `keys.picker` with the label `filter` (the notes popup's
  `pickerFilterHint` pattern; it places the `/` bind for the placement check), and `drawRow: (list, action) =>
  parts.leaderSearchRow(list, { label: action.label, keys: action.keys })`. Then it calls `focusFilter()`: a search
  is typed, so the filter has the keys on open; Esc in the filter returns to the list, where the list keys work,
  and Esc there closes.
- **Picker commands** (keys manifest, all `group: 'picker'`, `runsIn: 'page'`, the notes plugin's labels):
  `pickerDown` "next line", `pickerUp` "previous line", `pickerChoose` "pick", `pickerCancel` "close",
  `pickerFilter` "filter", `pickerList` "back to the list". Binds in `// ── Help ──`, scope `keys.picker`: `j` →
  `pickerDown`, `k` → `pickerUp`, `<CR>` → `pickerChoose`, `l` → `pickerChoose`, `<Esc>` → `pickerCancel`, `/` →
  `pickerFilter`; `<CR>` → `pickerChoose` with `where: 'box'`; `<CR>` → `pickerChoose` with `mode: 'insert'`;
  `<Esc>` → `pickerList` with `where: 'box'` (the notes picker's set plus `l`, as `docs/keymap.md` § Layers'
  "Every list picker" line asks). Each handler calls the picker's `down`, `up`, `choose`, `cancel`, `focusFilter`,
  `leaveFilter`.
- **Choosing** runs the row's command: `api.commands.run(action.command)` with no `arg`, or
  `api.commands.run({ id: action.command }, action.arg)` with one (`CommandKey`, `src/contracts/commands.ts`). The
  part logs `leader search ran <command>` for a row with no arg and `leader search ran <command> <arg as JSON>` for
  one with an arg, before the run. **Cancelling** logs `picker closed: Leader actions`. The picker itself logs
  `picker shown: Leader actions`, so the plugin's log lines read `[keys] picker shown: Leader actions`.
- **The row's look is the keys layout's**: new part `leaderSearchRow`. The default draws `kit.row(parent, {
  density: 'list', label: <sentence-cased label>, trailing: keysElement(input.keys, kit) })`, as `helpRow` does.
  The picker owns the row's click and its `is-cursor` class (`ListPickerRequest.drawRow`). Add it to `Layout`
  (with its contract comment), `LAYOUT_PARTS` in `read-keys-layout.ts`, `KeysParts` and `PART_SCOPES` in
  `keys-parts.ts` (scope `keys.picker`), and `CompleteLayout`'s default in `layout.js`.
- **`docs/features/layouts/design.md` § Adopters**: the `keys` row's surfaces become "the help overlay, the
  which-key shelf, the leader search's rows, the title bar's Keys button".

### Self-test (forms' script holds the keys plugin's steps; AGENTS.md § Running and testing)

No existing expected line changes: the title and its log line are unchanged, and labels are never logged. A new
group goes after `choices` and before `pane resize` in the forms script's group list, named `leader search`, why:
"Space b opens the session group on the shelf; Space / searches every leader action in force, Enter runs the pick,
and Esc twice closes the search." Its steps, from the forms page `choices` leaves (scope `forms.forms`):

1. `{ keys: [' '], expect: '[keys] which-key shows Space' }`
2. `{ keys: ['b'], expect: '[keys] which-key shows Space b', screenshot: 'which-key-shelf' }`
3. `{ keys: ['Escape'], expect: '[keys] which-key closed' }`
4. `{ keys: [' ', '/'], expect: '[keys] picker shown: Leader actions', screenshot: 'leader-search' }`
5. `{ keys: ['h', 'e', 'l', 'p', 'Enter'], expect: '[keys] leader search ran keys.toggleHelp' }` (the filter holds
   the keys, `help` is `keys.toggleHelp`'s label and ranks first)
6. `{ keys: ['Escape'], expect: '[page] Escape ran keys.closeHelp' }`
7. `{ keys: [' ', '/'], expect: '[keys] picker shown: Leader actions' }`
8. `{ keys: ['Escape', 'Escape'], expect: '[keys] picker closed: Leader actions' }`

GIVEN the default keymap on the page WHEN the user presses Space b THEN the shelf spans the window's bottom edge,
headed `Space b  Session`, listing `n New session`, `r Rename session`… (labels as the commands name them)
GIVEN forms' review scope WHEN the user presses Space / and types `help`, Enter THEN help opens, as `Space ?` does
GIVEN a pending prefix `groups` does not name WHEN which-key shows THEN the header shows the keys alone

## Tests

- `which-key.test.ts`: drop the `+` from the five prefix-label rows (`choices`, `questions, review`, `windows`,
  `panes`, and the `choices` editor row); add `name` to every expected model. New test
  `whichKeyModel_PendingKeys_NameTheHeaderByTheirGroup`, one table: page `[' ', 'b']` with `groups {'<Leader>b':
  'session'}` → `'session'`; page `[' ']` → `null`; page `[' ', 'f']` with no `groups` entry for it → `null`;
  editor `['<Space>', 'b']` → `'session'`.
- `leader-search.test.ts` (create): `leaderActions_Keymap_ListsTheLeaderPageBindsInForce`, one table of keymap →
  rows: a leader bind in the given scope is listed; one in `any` is listed; one in another scope is not; a
  non-leader page bind (`gg`) is not; `keys.searchLeader` is not; `<Leader>;` and `<Leader>bd` on one command
  make one row with keys `Space ; / Space b d`; one command on two leader binds with args `1` and `2` makes two
  rows; leader `,` (`keymap.editor.leader` `','`) lists `,`-started binds with keys `, b d`.
- `start.test.ts`: `searchLeader_Chosen_RunsTheCommandWithItsArg` — over the harness's fake picker, with a keymap
  holding a leader bind carrying `arg: 2`: choosing its row runs the command with `2` and logs `leader search ran
  <command> 2`; cancelling logs `picker closed: Leader actions`.
- `keys-parts.test.ts`: add `name: null` to `setLayouts_WhichKeyShown_PanelUnchangedNextShowUsesNewSet`'s model.
  `leaderSearchRow` gets no test of its own there: its fallback is `createLayoutParts`'s, tested where it lives.

Done when: `npm run typecheck`, `npm run lint` and `npm test -- src/plugins/keys src/plugins/keymap.test.ts
src/shared/layouts/layout-contracts.test.ts` pass, and `npm run selftest -- --plugin forms` passes (it holds the
new `leader search` group). The look of the `which-key-shelf` and `leader-search` screenshots
(`.selftest/screenshots/forms-which-key-shelf.png`, `forms-leader-search.png`) against design.md § The popup is
checked in `07-final-verification.md`.
Commit:    one commit for the group

## Proof

