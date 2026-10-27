# 08 — Settings and Gallery

Status: done
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

**Contents**

- **Intent** — what this task lands.
- **Fields** — Files, Consumes, Produces, Decisions, Binds and anchors, behaviour, Tests, Done when, Commit.
- **Proof** — written by `wigley:make`.

## Intent

Every Settings key shows on the thing it acts on: the open section's header, the split edge between the
sections and the rows, and the cursor row. Gallery shows its one key, `t`, in its header. Settings stops
reading `keysFor` and drawing Kbd for a hint; the binds a keymap row lists stay drawn with `kbd`, since they
are the row's value, not a hint. Task 01 edits `src/plugins/gallery/page/gallery-view.ts` first (it adds
the KeyPrompt section), so this task edits that file after 01 lands.

## Fields

Files:     modify `src/plugins/settings/page/start.ts` · modify `src/plugins/settings/page/settings-view.ts` ·
           modify `src/plugins/settings/page/sections-view.ts` · create `src/plugins/settings/page/row-prompt.ts` ·
           test `src/plugins/settings/page/row-prompt.test.ts` · modify `src/plugins/settings/page/settings.css` ·
           modify `src/plugins/gallery/manifest.ts` · modify `src/plugins/gallery/page/start.ts` ·
           modify `src/plugins/gallery/page/gallery-view.ts` · modify `src/plugins/gallery/page/gallery.css`

Consumes:  `KeysPageExports.anchor(element: HTMLElement, command: CommandId, options?: AnchorOptions): Disposable` ← 01
           `AnchorOptions { scope?: ViewScope; where?: HintWhere; label?: boolean | string }` ← 01
           the `is-hint-hidden` class the keys plugin sets on a hidden anchor ← 01
           the class `ui-key-chevron` ← 01
           `src/plugins/gallery/page/gallery-view.ts` with task 01's KeyPrompt section in it ← 01
           existing: `RowActions`, `RowAction` (`src/plugins/settings/page/settings-view.ts`), `sectionHeader`,
           `emptyState`, `definePlugin`

Produces:  in `src/plugins/settings/page/row-prompt.ts`:
           `export type PromptAction = 'edit' | 'reset' | 'addBind' | 'removeBind';`
           `export function rowPromptActions(actions: RowActions): PromptAction[];`
           in `src/plugins/settings/page/settings-view.ts`:
           `SettingsViewDeps.anchor(element: HTMLElement, command: SettingsCommand, scope: 'sections' | 'rows', label?: boolean | string): Disposable;`
           replaces `clearFilterKeys` and `kbd`; `SettingsView.keysChanged` is removed
           in `src/plugins/settings/page/sections-view.ts`: `SectionsViewDeps.edge: HTMLElement;` — the
           `⌥L rows ›` edge element (a `span` holding the anchor element and its chevron) the pane places at
           its end edge
           in `src/plugins/gallery/page/gallery-view.ts`:
           `GalleryViewDeps.anchor: KeysPageExports['anchor'];`
           in `src/plugins/gallery/manifest.ts`: `dependsOn: ['keys']`

