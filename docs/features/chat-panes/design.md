# Chat panes — design

**Contents**

- **Intent** — tmux-style panes in Sessions mode, with one side bar for every pane.
- **What a pane is** — a whole session in each pane, one pane per session.
- **The side bar and the focused pane** — selection, stepping and clicks.
- **Splitting, the picker and closing** — what a split shows, and when a pane closes.
- **Keys** — the tmux binds, and smart-splits between a tab's own panes and the chat panes.
- **Look** — the focused pane's border, icon tabs, and on-screen rows.
- **Persistence** — the layout and each pane's session across a relaunch.
- **Rejected** — approaches weighed and dropped.

## Intent

The user works several agent sessions at once and wants them side by side, as the user's tmux
setup shows them. Sessions mode splits into panes. The side bar stays one list of every session,
and it drives the focused pane. Every key is the one the user's tmux config gives the same action,
so the same hands work in both tools.

## What a pane is

- A pane shows one whole session: its tab bar and its tabs (Chat, and Docs when the `docs-session-tab` plugin is
  on), with the session's popups (a round, the primer) over them. A round's popup opens in its session's pane.
- A session shows in at most one pane. Each tab hands the session one element, and tmux never
  shows one process in two panes either.
- Only Sessions mode splits. Docs, Backlog and Settings keep their own fixed panes.
- Splitting halves the focused pane, as tmux does. Splits nest in both directions, so the panes are
  a tree. The tree is a shared page module, and Sessions mode is its first owner.
- Pane sizes are proportions of their parent, so panes scale with the window, as tmux's do.
- A pane keeps at least 280 px of width beside another pane and 160 px of height above or below
  one (at most half its parent when the parent is smaller). A split that would leave either half
  under its least is refused; a divider stops where it reaches the least. A window shrinking past
  the stored proportions draws the panes at their least and keeps the proportions, which come back
  as the window grows; a resize key steps from the drawn size.

## The side bar and the focused pane

- The side bar's selected row is the focused pane's session. The title bar shows that session.
- Picking a row loads its session into the focused pane. When another pane already shows that
  session, focus moves to that pane instead.
- `Alt+Shift+o` / `Alt+Shift+i` step the focused pane through the sessions that no other pane
  shows. A session on screen in another pane is skipped, so stepping never rearranges the other
  panes.
- Tab keys (`Alt+o` / `Alt+i`), `Cmd+w` and `Space k n` act on the focused pane's session. A new
  session from `Space k n` loads into the focused pane.
- A click inside a pane focuses it when the press ends, so nothing moves under a press: the focused pane's edge insets
  change its layout. A press and release in different panes focuses the pane the press began in; a cancelled press
  focuses none. At the release the keys stay on a text box the press focused in that pane, or a selection it began
  there; the Chat box takes them in insert mode at its caret. Any other focus lets go, and a visible Chat tab's box takes
  them.
- A round for a session in an unfocused pane opens its popup in that pane and leaves focus where it is.
  The row keeps its Needs you label until the user focuses that pane. Focus moving on its own would
  send the user's typing to the wrong session.

## Splitting, the picker and closing

- A split opens the shared list picker. It lists the sessions that no pane shows, then a
  "New session" row when chat's new-session command exists. A pick loads that session into the new
  pane. "New session" starts the chat start prompt, whose session then loads into the new pane.
- Esc in the picker closes the new pane, which undoes the split, and so does the picker closing any
  other way but a pick while the pane still holds no session. After "New session" the pane waits
  for the started session; when the start prompt starts nothing, the pane stays empty with the
  "Pick a session" text, and `Alt+w` closes it. While the picker is open, the split keys and
  `Alt+w` do nothing.
- `Alt+w` closes the focused pane only. Its session stays in the side bar, and the sibling pane
  takes the space. `Cmd+w` still closes the session.
- A pane whose session leaves the side bar (closed or ended) closes, as a tmux pane closes when its
  process exits. The panes left keep their sessions: main's pick of the next row is not loaded
  into them. The last pane never closes: it shows the next row, as the single view does today, or
  today's empty text when no row is left.

