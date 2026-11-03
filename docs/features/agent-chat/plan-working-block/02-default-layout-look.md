# 02 — Default layout look

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/page/chat.css` ·
           test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `WorkingInput`, `WorkingState`, the `working?` part ← 01
Produces:  `working(parent, input, kit)` in the default layout object in `layout.js`, returning
           `{ element, update(next) }`
Decisions: header, box, counts per the sketch (rounds 1–2) · tool calls only in the box (round 1) · no cost slot
           (round 2) · result cost as `$0.00` (round 2, user note) · live run draws its summary (Decided)

Read `DESIGN.md` first. Every value in `chat.css` is a design token.

Items:

1. **`working` part.** It draws a root `div.chat-working` and fills it again on each update, as `activity` does.
   - Header `div.chat-working-head`: `span.chat-working-time` then `span.chat-working-state`.
     Time text: `now - startedAt` as `m:ss` under an hour (`0:00`, `0:59`, `1:05`, `59:59`), `h:mm:ss` from one hour
     (`1:02:05`). Seconds round down. A local helper in `layout.js`; `kit.duration` keeps its own format.
     State text: `Thinking…`, `Writing…`, `Working…`, `Waiting…`.
   - Box `div.chat-working-box`: the latest 5 `tool` steps, oldest first, one `div.chat-working-action` each. The
     last line has `is-current`. A tool step with an error result has `is-failed`. Line text: the tool name, a
     space, then the target. The target is the summary. For `Read`, `Edit`, `Write`, `MultiEdit` and
     `NotebookEdit`, the target is the text after the last `/` or `\` of the summary. An empty summary gives the
     name alone. Rename `LIVE_STEP_LINES` to `WORKING_ACTION_LINES` (value 5) and keep its comment's meaning.
   - Counts `div.chat-working-counts`: every tool with its count, most used first, ties in order of first use, joined
     by a space, each always with its number: `Read 3 Edit 1 Bash 2`.
   - With no tool step, the box and the counts are not drawn: the header only.
2. **`activity` part.** It always draws the summary line, live or finished. Remove the live branch: the running dot,
   the header, the shortlist and `activityShortlist`. Keep the `is-live` class toggle. The open line still draws only
   the summary, and the app still places the step rows under it.
3. **`resultLine`.** Cost uses `toFixed(2)`: `$0.50`, `$0.00`. Duration stays as it is.
4. **`chat.css`.** Remove `.chat-activity-head`, `.chat-activity-action`, `.chat-activity-shortlist`,
   `.chat-activity-step` rules that only the removed live branch used; keep the summary, failed and time rules.
   Add the `.chat-working*` rules: tabular numerals on the time; the box as a card per `DESIGN.md` § Space, size
   and shape (`radius-md`) and § Surfaces; action lines in the mono font, one line each with an ellipsis; the
   current line in `--wg-fg`, the rest `--wg-fg-tertiary`, a failed line `--wg-status-error`; the counts dim.
   Update the block comment over the activity rules.

GIVEN a working input of 7 tool steps and 2 thinking steps WHEN the part draws THEN the box holds the last 5 tool
steps only, and the counts name every tool of the 7.

Tests:     `layout.test.ts`:
           · `result_lineFormats` — change the cost rows' expected text to two decimals; add a row with cost
             `0.004` → `$0.00`.
           · the `default chat layout activity` table — the live rows now expect the summary line
             (`span.chat-activity-steps…` and the time), with `is-live` on the root.
           · a new `it.each` table `working_draws`, rows: header only with no tool step (`0:00 Thinking…`) ·
             7 tools and 2 thinking steps → 5 box lines, last `is-current`, counts of all 7 · a failed tool →
             `is-failed` · file tool path `/a/b/chat-kit.ts` → `Read chat-kit.ts`, a Bash summary kept whole ·
             times 59 s → `0:59`, 65 s → `1:05`, 3725 s → `1:02:05`.
           · one test that `update` redraws with a new `now`.
Done when: compiles; `npm test` passes on `layout.test.ts`
Commit:    one commit for the group

## Proof
