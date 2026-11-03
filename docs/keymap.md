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
  the same keys in the same scope; `unbind` entries remove a default. A command's user binds come
  before its default binds, so a key prompt shows the user's key.
- A bind is one entry in vim notation (`<Leader>ks`, `gg`, `<A-o>`, `<Esc>`), written once. A
  leader bind fires on the page and, as a vim normal-mode map, in a text box in normal mode; in
  insert mode the leader key types itself (Space types a space). Any other bind fires on the page,
  and a chord on the page fires inside a box too. `where` (`page`, `box` or `both`) sets where a
  bind fires in place of that default, and a chord takes only `page`. A bind with `mode` fires in
  a box, in that vim mode.
- `groups` names each leader prefix for which-key (`<Leader>k` windows); a later layer's name for
  a prefix replaces an earlier one's.

## Layers

hjkl is the direction in every layer; the modifier picks the verb.

- **Raw key** acts on the focused scope: `j`/`k` move, `Enter` acts (on a docs tree row it opens
  the doc and focuses it), `Esc` backs out or closes (in a box's normal mode it leaves the box, on a
  doc it focuses the docs tree, and in the doc editor it closes the editor as `:q` does), `/` filters, `gg`/`G` first and last,
  `y`/`n` confirm, `i`/`a` enter the box. Letters are mnemonic verbs.
- **Shift or uppercase** is a variant or a bigger step of the lowercase key: `G` beside `gg`, `A`
  create by path beside `a`, `R` rescan.
- **Ctrl+hjkl** moves inside the content. `Ctrl+j`/`Ctrl+k` are the app's scroll keys, and every
  view that scrolls its content takes them: they scroll one line of the text the view shows
  (its prose's line height, the editor's own line in the editor), key repeat supplying the
  speed, and `Ctrl+Shift+j`/`Ctrl+Shift+k` scroll half a page, Shift being the bigger step. The
  views are the doc, its editor too while editing, the chat transcript, the form and its review,
  the primer card and its review, the Backlog list and detail, the gallery, and the Flow tab; the docs
  tree takes both pairs and scrolls the doc beside it.
  In the editor the line scroll keeps the cursor unless it would leave the view, as vim's
  `Ctrl+e`/`Ctrl+y` do, and the half page moves it with the scroll in visual mode, as vim's
  `Ctrl+d`/`Ctrl+u` do; in visual mode the selection grows or shrinks with the cursor. Other list
  views with a cursor (settings, the pickers, the chat session list) move with `j`/`k` and bind
  neither pair yet. `Ctrl+h`/`Ctrl+l` move to the previous and next unit (forms items, the rows of the focused
  primer column, and on the primer card the rows of the column the card came from). A chord
  bind takes the key from vim inside a box too, in every vim mode: in a form box, the chat box and
  the doc editor, vim's `Ctrl+j` and `Ctrl+k` (insert-mode digraph) do not reach vim, by design.
