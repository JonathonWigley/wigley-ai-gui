# 03 — Confirm subject and the forms.confirms slot

Status: in progress
Type: Batch
Rung: deep · ties a slot key to an async round's lifecycle across forms and agent-commands (queued, shown, submitted, cancelled, aborted, session end), and adds `ConfirmSubject`, `OpenConfirm` and `formsConfirmsSlot`, which 04 and 05 consume
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/forms/contract.ts`
- modify `src/plugins/forms/main/confirm.ts`
- modify `src/plugins/forms/main/start.ts`
- modify `src/plugins/agent-commands/main/tools.ts`
- test `src/plugins/forms/main/start.test.ts`
- test `src/plugins/forms/main/confirm.test.ts`
- test `src/plugins/agent-commands/main/tools.test.ts`

Consumes:  `KeyedSlotKey`, `KeyedSlotWriter` (`src/contracts/state.ts`, in the tree) · `AgentFormPresenter`,
           `PresentedAgentForm` (`src/contracts/agent-forms.ts`, in the tree) · `api.state.publish` (in the tree)

Produces:
- In `src/plugins/forms/contract.ts`, exactly as plan.md gives them:
  - `export interface ConfirmSubject { toolName: string; input: unknown; }`
  - `ConfirmRequest` gains `subject: ConfirmSubject | null`
  - `export interface OpenConfirm { sessionId: string; subject: ConfirmSubject; }`
  - `export const formsConfirmsSlot: KeyedSlotKey<OpenConfirm, 'main', 'forms'>`, with `id: 'forms.confirms'`,
    `process: 'main'`, `kind: 'keyed'`
- In `src/plugins/forms/main/confirm.ts` (forms-internal, consumed by forms' `start.ts` only):
  - `export interface ConfirmTracker { presenter(inner: AgentFormPresenter<Round, FormBody>): AgentFormPresenter<Round, FormBody>; track(sessionId: string, subject: ConfirmSubject | null, nonce: string, ask: () => Promise<boolean>): Promise<boolean>; }`
  - `export function createConfirmTracker(confirms: Pick<KeyedSlotWriter<OpenConfirm>, 'set' | 'delete'>): ConfirmTracker`
- In `src/plugins/agent-commands/main/tools.ts`: `confirmRequest` keeps its signature and returns `subject` too.

Decisions:
- **The round id is the form id.** Forms names a round by `PresentedAgentForm.formId`, the saved record's id, which
  the page receives as `PresentedRound.roundId` and `FormsCardPartItem.roundId`. `FormsSession.open` returns only the
  payload, so main learns the id only when the service's presenter shows the round. The slot key is that `formId`.
- **Spotting the confirm's round.** `askConfirm` titles the round's one question `Allow or deny <nonce>`
  (`questionTitle`), and the nonce is fresh random hex per confirm. The tracker keeps each pending confirm's nonce with
  its `sessionId` and `subject`. Its `presenter(inner)` forwards every `show` and `close` to `inner` unchanged. On a
  `show` whose round's only `question` item has a title of `questionTitle(nonce)` for a pending nonce, it also calls
  `confirms.set(form.formId, { sessionId, subject })`, with the confirm's own `sessionId`, and records that form id
  under the nonce. The set comes before the forward to `inner.show`, so the page finds the key when the card first
  draws. A re-show of the same form (a draft re-open) sets the same key again: every show passes the saved record's
  id (`showForm` in `src/shared/agent-forms/form-service.ts`, `reopenFormLeftOpen` included), and only a new confirm
  makes a new record.
- **Set when the round shows, not when `confirm` is called.** A confirm queues behind the session's open round, and
  the user sees nothing until it shows. The key appears only once a card exists for the page to draw on.
- **Delete when the confirm settles, whatever the outcome.** `track(sessionId, subject, nonce, ask)` registers the
  nonce when `subject` is not null, runs `ask()`, and in a `finally` deletes every form id recorded under the nonce and
  drops the nonce. `askConfirm` settles on every way a round ends: a submit (Allow or Deny), a cancel, an abort of its
  signal, and a failure (the session's end rejects the open). The tracker does not rely on the presenter's `close`: the
  page's `finish` closes the round inside the channel presenter, which bypasses the service-side wrapper.
- **A null subject publishes nothing.** `track` with `subject: null` only runs `ask()`.
- **Wiring in `start.ts`.** `startOverOrigins` publishes the slot with `api.state.publish(formsConfirmsSlot)`, builds
  the tracker over it with `createConfirmTracker`, and hands it to `createForms`. `createForms` wraps the agents
  service's presenter: `withShownWaits(tracker.presenter(presenter))`. The preview service (`samples`) keeps the
  unwrapped `presenter.quiet`. The `confirm` export becomes
  `tracker.track(sessionId, request.subject, nonce, () => askConfirm(formSession, request, nonce, signal, toolUseId))`,
  with `nonce = api.services.randomHex()` drawn once and passed to both. Its `no forms session for <sessionId>`
  rejection stays ahead of `track`, so it publishes nothing.
- **`confirmSample` publishes nothing.** It keeps calling `askConfirm` directly, and the samples service's presenter
  is not wrapped.
- **The manifest needs nothing.** Publishing a slot takes no manifest field: context-sources publishes
  `context-sources.breakdowns` with only `reads: { main: [], page: [] }` in its manifest. `forms/manifest.ts` is
  unchanged.
- **agent-commands' subject.** `confirmRequest` adds
  `subject: { toolName: \`app command ${info.id}\`, input }`. With no target `session`, `input` is `arg ?? null`.
  With one, `input` is `{ session: deps.senderName(session), arg: arg ?? null }`, the target's side-bar name as the
  detail shows it, since the target is what makes a close or a send risky. The demo step
  (`agent-commands/main/demo-steps.ts`) calls the same function with `arg` undefined, so its sample request carries
  `{ toolName: 'app command sessions.closeSession', input: null }` with no edit to that file.
- **Every other `ConfirmRequest` literal compiles.** The literals in the tree are `REQUEST` in
  `forms/main/confirm.test.ts`, `CONFIRM_REQUEST` in `forms/main/start.test.ts`, and `SUBMIT_CONFIRM` and the
  `sessions.closeSession` row's `confirmed` in `agent-commands/main/tools.test.ts`. `confirm.test.ts`'s `REQUEST`
  takes `subject: null`. `CONFIRM_REQUEST` takes `subject: { toolName: 'app command docs.trash', input: 'notes.md' }`.
  The tools test's values are under Tests.
- The `formsConfirmsSlot` comment in `contract.ts` reads: each open confirm round that has a subject, keyed by the
  round id forms gave it (the page's `roundId`), holding the caller's app session id and the subject; set when the
  round shows and deleted once its confirm settles, submitted, cancelled, aborted or failed. The `ConfirmRequest`
  comment gains one sentence: `subject` is the call the confirm stands for, which forms publishes while the round is
  open, or null for none.

GIVEN a confirm with a subject WHEN its round shows THEN `forms.confirms` holds `{ sessionId, subject }` under the
round's form id
GIVEN that round open WHEN the user submits Allow, submits Deny or cancels, the signal aborts, or the session's forms
session ends THEN the key is gone once `confirm` settles
GIVEN a confirm with `subject: null` WHEN its round shows THEN `forms.confirms` holds no key
GIVEN `confirmSample` WHEN its round shows THEN `forms.confirms` holds no key
GIVEN a risky `run_command` of `sessions.closeSession` with arg `{ keep: 'log' }` on target session `gamma 2` WHEN
agent-commands builds the confirm THEN its subject is
`{ toolName: 'app command sessions.closeSession', input: { session: 'gamma 2', arg: { keep: 'log' } } }`
GIVEN a confirm queued behind the session's open round WHEN the open round finishes and the confirm's round shows
THEN the key appears then, and not before

Tests:
- `src/plugins/forms/main/start.test.ts`, a new `it.each` in the `forms main part` describe, over
  `startWithToolSessions`, reading the slot with `harness.state.read(formsConfirmsSlot, 'test')`:
  `confirmsSlot_HoldsTheRoundWhileOpen_ThenDeletesIt: $case`. Each row connects `app-a`, calls
  `forms.confirm('app-a', CONFIRM_REQUEST, signal, null)`, flushes, and asserts
  `get(shown[0].formId)` equals `{ sessionId: 'app-a', subject: CONFIRM_REQUEST.subject }`. It then ends the round its
  own way, awaits the confirm's settle (resolves or rejects), and asserts `all().size` is 0. Rows:
  - `submitted Allow`: `harness.invoke('finish', formId, { kind: 'submitted', body: ALLOW_BODY })`
  - `submitted Deny`: the same with the one answer's `choice: 2`
  - `cancelled`: `harness.invoke('finish', formId, { kind: 'cancelled', body: ALLOW_BODY })`
  - `aborted`: the signal's controller aborts
  - `failed`: the connected tool session's `end()`, so the confirm rejects
  It breaks if a key outlives its round, or if the key is not the page's round id.
- Same file, `it.each` `confirmsSlot_HoldsNothing: $case`, asserting `all().size` is 0 while the round shows:
  - `a null subject`: `forms.confirm('app-a', { ...CONFIRM_REQUEST, subject: null }, live(), null)`
  - `confirmSample`: `forms.confirmSample('app-a', CONFIRM_REQUEST, signal)`, aborted after the assert
- Same file, `confirmsSlot_QueuedConfirm_HoldsNoKeyUntilItShows`: an open agent round in `app-a` first, then
  `forms.confirm(...)`; `all().size` is 0 while the confirm waits, and after the first round is finished the key is
  the confirm's round's form id with its `{ sessionId, subject }`, and the page received that round (`shown` holds
  it), which proves the wrapper forwards `show`.
- Same file, `confirmsSlot_NoFormsSession_PublishesNothing`: `forms.confirm('app-z', CONFIRM_REQUEST, live(), null)`
  for a session never connected rejects `no forms session for app-z`, and `all().size` is 0.
- `src/plugins/forms/main/confirm.test.ts`, new `tracker_ReShowOfOneForm_HoldsOneKey`, over `createConfirmTracker`
  with a recording `set`/`delete` and a recording inner presenter: inside `track`, the wrapped presenter shows the
  nonce's round twice under one form id; the slot holds one key, `set` ran before each inner `show`, and the settle
  deletes it once. It breaks if a re-show makes a second key or the set follows the show.
- `src/plugins/agent-commands/main/tools.test.ts`, rows of the existing `run_command runs and reports: $given` table,
  which asserts the whole request passed to `confirm`:
  - `SUBMIT_CONFIRM` gains `subject: { toolName: 'app command forms.submit', input: null }`, covering the three
    `forms.submit` rows (no arg).
  - The `a risky targetable command allowed with a target` row's `confirmed` gains
    `subject: { toolName: 'app command sessions.closeSession', input: { session: 'gamma 2', arg: { keep: 'log' } } }`.
- `src/plugins/forms/main/confirm.test.ts`: `REQUEST` gains `subject: null`; `askConfirm` does not read the
  subject, so its cases stay as they are beside the tracker test above.

Done when: `npm run typecheck` passes; `npm run lint` passes; the test gate runs
`src/plugins/forms/main/start.test.ts`, `src/plugins/forms/main/confirm.test.ts` and
`src/plugins/agent-commands/main/tools.test.ts`. The live confirm card and its verdict are checked in 07 Final
verification.

Commit: one commit for the group, by pathspec (the seven files above), no co-author trailer:
`forms: publish open confirm rounds in forms.confirms, with the call each stands for`

## Proof

