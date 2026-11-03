# 02 — Default layout look

Status: done
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/page/chat.css` ·
           modify `src/plugins/agents/main/selftest-script.ts` (one list entry and its comment) ·
           test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `WorkingInput`, `WorkingState`, the `working?` part, the stub `working` part in `layout.js` ← 01
Produces:  `working(parent, input, kit)` in the default layout object in `layout.js` (replaces 01's stub), returning
           `{ element, update(next) }` · `toolCounts(steps)` in `layout.js`, private
Decisions: header, box, counts per the sketch (rounds 1–2) · tool calls only in the box (round 1) · no cost slot
           (round 2) · result cost as `$0.00` (round 2, user note) · live run draws its summary (Decided) · newest
           box line is current, even when its tool has finished (cold read)

Read `DESIGN.md` first. Every value in `chat.css` is a design token.

Items:

1. **Shared counting.** Replace `toolTally` with `toolCounts(steps)`: it returns `[name, count]` pairs for the
   `tool` steps, most used first, ties in order of first use. The activity summary formats each pair as today (a
   count of 1 gives the name alone). The working counts format each pair as `name count`. One sort rule, two
   formats.
2. **`working` part.** It draws a root `div.chat-working` and fills it again on each update, as `activity` does.
   - Header `div.chat-working-head`: `span.chat-working-time` then `span.chat-working-state`.
     Time text: `max(0, now - startedAt)`, seconds rounded down, as `m:ss` under an hour (`0:00`, `0:59`, `1:05`,
     `59:59`) and `h:mm:ss` from one hour (`1:02:05`). A local helper in `layout.js`; `kit.duration` keeps its own
     format.
     State text: `Thinking…`, `Writing…`, `Working…`, `Waiting…` (the `…` character).
   - Box `div.chat-working-box`: the latest 5 `tool` steps, oldest first, one `div.chat-working-action` each. The
     last line has `is-current`. A tool step with an error result has `is-failed`; one line can have both.
     Line text: the tool name, one space, then the target. For `Read`, `Edit`, `Write` and `MultiEdit` the target
     comes from `input.file_path`, for `NotebookEdit` from `input.notebook_path`, when that field is a string: the
     text after its last `/` or `\`. Otherwise the target is the summary (the adapter cuts it at 80 characters).
     An empty target gives the name alone. Rename `LIVE_STEP_LINES` to `WORKING_ACTION_LINES` (value 5) and
     reword its comment for the box.
   - Counts `div.chat-working-counts`: `toolCounts` pairs as `name count`, joined by one space:
     `Read 3 Bash 2 Edit 1 Grep 1`.
   - With no tool step, the box and the counts are not drawn: the header only.
3. **`activity` part.** It always draws the summary line, live or finished, open or closed. Remove the live branch:
   the running dot, `div.chat-activity-head`, the shortlist, `activityShortlist` and `stepAction` (no other user).
   Keep the `is-live` class toggle. Update the file header comment, the `fillActivity` comment and the `activity`
   part comment to say this.
4. **`resultLine`.** Cost uses `toFixed(2)`: `$0.50`, `$0.00`. Duration stays as it is.
5. **`chat.css`.** Remove the rules only the live branch used: `.chat-activity-head`, `.chat-activity-action`,
   `.chat-activity-shortlist`, `.chat-activity-step` and its `is-current` and `is-failed` rules. Keep the summary,
   failed and time rules. Add the `.chat-working*` rules: tabular numerals on the time; the box as a card per
   `DESIGN.md` § Space, size and shape (`radius-md`) and § Surfaces; action lines in the mono font, one line each
   with an ellipsis; the current line `--wg-fg`, the rest `--wg-fg-tertiary`, a failed line `--wg-status-error`;
   the counts dim. Rewrite the block comment over the activity rules.
6. **Agents self-test.** In `src/plugins/agents/main/selftest-script.ts`, the `scrollsItself` list holds
   `.chat-activity-step`, an ellipsis box. Replace it with `.chat-working-action` and update its comment.

GIVEN a working input of 7 tool steps and 2 thinking steps WHEN the part draws THEN the box holds the last 5 tool
steps only, and the counts name every tool of the 7.

Tests:     `layout.test.ts`:
           · `result_lineFormats` — rows: `0.01234, 4210` → `end_turn · $0.01 · 4.2 s`; `0.5, null` →
             `end_turn · $0.50`; `0.004, null` → `end_turn · $0.00`; the null row stays.
           · the `default chat layout activity` table — `LiveClosed` and `LiveOpen` (both `sevenSteps` at 12000)
             expect the same lines: `chat-activity is-live`, then
             `span.chat-activity-steps:7 steps · Read 2 · Grep · Edit · Bash span.chat-activity-failed:· 1 failed span.chat-activity-time:· 12s`.
             `LiveClosedOneStep` expects `chat-activity is-live`, then
             `span.chat-activity-steps:1 step · Read span.chat-activity-time:· 3s`. Fix `UpdatedFromLiveToFinished`
             the same way. Delete `sevenStepHead` and the `chat-activity-shortlist` branch of `activityLines`.
           · a new `it.each` table `working_draws`, the root and each child described as `activityLines` does
             (box and counts children listed per line). Rows (startedAt 0):
             - no step, `thinking`, now 0 → header `0:00 Thinking…` only.
             - steps `Read a.ts, thinking, Read b.ts, Bash ls, Edit a.ts, thinking, Read c.ts, Grep todo (failed),
               Bash npm test (running)`, `working`, now 65000 → header `1:05 Working…`; box lines `Bash ls`,
               `Edit a.ts`, `Read c.ts`, `Grep todo` with `is-failed`, `Bash npm test` with `is-current`; counts
               `Read 3 Bash 2 Edit 1 Grep 1`.
             - one `Read` step with `input: { file_path: '/a/b/chat-kit.ts' }` and a 80-character summary ending
               in `…`, `waiting`, now 3725000 → header `1:02:05 Waiting…`; box `Read chat-kit.ts` with
               `is-current`; counts `Read 1`.
             - one `Bash` step, summary `npm test`, `writing`, now 59000 → `0:59 Writing…`; box `Bash npm test`.
             - now below startedAt (startedAt 5000, now 4000) → `0:00`.
           · one test: `update` with a new `now` redraws the header time.
Done when: `npm run typecheck`, `npm test` and `npm run lint` pass
Commit:    one commit for the group

## Proof

Commit 5df9b792 · proof: diff read: working part, toolCounts, summary-only activity, toFixed(2), CSS and selftest entry present; full typecheck and lint clean after 02 and 03; worker ran layout and agents tests 86 pass · concerns: chat/main/selftest-script.ts:592 activity-line why still says live header and shortlist (outside Files)
