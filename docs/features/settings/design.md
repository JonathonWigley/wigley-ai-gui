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
  `j`/`k` move the cursor and Enter opens the section in the content sheet. `Alt+l` / `Alt+h` move focus between the
  side bar and the form, as in Docs mode.
- `/` filters the open section's rows: setting rows by label, dotted path and description, command rows by label,
  qualified id and keys. Esc on the rows clears a kept filter; opening a section clears it too.

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
  - an array, or an object inside one: a JSON document box (the document editor with the JSON language); `:w`
    commits, `:q` reverts
- A value commits on Enter or a pick, never per keystroke. A value that fails the check stays in its box with the
  check's message under it.
- A setting read only when something is created (window size, the claude command) says so in its description; the row
  shows the new value at once and the app applies it to the next one.

## Keymap section

- The leader is a one-line field at the top.
- One row per command, every command included so an unbound one can get a key, grouped by plugin under a section
  header (core first), each with its label. A row lists each bind in force as Kbd with its scope as a Tag, and `where`
  or `mode` as a further Tag when set. A bind the user added shows "Set"; a default the user removed shows struck
  through with "Removed".
- A main command's row (`settings.show`, `window.summon`) lists its app menu, global or intercepted accelerators
  read-only; they are edited in the advanced box.
- On a command row:
  - `a` adds a bind: a box takes vim notation and shows a live Kbd preview and, when a bind on the same keys and scope
    exists, "Replaces <label>". Enter then opens the list picker of scopes (`any` and every scope), preselecting the
    scope of the command's first default bind, else `any`. A bind added here carries no `where` or `mode`.
  - `d` removes a bind (the list picker chooses which when the row has several): a default becomes an `unbind`
    entry, a user bind leaves `binds`.
  - `r` resets the row: every user `binds` entry and `unbind` entry naming that command's binds is removed.
  - Adding a bind that another user bind already holds in that scope replaces that one in the user layer too.
- An `Advanced` row at the bottom opens a JSON document box that edits `groups`, `remaps`, `app`, `intercept`, `global` and the
  accelerator `unbind` entries (`app`, `global`, `intercept`); the command rows own `binds`, `leader` and the `keys`
  `unbind` entries. `:w` commits.

## The userConfig service

- A core main service, `userConfig` on `MainServices`: its contract in `src/contracts/user-config.ts`, its adapter in
  `src/main/config/user-config.ts` beside the ConfigStore, filled in by `main.ts`. Any plugin may use it; the
  `settings` plugin is its first caller.
- It serves:
  - the schema: core and plugin setting defaults, each leaf's declaration (label, description, kind, choices), the
    plugin sections in order, every command and scope, the default binds as `KeyBind` entries by the layer they come
    from (defaults, then each manifest's `keys`), and the default leader
  - a read of both files: each file's user layer (null when the file is missing), its problem, and its revision, plus
    the theme names
  - a write of each file's whole new user layer against the revision it was read at
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
- A file that fails its check shows its problem in an error card at the top of its section, and the section refuses
  edits until the file is fixed, since a write would throw away the user's text.
