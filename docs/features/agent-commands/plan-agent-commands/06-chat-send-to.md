# 06 — Chat sends to another session, framed

Status: not started
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

Consumes:  `MainCommandContext.callerSessionId` and `CommandDecl.risky` ← 01
Produces:  `export function agentFrame(senderName: string, text: string): string` in `src/plugins/chat/agent-frame.ts`
           `export function readAgentFrame(text: string): { from: string; body: string } | null` in `src/plugins/chat/agent-frame.ts`
           command `chat.sendTo`, arg `{ sessionId: 'string', text: 'string' }`, `runsIn: 'main'`, in `src/plugins/chat/manifest.ts`
           `isUnattended(sessionId: string): boolean` on chat's main exports in `src/plugins/chat/contract.ts`

Decisions:
- The frame, pinned: `[Message from the agent in session "<name>" — not typed by the user]`, a newline, then the text
  (round 4). `readAgentFrame` reads back exactly what `agentFrame` writes: a first line of that shape gives
  `{ from: <name>, body: <rest> }`; any other text gives `null`. A name holding `"` round-trips.
- The frame module sits at the plugin root, beside `manifest.ts`, because main (06) and the page (07) both read it and
  neither imports the other's process folder.
- `sendTo` sends `agentFrame(name, text)` into the target through chat's own `send` path, so it queues behind a
  running turn and starts a held session as a typed message does.
- The sender name is the caller's `editableTitle` from sessions' titles, else `sessions.label(callerId)`, else the
  caller's id. With no `callerSessionId` the name is `the app` — a key or click never runs `sendTo`, as it has no
  bindings, but a manifest-declared command can be run from anywhere.
- `sendTo` refuses, by throwing, so a reporting run rejects (01):
  - empty or blank `text` → `Error('chat.sendTo: no text')`
  - a target equal to the caller → `Error('chat.sendTo: a session cannot send to itself')`
  - a target chat holds no session for → `Error('chat.sendTo: no chat session <id>')`
- `sendTo` takes its target from its argument, not from `targetSessionId`: the agent names the target in the tool's
  `session` field, and 08 passes it as both.
- `isUnattended(id)` reads the held session's `unattended` flag — set by a `launch` request with `unattended: true`,
  which makes the row deny each permission prompt at once — as `isHeadless` reads `headless` (search
  `isHeadless: (sessionId)` in `chat-sessions.ts`). It is false for an id chat does not hold. 08 refuses a risky
  command for a caller that is headless or unattended, since no user watches either.
- `firstMessageTitleOf(text)` titles a framed first message from its body, so the target's tab does not read
  "[Message from the agent…".
- Mark `stopAll`, `allowOrCopy` and `allowEntry` `risky: true` (round 2): `allowOrCopy` and `allowEntry` would let an
  agent approve another session's tool permission.
- `sendTo` gets no binding and no label in any menu: it is for agents.

GIVEN a sender name `Plan "auth"` and text `a\nb` WHEN `readAgentFrame(agentFrame(name, text))` runs THEN it returns `{ from: 'Plan "auth"', body: 'a\nb' }`
GIVEN plain text, or a first line that only starts like the frame WHEN `readAgentFrame` reads it THEN it returns null
GIVEN sessions A (titled `Planner`) and B WHEN `chat.sendTo {sessionId: 'B', text: 'go'}` runs with `callerSessionId: 'A'` THEN B receives the framed text with name `Planner`
GIVEN a target equal to the caller, blank text, or an unknown target WHEN `chat.sendTo` runs THEN it throws the text pinned above and sends nothing
GIVEN a framed first message WHEN the session takes its first-message title THEN the title comes from the body

Tests:
- `src/plugins/chat/agent-frame.test.ts` (new): `it.each` `readAgentFrame reads back what agentFrame writes` (rows:
  plain name, name with `"`, multi-line body, empty-line body); `it.each` `readAgentFrame returns null for text that
  is not a frame` (rows: plain text, the frame's opening words without the closing `]`, the frame on a second line).
- `src/plugins/chat/main/start.test.ts`: one `it.each` `sendTo sends the framed text to the target or refuses` (rows:
  titled caller, untitled caller falling back to the label, no caller → `the app`, self-send, blank text, unknown
  target). Search the file for an existing command-handler test of chat's main part and build beside it.
- `src/plugins/chat/main/chat-sessions.test.ts`: add a framed row to the existing first-message title test (search
  `firstMessageTitleOf`), expecting the body's title; one `it.each` for `isUnattended` (a launch with
  `unattended: true`, a plain start, an unknown id).

Done when: `npm run typecheck` passes; the test gate runs the tests above; `grep -c 'risky: true'
src/plugins/chat/manifest.ts` prints 3. The send between two live sessions is checked by 10 (Final verification).
Commit:    one commit for the group
