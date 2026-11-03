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

Planned: `plan-row-clock/` beside this file.

## Active time

- A session's clock runs while its turn is `working` or while any subagent or background task runs
  (`background > 0`). It pauses while the session is idle and while a turn is `waiting` on a permission answer
  with no background work running.
- Chat main owns each session's clock, since chat alone holds both the turn state and the background count. It
  sends the clock in each session's state and on each change; the chat page offers it to other plugins through
  `ChatPageExports.activeTime` and the `activeTimeChanged` event.
- The clock is an `ActiveTime` record (`src/shared/active-time.ts`): the closed total and the moment the open span
  started, null while paused. Any clock that counts only while something runs builds on this module.

## Across relaunch

- Chat saves each session's closed total with the session (`SavedSession.activeMs`), at each start and stop of the
  clock and once more when the app quits. A restored session's clock starts paused at that total.
- A session opened from Claude's saved history (the resume picker) starts at zero: no active time was recorded for
  it.

## The side-bar row

The row's second line holds the status chip, the context meter and its used tokens, then the run time and the cache
mark at the line's end:

- `chat.rowClock`, chat's row part, draws the run time through chat's `rowClock` layout part, again once a second
  while the clock runs.
- `usage.rowCache`, usage's row part, draws the cache mark through usage's `rowCache` layout part: a cache icon,
  `status-error` once the cache is cold, its tooltip the minutes left.
- The sessions layout's CSS orders the row parts by their `data-part` id.

## Decisions

- **Permission waits pause the clock**: a turn waiting on the user is the user's time, and can sit for hours.
- **Chat owns the clock, not a plugin of its own**: a separate plugin would need chat to export its turn and
  background events, and could not save the total with the session.
- **The cache mark is its own usage row part**: the run time sits between the meter and the cache mark, and parts
  from two plugins order only as whole parts.
- **The cache mark turns cold at usage's next redraw**: usage redraws its lines once a minute, so the mark can lag
  the expiry by up to a minute.

## Out of scope

- Moving the activity dock's turn timer and the agent strip's task timers onto `ActiveTime`: both work today and
  time a span with no pauses.
