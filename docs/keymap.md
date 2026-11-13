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
  bind fires in place of that default, and a chord takes only `page`. Tab and Shift+Tab are chords
  in any spelling (`<tab>`, `<s-tab>`), so neither can be the leader or sit inside a longer sequence. A bind with `mode` fires in
  a box, in that vim mode.
- `arg` hands the command its argument: a number, a string or a small record of numbers and
  strings. A command that declares an argument needs one on each of its binds, and a command that
  declares none takes no `arg`; `binds`, `app`, `intercept` and `global` entries take it, `unbind`
  entries do not. `{ "keys": "1", "scope": "forms.forms", "command": "forms.choose", "arg": 1 }`
  picks the first choice. `arg` does not tell binds apart: two binds on one key in one scope are a
  key bound twice, whatever their arguments.
- `groups` names each leader prefix for which-key (`<Leader>k` go to); a later layer's name for
  a prefix replaces an earlier one's.

## Layers

hjkl is the direction in every layer; the modifier picks the verb.

- **Raw key** acts on the focused scope: `j`/`k` move, `Enter` acts (on a docs tree row it opens
  the doc and focuses it), `Esc` backs out or closes (in a box's normal mode it leaves the box, on a
  doc it focuses the docs tree, and in the doc editor it closes the editor as `:q` does), `/` filters, `gg`/`G` first and last,
  `y`/`n` confirm (in chat `y` copies with a range open, else allows the waiting permission under the cursor, else the oldest waiting one, else copies; `n` denies the same one), `i`/`a` enter the box (in forms `o` too), `za` opens or closes a forms notice line, as vim's fold toggle, `e` edits the doc's section at the top of sight. `gh` opens Docs mode's Main page, from any docs view. On a docs list page `j`/`k` move the row and `l`/`Enter` open it. Letters are mnemonic verbs.
- **Shift or uppercase** is a variant or a bigger step of the lowercase key: `G` beside `gg`, `A`
  create by path beside `a`, `J`/`K` by message beside `j`/`k` by block, `R` rescan. Chat's `V` is vim's line select
  instead, since `v` opens visuals.
- **Ctrl+hjkl** moves inside the content. `Ctrl+j`/`Ctrl+k` are the app's scroll keys, and every view that scrolls its
  content takes them: they scroll one line of the text the view shows (its prose's line height, the editor's own line in
  the editor), key repeat supplying the speed, and `Ctrl+Shift+j`/`Ctrl+Shift+k` scroll half a page, Shift being the
  bigger step. The views are the doc, its editor too while editing, the chat transcript, the session hub, an open
  agent-strip box's tool list, the form and its review, the primer card and its review, the audio picker's list, the
  Backlog review pane, the Practice problem pane and console, the gallery and the key help; the docs tree takes both
  pairs and scrolls the doc beside it. The Backlog table takes both pairs too and scrolls the review pane. In the editor
  the line scroll keeps the cursor unless it would leave the view, as vim's `Ctrl+e`/`Ctrl+y` do, and the half page
  moves it with the scroll in visual mode, as vim's `Ctrl+d`/`Ctrl+u` do; in visual mode the selection grows or shrinks
  with the cursor. Other list views with a cursor (settings, the pickers, the chat session list) move with `j`/`k` and
  bind neither pair yet. `Ctrl+h`/`Ctrl+l` move to the previous and next unit (forms items, the rows of the focused
  primer column, on the primer card the rows of the column the card came from, the audio picker's moments, and a doc's
  sections). A chord bind takes the key from vim inside a box too, in every vim mode: in a form box, the chat box and
  the doc editor, vim's `Ctrl+j` and `Ctrl+k` (insert-mode digraph) do not reach vim, by design. `Ctrl+o`/`Ctrl+i` go
  back and forward through the docs view's places, as vim's jump list does, while the doc pane has focus.
