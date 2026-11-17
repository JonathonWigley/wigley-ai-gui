# 02 — Forms confirm export

Status: in progress
Type: Task
Rung: deep · async form lifecycle, queue, replay and abort rules that gate risky commands
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/plugins/forms/contract.ts`
- modify `src/plugins/forms/main/start.ts`
- create `src/plugins/forms/main/confirm.ts`
- test `src/plugins/forms/main/confirm.test.ts`
- test `src/plugins/forms/main/start.test.ts`

Consumes:  `AgentFormSession<AnswersPayload>.open(args, toolUseId, signal)` (in the tree, `src/contracts/agent-forms.ts`);
           `FormsService.startSession(owner)`; `api.services.randomHex` (in the tree)
Produces:  `export interface ConfirmRequest { title: string; detail: string }` in `src/plugins/forms/contract.ts`
           `export interface FormsMainExports { confirm(sessionId: string, request: ConfirmRequest, signal: AbortSignal, toolUseId: string | null): Promise<boolean> }` in `src/plugins/forms/contract.ts`
           `export const formsMainKey: DependencyKey<FormsMainExports, 'main', 'forms'>` in `src/plugins/forms/contract.ts`
           `export function confirmRoundArgs(request: ConfirmRequest, nonce: string): unknown` in `src/plugins/forms/main/confirm.ts`
           `export function confirmAllowed(payload: AnswersPayload, nonce: string): boolean | null` in `src/plugins/forms/main/confirm.ts`
           `export async function askConfirm(session: FormsSession, request: ConfirmRequest, nonce: string, signal: AbortSignal, toolUseId: string | null): Promise<boolean>` in `src/plugins/forms/main/confirm.ts`

Decisions:
- The confirm is a forms round in the caller's own forms session, the one forms started for the caller's tool session.
  So it:
  - shows over the caller's tabs, or marks a tab-less caller's row (`Round from <label>`)
  - queues behind the caller's open round
  - follows the close and release rules of rounds (round 5)
- **The session map.** Forms' main part keeps a map from app session id to the `FormsSession` it started in its
  `contributeTools` start callback. It drops the entry when that tool session ends. `confirm` for an id with no entry
  rejects with `Error('no forms session for <sessionId>')`, and that includes an id whose tool session has ended.
- `formsMainPart.start` returns `exports` that hand each consumer `{ confirm }`.
- **A fresh round every time** (lead ruling 6). Each `confirm` call draws a nonce of 8 hex characters from
  `api.services.randomHex`. That source survives a restart, and saved rounds outlive the app run. The nonce goes in
  the question title, which the rail names and the card does not draw.
  - The round's fingerprint differs on every call. So the service never replays an earlier Allow
    (`finishedPayload`, `unreturnedFinishedPayload`), and `newestFor(fingerprint)` pre-fills no saved choice.
- **The round's args** (`confirmRoundArgs(request, nonce)`), pinned:
  - `heading`: `request.title`
  - `overview`: `request.detail`
  - one question:
    - `title`: `Allow or deny <nonce>`
    - `summary`: `request.title`
    - `context`: `request.detail`
    - `choices`: `["Allow", "Deny"]`
    - `recommend`: `2`
    - `rationale`: `A risky command runs only on your Allow. Deny is the safe pick when you did not ask for this.`
  - no notices, no findings, no layout
- Deny is the recommendation, so a stray Enter and the headless auto-answer never allow (Decided at plan time).
- **`confirmAllowed(payload, nonce)`** reads only this confirm's own answer:
  - It returns `null` (not this round's answer) when either holds:
    - the payload carries `earlier_heading` (a handed-back round)
    - the first answer's `title` is not `Allow or deny <nonce>` (another round's answer)
  - It returns `true` only when the outcome is `submitted`, the first answer's `status` is `answered` and its `choice`
    is `1`.
  - Every other payload of this round is `false`.
- **`askConfirm`** loop:
  1. Return `false` when `signal.aborted`, without opening.
  2. Call `open(args, toolUseId, signal)`.
  3. When the call rejects: if `signal.aborted`, return `false`; else reject with the error (a session that ended).
  4. When the outcome is `draft`, or `confirmAllowed` gives `null`: if `signal.aborted`, return `false`; else go back to
     2 and re-send `open` with the same args. A re-send waits on its own open form, or queues behind another round. It
     never calls `collect`, which can return another round's answers.
  5. Otherwise return `confirmAllowed`'s boolean.

GIVEN a submitted payload whose first answer is `Allow or deny n1`, answered with choice 1 WHEN `confirmAllowed(payload, 'n1')` reads it THEN it is true
GIVEN choice 2, a `cancelled` outcome, an `auto_answered` outcome, an `untouched`, `not_applicable` or `dont_ask` answer WHEN `confirmAllowed` reads it with its own nonce THEN it is false
GIVEN a handed-back payload, or a submitted payload of another round with choice 1 WHEN `confirmAllowed` reads it THEN it is null
GIVEN two identical requests with a submitted Allow on the first WHEN the second `askConfirm` runs THEN it opens a new round whose draft carries no pre-picked choice
GIVEN the first open returns a `draft` and the next open returns this round's submitted Allow WHEN `askConfirm` runs THEN it resolves true after two opens and no collect
GIVEN a signal aborted before the call WHEN `askConfirm` runs THEN it resolves false and opens nothing
GIVEN the signal aborts while the open waits WHEN `askConfirm` settles THEN it resolves false
GIVEN a session id forms holds no tool session for, or one whose tool session ended WHEN `confirm` runs THEN it rejects with `no forms session for <id>`

Tests:
- `src/plugins/forms/main/confirm.test.ts` (new), in `describe('confirm')`:
  - `it.each` `confirmAllowed reads only this round's submitted Allow as allowed`. Its rows are the true payload, the
    six false payloads and the two null payloads above, each built with every other field valid.
  - `it('askConfirm re-opens after a draft and resolves on its own answer')`, with a fake `FormsSession`.
  - `it('askConfirm re-opens when the open returns another round's answer')`.
  - `it.each` `askConfirm resolves false on an abort`, with rows for aborted before the call and aborted while the
    open waits.
  - `it('confirmRoundArgs passes forms' round parser and recommends Deny')` (`roundType.parse` in `round-type.ts`).
- `src/plugins/forms/main/start.test.ts`, in `describe('forms main part')`:
  - `it('confirm opens the round in the caller's own forms session')`
  - `it.each` `confirm rejects for a session with no tool session`, with rows for an unknown id and an id after its tool
    session's `end`
  - `it('a second identical confirm after an Allow opens a fresh round with no pre-picked choice')`, through the real
    service, as the file's other round tests do

Done when: `npm run typecheck` passes; the test gate runs the tests above. The popup over the tabs and the marked
terminal row are checked live by 10 (Final verification).
Commit:    one commit for the group
