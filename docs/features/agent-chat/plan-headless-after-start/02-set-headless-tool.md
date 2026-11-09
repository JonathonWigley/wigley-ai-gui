# 02 — The set_headless tool

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/main/set-headless-tool.ts` · modify `src/plugins/chat/main/start.ts` ·
           test `src/plugins/chat/main/set-headless-tool.test.ts` · test `src/plugins/chat/main/start.test.ts`
Consumes:  `HEADLESS_NOTE`, `HEADLESS_OFF_NOTE` in `src/plugins/chat/contract.ts` (exist) ·
           chat-sessions' `setHeadless(sessionId, headless)` and `sessions()` (exist) ·
           sessions' `contributeTools(tools, start, { mainAgentOnly: true })` (exists)
Produces:  `export const SET_HEADLESS_TOOL: ToolDefinition` in `set-headless-tool.ts`
           `export interface SetHeadlessToolDeps { owns(sessionId: string): boolean; setHeadless(sessionId: string, headless: boolean): void; log(line: string): void }`
           `export function setHeadlessToolSession(deps: SetHeadlessToolDeps): (session: AgentSession) => ToolSession`
Decisions: chat contributes it, main-agent only (Decided) · on and off (round 1 Q1) · result is the state's
           existing line (Decided) · unowned session errors (Decided)

Follow `start-session-tool.ts`'s shape: definition, deps, a tool session whose `call` rejects any other name.

Pinned values:

- `name`: `set_headless`
- `description`: `Turn this session's headless mode on or off in the Auri app. While the session is headless the app shows no forms round: every ask_round comes back answered with its recommendations. Turn it on only when the user hands you the rest of the run ("continue with your own suggestions", "run headless", "stop asking me, finish it"); a reply that takes your recommendations for one round answers that round only. Turn it off when the user asks to be asked again. Only a session the Auri app started can be headless. Returns the line that says whether the session is now headless.`
- `inputSchema`: `{ type: 'object', properties: { headless: { type: 'boolean', description: 'true turns headless on, false turns it off.' } }, required: ['headless'], additionalProperties: false }`
- results:
  - `headless` not a boolean → `errorResult('headless must be true or false.')`
  - `!deps.owns(session.id)` → `errorResult('Only a session the Auri app started can be headless; this session was not started by the app.')`, `setHeadless` not called
  - otherwise `deps.setHeadless(session.id, headless)`, log `set_headless <on|off> for <session.id>`, and
    `textResult(headless ? HEADLESS_NOTE : HEADLESS_OFF_NOTE)` — the same on a repeat call with the flag already set

Wiring in `start.ts`: a second `sessions.contributeTools([SET_HEADLESS_TOOL], setHeadlessToolSession({ owns, setHeadless, log }), { mainAgentOnly: true })`
beside the `START_SESSION_TOOL` contribution; `owns` reads `chat.sessions()` by `sessionId` (the same read
`profileOf` makes), `setHeadless` is `chat.setHeadless`.

GIVEN an owned session that is not headless WHEN set_headless {headless: true} runs THEN its flag is true and the result is HEADLESS_NOTE
GIVEN an owned headless session WHEN set_headless {headless: false} runs THEN its flag is false and the result is HEADLESS_OFF_NOTE
GIVEN a session chat does not own WHEN set_headless runs THEN the result is an error and no flag changes
GIVEN a subagent's call WHEN set_headless runs THEN chat's main-agent guard answers it and no flag changes (the contribution is marked mainAgentOnly)

Tests:     `set-headless-tool.test.ts` `setHeadless_Call_SetsTheFlagAndReturnsItsLine_given $given` — one `it.each`
           table over: owned + true → flag set true, HEADLESS_NOTE; owned + false → false, HEADLESS_OFF_NOTE;
           not owned → isError, no setHeadless call; `headless: 'yes'` → isError, no call. `start.test.ts` — its
           fake `contributeTools` (about line 342) records only `{ tools, start }`, so it records `options` too; one case
           that the `set_headless` contribution exists with `mainAgentOnly: true` and that a call on a started row
           flips `chat.exports.isHeadless(id)` (the wiring, once)
Done when: compiles; `npm run lint`; the tests above pass
Commit:    one commit for the group

## Proof

Commit 46bd354e · proof: diff read: all three Produces present in set-headless-tool.ts; wiring mainAgentOnly in start.ts; set-headless-tool + start tests 79 pass, no type errors · concerns: lint fails only on oxfmt in chat-sessions.test.ts (group 01's file, in progress)
