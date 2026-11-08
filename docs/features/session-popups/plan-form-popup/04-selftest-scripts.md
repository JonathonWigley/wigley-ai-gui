# 04 — Self-test scripts for the popup

Status: done
Type: Task
Wave: 3 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/main/selftest-script.ts` · `src/plugins/chat/main/selftest-script.ts` · `src/plugins/primer/main/selftest-script.ts` · and any other script `npm run selftest -- --plugin forms,chat,primer,docs,sessions` shows waiting on a Form/Primer tab line
Consumes:  `sessions.togglePopup` and its log lines `hid <title> popup in <label>` / `opened <title> popup in <label>` / `no popup in <label>` ← 01 · popups for rounds and primers ← 03 · `docs-session-tab` ← 02
Produces:  self-test groups that prove the popup's keys and its scope hand-back
Decisions: AGENTS.md § Running and testing (a key behaviour the agent adds gets a step in its plugin's script) · `<Leader>vf` is a leader sequence, which the placement check leaves out, so no step exists to satisfy that gate · a screenshot waits for a line logged after the slide settles (220 ms in Mocha), never the line that starts it

## What to build

- **forms 'second session'** (`SECOND_SESSION_STEPS`): the session has its Docs tab (the self-test starts
  `docs-session-tab`) and the round's popup, no Form tab. Replace the two `<A-o>` steps that wait for
  `[sessions] showed Docs tab in selftest 2` / `showed Form tab in selftest 2` with:
  1. ` v f` → `[sessions] hid Form popup in selftest 2`, alsoExpect `[docs] Docs tab shown`, `checksFit: true`
     (the fit check moves here from the removed step).
  2. `<A-o>` → `[sessions] no other tab in selftest 2` (a key that proves the sessions scope, not the form's, holds
     the keys while hidden; the bar is on screen by now), with screenshot `popup-hidden`.
  3. ` v f` → `[sessions] opened Form popup in selftest 2`. The `<D-w>` step after it
     (`[forms] closing the session asks to cancel selftest · Second self-test round`) proves the forms scope is back.
  Keep the `<D-w>` step and the forms keys after it. Rewrite the group's `why` (now "hides and shows its round's
  popup over its Docs tab"), and the 'pane resize' group's why at :1317 ("…on the Form tab" → "…in the round's popup").
- **chat 'permission card'**: the round opens a popup over the Chat tab. In order after the `y` step:
  ` v f` → `[sessions] hid Form popup in chat-selftest`, alsoExpect `[chat] Chat tab shown in chat-selftest`; then one
  chat-scope key with its exact existing line — read the next group's first step (`TRANSCRIPT_FOCUS_STEPS`) and pick
  a key whose effect that group does not depend on, or press its inverse straight after so the transcript focus is
  where that group expects; then ` v f` → `[sessions] opened Form popup in chat-selftest`; then the existing
  `[' ', ' ']` → `[forms] review opened` step, which carries screenshot `form-popup-over-chat` (logged well after the
  slide); then `<D-Enter>`, whose `[chat] Chat tab shown in chat-selftest` wait stays. Fix the group's why at :802
  ("…takes the Chat tab over until Cmd+Enter submits it" → "…opens a popup over the Chat tab until Cmd+Enter submits
  it") and the fixture round overview at :970 ("Takes over the Chat tab until submitted." → "Opens over the Chat tab
  until submitted.").
- **primer**: rewrite comments and why texts naming the Primer tab (`open()` comment at ~206 "the steps start on its
  Primer tab", group 'primer' why at ~239); steps stay.
- Run each touched plugin's script and fix every wait on a tab line that no longer happens. Do not run the whole
  self-test (AGENTS.md: only when the user asks).

GIVEN a round open in a session with a Docs tab WHEN ` v f` THEN the popup hides and the sessions keys reach the session (`<A-o>` logs); WHEN ` v f` again THEN the form's keys work (`<D-w>` asks to cancel the round)
GIVEN a round over a Chat tab WHEN hidden THEN a chat key acts on the chat; WHEN the round is submitted THEN the Chat tab's `shown` line is logged

Tests:     the steps above
Done when: `npm run selftest -- --plugin forms`, `--plugin chat`, `--plugin primer`, `--plugin docs` and `--plugin sessions` each pass; `.selftest/screenshots/forms-popup-hidden.png` (bar at the bottom, no popup) and `chat-form-popup-over-chat.png` (popup over a dimmed strip of the chat, no shadow) are read and match `DESIGN.md`
Commit:    one commit for the group

## Proof

Commit b91a040e · proof: diff read; worker ran selftest --plugin forms, chat, docs, sessions PASS and forms,primer PASS; typecheck and lint clean; screenshots read · concerns: chat's floating composer draws over the open popup (z-order; fix dispatched); primer alone fails on a pre-existing cross-script wait; screenshot corners/scrim not measurable (06 queries them)
