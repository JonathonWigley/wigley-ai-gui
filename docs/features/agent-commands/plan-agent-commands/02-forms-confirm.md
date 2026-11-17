# 02 — Forms confirm export

Status: not started
Type: Task
Rung: hard · adds the `confirm` export that 08 consumes, over the async form lifecycle
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/plugins/forms/contract.ts`
- modify `src/plugins/forms/main/start.ts`
- create `src/plugins/forms/main/confirm.ts`
- test `src/plugins/forms/main/confirm.test.ts`
- test `src/plugins/forms/main/start.test.ts`

Consumes:  `AgentFormSession<AnswersPayload>.open(args, toolUseId, signal)` and `.collect(wait, signal)` (in the tree,
           `src/contracts/agent-forms.ts`); `FormsService.startSession(owner)` (in the tree)
Produces:  `export interface ConfirmRequest { title: string; detail: string }` in `src/plugins/forms/contract.ts`
           `export interface FormsMainExports { confirm(sessionId: string, request: ConfirmRequest, signal: AbortSignal, toolUseId: string | null): Promise<boolean> }` in `src/plugins/forms/contract.ts`
           `export const formsMainKey: DependencyKey<FormsMainExports, 'main', 'forms'>` in `src/plugins/forms/contract.ts`
           `export function confirmRoundArgs(request: ConfirmRequest): unknown` in `src/plugins/forms/main/confirm.ts`
           `export function confirmAllowed(payload: AnswersPayload): boolean` in `src/plugins/forms/main/confirm.ts`
           `export async function askConfirm(session: FormsSession, request: ConfirmRequest, signal: AbortSignal, toolUseId: string | null): Promise<boolean>` in `src/plugins/forms/main/confirm.ts`

Decisions:
- The confirm is a forms round in the caller's own forms session, the one forms started for the caller's tool
  session. So it shows over the caller's tabs, marks a tab-less caller's row (`Round from <label>`), queues behind the
  caller's open round, and follows the close and release rules of rounds (round 5).
- Forms' main part keeps a map from app session id to the `FormsSession` it started in its `contributeTools` start
  callback, and drops the entry when that tool session ends. `confirm` for an id with no entry rejects with
  `Error('no forms session for <sessionId>')`.
- `formsMainPart.start` returns `exports` that hand each consumer `{ confirm }`.
- The round's args (`confirmRoundArgs`), pinned:
  - `heading`: `request.title`
  - `overview`: `request.detail`
  - one question: `title` `Allow or deny`, `summary` `request.title`, `context` `request.detail`, `choices`
    `["Allow", "Deny"]`, `recommend` `2`, `rationale` `A risky command runs only on your Allow. Deny is the safe pick
    when you did not ask for this.`
  - no notices, no findings, no layout.
- Deny is the recommendation, so a stray Enter and the headless auto-answer never allow (Decided at plan time).
- `confirmAllowed(payload)` is true only when `payload.outcome` is `submitted`, the first answer's `status` is
  `answered` and its `choice` is `1`. Every other payload is a denial.
- `askConfirm` opens the round; while the outcome is `draft` (the deadline handed it back), it calls
  `collect(true, signal)` again, as an agent calls `collect_last_round`. When `signal` aborts, the waiting call's
  cancel closes the form (the service's rule), and `askConfirm` resolves `false`. A rejected open or collect rejects.

GIVEN a submitted payload whose first answer is answered with choice 1 WHEN `confirmAllowed` reads it THEN it is true
GIVEN choice 2, a `cancelled` outcome, an `auto_answered` outcome, or an `untouched` answer WHEN `confirmAllowed` reads it THEN it is false
GIVEN the first open returns a `draft` and the collect returns a submitted Allow WHEN `askConfirm` runs THEN it resolves true after one collect
GIVEN the signal aborts while the collect waits WHEN `askConfirm` settles THEN it resolves false
GIVEN a session id forms holds no tool session for WHEN `confirm` runs THEN it rejects with `no forms session for <id>`

Tests:
- `src/plugins/forms/main/confirm.test.ts` (new): `describe('confirm')` with
  `it.each` `confirmAllowed reads only a submitted Allow as allowed` (rows: the five payloads above, each built with
  every other field valid); `it('askConfirm collects again after a draft and resolves on the answer')`;
  `it('askConfirm resolves false when the signal aborts while it waits')`; one `it` that `confirmRoundArgs` passes
  forms' own round parser (`roundType.parse` in `round-type.ts`) and recommends Deny.
- `src/plugins/forms/main/start.test.ts`: in `describe('forms main part')`, one `it('confirm opens the round in the
  caller's own forms session and rejects for an unknown session')`.

Done when: `npm run typecheck` passes; the test gate runs the tests above. The popup over the tabs and the marked
terminal row are checked live by 10 (Final verification).
Commit:    one commit for the group
