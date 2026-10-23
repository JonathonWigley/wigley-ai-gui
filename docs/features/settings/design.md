# Settings mode — settled design

**Contents**

- **Scope** — what this feature covers and what stays a follow-up.
- **The mode** — the plugin, its keys, the side bar sections.
- **Setting rows** — declarations, controls by kind, commit and reset.
- **Keymap section** — command rows, adding and removing binds, the leader, the advanced box.
- **The userConfig service** — the seam that reads and writes the user's layers through the ConfigStore's checks.
- **Disk changes and broken files** — hot reload, stale writes, a file that fails its check.

The decisions the user settled in the 2026-10-23 interview (two rounds and the agent's Decided notices), kept so the
plan is written from them. A decision here stands unless the user changes it.

## Scope

- Settings mode edits `settings.json` and `keymap.json` in the user config folder (`~/.config/wigley-ai-gui/`).
  Themes stay hand-edited; a theme editor is a follow-up.
- The key-hints setting and moving `claude.command` to the Claude harness plugin are separate follow-ups. Each one
  shows in Settings mode when it lands, through its own setting declaration, with no change to the mode.
- A bind is added by typing vim notation; recording key presses is not planned (a press cannot tell when a sequence
  ends, and synthetic keys never reach a global shortcut).

## The mode

- The `settings` plugin, with a main part and a page part, adds Settings mode: title "Settings", Codicon
  `settings-gear`.
- `<Leader>k,` (page command `settings.showMode`) shows the mode, and pressed while it shows, toggles its side bar, as
  `<Leader>ks` and `<Leader>kd` do. `Cmd+,` on macOS and `Ctrl+,` on Windows is an app menu accelerator
  (`CommandOrControl+,`) on main command `settings.show`, which asks the page part over the plugin's channel to show
  the mode. A page chord cannot hold `,`, so the accelerator is the route.
- The side bar lists sections: Core, then one per plugin that declares settings, in manifest order, then Keymap.
  `j`/`k` move the cursor and Enter opens the section in the content sheet. In a window too narrow for the side bar it
  opens over the content, and opening a section by click or Enter closes it. `Alt+l` / `Alt+h` move focus between the
  side bar and the form, as in Docs mode.
- `/` filters the open section's rows, keeping their order: setting rows by label and dotted path (fuzzy, through
  the `FuzzyMatcher` page service) and by description (plain substring, since a fuzzy match over a sentence matches
  almost any query), command rows by label, qualified id, keys and accelerators, and the Leader row by "leader" and
  its keys, all fuzzy. Esc on the rows clears a kept filter; opening a section clears it too.

## Setting rows

- Every setting declares a label and a one-line description by its dotted path: core settings in
  `src/config/settings.ts` (`settingInfo`), a plugin's in its manifest (`settingInfo`). The type derives every leaf
  path from the settings type, so a missing or misspelled path fails the build. An array is one leaf
  (`chat.profiles`), and so is an optional member (`fonts.ui`).
- One row per leaf: label, description, the value in force, and its control. A row the user set shows a "Set" tag and
  the default in `fg-tertiary`; `r` resets it, removing the key from `settings.json` (an object left empty drops too).
- Controls by kind, opened by Enter or `i` on the row:
  - number and string: a one-line text box; Enter commits, Esc reverts, and an empty box commits as unset
  - a closed choice (`transparency`), a boolean, and `theme`: the shared list picker. `theme` lists the built-in
    themes and the user's `themes/*.json` by name, as served at that moment
  - an array, or an object inside one: a JSON document box (the document editor with the JSON language); Enter on
    the row focuses the editor and Esc closes the box; `:w`, `:wq` and `:x` commit, `:q` and `:q!` close without
    committing
- A value commits on Enter or a pick, never per keystroke. A value that fails the check stays in its box with the
  check's message under it.
- A setting read only when something is created (window size, the claude command) says so in its description; the row
  shows the new value at once and the app applies it to the next one.

## Keymap section

- The Leader row comes first ("The key every <Leader> bind starts with"): a one-line box, where an empty box or the
  default leader leaves the leader unset.
- One row per command, every command included so an unbound one can get a key, grouped by plugin under a section
  header (core first), each with its label. A row lists each bind in force as Kbd with its scope as a Tag, and `where`
  or `mode` as a further Tag when set. A bind the user added shows "Set"; a default the user removed shows struck
  through with "Removed", and one a user bind on the same keys displaced shows "Replaced by <label>", each judged per
  half (page and editor) as the merge judges it. A default with one half still firing is not struck and shows "Partly
  removed — still fires in the editor" or "Partly replaced by <label> — still fires on the page". A default a plugin's
  default on the same keys replaces, as the merge lays the default layers, never fires: it is not listed, and a half
  of one so replaced counts as a half it does not have. A command with no keys shows "Not bound".
- A main command's row (`settings.show`, `window.summon`) lists its app menu, global or intercepted accelerators
  read-only; they are edited in the advanced box. A default accelerator shows "Removed" when unbound and "Replaced by
  <label>" when a user accelerator of the same kind takes its keys.
- On a command row (Enter or `i` opens the add-bind box, as `a` does; on a main command's row they toast
  "Accelerators are edited in the advanced box", as `a`, `d` and `r` do):
  - `a` adds a bind: a box takes vim notation and shows a live Kbd preview and, when firing binds on the same keys and
    scope exist, "Replaces <label>" naming every command the add displaces ("Replaces A and B", "Replaces A, B and
    C"): each whose default still fires on a half the new bind shares, and each whose user bind the add drops. Enter
    then opens the list picker of scopes (`any` and every scope), preselecting the scope of the command's first
    default bind, else `any`. A bind added here carries no `where` or `mode`.
  - `d` removes a bind (the list picker chooses which when the row has several): a default becomes an `unbind`
    entry, a user bind leaves `binds`.
  - `r` resets the row: every user `binds` entry naming that command, every other command's user bind sharing a half
    with one of its default binds, and every `unbind` entry removing a half of one is removed.
  - Adding a bind that another user bind already holds in that scope replaces that one in the user layer too.
- An `Advanced` row at the bottom opens a JSON document box that edits `groups`, `remaps`, `app`, `intercept`, `global` and the
  accelerator `unbind` entries (`app`, `global`, `intercept`); the command rows own `binds`, `leader` and the `keys`
  `unbind` entries. `:w`, `:wq` and `:x` commit.

## The userConfig service

- A core main service, `userConfig` on `MainServices`: its contract in `src/contracts/user-config.ts`, its adapter in
  `src/main/config/user-config.ts` beside the ConfigStore, filled in by `main.ts`. Any plugin may use it; the
  `settings` plugin is its first caller.
- It serves:
  - the schema: core and plugin setting defaults, each leaf's declaration (label, description, control, default), the
    plugin sections in order, every command and scope, the default binds as `KeyBind` entries by the layer they come
    from (defaults, then each manifest's `keys`), unmerged because which one replaces which depends on the user's
    leader, the default `app`, `global` and `intercept` accelerators merged across those layers, and the default leader
  - a read of both files: each file's user layer (null when the file is missing), its problem, and its text (null when missing), plus
    the theme names
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
