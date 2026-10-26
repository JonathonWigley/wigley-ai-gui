# 02 — Shared agent form lifecycle; forms adopts it

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Rules: every rule in [plan.md § Rules for every task](plan.md#rules-for-every-task) applies.

Forms' main-side lifecycle (the service, the saved-round folder store, the memory store, the channel presenter, the
scripted presenter, the tool session) moves into a new layer `src/shared/agent-forms/`, generic over an
`AgentFormType`. Forms becomes the first type, `roundType`. Every forms behaviour stays; only names, imports, three
log and error texts (named under Decisions) and the channel's message names change. One group: every file below moves
together, and the tree does not compile between the items.

Items of the batch, in the order to do them:

1. The contract `src/contracts/agent-forms.ts`.
2. The layer `src/shared/agent-forms/`, its test type, and the tests moved into it.
3. Forms main adopts the layer: `round-type.ts`, `contract.ts`, `start.ts`, `preview/layout-preview.ts`, the deleted
   files, the tests that stay in forms.
4. The forms channel boundary on the page: `src/plugins/forms/page/start.ts`, and the two self-test lines.
5. `scripts/check-layers.mts`.

Files:     create `src/contracts/agent-forms.ts` ·
           create `src/shared/agent-forms/form-service.ts`, `form-store.ts`, `memory-form-store.ts`,
           `channel-presenter.ts`, `scripted-presenter.ts`, `tool-session.ts`, `test-form-type.ts` ·
           test (create, moved) `src/shared/agent-forms/form-service.test.ts`, `form-store.test.ts`,
           `memory-form-store.test.ts`, `channel-presenter.test.ts`, `tool-session.test.ts` ·
           create `src/plugins/forms/main/round-type.ts` · test (create) `src/plugins/forms/main/round-type.test.ts` ·
           create `src/plugins/forms/page/presented-round.ts` · test (create) `src/plugins/forms/page/presented-round.test.ts` ·
           modify `src/plugins/forms/contract.ts`, `src/plugins/forms/main/start.ts`,
           `src/plugins/forms/main/preview/layout-preview.ts`, `src/plugins/forms/main/preview/layout-preview.test.ts`,
           `src/plugins/forms/main/selftest-script.ts` (one line), `src/plugins/chat/main/selftest-script.ts` (one line),
           `src/plugins/forms/page/start.ts`, `scripts/check-layers.mts` ·
           delete `src/plugins/forms/main/forms-service.ts`, `forms-service.test.ts`, `round-store.ts`,
           `round-store.test.ts`, `preview/memory-round-store.ts`, `preview/memory-round-store.test.ts`,
           `channel-presenter.ts`, `channel-presenter.test.ts`, `scripted-presenter.ts`, `tool-session.ts`,
           `tool-session.test.ts` (each under `src/plugins/forms/main/`) ·
           check, no edit expected: `src/plugins/forms/main/round.ts`, `src/plugins/forms/main/fixtures.ts`,
           `src/plugins/forms/page/forms-commands.ts`, `src/plugins/forms/page/form-state.ts`

Consumes:  `Alerts.setOpenCount(source: string, count: number): void` ← 01 ·
           from the tree: `parseRound`, `fingerprint`, `readFormBody`, `answersPayload`, `handedBackPayload`,
           `noRoundPayload`, `requireKnownLayouts`, `FinishedOutcome` in `src/plugins/forms/main/round.ts`;
           `RoundError` in `src/plugins/forms/main/round-error.ts`; `ROUND_ERROR_NAME` in
           `src/plugins/forms/contract.ts`; `ChannelShape`, `MainChannel` in `src/contracts/plugin.ts`; `Clock`,
           `RandomHex` in `src/contracts/ambient.ts`; `Paths` in `src/contracts/paths.ts`; `Log` in
           `src/contracts/log.ts`; `errorText` in `src/shared/error-text.ts`; `isJsonObject` in `src/shared/json.ts`;
           `posixPaths` in `src/shared/paths/posix-paths.ts` (tests)

