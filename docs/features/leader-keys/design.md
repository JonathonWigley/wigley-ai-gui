# Leader keys — settled design

**Contents**

- **Scope** — the three pieces this feature covers.
- **The tree** — the group letters, and why each moved.
- **The popup** — which-key's look and its search.
- **The editors** — where the Keybindings and Leader menu sections are specified, and the core key capture they share.
- **Rejected** — the options the user saw and turned down.

Settled in the 2026-11-08 interview (three mockup rounds and one form round). A decision here stands unless the user
changes it.

## Scope

Three pieces, each its own surface:

- the leader tree itself: which group each leader action sits in (`src/plugins/keymap.ts`, `docs/keymap.md` § Leader
  groups)
- the which-key popup that shows after the leader (the `keys` plugin)
- Settings mode's editors: the Keybindings section for every bind and the Leader menu section for the leader tree
  (`docs/features/settings/design.md` § Keybindings and Leader menu sections)

## The tree

- Session actions sat in five places (`;`, `'`, `:`, `kn`, `rr`, `vs`, `vf`). They move into one `b` group, Neovim's
  buffer group, since a session plays a buffer's part here: `Space b d` closes as `<leader>bd` deletes a buffer. `s`
  stays reserved for search.
- `;` close and `'` stash stay as one-key shortcuts beside `bd` and `bs`: they are the most used. `:` stop all goes,
  leaving `bX` only, since it ends every session's process and is costly to hit by mistake.
- One-item groups go: `r` (rename) moves to `br`, and `x` (not applicable) joins the answer group as `ax`.
- `k` keeps its letter and is named "go to"; it holds the modes only, `kn` having moved to `bn`.
- A leader item's label is always its command's label; only a group's name is the user's to edit.

## The popup

- **Look (A3, the quiet shelf):** a full-width glass shelf rising from the window's bottom edge over the content,
  like Neovim's which-key, through the `keys` plugin's `default` layout. Its header is the keys pressed so far (`Space
  b`) and the group's name; below it the entries sit in up to four columns, each entry its key in `fg-tertiary` mono
  text (the Kbd primitive's look: no key-cap boxes) and its label, a group's label followed by `›`, both in `accent`, a
  single action's in `fg-secondary`. No counts or icons, and no accent on an action's row. Esc cancels the sequence as it does today; the
  key engine has no step back.
- **Search:** `Space /` (`keys.searchLeader`, scope `any`, page and box) opens the shared list picker over every leader
  action firing in the scope in force, each row its label with its keys as the trailing detail; picking one runs its
  command with its bind's `arg`. It opens with its filter focused, since a search is typed; Esc leaves the filter's INSERT
  mode, a second Esc returns to the list, and a third closes it. A box-only bind is left out, since the picker takes focus from the box. In the popup it shows as the `/` entry like any other bind, so it needs no hint of its
  own.

## The editors

Specified in `docs/features/settings/design.md` § Keybindings and Leader menu sections. Both record a key through one core
page capability: `api.keys.captureKey`, which hands the next key or chord the user presses to its caller as vim
notation, ahead of every bind and of the pending sequence, and returns a Disposable that cancels it. Esc is never
captured: it cancels the capture. The core already turns a keydown into a page key for its binds
(`src/renderer/page-keys.ts`), so the capture is that same turn, exposed.

## Rejected

- Popup: a docked glass panel inset from the content's edges with group counts (A1), and a sectioned one-column menu
  above the composer (A2); the user picked the quieter shelf. A centered palette card, and Finder-style columns of
  every level passed.
- Keybindings editor: a table with one line per bind and a "Works in" column (busier than one row per action); sections by a
  new per-command category field (over 200 commands to fill in; the plugin is already a meaningful section).
- Leader editor: editing one level at a time with a live popup preview (L1); a keyboard map per prefix (cannot show
  labels); the whole tree as a text outline file in vim (fast for big moves, less discoverable; still possible later
  over the same `keymap.json` entries).
- Recording a whole sequence until a pause or Enter: a pause is a guess, and typing covers sequences.
