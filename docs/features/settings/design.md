# Settings mode — settled design

**Contents**

- **Scope** — what this feature covers and what stays a follow-up.
- **The mode** — the plugin, its keys, the side bar sections.
- **Setting rows** — declarations, controls by kind, commit and reset.
- **Plugins section** — one switch per plugin, the lock, a refused pick, the filter.
- **Keybindings and Leader menu sections** — the action list with its keys, the leader tree, recording a key, the advanced box.
- **The userConfig service** — the seam that reads and writes the user's layers through the ConfigStore's checks.
- **Disk changes and broken files** — hot reload, stale writes, a file that fails its check.

The decisions the user settled in the 2026-10-23 interview (two rounds and the agent's Decided notices), kept so the
plan is written from them. A decision here stands unless the user changes it.

## Scope

- Settings mode edits `settings.json` and `keymap.json` in the user config folder (`~/.config/wigley-ai-gui/`).
  Themes stay hand-edited; a theme editor is a follow-up.
- The core `claude.command` setting moved to the `claude-code` plugin as `claude-code.command`, and shows in Settings
  mode under that plugin through its own setting declaration, with no change to the mode. The key-hints setting is
  still a follow-up, and will show the same way when it lands.
- A key is recorded as the user presses it when it is one key or one chord; a sequence (`gg`, `Space b r`) is typed in
  vim notation, since a press cannot tell when a sequence ends. Accelerators are never recorded: synthetic keys never
  reach a global shortcut, so they stay in the advanced box (2026-11-08 leader keys interview,
  `docs/features/leader-keys/design.md`).

## The mode

- The `settings` plugin, with a main part and a page part, adds Settings mode: title "Settings", Codicon
  `settings-gear`.
- `<Leader>k,` (page command `settings.showMode`) shows the mode, and pressed while it shows, toggles its side bar, as
  `<Leader>ks` and `<Leader>kd` do. `Cmd+,` on macOS and `Ctrl+,` on Windows is an app menu accelerator
  (`CommandOrControl+,`) on main command `settings.show`, which asks the page part over the plugin's channel to show
  the mode. `Cmd+,` is the Settings item of the app menu, the macOS place for it, so the accelerator is the route.
- The side bar lists sections: Core, then one per plugin that declares settings, in catalog order, then Plugins,
  then Keybindings, then Leader menu.
  `j`/`k` move the cursor and Enter opens the section in the content sheet. In a window too narrow for the side bar it
  opens over the content, and opening a section by click or Enter closes it. `Alt+l` / `Alt+h` (the core's
  `panes.focusRight` / `panes.focusLeft`) move focus between the side bar and the form, as in Docs mode.
- `/` filters the open section's rows, keeping their order: setting rows by label and dotted path (fuzzy, through
  the `FuzzyMatcher` page service) and by description (plain substring, since a fuzzy match over a sentence matches
  almost any query), plugin rows by label and id, fuzzy, command rows by label, qualified id, keys and accelerators,
  and the Leader row by "leader" and its keys, all fuzzy. Esc on the rows clears a kept filter; opening a section
  clears it too. The Leader menu's two panes take no `/` filter.

## Setting rows

- Every setting declares a label and a one-line description by its dotted path: core settings in
  `src/config/settings.ts` (`settingInfo`), a plugin's in its manifest (`settingInfo`). The type derives every leaf
  path from the settings type, so a missing or misspelled path fails the build. An array is one leaf
  (`claude-code.profiles`), and so is an optional member (`fonts.ui`).
- One row per leaf: label, description, the value in force, and its control. A row the user set shows a "Set" tag and
  the default in `fg-tertiary`; `r` resets it, removing the key from `settings.json` (an object left empty drops too).