Produces:

`src/contracts/agent-forms.ts` — every name in `plan.md` § Shared names under that file, word for word, plus the two
structural tool types below (Decisions say why):

```ts
export interface AgentFormOwnerInfo { sessionId: string | null; projectDir: string | null; deadlineSeconds: number | null }
export interface AgentFormOwner { id: string; info: AgentFormOwnerInfo }
export type AgentFormEndKind = 'submitted' | 'cancelled';
export interface AgentFormEnd<Body> { kind: AgentFormEndKind; body: Body }
export interface PresentedAgentForm<Form, Body> { formId: string; sessionId: string; label: string; form: Form; draft: Body | null }
export interface AgentFormListener<Body> { draft(body: Body): void; finish(end: AgentFormEnd<Body>): void }
export interface AgentFormPresenter<Form, Body> { show(form: PresentedAgentForm<Form, Body>, listener: AgentFormListener<Body>): void; close(formId: string): void }
export interface AgentFormClosed { formId: string; byFinish: boolean }
AgentFormInvoke<Form, Body>    { openForms(): PresentedAgentForm<Form, Body>[]; draft(formId: string, body: Body): void; finish(formId: string, end: AgentFormEnd<Body>): void }
AgentFormMessages<Form, Body>  { formShown: PresentedAgentForm<Form, Body>; formClosed: AgentFormClosed }
export interface AgentFormChannel<Form, Body> extends ChannelShape { invoke: AgentFormInvoke<Form, Body>; messages: AgentFormMessages<Form, Body> }
export interface AgentFormSession<Payload> { open(args: unknown, toolUseId: string | null, signal: AbortSignal): Promise<Payload>; collect(wait: boolean, signal: AbortSignal): Promise<Payload>; end(): void }
export interface AgentFormService<Payload> { startSession(owner: AgentFormOwner): AgentFormSession<Payload> }
export interface AgentFormType<Form, Body, Payload> { openTool; collectTool; noun; argsErrorName; parse; fingerprint; heading; savedHeading; readBody; prefill; payload; handedBackPayload; noFormPayload; notShownPayload }   // members exactly as plan.md writes them
export interface AgentFormSessions { mark(sessionId: string): void; activate(sessionId: string): void; addCloseGuard(mayClose: (sessionId: string) => boolean): void }

// The sessions contract's ToolResult and ToolSession, restated: the contracts layer imports no plugin.
export interface AgentFormToolResult { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
export interface AgentFormToolSession {
  call(name: string, args: unknown, context: { toolUseId: string | null; signal: AbortSignal }): Promise<AgentFormToolResult>;
  end(): void;
}
```

`AgentFormInvoke` and `AgentFormMessages` keep plan.md's names and members. Declare them as `export type … = { … }`,
not `interface` (Decisions). Move the long contract comment on `FormsSession.askRound` and `end` in
`src/plugins/forms/contract.ts` (lines 200–222, measured at plan time, re-verify) onto `AgentFormSession`, with
`round` read as `form`, `ask_round` as the open tool and `collect_last_round` as the collect tool. Move the
`RoundListener` comments onto `AgentFormListener`, and the `FormsChannel` comment's invoke and message rules onto
`AgentFormChannel`.

`src/shared/agent-forms/form-service.ts`:

```ts
export interface AgentFormServiceDeps<Form, Body, Payload> {
  type: AgentFormType<Form, Body, Payload>;
  presenter: AgentFormPresenter<Form, Body>;
  store: AgentFormStore;
  defaultDeadlineSeconds(): number;
}
export function createAgentFormService<Form, Body, Payload>(deps: AgentFormServiceDeps<Form, Body, Payload>): AgentFormService<Payload>;
```

`src/shared/agent-forms/form-store.ts` (names from plan.md, plus the three helpers the memory store shares):

