# 07 — The "from" tag wherever the page shows a framed message

Status: not started
Type: Task
Rung: standard · one new layout input field read from the frame 06 writes, and one Tag in the default layout, as `rowProfile` draws its Tag (`layout.js`)
Wave: 3 · Depends on: 05, 06
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/plugins/chat/page/entry-list.ts`
- modify `src/plugins/chat/page/chat-commands.ts`
- modify `src/plugins/chat/layouts/layout.d.ts`
- modify `src/plugins/chat/layouts/default/layout.js`
- modify `src/plugins/chat/layouts/default/layout.css`
- test `src/plugins/chat/page/entry-list.test.ts`
- test `src/plugins/chat/page/chat-commands.test.ts`
- test `src/plugins/chat/layouts/default/layout.test.ts`

Consumes:  `readAgentFrame(text)` from `src/plugins/chat/agent-frame.ts` ← 06
           05 changes `src/plugins/chat/page/chat-commands.ts` and its test first (shared file)
Produces:  `from: string | null` on `UserInput` and on `QueuedMessageInput` in `src/plugins/chat/layouts/layout.d.ts`

Decisions:
- **Where the frame is read** (lead ruling 5). Every place the page shows a user message's text reads it through
  `readAgentFrame`. The transcript keeps the framed text: the agent in the target session reads the frame line, and
  the user sees the Tag (round 4).
  - **Entries**: `entryInput` in `entry-list.ts` gives a framed user entry `from: <name>` and `text: <body>`. Any
    other entry gets `from: null` and its text as today.
  - **Pending rows**: `queuedInput` in `entry-list.ts` does the same for a queued message.
  - **Copy and range**: `stopText` in `entry-list.ts` returns the body for a framed user entry or queued message.
    The block line marks (`data-md-lines`) count from the drawn body, so `selectedSource` copies the lines the user
    sees.
  - **Back in the box**: `putBack` in `chat-commands.ts` puts the body of a framed message into the box, without the
    frame line. A user who sends it again sends it as their own.
- Document `from` in the comments above `UserInput` and `QueuedMessageInput` in `layout.d.ts`: it is the sending
  session's name when another session's agent sent the message, else null. `text` is then the message without its frame
  line.
- **The user turn.** `fillUserTurn` in the default `layout.js` draws `kit.tag(turn, 'from ' + input.from, 'neutral')`
  before the markdown when `from` is not null, as `rowProfile` draws its neutral Tag.
  - The Tag gets the class `chat-user-from` and the `title` `Sent by the agent in session "<name>", not typed by the
    user`.
  - `isUserTurnChanged` also compares `from`.
- **The pending row.** `queuedMessage` draws the same Tag before its text when `from` is not null.
- `layout.css` gives `.chat-user-from` `margin-bottom: var(--wg-space-1)`, the token `.chat-user-delivery` uses. The
  colour and shape come from the kit's neutral Tag (DESIGN.md § Chat).
- Another layout that does not read `from` still draws the body text, since the field is additive.

GIVEN a user entry whose text is a frame from `Planner` with body `go` WHEN `entryInput` builds its input THEN it has `from: 'Planner'` and `text: 'go'`
GIVEN a user entry with plain text WHEN `entryInput` builds its input THEN it has `from: null` and the text unchanged
GIVEN a framed queued message WHEN `queuedInput` builds its input THEN it has the sender and the body
GIVEN a framed entry with a two-block body WHEN the user copies its second block THEN the copy is that block's own lines, with no frame line
GIVEN a framed message returned to the box WHEN `putBack` places it THEN the box holds the body only
GIVEN a user input with `from: 'Planner'` WHEN the default layout draws it THEN the turn's children are the Tag `from Planner`, then the markdown
GIVEN two inputs that differ only in `from` WHEN `isUserTurnChanged` compares them THEN it returns true

Tests:
- `src/plugins/chat/page/entry-list.test.ts`:
  - One `it.each` `a framed message's input carries the sender and the body`. Its rows are a framed entry, a plain
    entry, a framed queued message and a plain queued message. Search the file for a test that asserts
    `isLatestDelivery` and build beside it.
  - Add a framed row to the existing `selectedSource` copy test: a two-block body, where the second block copies its own
    lines.
- `src/plugins/chat/page/chat-commands.test.ts`: add a framed row to the existing `putBack` test, expecting the box to
  hold the body only.
- `src/plugins/chat/layouts/default/layout.test.ts`:
  - Add `tag: (parent, text, tone) => part(parent, 'span', \`tag:${text}:${tone}\`)` to `fakeKit()`.
  - One `it.each` `a user turn draws the from Tag only for a framed message`. Rows: `from: 'Planner'` gives children
    `['tag:from Planner:neutral', 'markdown:go (fences off)']`; `from: null` gives `['markdown:go (fences off)']`.
  - One row for the queued message the same way.
  - One `it` that a changed `from` redraws the turn (`isUserTurnChanged`).
  - Existing rows that build a `UserInput` or `QueuedMessageInput` gain `from: null`.

Done when: `npm run typecheck` passes; the test gate runs the tests above. The Tag's class and title in a live session
are checked by 10 (Final verification), with a screenshot and a `query`.
Commit:    one commit for the group
