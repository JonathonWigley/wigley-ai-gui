# Session clock

**Contents**

- **Status** — what is built.
- **Active time** — what the clock counts, and where it lives.
- **Across relaunch** — what is saved and what starts at zero.
- **The side-bar row** — where the run time and the cache mark draw.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope**

Each session keeps its **active time**: how long its agent has worked, counted only while work runs, the way Claude
Code's own timer counts. The side-bar row shows it beside a mark that says whether the session's prompt cache is
cold.

## Status

Built.

## Active time

- A session's clock runs while its turn is `working` or while any subagent or background task runs
  (`background > 0`). It pauses while the session is idle and while a turn is `waiting` on a permission answer
  with no background work running.
- Chat main owns each session's clock, since chat alone holds both the turn state and the background count. It
  sends the clock in each session's state and on each change; the chat page offers it to other plugins through
  `ChatPageExports.activeTime` and the `activeTimeChanged` event.
- The clock is an `ActiveTime` record (`src/contracts/active-time.ts`): the closed total and the moment the open span
  started, null while paused. Its functions are in `src/shared/active-time.ts`, and any clock that counts only while
  something runs builds on that module.

## Across relaunch

- Chat saves each session's total at the moment of the save, the open span included, with the session
  (`SavedSession.activeMs`). It saves at each start and stop of the clock, at every other save chat makes, and tries once
  more when the app quits. The app does not wait for that last write, so a quit that cuts it short leaves the last
  saved total, which can lack the whole open span. A restored session's clock starts paused at that total.
- A kept run's work while the app is closed is not counted. A run still working restarts its clock at relaunch, and a
  turn that ended meanwhile adds nothing, so the row's time can run below the run's own.
- A session opened from Claude's saved history (the resume picker) starts at zero, unless a saved record the restore
  skipped holds that session: the row takes over that record's total with its messages. A record of a row already
  open adds its total the same way.
- `/clear` resets the clock to zero: the run time describes the conversation in the row, as the title, transcript,
  context and cache do, and `/clear` starts a new conversation.

## The side-bar row

The row's second line holds the status chip, the context meter and its used tokens, then the run time and the cache
mark at the line's end:

- `chat.rowClock`, chat's row part, draws the run time through chat's `rowClock` layout part, again once a second
  while the clock runs. It draws nothing for a session chat does not hold and for a clock paused at 0.
- `usage.rowCache`, usage's row part, draws the cache mark through usage's `rowCache` layout part: a cache icon,
  `status-error` once the cache is cold, its tooltip the minutes left.
- Each plugin orders its own row part's wrapper (`sessions.css`: a part may set its own wrapper's `order`):
  `usage.rowLine` 2 and `usage.rowCache` 4 in `usage.css`, `chat.rowClock` 3 with `margin-left: auto` in `chat.css`.
  `usage.rowLine` also has `margin-right: auto`: the two auto margins share the free room between the meter and the
  run time, and a row whose run time draws nothing (paused at 0) still has the cache mark at the line's end.

## Decisions

- **Permission waits pause the clock**: a turn waiting on the user is the user's time, and can sit for hours.
- **Chat owns the clock, not a plugin of its own**: a separate plugin would need chat to export its turn and
  background events, and could not save the total with the session.
- **The cache mark is its own usage row part**: the run time sits between the meter and the cache mark, and parts
  from two plugins order only as whole parts.
- **The second line never wraps**: the parts stay whole and the row stays two lines. When the line is too narrow the
  status gives way first (it ellipsizes, to nothing), then the meter's bar shrinks to nothing, the used tokens
  staying whole (`usage.rowLine` shrinks, its bar is the only part of it that can). A container query on
  `div.session-row-parts` was not used: `container-type: inline-size` gives the holder no intrinsic width, so with
  `flex: 1 1 auto` the status takes the whole line and the parts get none. Below that the other parts clip at
  the card edge with no ellipsis: measured at 12m 05s clocks, a plain row (meter, clock, cache) needs about 113px
  of line and clips below a side bar of about 136px, under `SIDE_BAR_MIN` (160), and a row with the workflow chip,
  the working line, meter, clock and cache needs about 258px of line, a side bar of about 282px, so it clips at
  the default 256 and below.
- **The cache mark turns cold at usage's next redraw**: usage redraws its lines once a minute, so the mark can lag
  the expiry by up to a minute.

## Out of scope

- Moving the activity dock's turn timer and the agent strip's task timers onto `ActiveTime`: both work today and
  time a span with no pauses.