```ts
export const RETENTION_SECONDS: number; // 90 * 24 * 60 * 60
export type SavedOutcome = 'open' | AgentFormEndKind;
export type AgentFormOwnerRef = Pick<AgentFormOwnerInfo, 'sessionId' | 'projectDir'>;
export interface SavedAgentForm { id: string; fingerprint: string; args: unknown; body: unknown; outcome: SavedOutcome; returned: boolean;
  session_id: string | null; project_dir: string | null; tool_use_id: string | null; created: number; updated: number }
export type FinishedSavedAgentForm = SavedAgentForm & { outcome: AgentFormEndKind };
export interface AgentFormStore {
  create(owner: AgentFormOwnerRef, fingerprint: string, args: unknown, body: unknown | null, toolUseId: string | null): SavedAgentForm;
  saveBody(record: SavedAgentForm, body: unknown): void;
  finish(record: SavedAgentForm, outcome: AgentFormEndKind, body: unknown): void;
  markReturned(record: SavedAgentForm): void;
  newestFor(fingerprint: string): SavedAgentForm | null;
  newestUnreturnedFinished(owner: AgentFormOwnerRef, excluding: ReadonlySet<string>): FinishedSavedAgentForm | null;
  recentArgs(limit: number): unknown[];
  prune(): void;
}
export function createFolderFormStore(deps: { dir: string; clock: Clock; randomHex: RandomHex; paths: Paths; log: Log; logSource: string }): AgentFormStore;
export function isFinished(record: SavedAgentForm): record is FinishedSavedAgentForm;
export function formQueries(readAll: () => SavedAgentForm[], paths: Paths): Pick<AgentFormStore, 'newestFor' | 'newestUnreturnedFinished' | 'recentArgs'>;
export function openRecord(owner: AgentFormOwnerRef, fingerprint: string, args: unknown, body: unknown | null, toolUseId: string | null, clock: Clock, randomHex: RandomHex): SavedAgentForm;
```

`src/shared/agent-forms/memory-form-store.ts`:

```ts
export function createMemoryFormStore(clock: Clock, randomHex: RandomHex, paths: Paths): AgentFormStore;
```

`src/shared/agent-forms/channel-presenter.ts`:

```ts
export interface AgentFormChannelPresenter<Form, Body> extends AgentFormPresenter<Form, Body> { quiet: AgentFormPresenter<Form, Body> }
export function createAgentFormChannelPresenter<Form, Body>(deps: {
  channel: Pick<MainChannel<AgentFormChannel<Form, Body>>, 'handle' | 'send'>;
  alerts: Alerts; source: string; announceTitle: string; window: { show(): void }; log: Log; sessions: AgentFormSessions;
}): AgentFormChannelPresenter<Form, Body>;
```

`src/shared/agent-forms/scripted-presenter.ts`:

```ts
export class ScriptedFormPresenter<Form, Body> implements AgentFormPresenter<Form, Body> {
  readonly shown: PresentedAgentForm<Form, Body>[];
  readonly closed: string[];
  show(form: PresentedAgentForm<Form, Body>, listener: AgentFormListener<Body>): void;
  close(formId: string): void;
  latest(): PresentedAgentForm<Form, Body>;
  draft(formId: string, body: Body): void;
  submit(formId: string, body: Body): void;
  cancel(formId: string, body: Body): void;
}
```

`src/shared/agent-forms/tool-session.ts`:

```ts
export function createAgentFormToolSession<Payload extends object>(
  session: AgentFormSession<Payload>,
  tools: { open: string; collect: string },
  argsErrorName: string,
): AgentFormToolSession;
```

`src/shared/agent-forms/test-form-type.ts` (the test type the moved tests run on; Decisions give its rules):

```ts
export const TEST_FORM_ERROR_NAME = 'TestFormError';
export interface TestForm { heading: string; items: string[] }
export interface TestBody { note: string }
export interface TestPayload { outcome: string; heading: string; note: string; earlier_heading?: string; notShown?: true; blockingHeading?: string | null }
export const TEST_FORM_TYPE: AgentFormType<TestForm, TestBody, TestPayload>;
```

`src/plugins/forms/main/round-type.ts`:

