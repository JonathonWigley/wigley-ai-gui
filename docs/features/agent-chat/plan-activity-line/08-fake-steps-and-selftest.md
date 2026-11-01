# 08 — Fake steps turn and self-test steps

Status: in progress
Type: Batch
Wave: 4 · Depends on: 04, 07
Plan: [plan.md](plan.md)

Files:     modify `src/shared/fake-agent-harness.ts` · test `src/shared/fake-agent-harness.test.ts` · modify `src/plugins/chat/main/selftest-script.ts`
Consumes:  the log lines `focused activity line`, `expanded activity line`, `collapsed activity line` from `chat-commands.ts` ← 07
           `createFakeAgentHarness(clock: Clock)` and its per-id `at` stamping in `src/shared/fake-agent-harness.ts` ← 04
Produces:  `export const FAKE_STEPS_TEXT = 'fake: steps';` in `src/shared/fake-agent-harness.ts`
           the self-test group `activity line` and the changed `transcript focus` group in `src/plugins/chat/main/selftest-script.ts`
Decisions: **fake**: a send of `FAKE_STEPS_TEXT` emits the user entry and `working` (as every send does), then these steps in order, each tool with its result already set, and holds the turn open as `FAKE_HOLD_TEXT` does, so `interrupt` ends it with the `Interrupted` notice and `idle`. Ids are `step-<turn>-<n>`, n from 1. Steps:
           1. `tool` Read, input `{ file_path: 'src/app.ts' }`, summary `src/app.ts`, result ok
           2. `tool` Read, `src/view.ts`, result ok
           3. `tool` Read, `src/state.ts`, result ok
           4. `tool` Bash, input `{ command: 'false' }`, summary `false`, result `{ text: 'exit code 1', isError: true }`
           5. `tool` Edit, `src/app.ts`, result ok
           6. `tool` Bash, `npm test`, result ok
           7. `thinking`, text `Checking the test output.`, `streaming: false`
           Each step takes `at` from the fake's clock as 04 stamps every entry, so with the app's real clock the held turn's live line ticks once a second from the user entry's time until `interrupt`; a drive run captures it ticking (10)
           The last step is the only `thinking` entry, so `[chat] thinking entry added in chat-selftest` marks the whole run arrived. Finished, the run reads `7 steps · Read 3 · Bash 2 · Edit · 1 failed · <time>`, the time from the user entry to the `Interrupted` notice
           **self-test, `transcript focus` group** (the fake's tool turn is user, tool, assistant, result): steps after `Escape → left the box` become: `k` → `[chat] focused assistant entry`; `k` → `[chat] focused activity line`; `j` → `[chat] focused assistant entry`; `k` → `[chat] focused activity line`; `Enter` → `[chat] expanded activity line` (checksFit, screenshot `activity-open`); `j` → `[chat] focused tool entry`; `Enter` → `[chat] expanded tool entry` (checksFit, screenshot `step-open`); `k` → `[chat] focused activity line`; `Enter` → `[chat] collapsed activity line`; then `g g` and `G` as today. The group's `why` says the tool now sits in an activity line that Enter opens into step rows
           **self-test, new group `activity line`**, placed right after `transcript focus`, why: `A held steps turn draws the live header and shortlist with the box focused (no frame, no marked entry); Ctrl+C ends it into the finished line with its failed count; Esc shows the focused entry's left bar.` Steps: `sendKeys(FAKE_STEPS_TEXT)` → `[chat] thinking entry added in chat-selftest`, screenshot `activity-live`; `<C-c>` → `[chat] notice entry added in chat-selftest`; `Escape` → `[chat] left the box`; `k` → `[chat] focused activity line`, screenshot `activity-finished`
           match the file's existing step shapes (`sendKeys`, `expect`, `screenshot`, `checksFit`); add no new runner feature
GIVEN a fake process WHEN `FAKE_STEPS_TEXT` is sent THEN it emits the user entry, `working`, the seven steps in order, each with the fake clock's `at`, and no result, and an `interrupt` then emits the `Interrupted` notice and `idle`
Tests:     `fake-agent-harness.test.ts`: `send_StepsText_EmitsStepsAndHoldsTurnOpen` — the emitted entry kinds and ids in order, no `result` entry, the last activity `working`; then `interrupt` emits the notice and `idle` (follow `send_HoldText_HoldsTurnOpen` and `interrupt_HeldTurn_EndsWithNotice`)
Done when: compiles; the test gate runs `fake-agent-harness.test.ts`; the self-test itself runs in 10
Commit:    one commit for the group

## Proof

