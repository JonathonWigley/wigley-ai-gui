# Keymap — assigning keys

**Contents**

- **Where keys live** — the default keymap file, the user's overlay, and the one notation.
- **Layers** — what each modifier means, with hjkl as the direction everywhere.
- **Leader groups** — the group letters, today's binds under each, and the reserved letters.
- **Adding a bind** — the steps every new or moved key takes.

Every key in the app follows one rule, taken from the user's Rider (IdeaVim), tmux, Ghostty and
Neovim setups, so the same hands work in all five. A good key is the one the user would guess
from those tools: the modifier says what kind of action it is, hjkl says which way, and the
leader holds everything named. `DESIGN.md` § Keys and focus holds the scope rule this extends
(raw keys act on the focused scope, chords navigate the visible scope, the leader changes scope).

## Where keys live

- `src/plugins/keymap.ts` holds every default key of the core and the built-in plugins, in banner
  sections by area, each command and scope named in full (`sessions.nextTab`, `docs.tree`). A
  wrong name fails the build. Built-in manifests declare commands and scopes only; the optional
  manifest `keys` is for a plugin from outside the repo.
- The user's `~/.config/wigley-ai-gui/keymap.json` takes the same entries and lays them over the
  defaults and any plugin's keys, so a line copies across unchanged. A user bind replaces a bind on
  the same keys in the same scope; `unbind` entries remove a default.
- A bind is one entry in vim notation (`<Leader>ks`, `gg`, `<A-o>`, `<Esc>`), written once. A
  leader bind fires on the page and in a text box; any other bind fires on the page, and a chord
  on the page fires inside a box too. `where` (`page`, `box` or `both`) sets where a bind fires in
  place of that default, and a chord takes only `page`. A bind with `mode` fires in a box, in that
  vim mode.
- `groups` names each leader prefix for which-key (`<Leader>k` windows); a later layer's name for
  a prefix replaces an earlier one's.

## Layers

hjkl is the direction in every layer; the modifier picks the verb.

- **Raw key** acts on the focused scope: `j`/`k` move, `Enter` acts, `Esc` backs out or closes,
  `/` filters, `gg`/`G` first and last, `y`/`n` confirm, `i`/`a` enter the box. Letters are
  mnemonic verbs.
- **Shift or uppercase** is a variant or a bigger step of the lowercase key: `G` beside `gg`, `A`
  create by path beside `a`, `R` rescan.
- **Ctrl+hjkl** moves inside the content: `Ctrl+j`/`Ctrl+k` scroll half a page in the doc, its
  editor too while editing (in visual mode the selection grows or shrinks with the scroll, as vim's
  `Ctrl+d`/`Ctrl+u` do), and the chat transcript, and page the gallery a whole page (in forms,
  the next and previous box); `Ctrl+h`/`Ctrl+l` the previous and next unit (forms items). A chord
  bind takes the key from vim inside a box too, as forms' `Ctrl+j` does: in the chat box and the
  doc editor vim's `Ctrl+j` and `Ctrl+k` (insert-mode digraph) do not reach vim, by design.
- **Alt+hjkl** moves focus between panes (`Alt+h`/`Alt+l` between the docs tree and the doc).
  Reserved for when the app has them: `Alt+Shift+hjkl` resize, `Ctrl+Alt+hjkl` swap,
  `Alt+'` / `Alt+;` split, `Alt+w` close a pane.
- **Alt+o / Alt+i** next and previous tab; **Alt+Shift+o / Alt+Shift+i** next and previous
  session, Shift being the bigger scope. **Alt+n / Alt+p** next and previous thing waiting on the
  user (forms' unanswered items).
- **Cmd** is for OS-convention app actions only: `Cmd+Enter` send or submit, `Cmd+w` close, the
  summon chord, `Cmd+,` Settings. Nothing else takes Cmd. `Cmd+,` is an app menu accelerator
  (`CommandOrControl+,`), since a page chord cannot hold `,`, so on Windows it is `Ctrl+,`, where
  `Win+,` belongs to the OS. `D-` is the Win key on Windows, so these binds are Win
  chords there: the user holds the four modifiers the same way on both OSes.
- **Leader (Space)** changes scope or holds named actions. Inside a text box raw keys belong to
  vim, so every action reachable from a box keeps a leader route there.

## Leader groups

The first key after the leader is the group. The next is the item's first letter, a doubled key
is the group's main action, `n`/`p` are next and previous, and uppercase is a variant.

| Key                | which-key name                       | Binds today                                                                                                |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `<Leader><Leader>` | none: the current context's overview | forms review, on the page and in a box                                                                     |
| `?`                | none: help                           | key help                                                                                                   |
| `;`                | none: close                          | close session                                                                                              |
| `k`                | windows                              | `ks` Sessions, `kd` Docs, `kn` new session, `k,` Settings                                                  |
| `f`                | none: find                           | reserved: `ff` file, `fs` text, `fa` command palette                                                       |
| `c`                | chat controls                        | in a box only: `cm` mode, `ce` effort, `co` model, `cc` every control, `cx` remove the last attached image |
| `a`                | answer                               | in a box only: `a1`…`a9`, `ac` clear, `af` fix now, `au` follow-up, `as` leave it                          |
| `x`                | none: forms not applicable           | in a box only: `x`                                                                                         |
| `z`                | debug                                | `zg` gallery, `zs` shell layout                                                                            |
| `zl`               | forms layouts                        | `zln` next, `zlp` previous, `zlc` copy, `zlo` open preview                                                 |
| `zc`               | chat layouts                         | `zcn` next, `zcp` previous, `zcc` copy                                                                     |

A row named `none` is a prefix without a `groups` entry; which-key labels it from its commands'
groups, and its description here is only for readers of this table.

Reserved to match Rider and Neovim, for when the app has the action: `.` context actions, `i`
info, `e` errors and attention (`en`/`ep`), `j` jump to session N, `s` search, `o` open (config
files), `r` rename, `v` view.

## Adding a bind

1. Pick the layer from what the action does.
2. When Rider, Neovim or tmux already has a key for the same concept, use that key.
3. Check it against every bind in its scope and in every scope that overlaps it.
4. Give an action reachable from a text box a leader route.
5. Name a new leader group in the keymap file's `groups`, and add its row to the table above.
