# 07 — The "from" tag on a message another session sent

Status: not started
Type: Task
Rung: standard · one new layout input field, read from the frame 06 writes, and one Tag in the default layout
Wave: 3 · Depends on: 06
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/plugins/chat/page/entry-list.ts`
- modify `src/plugins/chat/layouts/layout.d.ts`
- modify `src/plugins/chat/layouts/default/layout.js`
- modify `src/plugins/chat/layouts/default/layout.css`
- test `src/plugins/chat/page/entry-list.test.ts`
- test `src/plugins/chat/layouts/default/layout.test.ts`

Consumes:  `readAgentFrame(text)` from `src/plugins/chat/agent-frame.ts` ← 06
Produces:  `from: string | null` on `UserInput` in `src/plugins/chat/layouts/layout.d.ts`

Decisions:
- `entryInput` in `entry-list.ts` reads the user entry's text with `readAgentFrame`. For a framed message it gives
  `from: <name>` and `text: <body>`; for any other message `from: null` and the text as today. The transcript keeps
  the framed text: the agent in the target session reads the frame line, the user sees the Tag (round 4).
- Document `from` in the comment above `UserInput` in `layout.d.ts`: the sending session's name when another
  session's agent sent the message, else null; `text` is then the message without its frame line.
- `fillUserTurn` in the default `layout.js` draws `kit.tag(turn, 'from ' + input.from, 'neutral')` before the
  markdown when `from` is not null, with the class `chat-user-from`, as `rowProfile` draws its neutral Tag. The Tag's
  `title` is `Sent by the agent in session "<name>", not typed by the user`.
- `isUserTurnChanged` also compares `from`.
- `layout.css` gives `.chat-user-from` only the spacing the Tag needs above the text; colour and shape come from the
  kit's neutral Tag (DESIGN.md § Chat).
- Another layout that does not read `from` still draws the body text: the field is additive.

GIVEN a user entry whose text is a frame from `Planner` with body `go` WHEN `entryInput` builds its input THEN it has `from: 'Planner'` and `text: 'go'`
GIVEN a user entry with plain text WHEN `entryInput` builds its input THEN it has `from: null` and the text unchanged
GIVEN a user input with `from: 'Planner'` WHEN the default layout draws it THEN the turn shows a neutral Tag `from Planner` above the text
GIVEN two inputs that differ only in `from` WHEN `isUserTurnChanged` compares them THEN it returns true

Tests:
- `src/plugins/chat/page/entry-list.test.ts`: one `it.each` `a user entry's input carries the frame's sender and
  body` (rows: framed, plain). Search the file for a test that asserts `isLatestDelivery` and build beside it.
- `src/plugins/chat/layouts/default/layout.test.ts`: one `it.each` `a user turn draws the from Tag only for a framed
  message` (rows: `from: 'Planner'` → one `.chat-user-from` Tag with text `from Planner`; `from: null` → none), and
  one row in the existing `isUserTurnChanged` cases if the file has them, else one `it` that a changed `from`
  redraws the turn.

Done when: `npm run typecheck` passes; the test gate runs the tests above. The Tag in a live session is checked by 10
(Final verification), with a screenshot.
Commit:    one commit for the group
