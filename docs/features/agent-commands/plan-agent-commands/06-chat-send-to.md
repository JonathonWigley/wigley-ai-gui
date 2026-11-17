# 06 — Chat sends to another session, framed

Status: done
Type: Task
Rung: hard · a new main command over chat's session store, the frame rule both processes read, and the title rule
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- create `src/plugins/chat/agent-frame.ts`
- test `src/plugins/chat/agent-frame.test.ts`
- modify `src/plugins/chat/manifest.ts`
- modify `src/plugins/chat/contract.ts`
- modify `src/plugins/chat/main/start.ts`
- modify `src/plugins/chat/main/chat-sessions.ts`
- test `src/plugins/chat/main/start.test.ts`
- test `src/plugins/chat/main/chat-sessions.test.ts`

Consumes:  `MainCommandContext.callerSessionId`, `CommandDecl.risky`, `CommandDecl.targets` ← 01
Produces:  `export function frameAgentMessage(senderName: string, text: string): string` in `src/plugins/chat/agent-frame.ts`
           `export function readAgentFrame(text: string): { from: string; body: string } | null` in `src/plugins/chat/agent-frame.ts`
           `export function frameSenderName(title: string | null, label: string | null, sessionId: string): string` in `src/plugins/chat/agent-frame.ts`
           command `chat.sendTo`, arg `{ sessionId: 'string', text: 'string' }`, `runsIn: 'main'`, in `src/plugins/chat/manifest.ts`
           `isUnattended(sessionId: string): boolean` and `senderName(sessionId: string): string` on `ChatMainExports` in `src/plugins/chat/contract.ts`

Decisions:
- **One spelling** (lead ruling 2): the writer is `frameAgentMessage`, the reader `readAgentFrame`, everywhere.
- **The frame**, pinned: `[Message from the agent in session "<name>" — not typed by the user]`, then a newline, then
  the text (round 6). The dash is U+2014.
- **The sender name** (lead ruling 4). `frameSenderName(title, label, sessionId)` owns the rule, and 08 consumes it
  through `senderName`:
  1. Collapse each run of whitespace in `title` (newlines included) to one space, and trim.
  2. Longer than 80 characters (code points): keep the first 79 and add `…`.
  3. Empty: do the same to `label`. Still empty: use `sessionId`.
  4. Escape `\` as `\\` and `"` as `\"`. Escaping `\` too lets `readAgentFrame` read back a name that holds `\"`
     (Decided).
  - `senderName(id)` is chat main's export. It calls `frameSenderName(editableTitle(sessions.titles(id)),
    sessions.label(id), id)`.
- **`readAgentFrame`** reads back exactly what `frameAgentMessage` writes:
  - The first line must match `^\[Message from the agent in session "((?:[^"\\]|\\.)*)" — not typed by the user\]$`.
  - `from` is the captured name with the escapes undone. `body` is everything after the first newline.
  - Any other text gives `null`, including a frame line with no newline after it.
- The frame module sits at the plugin root, beside `manifest.ts`, because main (06) and the page (07) both read it and
  neither imports the other's process folder.
- **`sendTo` handler.** It goes in the `commands` map chat main's `start` returns. It reuses the session store's
  `holds`/`requireHeld` checks, and sends through chat's own `send` path. So it queues behind a running turn and starts
  a held session, as a typed message does.
- **Framing** (lead ruling 3):
  - With a `callerSessionId`, `sendTo` sends `frameAgentMessage(senderName(caller), text)`.
  - With no caller (a user's key or click), it sends `text` as typed, unframed.
  - The text is sent untrimmed.
- **Slash text** (lead ruling 3). `sendTo` never runs an app slash command. `/clear` and `/login` live only in the page
  (`page/chat-commands.ts`), and `sendTo` goes through main's `send`. A framed text starts with `[`, so no slash rule
  reads it. An unframed text that starts with `/` goes to the harness as the message text.
- **Refusals.** `sendTo` refuses by throwing, so a reporting run rejects (01). The checks run in this order:
  1. empty or blank `text` → `Error('chat.sendTo: no text')`
  2. a target equal to the caller → `Error('chat.sendTo: a session cannot send to itself')`
  3. a target chat holds no session for → `Error('chat.sendTo: no chat session <id>')`. This covers a terminal row
     and the layout preview's session.
- `sendTo` takes its target from its argument, not from `targetSessionId`, and is not flagged `targets`. 08 passes the
  argument through and validates `arg.sessionId` as a row.
- **`isUnattended(id)`** reads the held session's `unattended` flag, as `isHeadless` reads `headless` (search
  `isHeadless: (sessionId)` in `chat-sessions.ts`).
  - The flag is set by a `launch` request with `unattended: true`, and kept on a restored row.
  - It is false for an id chat does not hold.
  - Add it to the `ChatSessions` interface beside `isHeadless`, and to chat main's exports.
  - 08 refuses a risky command for a caller that is headless or unattended, since no user watches either.