Decisions: placements the user approved (interview 2026-10-27): Settings shows `/ filter` in the section
           header, `⌥L`/`⌥H` at the split edge, and `i edit  r reset` on the cursor row (`a add  d remove` on a
           key row); Gallery shows `t transparency` in its header; gallery's manifest lists `keys` in
           `dependsOn` (adding it is this task's); pickers and dialogs put each key on the button or row it runs
           · a hint shows only in its anchor's scope (plan.md Decisions) · vim's own keys need no anchor
           (plan.md Decisions) · the rows sheet gains a section header (SectionHeader primitive) with the open
           section's title, since the sheet had no header at plan time (drafter) · `/` fires in both
           `settings.sections` and `settings.rows`, so the header holds two `/ filter` anchors, one per scope,
           stacked in one grid cell (`grid-area: 1 / 1`), so exactly one shows and the header never shifts
           (drafter: a hidden hint keeps its space, and two side by side would leave a gap) · the edge prompts
           are `⌥L rows ›` at the sections pane's end edge (scope `settings.sections`) and `‹ sections ⌥H` at the
           start of the section header (scope `settings.rows`); the labels `rows` and `sections` are the
           drafter's, since the user named the keys only · the start edge reads `‹ sections ⌥H`: `keyPrompt`
           draws the keys and then the label, so `‹ sections` is a `span.ui-key-chevron` (task 01) that the view
           places before the `settings.focusSections` anchor element, which shows keys only; `⌥L rows ›` is the
           `settings.focusRows` anchor with label `rows`, then a `›` chevron element after it; task 01's rule
           hides each chevron while its anchor is hidden (drafter; tasks 07 and 09 do the same) · the cursor prompt is one element made once,
           holding four anchors (`i edit`, `r reset`, `a add`, `d remove`), which `markCursor` moves to the
           end of the cursor row's first line, wrapping there when the line has no room (review fix), and in which it sets `hidden` on each anchor
           `rowPromptActions` leaves out (drafter) · a row with an `addBind` action is a key row: it shows
           `a add  d remove  r reset`, and no `i edit`, since `i` on a key row runs add (drafter, from
           `commandActions` in `src/plugins/settings/page/keymap-view.ts`) · every other row shows `i edit` and
           `r reset` for the actions it has · the empty state `No rows match "<query>".` keeps its key through
           an anchor (`settings.clearFilter`, scope `settings.rows`, keys only), made once (DESIGN.md
           § Surfaces, Empty states) · each `settings.picker` and `settings.box` bind is vim's, so the picker and
           the row box get no anchor · the gallery's `t transparency` anchor replaces the status line's
           hard-coded `kbd('t')` and the word `switches` at the status line's end (drafter); the Kbd, KeyPrompt
           and Button samples keep drawing `kbd`, since they are samples, not hints
           · task 01's contract for wave 2: a command counts as placed once the page load named an anchor for
           it in its scope, a disposed anchor included, and the view puts nothing in an anchor element

### Binds and anchors

From `src/plugins/keymap.ts` § Settings and § Gallery.

| Scope | Keys | Command | Anchor: element, options |
|---|---|---|---|
| `settings.sections` | `/` | `settings.filter` | section header's end, cell shared with the rows one; scope `sections`, label `filter` |
| `settings.sections` | `<A-l>` | `settings.focusRows` | sections pane's end edge (edge prompt, a `›` chevron element after it); scope `sections`, label `rows` |
| `settings.sections` | `j k gg G <CR> <Esc>` | move, open, clear filter | vim |
| `settings.rows` | `/` | `settings.filter` | section header's end; scope `rows`, label `filter` |
| `settings.rows` | `<A-h>` | `settings.focusSections` | section header's start (edge prompt, a `‹ sections` chevron element before it); scope `rows`, keys only |
| `settings.rows` | `i` | `settings.edit` | cursor prompt; scope `rows`, label `edit` |
| `settings.rows` | `r` | `settings.reset` | cursor prompt; scope `rows`, label `reset` |
| `settings.rows` | `a` | `settings.addBind` | cursor prompt; scope `rows`, label `add` |
| `settings.rows` | `d` | `settings.removeBind` | cursor prompt; scope `rows`, label `remove` |
| `settings.rows` | `<Esc>` | `settings.clearFilter` | vim; also the no-match empty state's hint; scope `rows`, keys only |
| `settings.rows` | `j k gg G <CR>` | move, open | vim |
| `settings.box` | `<CR> <Esc>` | `settings.boxAccept` `settings.boxCancel` | vim |
| `settings.picker` | `j k <CR> <Esc>` | picker commands | vim |
| `gallery.gallery` | `t` | `gallery.toggleTransparency` | status line's end (box hint); `{ scope: 'gallery.gallery', label: 'transparency' }` |
| `gallery.gallery` | `gg G <C-j> <C-k> <C-S-j> <C-S-k>` | scroll commands | vim |
| `any` | `<Leader>k,` `<Leader>zg` `<Leader>zs`, app `Cmd+,` | | leader, or an app accelerator |

### What changes, by file

- `settings/page/start.ts`: hands `anchor: (element, command, scope, label) => keys.anchor(element,
  qualify('settings', command), { scope: qualify('settings', scope), label })` (the plugin's id from
  `settingsManifest.id`) in place of `clearFilterKeys` and `kbd`; the `keys.onChanged` follow and the `kbd`
  import go.
- `settings-view.ts`: the rows sheet gains the section header first, above the filter frame:
  `‹ sections ⌥H`, the open section's title, then the stacked `/ filter` cell. `openSection` sets the
  title. The cursor prompt and the empty state's hint are made once at creation; `markCursor` places the
  cursor prompt; `drawRows` hands the empty state the kept hint element. `keysChanged` goes from the view.
- `sections-view.ts`: the pane appends `deps.edge` at its end edge; the view makes that element with its
  anchor and hands it in.
- `row-prompt.ts`: `rowPromptActions` returns, in this order, the actions the row has: for a row with
  `addBind`, `addBind`, `removeBind`, `reset`; for any other row, `edit`, `reset`.
- `settings.css`: styles `.settings-head`, `.settings-filter-hint` (the stacked cell),
  `.settings-row-actions`, `.settings-edge`, `.settings-edge--start`, `.settings-edge--end`, with existing
  tokens only. No rule changes the order inside `.ui-key-prompt`.
- `gallery/manifest.ts`: `dependsOn: ['keys']`; the header comment's "names no other plugin" changes to say
  that it names only `keys`, for its key hint.
- `gallery/page/start.ts`: reads `api.dependency<KeysPageExports>('keys')` and hands `anchor` to
  `createGalleryView`.
- `gallery-view.ts`: the status line holds the status text, then one anchor element for
  `gallery.toggleTransparency`.
- `gallery.css`: styles the status line's anchor with existing tokens, if the status line's own rules do not
  already place it.

GIVEN Settings mode shows with the sections focused WHEN it draws THEN the section header shows the open
section's title and `/ filter`, and the sections pane shows `⌥L rows ›`
GIVEN the rows have focus WHEN the cursor is on a setting row THEN that row ends in `i edit  r reset`, the
header shows `‹ sections ⌥H` and `/ filter` in the same place as before, and `⌥L rows ›` hides
GIVEN the rows have focus WHEN the cursor is on a keymap command row THEN that row ends in
`a add  d remove  r reset`
GIVEN a filter matches no row THEN the empty state reads `No rows match "<query>".` with the clear key
GIVEN Gallery mode shows THEN its status line ends in `t transparency`, and `t` switches it as today

Tests:     in `row-prompt.test.ts` (each test builds its own `RowActions` with no-op functions):
           `rowPromptActions_SettingRow_EditThenReset` — `{ open, edit, reset }` gives `['edit', 'reset']` ·
           `rowPromptActions_KeyRow_AddRemoveReset` — `{ open, edit, addBind, removeBind, reset }` gives
           `['addBind', 'removeBind', 'reset']` ·
           `rowPromptActions_NoActions_Empty` — `{}` gives `[]` ·
           `rowPromptActions_EditOnly_Edit` — `{ open, edit }` gives `['edit']` ·
           the header, edges, cursor prompt and the gallery status line are looks: task 12 (Final
           verification) checks them on screen

Done when: typecheck and lint pass; `grep -rn "keysFor\|clearFilterKeys\|keysChanged" src/plugins/settings/page --include='*.ts'`
           prints no line outside test files; `grep -n "'keys'" src/plugins/gallery/manifest.ts` prints the
           `dependsOn` line; the test gate runs the tests above
Commit:    one commit for the group: "Settings and Gallery name key anchors on their headers, edges and cursor rows"

### Concerns for the lead

- None outside this task's files. `createListPicker` stays unchanged here: every `settings.picker` bind is vim's.

## Proof

Commit aeac5ad · proof: diff read, Produces present; whole-tree typecheck and lint clean after wave 2 · concerns: scripts/check-layers.mts edited (gallery page layer gains keys/contract.ts), outside the Files list; settings rows gain one line for the cursor prompt (task 12 visual)
