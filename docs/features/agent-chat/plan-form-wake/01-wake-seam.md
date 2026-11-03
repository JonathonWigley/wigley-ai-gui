# 01 — Wake seam in the form service, and the chat adapter

Status: in progress
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/agent-forms.ts` · modify `src/shared/agent-forms/form-service.ts` ·
           create `src/shared/agent-forms/chat-wake.ts` · test `src/shared/agent-forms/form-service.test.ts` ·
           test `src/shared/agent-forms/chat-wake.test.ts` · modify `src/plugins/forms/main/round-type.test.ts` and
           `src/plugins/primer/main/primer-type.test.ts` (their `createAgentFormService(` calls pass `NO_FORM_WAKE`)
Consumes:  `ChatMainExports.send` / `profileOf` shapes (tree, structurally restated); `UserMessage` from `src/contracts/agent.ts`
Produces:  in `src/contracts/agent-forms.ts`:
           `export interface AgentFormWake { formFinishedUnheard(sessionId: string, text: string): void; }`
           with a doc comment stating that it must not throw and must return at once (delivery is fire-and-forget)
           in `src/shared/agent-forms/form-service.ts`: `AgentFormServiceDeps` gains `wake: AgentFormWake` (required)
           in `src/shared/agent-forms/chat-wake.ts`:
           `export interface ChatFormWakeTarget { profileOf(sessionId: string): string | null; send(sessionId: string, message: UserMessage): Promise<void>; }`
           `export function createChatFormWake(chat: ChatFormWakeTarget, log: (source: string, message: string) => void, source: string): AgentFormWake`
           `export const NO_FORM_WAKE: AgentFormWake`

Decisions:
- The wake fires in `formListener(...).finish`, after the existing `store.finish`, `closeInWindow` and `wakeWaiters`.
  Its condition is read **before** `wakeWaiters` runs, as named booleans:
  - `noCallWaits = open.callers === 0 && session.askTurn === null` (plan.md Decisions, "No call will return it")
  - `madeUnderCurrentHost = session.formsHostId === session.info.sessionId`: after `/clear` moved the host id, a form
    from the old conversation finishes with no wake, because the new conversation never heard of it
  It fires only when both hold.
- The service composes the text, with the heading **verbatim**: no escaping, collapsing or truncating.
  `` `The user ${end.kind} the ${type.noun} "${type.heading(open.form)}" in the forms app. Call ${type.collectTool} for its answers.` ``
  where `end.kind` is the `AgentFormEndKind` (`submitted` | `cancelled`). It is called with `session.sessionId`
  (the app's row id), never `info.sessionId`.
- A `finish` that returns early (`open.end !== null || open.closed`) never wakes. The service adds no try/catch
  around the wake: the interface's contract is that it does not throw.
- `createChatFormWake`: does nothing when `chat.profileOf(sessionId) === null`. Otherwise it calls
  `chat.send(sessionId, { text, images: [] })` and catches a rejection with
  `log(source, \`form wake not sent to ${sessionId}: ${errorText(error)}\`)` (`errorText` from
  `src/shared/error-text.ts`).
- `NO_FORM_WAKE.formFinishedUnheard` does nothing (for the layout previews and tests that do not assert the wake).
- `createAgentFormService`'s summary comment ("validation, re-send, replay, hand-back, pre-fill, the soft deadline and
  the saved forms") names the wake as well.

GIVEN a form the user submits after its only call returned a draft WHEN finish runs THEN the wake gets the session's app id and the submitted text
GIVEN an ask call still waiting on the form WHEN the user submits THEN no wake
GIVEN a collect call still waiting on the form (the ask returned a draft) WHEN the user submits THEN no wake
GIVEN a re-send of the open form queued behind an earlier call WHEN the user submits THEN no wake
GIVEN an ask for a different form queued behind the open one WHEN the user submits the open one THEN no wake (the queued call hands it back)
GIVEN a form the user cancels with no call waiting WHEN finish runs THEN the wake text says `cancelled`
GIVEN a form whose session moved to a new host id before the submit WHEN the user submits THEN no wake
GIVEN a session chat does not own WHEN the chat wake fires THEN `send` is not called
GIVEN `send` rejects WHEN the chat wake fires THEN the rejection is logged with the session id and nothing throws

Tests:
- `form-service.test.ts`: both service builders, `startSession` and `startMovableSession` (~line 1239), pass one spy
  `wake` recording `(sessionId, text)` calls, reset in `beforeEach`. A new `describe('the wake')` holds one `it.each`
  table over the first six GIVENs. Each row names its setup and its expected calls (`[]` or one call). The
  collect-waiting row is the one that pins the `callers` clause; the queued rows pin `askTurn`. Owner id
  `'app-1'`, heading from `NAMING_ARGS`. The expected text is written literally:
  `The user submitted the form "Naming decisions" in the forms app. Call collect_last_form for its answers.` (and its
  `cancelled` twin).
- The host-move GIVEN is a row added to the existing "a session moved to a new host id" block: its spy records `[]`.
- `chat-wake.test.ts`: one `it.each` over owned → one `send('s1', { text, images: [] })`, and not owned → no
  `send`. One `it` for the rejection: the log records a message containing `s1` and the rejection's text, and
  `formFinishedUnheard` returns without throwing (flush microtasks before asserting the log).
Done when: `npm run typecheck` passes; the test gate runs `form-service.test.ts`, `chat-wake.test.ts`, `round-type.test.ts` and `primer-type.test.ts`.
Commit:    one commit for the group

## Proof