```ts
export const roundType: AgentFormType<Round, FormBody, AnswersPayload>;
// Rejects, before the service sees the call, an open whose round names a layout `layoutNames()` lacks.
export function withKnownLayouts(service: FormsService, layoutNames: () => readonly string[]): FormsService;
```

`src/plugins/forms/contract.ts` after the change:

```ts
export type FormsSession = AgentFormSession<AnswersPayload>;
export type FormsService = AgentFormService<AnswersPayload>;
export type RoundEnd = AgentFormEnd<FormBody>;
export interface FormsChannel extends ChannelShape {
  invoke: AgentFormInvoke<Round, FormBody> & { layout(): Promise<LayoutSet>; openPreview(): void };
  messages: AgentFormMessages<Round, FormBody> & { layoutChanged: LayoutSet };
}
```

`PresentedRound` and `RoundClosed` stay as they are: the forms page state uses them, and the page maps to them at
the channel boundary. `RoundListener` and `RoundPresenter` are deleted (their generic forms replace them). The
`AgentSession` import goes when nothing else in the file uses it.

Decisions:

- **Contract types as type aliases.** `ChannelShape.invoke` is `Record<string, (...args: never[]) => unknown>` and
  `messages` is `Record<string, unknown>` (`src/contracts/plugin.ts` lines 155–158). A TypeScript `interface` has no
  implicit index signature, so `invoke: AgentFormInvoke<…>` declared as an interface does not satisfy `ChannelShape`.
  Declare `AgentFormInvoke` and `AgentFormMessages` as `type` aliases with plan.md's members. Every other name stays
  an interface as plan.md writes it.
- **Tool session types.** `plan.md` writes `createAgentFormToolSession(…): ToolSession`. `ToolSession` lives in
  `src/plugins/sessions/contract.ts`, which neither `src/contracts` nor `src/shared/agent-forms` may import. So
  `src/contracts/agent-forms.ts` restates it as `AgentFormToolSession` and `AgentFormToolResult`, field for field
  from `ToolSession`, `ToolCallContext` and `ToolResult` (sessions contract lines 62–80, measured at plan time,
  re-verify). `sessions.contributeTools` accepts it structurally.
