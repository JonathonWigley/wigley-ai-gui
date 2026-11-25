# Activity bar

**Contents**

- **Order and groups** — where each mode's place comes from: its plugin's suggestion, then the user's override.
- **Names: peek and pin** — the collapsed bar, the hover peek over the content and the pinned wide bar.
- **Counts** — a mode's count on its item.
- **Seams** — the modules and contracts that carry each part.

The activity bar is the strip of mode icons at the window's start. It shows every mode in groups split by hairlines,
names each one on demand, and marks a mode that holds something for the user.

## Order and groups

- **A plugin suggests its mode's place** when it adds the mode: `place: { group, order, at }` on `Mode`. `group` and
  `order` are numbers, lower first; `at` is `top` (the default) or `bottom`, the bar's edge the group sits against.
  Modes sharing an `at` and a `group` form one group; a hairline separates neighbouring groups. A mode with no `place`
  joins a last top group of its own, in first-add order. Ties in `order` keep first-add order.
- **The built-in suggestions** give this order:

  ```
  top     1: Sessions, Inbox, Board, Builds
          2: Docs, Backlog, Schedules, Chatroom
  bottom  3: Practice, Gallery, Settings
  ```

- **The user overrides it wholly** with the core setting `shell.activityBar`: `groups`, a list of
  `{ modes: string[], at?: 'top' | 'bottom' }` in order, each naming modes by the qualified id `modes.show` takes
  (`sessions.sessions`, `work-inbox.main`, `docs.docs`), and `hidden`, mode ids the bar leaves out. With `groups`
  non-empty, the suggestions are ignored: a mode the setting leaves out of every group and out of `hidden` shows in a
  group of its own after the last top group, in suggestion order. An id naming no added mode is skipped. `hidden`
  applies with or without `groups`. A hidden mode keeps its keys; only its item leaves. The setting hot reloads.

## Names: peek and pin

- **Collapsed** is the 40px bar (`activitybar-width`): icons, the shown mode's accent mark, and a dot on an item whose
  count is above zero.
- **Peek.** The pointer resting on the bar for `activitybar-peek-delay` widens it to `activitybar-expanded-width`
  over the content, with a shadow: the grid track stays at its collapsed width, so nothing under it moves. Each item
  then shows its title, its count and the key of its show command; the bar's end shows the Pin button. The pointer
  leaving the bar ends the peek at once, and a click on an item shows that mode and ends it.
- **Pin.** `Space v p` (`activityBar.togglePin`) or the Pin button keeps the bar wide: the grid track takes
  `activitybar-expanded-width` and the side bar and content move over. Pressed again, or Unpin, it collapses. The
  pinned state is kept in `uiState` (`shell` scope, `activity-bar-pinned`) across reloads and restarts.
- **Narrow window.** Below 680px (`SIDE_BAR_OVER_QUERY`), a pinned bar lies collapsed and peeks on hover as an
  unpinned one does, and takes its pinned width again when the window widens. The pin itself stays set. The left
  bar's crowding plays no part here: the pinned width counts in the side bar's room, so a pinned bar may crowd the
  side bar over the content, and a crowding that unpinned the bar would undo itself and flicker.
- Names, counts and keys draw in every item at all times; the layout's CSS shows them only while the bar is expanded
  (`is-expanded` on the bar), so a peek redraws nothing. Keys draw through the core's key anchors, so the `showHints`
  setting hides them as it hides every hint.

## Counts

- A mode sets its count through its handle, `setCount(count: number | null)`, as it sets its context: null or 0
  shows nothing, more than 0 shows the dot collapsed and the number expanded.
- Inbox publishes the number of items in its Needs you section. No other mode sets a count yet.

## Seams

- `src/renderer/shell/activity-order.ts` — `arrangeActivityItems`, the pure fold of the added modes (id, place, first
  add) and the `shell.activityBar` setting into the bar's top and bottom groups of mode ids.
- `src/renderer/shell/shell-chrome.ts` — draws each group's items and the dividers through the shell layout, sets
  each item's count, and redraws on an add, a dispose, a count or a setting change.
- `src/renderer/shell/shell.ts` — the peek timer, the pin, the `is-expanded`, `is-peeking` and `is-pinned` classes,
  and the grid track's width, counted in the side bar's room.
- The shell layout contract (`src/renderer/shell/layouts/layout.d.ts`) — `activityItem` takes the title, icon, count
  and show command; `activityDivider` and `activityPin` are new parts.
