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
  wrong name fails the build. Built-in manifests declare commands and scopes only.
- The user's `~/.config/wigley-ai-gui/keymap.json` takes the same entries and lays them over the
  defaults, so a line copies across unchanged.
- A bind is one entry in vim notation (`<Leader>ks`, `gg`, `<A-o>`, `<Esc>`), written once. A
  leader bind fires on the page and in a text box; any other bind fires on the page, and a chord
  on the page fires inside a box too. `where` narrows a bind to `page` or `box`.
- `groups` names each leader prefix for which-key (`<Leader>k` windows).

## Layers

hjkl is the direction in every layer; the modifier picks the verb.

- **Raw key** acts on the focused scope: `j`/`k` move, `Enter` acts, `Esc` backs out or closes,
  `/` filters, `gg`/`G` first and last, `y`/`n` confirm, `i`/`a` enter the box. Letters are
  mnemonic verbs.
- **Shift or uppercase** is a variant or a bigger step of the lowercase key: `G` beside `gg`, `A`
  create by path beside `a`, `R` rescan.
- **Ctrl+hjkl** moves inside the content: `Ctrl+j`/`Ctrl+k` scroll half a page (in forms, the
  next and previous box), `Ctrl+h`/`Ctrl+l` the previous and next unit (forms items).
- **Alt+hjkl** moves focus between panes (`Alt+h`/`Alt+l` between the docs tree and the doc).
  Reserved for when the app has them: `Alt+Shift+hjkl` resize, `Ctrl+Alt+hjkl` swap,
  `Alt+'` / `Alt+;` split, `Alt+w` close a pane.
- **Alt+o / Alt+i** next and previous tab; **Alt+Shift+o / Alt+Shift+i** next and previous
  session, Shift being the bigger scope. **Alt+n / Alt+p** next and previous thing waiting on the
  user (forms' unanswered items).
- **Cmd** is for OS-convention app actions only: `Cmd+Enter` send or submit, `Cmd+w` close, the
  summon chord. Nothing else takes Cmd.
- **Leader (Space)** changes scope or holds named actions. Inside a text box raw keys belong to
  vim, so every action reachable from a box keeps a leader route there.

## Leader groups

The first key after the leader is the group. The next is the item's first letter, a doubled key
is the group's main action, `n`/`p` are next and previous, and uppercase is a variant.

| Key | Group | Binds today |
|---|---|---|
| `<Leader><Leader>` | the current context's overview | forms review |
| `?` | help | key help |
| `;` | close | close session |
| `k` | windows and modes | `ks` Sessions, `kd` Docs, `kn` new session |
| `f` | find | reserved: `ff` file, `fs` text, `fa` command palette |
| `c` | chat controls (box) | `cm` mode, `ce` effort, `co` model, `cc` every control |
| `a` | forms answer (box) | `a1`…`a9`, `ac` clear, `af` fix now, `au` follow-up, `as` leave it |
| `x` | forms not applicable (box) | `x` |
| `z` | debug and testing | `zl` forms layouts, `zc` chat layouts, `zg` gallery, `zs` shell layout |

Reserved to match Rider and Neovim, for when the app has the action: `.` context actions, `i`
info, `e` errors and attention (`en`/`ep`), `j` jump to session N, `s` search, `o` open (config
files), `r` rename, `v` view.

## Adding a bind

1. Pick the layer from what the action does.
2. When Rider, Neovim or tmux already has a key for the same concept, use that key.
3. Check it against every bind in its scope and in every scope that overlaps it.
4. Give an action reachable from a text box a leader route.
5. Name a new leader group in the keymap file's `groups`, and add its row to the table above.