- **Tab / Shift+Tab** move to the next and previous text box, from the page or inside a box in every vim mode (forms'
  notes, reason and comment boxes, the audio picker's notes boxes). Every view with more than one box takes them, so the
  keys that move between boxes are the same on every page. Inside such a view's boxes they take the key from vim, so a
  box there types no tab character. `<Tab>` and `<S-Tab>` are chords in the page's notation for this reason: they fire
  ahead of a box's vim, as Ctrl chords do.
- **Ctrl+n** opens the new-session prompt with only its folder and profile steps, from every main view and its boxes in
  every vim mode: Sessions with nothing shown, the Sessions list, the Chat tab, its session hub and its agent strip, the
  docs tree, doc and the doc's right column, the Backlog table, review pane and chunk strip, the Settings sections, rows
  and Leader menu panes, the gallery, a form and its review, the primer's columns, card and review, the audio picker's
  list, the note popup, and the Practice list, problem pane, editor, console and the scoped-agents ask box
  (`scoped-agents.ask`, serving both Practice's interviewer and Backlog's assistant). It is bound per main view, so a
  dialog, picker or confirm keeps its own keys; a new main view adds its scope to that list in `src/plugins/keymap.ts`.
  While a box's completion popup is open, Ctrl+n and Ctrl+p move the popup's selection instead, and Tab accepts it,
  ahead of every bind; Shift+Tab still moves to the previous box.
- **Alt+hjkl** moves focus to the pane that way, as smart-splits does between Neovim and tmux: first between a view's
  own panes (a Docs session tab's tree and doc, the doc and its right column, the Backlog table and review pane, the primer
  popup's tasks, items and card columns, the Practice problem pane, editor and console, and a Chat tab's transcript, box
  and session hub), then, at the view's edge, to the outer pane that way (the neighbouring chat pane in Sessions mode,
  Practice's interviewer pane under its editor and console, reached with Alt+j from the console and left with Alt+k, from the chat box after a first Alt+k to its transcript), then, at main's edge, to the shown mode's side bar on the left (the
  Sessions list, the docs tree, the Settings sections) and the right bar on the right (each part of
  it that has rows, Alt+j/k between them). Backlog has no side bar;
  Alt+h/l move between its table and review pane, Alt+j from the table or review pane to the chunk strip and Alt+k
  back to the table, and Alt+l from the review pane or the strip into the assistant pane while it shows (its outer
  pane). From the side bar Alt+l, and from the right bar Alt+h, return to main's last
  pane. A hidden side bar or right bar is no stop: focus stops at the outer edge, and stays put while any scope is
  pushed over the view (a dialog, a confirm, a picker, a filter box, help). The commands are the core's
  `panes.focusLeft`, `panes.focusRight`, `panes.focusUp` and `panes.focusDown`, bound in every scope; a view takes part
  through its focus target, a mode's side bar through the mode, and a right bar part through its contribution (AGENTS.md
  § Architecture), never a bind of its own. Each move takes the keyboard with it: the box or list of the pane left
  behind keeps no focus.
- **A side-bar list** opens the cursor's item on `Enter` and moves focus into main, and opens it on `l` keeping
  focus in the list (the docs tree, the Sessions list, the Settings sections, the Practice list). `a` on
  the Practice list starts an import. Backlog's own keys (the table's `Enter` activate, `x` mark, `c` chunk, `u` unchunk,
  `r` rename, `s`/`S` start (`S` skips started and empty chunks), `H` headless, `gl` commits since, `W` sweep, and the strip's `h`/`l` and `Enter`) are listed in
  `docs/features/backlog/design.md` § The mode. The Sessions
  list's cursor row also takes `s` favorite its project, `J`/`K` move its project among the favorites, `r` rename
  and `d` close, as the docs tree's `s`, `r` and `d` do; `Esc` returns to the focused pane.