- **Titles** (lead ruling 5). `firstMessageTitleOf(text)` titles a framed message from its body. It serves both the send
  path and the resume path (`firstMessage: firstMessageTitleOf(request.title)`), so a resumed framed row keeps the body
  title.
- **Flags in `src/plugins/chat/manifest.ts`.**
  - `risky: true` (04's rule) on `stopAll`, `endSession`, `allowOrCopy`, `allowEntry`, `removeImage`, `removeImageAt`
    and `removeShownImage`.
  - `targets: true` (04's rule) on `send`, `sendNow`, `interrupt` and `allowOrCopy`.
- `sendTo` gets no binding and no label in any menu: it is for agents.

GIVEN a sender name `Plan "auth"` and text `a\nb` WHEN `readAgentFrame(frameAgentMessage(name, text))` runs THEN it returns `{ from: 'Plan "auth"', body: 'a\nb' }`
GIVEN a title `fix the\nlogin  bug` WHEN `frameSenderName` runs THEN it returns `fix the login bug`; a 100-character title gives 79 characters and `…`; a blank title gives the label, else the id
GIVEN plain text, or a first line that only starts like the frame WHEN `readAgentFrame` reads it THEN it returns null
GIVEN sessions A (titled `Planner`) and B WHEN `chat.sendTo {sessionId: 'B', text: 'go'}` runs with `callerSessionId: 'A'` THEN B receives the framed text with name `Planner`, through `send`
GIVEN no caller WHEN `chat.sendTo {sessionId: 'B', text: '/clear'}` runs THEN B receives `/clear` unframed through `send`, and no app slash command runs
GIVEN blank text to an unknown target WHEN `chat.sendTo` runs THEN it throws `chat.sendTo: no text` and sends nothing
GIVEN a framed first message, sent or resumed WHEN the session takes its first-message title THEN the title comes from the body

Tests:
- `src/plugins/chat/agent-frame.test.ts` (new):
  - `it.each` `readAgentFrame reads back what frameAgentMessage writes`, with rows for a plain name, a name with `"`, a
    name with `\"`, a multi-line body and an empty-line body.
  - `it.each` `readAgentFrame returns null for text that is not a frame`, with rows for plain text, the frame's opening
    words without the closing `]`, the frame on a second line, and a frame line with no newline.
  - `it.each` `frameSenderName cleans, caps and falls back`, with rows for newlines, a long title, a blank title with a
    label, and blank title and label.
- `src/plugins/chat/main/start.test.ts`: one `it.each` `sendTo sends the framed text to the target or refuses`. Search
  the file for an existing command-handler test of chat's main part and build beside it.
  - Rows:
    - a titled caller
    - an untitled caller, falling back to the label
    - no caller, giving unframed text
    - no caller with `/clear`
    - a running target, which queues the message (the `send` path)
    - a self-send
    - blank text
    - blank text with an unknown target (the blank refusal wins)
    - a terminal row's id (`no chat session`)
- `src/plugins/chat/main/chat-sessions.test.ts`:
  - Add a framed row to the existing first-message title test (search `firstMessageTitleOf`), expecting the body's
    title, and a resume row with a framed `request.title`.
  - One `it.each` for `isUnattended`, with rows for a launch with `unattended: true`, a restored unattended row, a plain
    start and an unknown id.

Done when: `npm run typecheck` passes; the test gate runs the tests above; `grep -c 'risky: true'
src/plugins/chat/manifest.ts` prints 7 and `grep -c 'targets: true'` prints 4. The send between two live sessions is
checked by 10 (Final verification).
Commit:    one commit for the group

## Proof

Commit 11db446db · proof: diff read: frameAgentMessage, readAgentFrame, frameSenderName in chat/agent-frame.ts; chat.sendTo in the manifest (runsIn main, arg sessionId/text); isUnattended and senderName on ChatMainExports; wave-2 typecheck passes · concerns: sendTo needed a label and group (label: send a message to another session, framed as its agent's; group chat); the 'running target' test row is the likeliest to fail; the fake sessions gained label and the harness exposes titles/labels