- **The layout check stays outside `parse`.** The dispatch asked for `requireKnownLayouts` to fold into the round
  type's `parse` through a `layoutNames` closure. That breaks a forms behaviour: the service parses a saved finished
  round's args with `type.parse` to return or hand back its answers, and today it parses them with `parseRound`
  alone, so the test `returns the answers of a saved round whose layout left the folder` passes (comment at
  `round.ts` lines 150–154, measured at plan time, re-verify). So `roundType.parse` is `parseRound` alone, and
  `withKnownLayouts` wraps the service: its sessions' `open` runs `requireKnownLayouts(parseRound(args),
  layoutNames())` first and returns a rejected promise with that `RoundError` when it throws, before it calls the
  inner session's `open`. `collect` and `end` pass through. The check still runs before anything is saved, shown or
  queued, as today (`askRoundQueuedOrNow`, `forms-service.ts` lines 603–635).
- **Service texts with the type's words.** The service builds three texts today with the round's words. Each takes
  `type.noun` and `type.openTool`, so forms' texts stay word for word:
  - `` `The session ended before this ${openTool} ran.` `` (today line 426)
  - `` `${openTool} was cancelled before it ran.` `` (today line 429)
  - the unreadable saved form error (today lines 154–165): `named` is `` `A saved ${noun}` `` when
    `type.savedHeading(record.args)` is null, else `` `The saved ${noun} '${heading}'` ``; the message is
    `` `${named} (file ${record.id}.json) was finished but never returned, and its answers cannot be read: it was saved in a shape this app no longer accepts (${cause.message}). Its file is left as it was. Tell the user its answers were not returned. Later calls in this session pass over it, so send your ${noun} again with ${openTool}.` ``
  - A parse error is one whose `name` equals `type.argsErrorName` (today `instanceof RoundError`).
- **Moved into the type, not the service.** `prefillDraft`'s Don't-ask strip and `ANSWER_LISTS`
  (`forms-service.ts` lines 111–139), `savedHeading` (lines 149–152) and `roundNotShownPayload` (lines 400–420) move
  to `round-type.ts`. The service calls:
  - pre-fill: `saved = store.newestFor(fp)`; no draft when null, else
    `type.prefill(form, type.readBody(form, saved.body), saved.outcome !== 'open')`. `roundType.prefill` returns the
    body as is when `finished` is false, and the body with every answer list's `dont_ask` set false and
    `dont_ask_reason` set `''` when true (today's `ANSWER_LISTS`).
  - not shown: `type.notShownPayload(form, blocking === null ? null : type.heading(blocking.form))`.
    `roundType.notShownPayload(round, blockingHeading)` is today's `roundNotShownPayload` with `other` built from the
    heading string: `'another round'` when null, else `` `the round '${blockingHeading}'` ``; every word kept.
  - the open form's blank body: `type.readBody(form, {})`, as `readFormBody(round, {})` today.
  - label: `` `${path.basename(projectDir)} · ${type.heading(form)}` ``, or the heading alone without a project.
- **`roundType` members:** `openTool: 'ask_round'`, `collectTool: 'collect_last_round'`, `noun: 'round'`,
  `argsErrorName: ROUND_ERROR_NAME`, `parse: parseRound`, `fingerprint`, `heading: (round) => round.heading`,
  `savedHeading` (moved), `readBody: readFormBody`, `prefill` (above), `payload: answersPayload`,
  `handedBackPayload`, `noFormPayload: noRoundPayload`, `notShownPayload` (above).
- **Store texts.** The folder store logs under `deps.logSource` where it logs `'forms'` today. Its save error was
  `` `could not save round ${record.id}: …` ``; the store knows no noun, so it becomes
  `` `could not save form ${record.id}: ${errorText(error)}` ``. `could not prune ${name}: …` is unchanged. The
  store's folder is `deps.dir` (today `roundsDir`).
- **Presenter texts.** The presenter logs `` `form shown: ${form.label}` `` under `deps.source` (today
  `` log('forms', `round shown: ${round.label}`) ``, `channel-presenter.ts` line 85). It announces with
  `deps.announceTitle` (today the literal `'New review round'`) and sets `alerts.setOpenCount(deps.source, n)`. So
  forms' line becomes `[forms] form shown: <label>`. Update the two self-test lines that wait on it:
  `src/plugins/forms/main/selftest-script.ts` line 1116 `shownLine` to
  `'[forms] form shown: selftest · Layouts self-test round'`, and `src/plugins/chat/main/selftest-script.ts` line 169
  to `` `[forms] form shown: chat-selftest · ${ROUND_HEADING}` `` (lines measured at plan time, re-verify).
  `scripts/start-lock.test.mts` line 199 quotes the old line only as sample input; leave it.
- **Tool session text.** An unknown tool rejects with `` `no agent form tool "${name}"` `` (today
  `` `forms has no tool "${name}"` ``, `tool-session.ts` line 33). Everything else in `tool-session.ts` keeps its
  behaviour: `args ?? {}` for the open tool, `wait` true unless `wait: false`, a parse error as
  `{ content: [{ type: 'text', text: message }], isError: true }`, any other error rethrown.
- **Scripted presenter texts:** `'No form has been shown'` and `` `No form ${formId} was shown` ``.
- **The test type** (`test-form-type.ts`), `TEST_FORM_TYPE`:
  - `openTool: 'open_form'`, `collectTool: 'collect_last_form'`, `noun: 'form'`, `argsErrorName: TEST_FORM_ERROR_NAME`.
  - `parse`: args must be an object with a non-blank string `heading` and a non-empty array of strings `items`;
    anything else throws an `Error` whose `name` is `TestFormError` and whose message names the field
    (`'heading must be a non-blank string'`, `'items must be a non-empty array of strings'`).
  - `fingerprint`: `form.items.join('\n')`, so a re-send under a reworded heading matches, as a round's does.
  - `heading`: `form.heading`. `savedHeading`: `args.heading` when it is a non-blank string, else null.
  - `readBody(form, raw)`: `{ note: raw.note }` when `raw` is an object whose `note` is a string, else `{ note: '' }`.
  - `prefill(form, saved, finished)`: `{ note: finished ? `finished: ${saved.note}` : saved.note }`, so a test
    sees which flag the service passed.
  - `payload(form, outcome, body)`: `{ outcome, heading: form.heading, note: body.note }`.
  - `handedBackPayload`: the payload plus `earlier_heading: form.heading`.
  - `noFormPayload()`: `{ outcome: 'no_form', heading: '', note: '' }`.
  - `notShownPayload(form, blockingHeading)`: `{ outcome: 'draft', heading: form.heading, note: '', notShown: true, blockingHeading }`.
- **Forms main wiring** (`src/plugins/forms/main/start.ts`, `createForms` lines 59–104, measured at plan time,
  re-verify): the store is `createFolderFormStore({ dir: path.join(services.homeDir, '.agents', 'wigley-forms',
  'rounds'), clock, randomHex, paths, log, logSource: 'forms' })`; the presenter is
  `createAgentFormChannelPresenter({ channel: api.channel, alerts: services.alerts, source: 'forms', announceTitle:
  'New review round', window: services.window, log: services.log, sessions })`; the agents' service is
  `withKnownLayouts(createAgentFormService({ type: roundType, presenter, store, defaultDeadlineSeconds }),
  layoutNames)`; the preview's is `withKnownLayouts(createAgentFormService({ type: roundType, presenter: presenter.quiet,
  store: createMemoryFormStore(clock, randomHex, paths), defaultDeadlineSeconds }), layoutNames)`, so the preview
  keeps rejecting an unknown layout as today. The tools: `createAgentFormToolSession(forms.startSession(session), { open: 'ask_round', collect:
  'collect_last_round' }, ROUND_ERROR_NAME)`.
- **Renamed calls:** `askRound` → `open` and `collectLastRound` → `collect` in `preview/layout-preview.ts` (lines 89,
  106) and in its test's fake session (`layout-preview.test.ts`, `Call.method` values and the fake's members).
- **The page boundary.** In `src/plugins/forms/page/start.ts` `listenForRounds` (lines 79–113, measured at plan
  time, re-verify), add `presentedRoundOf` in a new file `src/plugins/forms/page/presented-round.ts` (exported, with one test in
  `presented-round.test.ts`: `maps a presented form to its round, formId to roundId`) and use it at the three places
  main's forms enter the page:

```ts
function presentedRoundOf(form: PresentedAgentForm<Round, FormBody>): PresentedRound {
  return { roundId: form.formId, sessionId: form.sessionId, label: form.label, round: form.form, draft: form.draft };
}
```

  `api.channel.on('formShown', …)` dispatches `roundShown` with `presentedRoundOf(form)`;
  `api.channel.on('formClosed', (closed) => closeRoundFromMain(…, { roundId: closed.formId, byFinish: closed.byFinish }))`;
  `api.channel.invoke('openForms')` maps each form through `presentedRoundOf`. The `draft` and `finish` invokes keep
  their arguments (`RoundEnd` is now `AgentFormEnd<FormBody>`, the same shape). The store actions keep their names
  (`roundShown`, `roundClosed`). No other forms page file changes.
- **Layers** (`scripts/check-layers.mts`): add
  `'src/shared/agent-forms': { layers: ['src/contracts', 'src/shared', 'src/shared/paths'], packages: ['node:'] }`
  after the `'src/shared/paths'` entry (line 21). `src/shared/paths` is there for the moved tests, which import
  `posixPaths` and `windowsPaths`. Add `'src/shared/agent-forms'` to the `'src/plugins/forms/main'` entry's layers
  (lines 237–247). The forms page layer does not get it.

GIVEN a form open in a session WHEN a second `open` with another fingerprint runs THEN it waits until the user
finishes the first, as `askRound` does today
GIVEN a saved finished round whose layout left the folder WHEN `collect` runs THEN it returns that round's answers
GIVEN an open naming a layout the folder lacks WHEN it runs behind an open round THEN it rejects with the
`RoundError` at once and nothing is saved or shown
GIVEN main shows a form WHEN the forms page hears `formShown` THEN the store gets `roundShown` with `roundId` equal
to the form's `formId`

Tests:

Moved and made generic — `src/shared/agent-forms/form-service.test.ts`. It takes over
`src/plugins/forms/main/forms-service.test.ts`: every `describe` and `it` there moves, with its name and its
assertions on lifecycle, except the Stay list below. Each moved test runs `createAgentFormService` with
`TEST_FORM_TYPE`, a `ScriptedFormPresenter`, a `createFolderFormStore` over a temp folder, and the same fake timers,
clock and hex counter as today. `NAMING_ARGS` becomes `{ heading: 'Naming decisions', items: ['module_a or
module_b'] }`, `PLACEMENT_ARGS` `{ heading: 'Placement decisions', items: ['where it lives'] }`; a body is a
`TestBody`; `oneAnswer({ choice: 2, notes: 'half done' })` becomes `{ note: 'half done' }` and the asserted answer
fields become `note`. Calls are `session.open` and `session.collect`. Where a moved test asserts a text the round
type builds, it asserts the test type's field instead:
- `summary` containing `was not shown` → `notShown: true`
- `next` containing `collect_last_round`, `ask_round`, `send it again` or `send the same round again with ask_round`
  → the assertion is dropped; `round.test.ts` already pins those texts (lines 703, 1316–1342, measured at plan
  time, re-verify)
- `answers[0]…` → `note`; `outcome: 'no_round'` → `'no_form'`
- the unreadable saved round: `"The saved round 'Old review'"` → `"The saved form 'Old review'"`; the unparseable
  record's args are `{ heading: 'Old review', items: [] }`, and `'origin'` → `'items must be a non-empty array of strings'`
- `'ask_round was cancelled before it ran.'` → `'open_form was cancelled before it ran.'`;
  `'The session ended before this ask_round ran.'` → `'The session ended before this open_form ran.'`
- `'could not save round r: EACCES'` (the spy's own text) → `'could not save form r: EACCES'`
- the two tests that pre-fill from a finished save assert the `finished: ` prefix the test type adds:
  `opens a fresh round pre-filled from the round just cancelled` asserts `draft` `{ note: 'finished: <the cancelled
  note>' }`, and `pre-fills a fresh round from an older round already returned` asserts `{ note: 'finished: <the
  saved note>' }`
One new test in this file: `passes finished to prefill: true for a finished save, false for an open draft` — a
finished save pre-fills `{ note: 'finished: half done' }`, an open draft `{ note: 'half done' }`.

Stay — these leave `forms-service.test.ts` for `src/plugins/forms/main/round-type.test.ts`, assertions unchanged,
the service built as `createAgentFormService({ type: roundType, … })` and, for the layouts group,
`withKnownLayouts(…, () => layoutNames)`:
- `askRound` › `returns notices and their comments beside the answers`
- `askRound` › `rejects a malformed round with its RoundError and shows nothing`
- `layouts a round names` › all five: `fails ask_round naming a layout the folder lacks, listing the folder's
  layouts`, `fails a round naming a layout the folder lacks before it queues behind an open round`, `opens a round
  whose layouts the folder holds`, `re-attaches a re-send that differs only in layout, keeping the layouts it opened
  with`, `returns the answers of a saved round whose layout left the folder`
- `saved rounds from an earlier app run` › `reports a saved round that no longer parses to collect_last_round and
  leaves it unreturned` (pins `"The saved round 'Old review'"` and `'origin'` for forms)
- `pre-fill` › all five: `drops a finished round's Don't ask presses`, `drops a finished round's Don't ask presses on
  finding answers`, `pre-fills an old file's what and why as joined notes`, `keeps an open draft's Don't ask
  presses`, `restores the choice number kept on a not-applicable answer`
Two new unit tests in `round-type.test.ts`:
- `notShownPayload names the blocking round` — `roundType.notShownPayload(parseRound(PLACEMENT_ARGS), 'Naming
  decisions')` has `summary` `"This round, 'Placement decisions', was not shown: the round 'Naming decisions' is
  still open in the app."`, a `next` containing `'Send this round again with ask_round'` and `'earlier_heading'`, no
  `earlier_heading`, and `answers[0].status` `'untouched'` (moved from `returns a draft at its own deadline without
  opening its round or replacing the open one`).
- `notShownPayload names another round when none blocks` — with `null`, `summary` contains `'another round is still
  open in the app.'`.

Moved, made generic, assertions kept:
- `src/plugins/forms/main/round-store.test.ts` → `src/shared/agent-forms/form-store.test.ts`. `describe('RoundStore')`
  becomes `describe('createFolderFormStore')`; every `it` keeps its name. Bodies become plain objects. The two
  `could not save round` assertions (lines 416, 429) become `could not save form`. `writes the saved-round fields
  retro reads` keeps every field name.
- `src/plugins/forms/main/preview/memory-round-store.test.ts` → `src/shared/agent-forms/memory-form-store.test.ts`;
  `describe('createMemoryRoundStore')` becomes `describe('createMemoryFormStore')`; every `it` keeps its name.
- `src/plugins/forms/main/channel-presenter.test.ts` → `src/shared/agent-forms/channel-presenter.test.ts`;
  `describe('createChannelPresenter')` becomes `describe('createAgentFormChannelPresenter')`; every `it` keeps its
  meaning with `round` read as `form` in its name. The presenter takes `source: 'forms'` and
  `announceTitle: 'New review round'` as test data, so the announce assertion stays
  `[['New review round', 'wigley-ai-gui · Pick a theme']]`; the log line becomes
  `'[forms] form shown: wigley-ai-gui · Pick a theme'`; the page fake sends and handles `formShown`, `formClosed`,
  `openForms`; the count fake records `(source, count)` as task 01 left it.
- `src/plugins/forms/main/tool-session.test.ts` → `src/shared/agent-forms/tool-session.test.ts`;
  `describe('createFormsToolSession')` becomes `describe('createAgentFormToolSession')`. It passes
  `{ open: 'open_form', collect: 'collect_last_form' }` and `TEST_FORM_ERROR_NAME`, calls those names, and throws
  an `Error` named `TestFormError` where it threw `RoundError`. `rejects a tool forms does not have` becomes
  `rejects a tool the session does not have`, asserting `'no agent form tool "ask"'`.

Unchanged in meaning, edited for names: `src/plugins/forms/main/preview/layout-preview.test.ts` (`open`/`collect`),
`src/plugins/forms/main/start.test.ts` (no edit expected), every forms page test.

Approach:  Move code, do not rewrite it. `form-service.ts` is `forms-service.ts` with `Round` → `Form`,
           `FormBody` → `Body`, `AnswersPayload` → `Payload`, `SessionInfo` → `AgentFormOwnerInfo`, `RoundPresenter`
           → `AgentFormPresenter`, `RoundStore` → `AgentFormStore`, and each round function call replaced by the
           type member above. Keep every comment, updating its words. `roundId` in `PresentedAgentForm` is `formId`.
           The channel presenter's guard, `finish` handling and `byFinish` rule stay as they are.

Done when: `npm run typecheck` and `npm run lint` pass; the gate runs `npm test -- src/shared/agent-forms` and
           `npm test -- src/plugins/forms`, and `npm test -- src/plugins/chat/main` for the changed line. The
           self-test lines changed here (`[forms] form shown: …`) are proved in task 14 (Final verification).
Commit:    one commit for the group in wigley-ai-gui

## Proof