## Keys

The binds copy the user's tmux config (`~/.config/tmux/config/navigation.conf` and
`smart-splits.conf`); `docs/keymap.md` holds them.

| Action                     | Key                 | tmux                          |
| -------------------------- | ------------------- | ----------------------------- |
| Split, new pane below      | `Alt+'`             | `split-window -v`             |
| Split, new pane right      | `Alt+;`             | `split-window -h`             |
| Focus the pane that way    | `Alt+h/j/k/l`       | `select-pane -L/-D/-U/-R`     |
| Resize the focused pane    | `Alt+Shift+h/j/k/l` | `resize-pane -L/-D/-U/-R`     |
| Swap with the pane that way| `Ctrl+Alt+h/j/k/l`  | `swap-pane`                   |
| Close the pane             | `Alt+w`             | `kill-pane`                   |

**Smart-splits.** In the user's tmux, Neovim's own splits take `Alt+hjkl` first, and tmux takes
the key at Neovim's edge. The app does the same. The view in force hands the core a focus target,
which moves focus inside the view or reports its edge, and the core then moves to the neighbouring
chat pane. The key engine cannot hold one key in both a view's scope and every scope, so focus is
one core seam, the same shape as the resize target. Resize falls through the same way: the view's
own divider, then the chat pane's divider, then the side bar. Focus stops at the outer edge and
does not wrap, as the user's tmux binds stop at `pane_at_left` and the other edges.

## Look

- The focused pane draws an accent border, and unfocused panes are not dimmed, as the user's tmux
  theme draws them (active border coloured, `window-style` dimming off).
- Tabs draw as icons, with the tab's title as its tooltip, so tab bars stay short in narrow panes.
  Each tab plugin names its Codicon: Chat `comment`, Docs `book`; the popups name theirs for the hidden bar, forms
  `checklist` and the primer `lightbulb`. A user layout can bring the titles back.
- The focused pane shows a key prompt on each side that has a pane that way (`‹ ⌥H ⌃⌥H swap`),
  so the user sees where focus and swap would go. None shares a divider's centre, where the
  divider's resize prompt shows: the up prompt sits at the pane's right corner under the tab bar,
  the down prompt at the right corner above the bottom edge, and the left and right prompts below
  the pane's vertical centre. Content never draws under the up or down prompt: while the pane shows
  one, its sheet leaves a strip that high free, between the tab bar and the sheet for the up
  prompt and under the sheet for the down one, so the sheet shifts when focus moves.
- Each tab bar holds the tab strip, `⌘W` (close the session) and three pane controls: split right,
  split down and close the pane. The focused pane's controls carry their keys. An unfocused pane's
  bar drops every key, taking no space, so its controls are bare icons and its strip keeps room in
  a 280 px pane. This breaks the rule that an out-of-scope hint keeps its space: a pane's bar
  changes width when focus moves.
- A side bar row whose session shows in an unfocused pane carries a quieter on-screen mark, so the
  user sees which picks jump to a pane and which load into the focused one.

## Persistence

The pane tree, its proportions, the focused pane and each pane's session are kept in uiState and
come back after a relaunch. A pane names its session by the host session id, since the app's own
session id is new each run. Main resumes chat sessions after the page's first state, so a pane
whose session that state lacks stays empty and waits for it, loading it when a later state brings
it; the layout is saved with the session it waits for. A waiting pane never takes a session main
selects on its own, such as one that connects first: that session loads into the focused pane,
or, when that pane waits, into the first pane that does not, replacing its session; it loads into
the focused pane, ending its wait, only when every pane waits. The first
split, pane close or swap ends the wait, and the panes still waiting close.

## Rejected

- **One session in two panes:** every tab plugin would have to draw its tab twice.
- **Swapping sessions between panes on a step:** stepping the focused pane would scramble the other
  panes.
- **Per-view edge binds for smart-splits:** each scope would bind the directions it has no
  neighbour for, which is four binds in every view instead of one target.
- **Focus jumping to a pane that gets a round:** it sends the user's typing to the wrong session.