- **Ctrl+n / Ctrl+p** move to the next and previous text box, from the page or inside a box in
  every vim mode (forms' notes, reason and comment boxes). Every view with more than one box
  takes them, so the keys that move between boxes are the same on every page. Inside a box they
  take the key from vim's insert-mode completion.
- **Alt+hjkl** moves focus to the pane that way, as smart-splits does between Neovim and tmux: first
  between a view's own panes (the docs tree and the doc, while the tree shows; the Backlog list and detail, the Settings
  sections and rows, and the Primer tab's tasks, items and card columns), then, at the view's edge,
  to the neighbouring chat pane in Sessions mode. Focus stops at the outer edge, and stays put while
  any scope is pushed over the view (a dialog, a confirm, a picker, a filter box, help). The commands are the
  core's `panes.focusLeft`, `panes.focusRight`, `panes.focusUp` and `panes.focusDown`, bound in every
  scope; a view takes part through its focus target (AGENTS.md § Architecture), never a bind of its own.
- **Alt+Shift+hjkl** resizes the focused pane, as tmux's `resize-pane` does: `Alt+Shift+h` moves the
  pane's right divider 24px left, `Alt+Shift+l` moves it 24px right, and a pane with no right divider
  moves its left one; `Alt+Shift+j`/`Alt+Shift+k` move the pane's lower divider down and up, else its
  upper one. Key repeat supplies the speed. A press resizes the view's own focused pane first, then
  the focused chat pane, then the side bar (left and right only): with no split pane focused and one
  chat pane (a Chat tab, Settings mode, Docs mode's tree, the Backlog homes) the keys resize the side
  bar. A view's divider that is hidden (its split stacked, or its start pane hidden) passes the press on. A divider
  stops where the pane it squeezes reaches its least size (280 px wide, 160 px tall). The commands are the
  core's `panes.resizePaneLeft`, `panes.resizePaneRight`, `panes.resizePaneUp` and
  `panes.resizePaneDown`, rebound in `keymap.json` like any other. Each divider shows the prompt
  `⌥⇧H ◂ ▸ ⌥⇧L` (`⌥⇧K ▴ ▾ ⌥⇧J` on a divider between stacked panes) while the pointer is over it,
  while it is dragged, and for a moment after each keyboard resize.
- **Alt+' / Alt+;** split the focused chat pane, the new pane below or to the right, as tmux's
  `split-window -v` / `-h` do; **Ctrl+Alt+hjkl** swaps the focused chat pane with the one that way;
  **Alt+w** closes the focused chat pane and leaves its session in the side bar
  (`docs/features/chat-panes/design.md`).
- **Alt+o / Alt+i** next and previous tab; **Alt+Shift+o / Alt+Shift+i** next and previous
  session, Shift being the bigger scope. **Alt+n / Alt+p** next and previous thing waiting on the
  user (forms' unanswered items).
- **Cmd** is for OS-convention app actions only: `Cmd+Enter` send or submit, `Cmd+w` close, the
  summon chord, `Cmd+,` Settings. Nothing else takes Cmd. `Cmd+,` is an app menu accelerator
  (`CommandOrControl+,`), since a page chord cannot hold `,`, so on Windows it is `Ctrl+,`, where
  `Win+,` belongs to the OS. `D-` is the Win key on Windows, so these binds are Win
  chords there: the user holds the four modifiers the same way on both OSes.
- **Leader (Space)** changes scope or holds named actions. Inside a text box raw keys belong to
  vim, so every action reachable from a box keeps a leader route there, taken in vim normal mode:
  in insert mode Space types a space, so the route starts with Esc there.

## Leader groups

The first key after the leader is the group. The next is the item's first letter, a doubled key
is the group's main action, `n`/`p` are next and previous, and uppercase is a variant.

| Key                | which-key name                       | Binds today                                                                                                                                                                                                     |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<Leader><Leader>` | none: the current context's overview | forms and primer review, on the page and in a box                                                                                                                                                               |
| `?`                | none: help                           | key help                                                                                                                                                                                                        |
| `;`                | none: close                          | close session                                                                                                                                                                                                   |
| `k`                | windows                              | `ks` Sessions, `kd` Docs, `kb` Backlog, `kn` new session, `k,` Settings                                                                                                                                         |
| `n`                | notes                                | `nn` open or close the note popup; in the popup `nf` new follow-up, `na` append to a follow-up, `ns` new session, `nc` capture the window, `nd` discard                                                         |
| `f`                | none: find                           | reserved: `ff` file, `fs` text, `fa` command palette                                                                                                                                                            |
| `v`                | view                                 | `vt` hide or show the docs tree, `vd` show or hide done follow-ups, `va` show only agent-ready follow-ups (Backlog), `vu` hide or show usage details                                                            |
| `w`                | workflow                             | `ww` the session's next workflow step (Clear & make when a plan is ready, Cancel during its countdown), `wn` make in a new session, `wr` resume make, `wo` open the plan, `wt` retro, `wd` dismiss a closed run |
| `r`                | rename                               | `rr` rename the focused session                                                                                                                                                                                 |
| `p`                | projects                             | `pf` favorite or unfavorite the focused session's project, `pk` / `pj` move it up or down among the favorites                                                                                                   |
| `c`                | chat controls                        | in a box only: `cm` mode, `ce` effort, `co` model, `cc` every control, `cx` remove the last attached image, `cp` pull back the newest unsent pending message, `cy` copy the sign-in link (sign-in dialog)       |
| `a`                | answer                               | in a box only: `a1`…`a9` pick the numbered choice or action header, `ac` clear                                                                                                                                  |
| `x`                | none: forms not applicable           | in a box only: `x`                                                                                                                                                                                              |
| `z`                | debug                                | `zg` gallery, `zs` shell layout                                                                                                                                                                                 |
| `zl`               | layout previews                      | `zlo` forms preview, `zlp` primer preview, `zls` sessions preview, `zlc` chat preview, `zla` agents preview, `zlw` workflow preview                                                                             |

A row named `none` is a prefix without a `groups` entry; which-key labels it from its commands'
groups, and its description here is only for readers of this table.

Reserved to match Rider and Neovim, for when the app has the action: `.` context actions, `i`
info, `e` errors and attention (`en`/`ep`), `j` jump to session N, `s` search, `o` open (config
files).

## Adding a bind

1. Pick the layer from what the action does.
2. When Rider, Neovim or tmux already has a key for the same concept, use that key.
3. Check it against every bind in its scope and in every scope that overlaps it.
4. Give an action reachable from a text box a leader route.
5. Name a new leader group in the keymap file's `groups`, and add its row to the table above.