- A control is a kind: a string id on the leaf's `control` (`{ kind, choices }`) that the settings page registers
  through `SettingsPageExports.addControlKind` (`src/plugins/settings/contract.ts`). A kind says how a value prints on
  the row and how it edits, in a box or in the list picker. The page registers the built-ins
  (`built-in-control-kinds.ts`); a plugin manifest's `settingControls` binds one of its setting paths to a kind id, so
  a plugin adds a kind without an edit to the page. A row whose kind no registration holds draws its value as JSON
  text and offers reset only. Main still checks a written value by the default's shape, whatever the kind. The
  built-ins, opened by Enter or `i` on the row:
  - `number` and `string`: a one-line text box; Enter commits, Esc reverts, and an empty box commits as unset
  - a closed `choice` (`transparency`), a `boolean`, `theme` and `layout`: the shared list picker. `theme` lists the
    built-in themes and the user's `themes/*.json` by name, as served at that moment. `layout` is the kind of each
    `<owner>.layout` row and of the core `shell.layout`: it lists that owner's layout names, `default` first
  - `json`, an array or an object inside one: a JSON document box (the document editor with the JSON language); Enter on
    the row focuses the editor and Esc closes the box; `:w`, `:wq` and `:x` commit, `:q` and `:q!` close without
    committing
- A value commits on Enter or a pick, never per keystroke. A value that fails the check stays in its box with the
  check's message under it.
- A setting read only when something is created (window size, the claude command) says so in its description; the row
  shows the new value at once and the app applies it to the next one.

## Plugins section