- **Every list picker** takes the same keys: `j`/`k`, `gg`/`G`, `Enter` and `l` choose, `/` filters, `Esc` closes.
- **Every pane that scrolls or holds rows** takes vim's `gg`/`G` (top and bottom) and `j`/`k` (a row, or a line where
  the pane has no rows): the doc, the Backlog review pane, the form and its review, the primer card and its review, the
  audio picker's list, the session hub (its section heads), the doc's right column, the Practice problem pane, the
  gallery and the key help; the Backlog table moves a row. The doc's right column also opens its cursor row on `Enter`
  or `l` and returns to the doc on `Esc`. The right bar's system stats panel (scope `system-stats.panel`) moves its
  process rows with `j`/`k` and `gg`/`G`, cycles its sort column on `s`, opens a group on `Enter` or `l` and closes it
  on `h`.
- **Alt+Shift+hjkl** resizes the focused pane, as tmux's `resize-pane` does: `Alt+Shift+h` moves the
  pane's right divider 24px left, `Alt+Shift+l` moves it 24px right, and a pane with no right divider
  moves its left one; `Alt+Shift+j`/`Alt+Shift+k` move the pane's lower divider down and up, else its
  upper one. Key repeat supplies the speed. A press resizes the view's own focused pane first (a Chat tab's session
  hub while the hub has the keys), then
  the focused chat pane, then the side bar (left and right only): with no split pane focused and one
  chat pane (a Chat tab, Settings mode, Docs mode's tree) the keys resize the side
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
- **Alt+o / Alt+i** next and previous tab: the shown mode's own tabs when it has them (Practice's problem pane or
  console, through the mode's `stepTab`), else the session tabs, showing Sessions; **Alt+Shift+o / Alt+Shift+i** next
  and previous session, Shift being the bigger scope. **Alt+n / Alt+p** next and previous thing waiting on the
  user (forms' unanswered items).
- **Cmd** is for OS-convention app actions only: `Cmd+Enter` send or submit, `Cmd+w` close, the
  summon chord, `Cmd+,` Settings. Nothing else takes Cmd, but Practice's `Cmd+'` Run, which
  matches LeetCode's own key, beside its `Cmd+Enter` Submit. The two
  bind in `scoped-agents.ask`, and do nothing while Practice is hidden, since Backlog's
  assistant box shares that scope. `Cmd+,` is an app menu accelerator
  (`CommandOrControl+,`), since a page chord cannot hold `,`, so on Windows it is `Ctrl+,`, where
  `Win+,` belongs to the OS. `D-` is the Win key on Windows, so these binds are Win
  chords there: the user holds the four modifiers the same way on both OSes.
- **Leader (Space)** changes scope or holds named actions. Inside a text box raw keys belong to
  vim, so every action reachable from a box keeps a leader route there, taken in vim normal mode:
  in insert mode Space types a space, so the route starts with Esc there.

## Leader groups

The first key after the leader is the group. The next is the item's first letter, a doubled key
is the group's main action, `n`/`p` are next and previous, and uppercase is a variant.

| Key                | which-key name                       | Binds                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<Leader><Leader>` | none: the current context's overview | forms and primer review, on the page and in a box                                                                                                                                                                                                                                                                                                                                                                                         |
| `?`                | none: help                           | key help                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/`                | none: search                         | search every leader action by name, in the list picker; each row shows its keys                                                                                                                                                                                                                                                                                                                                                           |
| `;`                | none: close                          | close session, the same as `bd`, kept one key from the leader                                                                                                                                                                                                                                                                                                                                                                             |
| `'`                | none: stash                          | stash session, the same as `bs`, kept one key from the leader                                                                                                                                                                                                                                                                                                                                                                             |
| `b`                | session                              | `bn` new session, `br` rename, `bd` close, `bs` stash (a note dialog, then the close; the start prompt lists it under Stashed), `bX` stop every session's process (`chat.stopAll`; the rows stay, resting), `bp` hide or show the session's popup, `bh` hide or show the session hub                                                                                                                                                      |
| `k`                | go to                                | `ks` Sessions, `kd` Docs, `kb` Backlog, `kp` Practice, `k,` Settings                                                                                                                                                                                                                                                                                                                                                                      |
| `n`                | notes                                | `nn` open or close the note popup; in the popup `nf` new follow-up, `na` append to a follow-up, `ns` new session, `nc` capture the window, `nd` discard                                                                                                                                                                                                                                                                                   |
| `f`                | none: find                           | reserved: `ff` file, `fs` text, `fa` command palette                                                                                                                                                                                                                                                                                                                                                                                      |
| `v`                | view                                 | `vt` hide or show the docs tree, `vw` switch the docs sidebar between the wiki and All pages, `vd` show or hide done follow-ups, `va` show only agent-ready follow-ups (Backlog), `vb` show or hide the Backlog assistant, `vr` pick the Backlog repo, `vc` hide chunked follow-ups, `vs` stale follow-ups first, `vi` focus or leave the Practice interviewer, `vu` hide or show usage details, `vy` hide or show the system stats panel |
| `w`                | workflow                             | `ww` the session's next workflow step (Clear & make when a plan is ready, Cancel during its countdown), `wn` make in a new session, `wr` resume make, `wo` open the plan, `wt` retro, `wd` dismiss a closed run, `ws` show or hide the side pane, `wf` open or fold finished waves, `wh` turn headless on or off                                                                                                                          |
| `p`                | projects                             | `pf` favorite or unfavorite the focused session's project, `pk` / `pj` move it up or down among the favorites                                                                                                                                                                                                                                                                                                                             |
| `c`                | chat controls                        | on the page or in a box: `ci` show the attached images (`x` removes the shown one); in a box only: `cm` mode, `ce` effort, `co` model, `cc` every control, `cx` remove the last attached image, `cp` pull back the newest unsent pending message, `cy` copy the sign-in link (sign-in dialog)                                                                                                                                             |
| `a`                | answer                               | in a form's box and on the form's page: `a1`…`a9` pick the numbered choice or action header (in the audio picker's notes box, `a1`…`a6` pick the numbered candidate), `ac` clear, `ax` not applicable                                                                                                                                                                                                                                     |
| `z`                | debug                                | `zg` gallery, `zs` shell layout                                                                                                                                                                                                                                                                                                                                                                                                           |
| `zl`               | layout previews                      | `zlo` forms preview, `zlp` primer preview, `zls` sessions preview, `zlc` chat preview, `zla` agents preview, `zlw` workflow preview, `zlm` audio picker preview                                                                                                                                                                                                                                                                           |

A row named `none` is a prefix without a `groups` entry; which-key labels it from its commands'
groups, and its description here is only for readers of this table.

Reserved to match Rider and Neovim, for when the app has the action: `.` context actions, `i`
info, `e` errors and attention (`en`/`ep`), `j` jump to session N, `s` search, `o` open (config
files).

## Adding a bind

1. Pick the layer from what the action does.
2. When Rider, Neovim or tmux already has a key for the same concept, use that key.
3. Check it against every bind in its scope and in every scope that overlaps it.
4. Give an action reachable from a text box a leader route. Forms' `za` takes none: a notice line closed from
   inside its own comment box would drop the box's focus, so from a box the route is `Esc`, then `za`.
5. Put a leader action in the group its concept belongs to, never in a group of its own: a session action goes
   under `b`, a mode under `k`, a show-or-hide under `v`. A new group needs at least two actions, a name in the
   keymap file's `groups`, and its row in the table above. Settings mode's Leader menu page edits the user's
   tree in `keymap.json`, and its group names, the same way.
6. A key that steps 1 to 3 settle is picked without asking and shown as a Decided notice
   (`~/wigley-agents/decisions.md` § Decided notices), in place of the key question that
   `decisions.md` § Architecture › Keys leaves open. A key that conflicts with an existing bind or moves one
   is asked.
