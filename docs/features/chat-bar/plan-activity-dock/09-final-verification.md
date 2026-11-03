# 09 — Final verification

Status: in progress
Type: Task
Wave: 5 · Depends on: 06, 07
Plan: [plan.md](plan.md)

Files:     none (runs checks; screenshots land in `.selftest/screenshots/`, git-ignored, and drive captures in the
           run's `.drive/<run-id>/` folder)
Consumes:  every group 01–07
Produces:  the live checks below, each with its result and the capture it was read from
Decisions: the live checks follow `wigley:writing-tests` § What earns a live run instead: only what a unit test
           cannot see — layout, placement in the composer, the composer's height against the transcript, and
           wiring with no test over it. The rules the tests pin (the finished-line text, cost sum, held rule, tick,
           flag pick, hidden rows and stops, agent ids) earn no live check · tooling per `AGENTS.md`: the self-test
           (`npm run selftest -- --plugin <id>`, the agent may run it any time; the whole self-test only on the
           user's ask) and the drive run (`.agents/skills/drive/SKILL.md`)

## Runs

1. `npm run selftest -- --plugin chat` — chat's script with the groups 07 changed. Read every screenshot below
   against `DESIGN.md` § Surfaces › Chat.
2. `npm run selftest -- --plugin agent-strip` and `npm run selftest -- --plugin agent-lines` — their `fake: agents`
   turns now draw the dock beside the strip; the fit check covers `.chat-working-action`.
3. One drive run (`npm run drive -- start`, the drive skill's loop) for check 6, with a user chat layout written into
   the run's home.

## Checks

1. **expected — the live dock sits in the composer.** `chat-dock-live.png`: under the agent strip and above the box,
   the header `m:ss Working…` (or another state word), the 3 latest tool calls of the `fake: steps` turn in mono
   (`Bash false` failed in `status-error`, `Edit app.ts`, `Bash npm test` in `fg`), then the counts; the transcript
   above holds the user message and no activity line.
2. **expected — the finished line.** `chat-dock-done.png`: one dim line `Done · <time> · Bash 1` (the fake reports
   no cost, so no `$` part) in place of the live dock; the transcript shows the user message and the assistant reply, with no
   activity line and no `end_turn` row.
3. **low-confidence — the composer's height and the transcript.** In `chat-dock-live.png` and
   `chat-dock-done.png`, the last transcript entry sits fully above the composer, and the dock's shrink from live to
   done leaves no gap or overlap (`followComposerHeight` has no test over a row that changes height inside the
   composer).
4. **low-confidence — the dock hides.** `chat-dock-after-interrupt.png` (taken once the idle line is logged, task
   07): after Ctrl+C on the held turn (the fake sends no result), the composer holds no dock row and no empty space
   where it sat.
5. **low-confidence — main agent only, in the running app.** The agent-strip self-test's `strip` screenshot
   (`agent-strip-strip.png`): the dock lists the two `Agent` calls and counts `Agent 2`, and none of the
   subagents' `Read` and `Grep` calls, which show in their strip boxes.
6. **low-confidence — the flag on brings the rows back.** In the drive run, after `npm run drive -- start` (the
   run home exists only then), write `<run home>/.config/wigley-ai-gui/layouts/chat/activity-on/layout.js`
   exporting `export default { activityInTranscript: true };`. Then run
   `npm run drive -- setting chat.layout '"activity-on"'` and expect `applied: true` (the drive skill's documented
   route; do not hand-edit `settings.json`). Send `fake: tool` (type it, then Enter), wait for the idle line, and
   capture: the transcript shows the activity line and the `end_turn` row again. Then `Escape`, `k`, `k`: the first
   `k` logs `[chat] focused assistant entry`, the second `[chat] focused activity line` (the following focus rests
   on the result row). The layout reload's rebuild reading the flag is wiring no test covers. Delete nothing in the
   user's own config: the file goes only into the drive run's temp home.
7. **low-confidence — the layout preview's finished turn shows in the dock.** `chat-chat-preview.png` from run 1
   (the `layout preview` group's `chat-preview` screenshot): the preview tab's composer shows the finished line,
   and its transcript holds no activity line and no result row. Nothing else checks the preview's path to the
   dock (task 08 step 4 states it in the layouts design).

The checks only the user's hands or eyes settle: none. Synthetic keys and offscreen captures reach every check
above.

Done when: runs 1–3 complete; each check above is marked passed or failed with the capture it was read from; a
           failed check is reported with its capture path and fixed in a follow-up group before the plan closes
Commit:    none (no files change)

## Proof

