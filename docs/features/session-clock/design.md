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
  writes the clock to each session's key in the `chat.session` slot; the chat page offers it to other plugins through
  `ChatPageExports.activeTime`.
- The clock is an `ActiveTime` record (`src/contracts/active-time.ts`): the closed total and the moment the open span
  started, null while paused. Its functions are in `src/shared/active-time.ts`, and any clock that counts only while
  something runs builds on that module.

## Across relaunch

- Chat saves each session's total at the moment of the save, the open span included, with the session
  (`SavedSession.activeMs`). It saves at each start and stop of the clock, at every other save chat makes, and tries once
  more when chat stops, at quit or when chat is switched off. A quit waits for that write to settle (`src/main/quit-wait.ts`), so a
  quit that ends the app early, such as a second quit in a drive run, can still leave the last saved total, which can
  lack the whole open span. A restored session's clock starts paused at that total.
- A kept run's work while the app is closed is not counted. A run still working restarts its clock at relaunch, and a
  turn that ended meanwhile adds nothing, so the row's time can run below the run's own.
- A session opened from Claude's saved history (the resume picker) starts at zero, unless a saved record the restore
  skipped holds that session: the row takes over that record's total with its messages. A record of a row already
  open adds its total the same way.
- `/clear` resets the clock to zero: the run time describes the conversation in the row, as the transcript,
  context and cache do, and `/clear` starts a new conversation.

## The side-bar row

The row's second line holds other plugins' parts, then the context meter and its used tokens, the run time and the cache
mark at the line's end:

- `chat.rowClock`, chat's row part, draws the run time through chat's `rowClock` layout part, again once a second
  while the clock runs. It draws nothing for a session chat does not hold, and `0s` for a clock paused at 0.
- `usage.rowCache`, usage's row part, draws the cache mark through usage's `rowCache` layout part: a cache icon,
  `status-error` once the cache is cold or while the session has no usage yet, its tooltip the minutes left.
- Each plugin orders its own row part's wrapper (`sessions.css`: a part may set its own wrapper's `order`):
  `chat.rowProfile` -1, `chat.rowClock` 3 in `chat.css`, and `usage.rowLine` 2 and `usage.rowCache` 4 in `usage.css`.
  `usage.rowLine` also has `margin-left: auto`, which takes the free room, so the meter, run time and cache mark sit
  at the line's end. The used tokens hold at least `999k`'s width, the run time `00m 00s`'s and the cache mark its icon's,
  the last two even while they draw nothing, so the meters line up from row to row.

## Decisions

- **Permission waits pause the clock**: a turn waiting on the user is the user's time, and can sit for hours.
- **Chat owns the clock, not a plugin of its own**: a separate plugin would need chat to export its turn and
  background events, and could not save the total with the session.
- **The cache mark is its own usage row part**: the run time sits between the meter and the cache mark, and parts
  from two plugins order only as whole parts.
- **The second line wraps only on a narrow or crowded footer**: the parts stay whole. When the line is too narrow
  the meter's bar shrinks to its least width, the used tokens staying whole (under the default layout
  `usage.rowLine` shrinks, its bar the only part of it that can). When the parts still overflow the line, or on a
  footer narrower than `220px` (a side bar under about 243px) at any rate, the default layout moves the end group —
  the parts ordered 2 and later: meter, clock, cache — to a line of its own under the rest, its bar filling that
  line's free room. Sessions measures the overflow, since CSS cannot query content against its box: the parts
  holder carries `is-crowded` while its parts, laid on one line with the class off, need more than its width,
  measured a frame after the holder or a part resizes (`page/layout/row-crowding.ts`). A profile, the `No workflow`
  tag, the meter at its least width, the clock and the cache mark take 239px, more than the 233px footer of the
  side bar's default width. The `220px` rule stays for the rows that fit only by ellipsizing the workflow chip's
  stage tag to nothing. The break before the group is a full-width flex item, so it forms a line
  even on a row with no part ahead of it; the gap between the lines is each part's top margin, which the holder takes
  back once, rather than `row-gap`, so that empty line adds no height and two lines sit one gap apart. CSS cannot
  read a part's `order`, so a `:has()` guard on the break would have to name the end group's part ids in sessions'
  layout. The fixed slots alone (clock 50px, meter at its least 38px, cache 16px, two
  gaps) take about 116px, so at `SIDE_BAR_MIN` (160, a 137px footer) the `No workflow` tag and the working line had
  no room beside them and were cut off. The container is `div.session-row-foot`, which the row's grid sizes;
  `div.session-row-parts` cannot be one, as `container-type: inline-size` gives it no intrinsic width. Above `220px`
  a workflow chip's stage tag still ellipsizes before the line counts as crowded, as its least width is nothing.
- **The cache mark turns cold at usage's next redraw**: usage redraws its lines once a minute, so the mark can lag
  the expiry by up to a minute.

## Out of scope

- Moving the activity dock's turn timer and the agent strip's task timers onto `ActiveTime`: both work today and
  time a span with no pauses.
