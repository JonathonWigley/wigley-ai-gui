# 07 — Self-test scripts follow the dock

Status: in progress
Type: Batch (chat's script groups; the two comment fixes in agent-strip's and agent-lines' scripts)
Wave: 4 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/selftest-script.ts` · modify `src/plugins/agent-strip/main/selftest-script.ts`
           (comment only) · modify `src/plugins/agent-lines/main/selftest-script.ts` (comment only)
Consumes:  the default layout's hiding (`activityInTranscript: false`) ← 05 · the dock in the composer ← 06 (at run
           time only; this task compiles without it) · `FAKE_TOOL_TEXT`, `FAKE_STEPS_TEXT` in
           `src/shared/fake-agent-harness.ts` (exist) · the page log lines `[chat] <kind> entry added in <tab>`,
           `[chat] focused <kind> entry`, `[chat] <tab> is <activity>` (exist)
Produces:  in `src/plugins/chat/main/selftest-script.ts`: `VISUAL_STEPS`, `TRANSCRIPT_FOCUS_STEPS` and a renamed
           `ACTIVITY_DOCK_STEPS` (from `ACTIVITY_LINE_STEPS`), and the groups `transcript focus` and
           `activity dock` (renamed from `activity line`)
Decisions: the self-test follows the new default rather than installing a layout with the flag on (D7) · the dock
           is no stop, so no step focuses it (decision 1) · the fake's interrupt leaves no result, so the dock hides
           after Ctrl+C, captured once the idle line is logged (D3, precondition 9; task 06's `drawTurn` order) · `.chat-working-action` stays in the agent scripts' `scrollsItself`
           (decision 7, precondition 6)

## What changes

`TRANSCRIPT_FOCUS_STEPS` (a `fake: tool` turn: user, tool, assistant, result; the transcript shows user and
assistant):

1. `sendKeys(FAKE_TOOL_TEXT)` → expect `[chat] chat-selftest is idle`, `alsoExpect` the line
   `[chat] result entry added in chat-selftest`, `screenshot: 'dock-done'`, `checksFit: true`.
2. `Escape` → `[chat] left the box`.
3. `k` → `[chat] focused user entry`; `j` → `[chat] focused assistant entry`.
4. `g g` → `[chat] focused the first entry`; `G` → `[chat] following the latest entry`.

The steps that opened the activity line and its tool step (`expanded activity line`, `focused tool entry`,
`expanded tool entry`, the `activity-open` and `step-open` screenshots) go: the default draws neither.

`ACTIVITY_DOCK_STEPS` (a held `fake: steps` turn):

1. `sendKeys(FAKE_STEPS_TEXT)` → expect `[chat] thinking entry added in chat-selftest`,
   `screenshot: 'dock-live'`, `checksFit: true`.
2. `<C-c>` → expect `[chat] chat-selftest is idle`, `alsoExpect` the line
   `[chat] notice entry added in chat-selftest` (`NOTICE_LINE`'s text; `alsoExpect` takes a pattern, such as
   `/^\[chat\] notice entry added in chat-selftest$/`), `screenshot:
   'dock-after-interrupt'`. The step waits for the idle line, not the notice: the fake emits the notice before it
   goes idle, and the dock hides on the idle path (task 06 calls `drawTurn` before that log line), so a capture
   taken on the notice can still show the live dock.
3. `Escape` → `[chat] left the box`.
4. `k` → `[chat] focused user entry`; `G` → `[chat] following the latest entry`.

Group `why` texts state what each group now proves:

- `transcript focus`: "A tool turn's transcript holds its user and assistant entries only, focus following the
  assistant: k and j walk them, gg focuses the first entry and G follows the latest; the activity dock shows the
  finished turn's one line."
- `activity dock`: "A held steps turn draws the live activity dock in the composer (the time and state word, the
  main agent's 3 latest tool calls, the counts) with the box focused; Ctrl+C ends it with the fake's notice and no
  result, so the dock hides; Esc shows the focused entry's left bar; k focuses the user entry and G follows the
  latest again."

`VISUAL_STEPS` (a `fake: visual` turn ending in a result): its `k` step (`focused assistant entry`, why "The reply
holding both visuals sits above the result.") goes. Under the default the result is no stop, so after `Escape` the
following focus already sits on the reply, and `v` opens the overlay from there; the `Escape` step's `why` says so.

No other group changes. Every other group of chat's script was checked against the new default at plan time
(`sending`, `slash completion`, `interrupt and close`, `row activity`, `images`, `resting session`, `layout preview`
and the rest): each expects only logs that stay (`[chat] <kind> entry added in <tab>` is logged for hidden kinds
too) or stops that stay (notices, pending rows, the first user entry). The commit message lists the `visuals` `k`
step, the two rewritten groups and the renamed constant. The removed screenshots (`activity-open`, `step-open`,
`activity-live`, `activity-finished`) have no reference outside this script.

`agent-strip` and `agent-lines` scripts: in each `scrollsItself` comment, "the working block's tool calls" becomes
"the activity dock's tool calls". The selector lists stay.

Tests:     no unit test; the script is proved by the self-test run in 09
Done when: `npm run typecheck` and `npm run lint` pass
Commit:    one commit for the group

## Proof