- One row per plugin, in catalog order, then each plugin that failed its first load: its label, its one-line description (both declared in the plugin's manifest),
  and at the end its state, `true` or `false`, with the shared list picker as the control (Enter or `i`). The
  `default` layout draws it as the `pluginRow` part.
- The state comes from the `core.plugins` slot, which says what runs now, and not from `settings.json`, which says what
  the user asked for. The row redraws when the slot changes, so a refused switch-off keeps showing `true`.
- The row's end holds, in this order: an error Tag `failed` (only when the row has a problem), a neutral origin Tag
  (`user`, or `replaces built-in`; none for a built-in plugin), the lock Tag below, then the state. The state `true`
  or `false` says whether a version of the plugin runs. The problem shows as a `status-error` line under the
  description, wrapped whole. A plugin that failed its first load has a row labelled with its id and no description.
- A plugin that running plugins depend on carries a `Needed by <label>, <label>` Tag before its state and cannot be
  switched off; the user switches those plugins off first. Settings' own row carries `Edit settings.json to turn off`,
  since switched off from its own section it could come back only by a hand edit.
- A pick writes the `plugins.disabled` list in `settings.json`, through the same checks as every setting; the switch
  applies the change at once. A pick of `false` on a running plugin asks the switch first (`mayDisable`): a reason
  (a dependency, or open work the plugin's `mayStop` guards) logs `refused settings.json: <reason>`, shows as a toast,
  and writes nothing. A pick of `true` writes without asking.
- Core shows no `plugins.disabled` row: its JSON box would write the list without that ask. A hand edit of
  `settings.json` still works, and a switch-off it names that cannot happen yet shows as a config problem.
- `/` filters the rows by label and id, fuzzy. While `settings.json` fails its check the section shows the same problem
  card as Core and refuses each pick.

## Keybindings and Leader menu sections

Both sections edit `keymap.json`'s user layer through the `userConfig` service, as the setting rows do, and show the
merged keymap: defaults, each manifest's `keys`, then the user's layer.

### Keybindings

- The Leader row comes first ("The key every <Leader> bind starts with"): a one-line box, where an empty box or the
  default leader leaves the leader unset.
- One row per command, every command included so an unbound one can get a key, grouped by plugin under a section
  header (core first). A row is one line: the action's label, its manifest `group` as a dim detail, then each bind in
  force at the row's end as Kbd, separated by `·`. A row too narrow for every bind gives way in order: the dim
  group, then whole binds from the last (a bind is never squeezed; hovering the binds lists every one), then the
  label down to a few characters; on the cursor row, whose prompt leaves least room, the first bind's tags and then
  the label may go further. While a recording runs, the row's binds show only the recording and the bind it
  replaces. A bind carries a Tag only when it says something: its scope's title
  when it is not `any`, `box` or `page` when `where` is set, its `mode`, and `Set` for a user bind. A default the user
  removed shows struck through with "Removed", and one a user bind on the same keys displaced shows "Replaced by
  <label>", each judged per half (page and editor) as the merge judges it; a default with one half still firing
  shows "Partly removed — still fires in the editor" or "Partly replaced by <label> — still fires on the page". A
  default a plugin's default on the same keys replaces, as the merge lays the default layers, never fires: it is not
  listed. A command with no keys shows `—` in `fg-tertiary`.
- The cursor row shows its keys as a cursor prompt: `↩ reassign`, `a add key`, `d clear`, `r reset`.
  Where an edit names the binds it displaces, it names each by its row's label, so an arg row names its argument
  (`B: arg`).
  - **Reassign** (Enter or `i`) works on the row: the row's first bind in force is struck, and the next key or chord
    the user presses is recorded in its place, shown live; Enter keeps it, Esc cancels, and Tab turns the row into a
    one-line box for vim notation with the live Kbd preview. When the keys are taken in that scope the row shows
    "<keys> runs "<label>" in <scope>: it moves here" under it before the commit. Reassign keeps the bind's scope,
    `where` and `mode`, and judges the keys as that bind: a chord is refused for a `box` or `both` bind, and only the
    halves the bind fires on displace another; a row with several binds reassigns the one the list picker chooses.
  - **Add key** (`a`) records the same way, then opens the list picker of scopes (`any` and every scope),
    preselecting the scope of the command's first default bind, else `any`, each scope's line naming what the bind
    would replace there. A bind added here carries no `where` or `mode`.
  - **Clear** (`d`) removes a bind (the list picker chooses which when the row has several): a default becomes an
    `unbind` entry, a user bind leaves `binds`.
  - **Reset** (`r`): every user `binds` entry naming that command, every other command's user bind sharing a half
    with one of its default binds, and every `unbind` entry removing a half of one is removed.
  - Adding or reassigning onto keys another user bind holds in that scope replaces that one in the user layer too.
- `f` cycles the filter over the rows: All, Bound, Unbound, Changed (a row with any user bind or unbind entry), each
  shown as a chip with its count above the rows. `/` filters by label, qualified id, keys and accelerators, fuzzy,
  inside the chip's rows.
- `?` finds by key: the next key or chord the user presses becomes the query, and the rows show every command whose
  bind is that key or starts with it, in every scope, under "<keys> runs" and "Starts with <keys>". Esc clears it.
- A main command's row (`settings.show`, `window.summon`) lists its app menu, global or intercepted accelerators
  read-only, and every edit key on it toasts "Accelerators are edited in the advanced box". A default accelerator shows
  "Removed" when unbound and "Replaced by <label>" when a user accelerator of the same kind takes its keys.
- An `Advanced` row at the bottom opens a JSON document box that edits `remaps`, `app`, `intercept`, `global` and the
  accelerator `unbind` entries (`app`, `global`, `intercept`); the command rows own `binds`, `leader` and the `keys`
  `unbind` entries, and the Leader menu owns `groups`. `:w`, `:wq` and `:x` commit.

### Leader menu

The leader tree as which-key shows it, edited in place, in two panes moved between with `Alt+h` / `Alt+l`:

- **Groups**, on the left: Top level first, then every group prefix (a key sequence after the leader that some bind
  runs past) in key order, a nested group (`z l`) indented under its parent. Each row shows the group's key, its name
  from `groups` (or, unnamed, its commands' manifest groups, as which-key labels it) and its item count. `R` renames the
  group (a one-line box writing its `groups` entry; an empty name removes the entry), `a` adds a group (record its key,
  then name it), and `d` on a group removes its name; a group with items refuses with "Move or clear its items first".
- **Items**, on the right: every bind directly under the selected group, in key order, a nested group's row opening it
  on Enter. A row shows its key, the action's label (always the command's label: leader items take no label of their
  own), its qualified id dim, and a Tag when it fires only in one scope (the scope's title) or only in a box (`in a
  box`). The cursor row's prompt: `↩ change action`, `c change key`, `d clear`, `m move to group`, `r reset`; the
  `add…` row's: `a add`.
  - **Add** (`a`, also the `add…` row at the end, which lists the group's free keys) records one key, refusing one the
    group already holds in an overlapping scope, then opens the list picker over every page command by label. A
    command already bound under the leader shows that key in `status-warning`; picking it moves that bind instead of
    adding a second. The scope picker then opens as Add key's does; a scope where the key meets an item in an
    overlapping scope is refused with the same note, writing nothing. A command with several leader binds moves the
    one in the scope chosen, else its first, and its other leader binds in a scope overlapping the one chosen go in
    the same edit: one leader path per command per scope.
  - **Change action** opens the same command picker and keeps the key and scope. The picked command's leader binds in
    a scope overlapping the item's go, and the item's key now runs it, as Add does: one leader path per command per
    scope; **change key** records a new key in the same group; **move to group** picks a group, then records the key
    there. Each is one user-layer edit: a user bind's entry is rewritten, a default's becomes an `unbind` entry beside
    the new `binds` entry.
  - **Clear** works as on the Keybindings section, on the one bind; **reset** works on the item's command, as on the
    Keybindings section.
- A row's main part (key, label, id, tags) is one line; the cursor prompt follows it on that line, and wraps under
  it when the pane is narrow.
- A click on a row moves its pane's cursor there and gives that pane the keys. Both panes' cursors are kept across a
  page reload with the rest of Settings mode's place, each falling back as on a first open when its row is gone.

## The userConfig service

- A core main service, `userConfig` on `MainServices`: its contract in `src/contracts/user-config.ts`, its adapter in
  `src/main/config/user-config.ts` beside the ConfigStore, filled in by `main.ts`. Any plugin may use it; the
  `settings` plugin is its first caller.
- It serves:
  - the schema: core and plugin setting defaults, each leaf's declaration (label, description, `control` as `{ kind, choices }` with `kind` a string id, default), the
    plugin sections in order, every command and scope, the default binds as `KeyBind` entries by the layer they come
    from (defaults, then each manifest's `keys`), unmerged because which one replaces which depends on the user's
    leader, the default `app`, `global` and `intercept` accelerators merged across those layers, and the default leader
  - a read of both files: each file's user layer (null when the file is missing), its problem, and its text (null when missing), plus
    the theme names and each owner's layout names (`layoutNames`)
  - a write of each file's whole new user layer against the text it was read at (stale: `changedOnDisk`)
  - a change signal, each time the ConfigStore serves a new config
- A write runs the same check the ConfigStore runs on that file — for `settings.json` the settings merge and the
  theme the layer names, for `keymap.json` the parse, the merge and the ambiguity check — and refuses a layer that
  fails with the check's message. A passing layer is written whole, as 2-space JSON keeping key order, through the
  files service's atomic write, creating the config folder when it is missing. The ConfigStore's watcher then hot
  reloads it, as it does a hand edit.
- The ConfigStore and the service share one check per file, so a hand edit and a form edit pass or fail alike.

## Disk changes and broken files

- The page redraws a section on each change signal. An open box keeps the user's text across the redraw.
- A box keeps the file's text from when it opened. A commit whose text no longer matches the file is refused as
  stale: the box stays open with the user's text, under the message "<file> changed on disk; the form now shows
  it", over the redrawn rows, and a second commit writes over the change.
- An edit or reset that changes nothing writes nothing.
- A file that fails its check shows "<file> has a problem: …" in an error card at the top of its section, and the section refuses
  edits until the file is fixed, since a write would throw away the user's text.
