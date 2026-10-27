# 05 — Self-test: resting session

Status: not started
Type: Task
Wave: 4 · Depends on: 03, 04
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/selftest-script.ts`
Consumes:  the resting behaviour and its log lines ← 03, 04 (`<name> rested`, `<name> has no running process`)
Produces:  the `resting session` group in `src/plugins/chat/main/selftest-script.ts`, replacing `ended session`
Decisions: an exit rests and the next message resumes in place (round 2) · `chat.ended` is gone (design review)

Behaviour:

- Rename `ENDED_SESSION_STEPS` to `RESTING_SESSION_STEPS` and the group `ended session` to `resting session`.
- Its steps: show `chat-second`; send `FAKE_END_TEXT` and expect `[chat] chat-second rested`; `<Leader>ce` in the
  box expects the control-pick log `chat-second has no running process` (the bind now exists in `chat.chat`);
  Esc leaves the box; `j` expects `[chat] focused notice entry` (why: the exit notice follows the sent message);
  then send a message and expect the fake's reply entry
  (`[chat] assistant entry added in chat-second`), proving the send restarted the process in the same row; then
  back to `chat-selftest` as today.
- The group's `why`: the fake's end leaves the second session resting in its row, where control keys log that no
  process runs, the entry keys still work, and the next message starts the process again in place.
- Fix the comment above the steps (`stays ended for the rest of the run` no longer holds) and every later step that
  relied on `chat-second` being ended; read the groups after this one for that.
- The self-test's plugin data lives in its temp home, removed after each run, so every run starts with no saved
  file; nothing to clear.

GIVEN the second session's process ended by `fake: end` WHEN the self-test sends another message there THEN the fake
replies in the same row.

Tests:     the self-test group above is this task's check
Done when: `npm run selftest` passes
Commit:    one commit for the group

## Proof
