# 02 — Structured round results

Status: in progress
Type: Batch
Wave: 2 · Depends on: 01 (task 01 edits `forms/main/start.ts` too: read it as task 01 left it)
Plan: [plan.md](plan.md)

The round logic returns records. A new forms MCP wording module turns the records into the text the agent reads.
The text stays byte-identical. A golden test captures today's text before any source edit, and asserts the same text
after the change. The work is five steps in one commit.

Files:
- create `src/plugins/forms/main/mcp-wording.ts` · test `src/plugins/forms/main/mcp-wording.test.ts` · create
  `src/plugins/forms/main/forms-tools.golden.txt` (written by the golden test's first run)
- modify `src/plugins/forms/main/round-error.ts` · `src/plugins/forms/main/round.ts` ·
  `src/plugins/forms/main/round-type.ts` · `src/plugins/forms/main/start.ts` ·
  `src/plugins/forms/main/tool-definitions.ts` · `src/plugins/forms/main/fixtures.ts` (comment only)
- modify `src/plugins/forms/main/kinds/item-format.ts` · `kinds/fields.ts` · `kinds/formats.ts` (comment only) ·
  `kinds/notice/notice-format.ts` · `kinds/question/question-format.ts` · `kinds/finding/finding-format.ts` (all under
  `src/plugins/forms/main/`)
- modify `src/plugins/forms/contract.ts` · `src/plugins/primer/contract.ts` · `src/plugins/primer/main/primer-type.ts` ·
  `src/plugins/audio-picker/contract.ts` · `src/plugins/audio-picker/main/picker-type.ts`
- modify `src/contracts/agent-forms.ts` · `src/shared/agent-forms/tool-session.ts` ·
  `src/shared/agent-forms/form-service.ts` · `src/shared/agent-forms/test-form-type.ts` (the test double)
- test `src/plugins/forms/main/round.test.ts` · `round-type.test.ts` · `kinds/fields.test.ts` ·
  `kinds/notice/notice-format.test.ts` · `kinds/question/question-format.test.ts` ·
  `kinds/finding/finding-format.test.ts` (all under `src/plugins/forms/main/`) ·
  `src/plugins/primer/main/primer-type.test.ts` · `src/plugins/audio-picker/main/picker-type.test.ts` ·
  `src/shared/agent-forms/tool-session.test.ts` ·
  `src/shared/agent-forms/form-service.test.ts`
- modify `AGENTS.md` (one sentence, step 5) · `docs/features/followups.md` · `docs/features/intent-alignment/master-plan.md`

Consumes:
- `AgentFormType<Form, Body, Payload>` in `src/contracts/agent-forms.ts` (today's tree)
- `createAgentFormToolSession(session, type)` in `src/shared/agent-forms/tool-session.ts` (today's tree)
- `FORMATS`, `ITEM_KINDS`, `ANSWERABLE_KINDS` in `src/plugins/forms/main/kinds/formats.ts` (today's tree)
- `capitalised` in `src/shared/capitalised.ts` (today's tree)

Produces:
- `export type RoundErrorPath =` in `src/plugins/forms/main/round-error.ts`
- `export type RoundItemPath = Extract<RoundErrorPath, { at: 'item' }>;` in `src/plugins/forms/main/round-error.ts`
- `constructor(fields: { path: RoundErrorPath; problem: string; detail?: string })` on `export class RoundError extends Error` in `src/plugins/forms/main/round-error.ts`
- `export type RoundReason =` in `src/plugins/forms/main/round.ts`
- `export interface RoundResult` in `src/plugins/forms/main/round.ts`
- `export function answersResult(round: Round, outcome: RoundOutcome, body: FormBody): RoundResult` in `src/plugins/forms/main/round.ts`
- `export function handedBackResult(round: Round, outcome: FinishedOutcome, body: FormBody): RoundResult` in `src/plugins/forms/main/round.ts`
- `export function notShownResult(round: Round, blockingHeading: string | null): RoundResult` in `src/plugins/forms/main/round.ts`
- `export function noRoundResult(): RoundResult` in `src/plugins/forms/main/round.ts`
- `export const ROUND_OPEN_TOOL = 'ask_round';` in `src/plugins/forms/main/mcp-wording.ts`
- `export const ROUND_COLLECT_TOOL = 'collect_last_round';` in `src/plugins/forms/main/mcp-wording.ts`
- `export function roundErrorText(error: RoundError): string` in `src/plugins/forms/main/mcp-wording.ts`
- `export function roundPayload(result: RoundResult): AnswersPayload` in `src/plugins/forms/main/mcp-wording.ts`
- `export function autoAnsweredPayload(round: Round, body: FormBody): AnswersPayload` in `src/plugins/forms/main/round-type.ts`
- `describe(): Record<string, unknown>;` in `ItemFormat` in `src/plugins/forms/main/kinds/item-format.ts`
- `parse(raw: unknown, at: RoundItemPath): Item;` in `ItemFormat` in `src/plugins/forms/main/kinds/item-format.ts`
- `argsErrorText(error: unknown): string | null;` in `AgentFormType` in `src/contracts/agent-forms.ts`

Decisions:
- Wire text stays byte-identical: every tool result text and error text of `ask_round` and `collect_last_round`, the
  `FORMS_TOOLS` list, and the primer's and the audio picker's error texts. Tests pin the exact strings (plan.md, Decisions).
- `RoundError` holds `path`, `problem` and `detail`. `problem` is free text. `detail` is `''` when there is none
  (plan.md, Decided by the agent).
- Payloads become an outcome plus a reason: round logic builds a `RoundResult`, and `roundPayload` words it (plan.md).
- Round-specific wording goes to `src/plugins/forms/main/mcp-wording.ts`. Generic lines stay in
  `src/shared/agent-forms/form-service.ts` and `tool-session.ts`, over the type's `noun`, `openTool` and `collectTool`
  (plan.md).
- After this task, these files hold no `ask_round` or `collect_last_round`, comments included:
  `round-error.ts`, `round.ts`, `round-type.ts`, and every non-test file under `src/plugins/forms/main/kinds/` (the
  scope of the grep is drafter).
- `needs_manual_open` leaves `Outcome` in `src/plugins/forms/contract.ts`, `PrimerOutcome` in
  `src/plugins/primer/contract.ts` and `AudioPickerOutcome` in `src/plugins/audio-picker/contract.ts` (the audio picker
  by the user, refresh round: it landed after the plan and takes the same treatment). No TypeScript type replaces it. The marketplace relay produces it
  (`relay.py` lines 249–254, the `needs_manual_open` payload builder) and no code in this repo produces or reads it. The three tool descriptions keep their
  sentence about it, since that sentence is wire text the agent reads from this app's tool list (drafter).
- `RoundErrorPath` is a closed union (drafter):
  ```ts
  export type RoundErrorPath =
    | { at: 'call' }                                   // the round call as a whole
    | { at: 'field'; field: string }                   // one of the round's own fields
    | { at: 'item'; kind: ItemKind; number: number };  // one item, `number` 1-based
  ```
  The `field` is the round field's key: `'heading'`, `'overview'`, `'layout'`, or a list key such as `'notices'`.
  An item's own field name stays in `problem`, as today (`choices[2].action must be one of …`).
- `roundErrorText` words an error as `prefix + problem`, then `' ' + detail` when `detail` is not `''`. The prefix,
  pinned to today's text (drafter):

  | `path` | prefix |
  |---|---|
  | `{ at: 'call' }` | `ask_round ` |
  | `{ at: 'field', field: 'heading' }` | `` (empty: today's heading message has no prefix) |
  | `{ at: 'field', field: <any other> }` | `ask_round's ` |
  | `{ at: 'item', kind, number }` | `` `${capitalised(FORMATS[kind].noun)} ${number}: ` `` (`Notice 1: `) |

- Split rule at each throw site: `problem` is today's message after its prefix, up to and including the end of the
  first sentence. `detail` is the rest, after the one space that follows that sentence. Examples, from today's
  messages:
  - `` `ask_round takes an object with ${…}. Each list is optional, but the round needs at least one item.` `` →
    path call, problem `` `takes an object with ${…}.` ``, detail `Each list is optional, but the round needs at least one item.`
  - `` `${where}${field} must be a non-empty string. Give it the text you would have written in the reply.` `` →
    problem `` `${field} must be a non-empty string.` ``, detail `Give it the text you would have written in the reply.`
  - `` `${where}each notice must be an object.` `` → problem `each notice must be an object.`, detail `''`.

  The rule, for every site: `problem` runs to the first `. ` and keeps its `.`; `detail` is the text after that
  space. A message with no `. ` has the whole text as `problem` and `''` as `detail`. The golden test pins only the
  joined text, not the cut. So any cut is accepted where `problem + ' ' + detail` equals today's message after its
  prefix, or where `problem` alone equals it and `detail` is `''`.
- `RoundError.message` is `problem`, then `' ' + detail` when `detail` is not `''`, with no prefix. It is for logs
  and `errorText` only. The agent's text is `roundErrorText(error)` (drafter).
- `RoundError.name` stays `ROUND_ERROR_NAME` (`'RoundError'`). The contract comment over `ROUND_ERROR_NAME` changes
  to say the tool error text is `roundErrorText`, not the message (drafter).
- `AgentFormType.argsErrorName: string` is replaced by `argsErrorText(error: unknown): string | null`: the
  model-facing text of an error `parse` threw for a malformed call, or `null` when `error` is not one. The tool
  session and the form service's unreadable-form error read it. This is the one contract change; the type's
  `noun`, `openTool` and `collectTool` stay (drafter: the generic lines need a worded error, and the round's error no
  longer carries its wording in `message`).
  - `roundType.argsErrorText`: `roundErrorText(error)` when `error instanceof RoundError`, else `null`.
  - `primerType.argsErrorText`: `error.message` when `error instanceof PrimerError`, else `null`. The primer's text
    does not change.
  - The audio picker type (`createAudioPickerType` in `src/plugins/audio-picker/main/picker-type.ts`):
    `argsErrorText` is `error.message` when `error instanceof AudioPickerError` (`main/picker-error.ts`), else `null`.
    Its text does not change. `AUDIO_PICKER_ERROR_NAME` stays: `picker-error.ts` names the class with it, and
    `audio-reads.ts` (line 123 at refresh time) checks it on its own reads, which this task leaves as they are (refresh,
    Decided).
  - `TEST_FORM_TYPE.argsErrorText`: `` `Bad form: ${error.message}` `` when `error` is an `Error` named
    `TEST_FORM_ERROR_NAME`, else `null`. The prefix makes the tests prove the shared code uses the type's text.
  - The prefix reaches only the two texts `argsErrorText` words: the tool session's error result and the
    unreadable-form error. `session.open` and `session.collect` still reject with the `testFormError` object itself.
    Measured at plan time, exactly two assertions change, both listed in Tests:
    `tool-session.test.ts` (line 114, `'questions must hold at most 20 items'`) and `form-service.test.ts` (line 1250,
    `'items must be a non-empty array of strings'`). The `toMatchObject({ name: TEST_FORM_ERROR_NAME })` assertions
    (`form-service.test.ts` lines 236 and 1633) read the rejected error, not a worded text, and do not change.
- `RoundReason` and `RoundResult` (drafter):
  ```ts
  export type RoundReason =
    | { kind: 'finished' }                    // submitted or cancelled, returned plainly
    | { kind: 'stillOpen' }                   // a draft of the round the call waits on
    | { kind: 'autoAnswered' }
    | { kind: 'handedBack'; heading: string } // an earlier round's answers
    | { kind: 'notShown'; heading: string; blockingHeading: string | null }
    | { kind: 'noRound' };
  export interface RoundResult {
    outcome: Outcome;
    reason: RoundReason;
    answers: AnswerResult[];
    findings: FindingResult[];
    notices: NoticeResult[];
    note: string;                             // '' when the user wrote none
  }
  ```
  `answersResult` sets `reason` from `outcome`: `'draft'` → `stillOpen`, `'auto_answered'` → `autoAnswered`,
  `'submitted'` and `'cancelled'` → `finished`. `notShownResult` is today's `roundNotShownPayload` record: outcome
  `'draft'`, the round's blank answers, reason `notShown`. `noRoundResult` has outcome `'no_round'`, empty lists and
  note `''`.
- `roundPayload` builds the wire payload with keys in this order, since the tool result text is
  `JSON.stringify(payload, null, 2)`: `outcome`, `summary`, `next`, `answers`, `findings`, `notices`, then `note`
  only when it is not `''`, then `earlier_heading` only for `handedBack` (its `heading`). The `summary` and `next`
  per reason are today's texts, moved verbatim from `round.ts` (`NEXT_ON_DRAFT`, `NEXT_ON_AUTO_ANSWERED`,
  `NEXT_ON_NO_ROUND`, `summarise`, `countOf`, `handedBackPayload`'s `next`, `noRoundPayload`'s summary) and from
  `round-type.ts` (`roundNotShownPayload`'s summary and next). `summarise` counts `findings` as the `finding` kind
  and `answers` as the `question` kind, in `ANSWERABLE_KINDS` order, as today.
- `roundType` stays in `round-type.ts` and composes logic and wording: `openTool: ROUND_OPEN_TOOL`,
  `collectTool: ROUND_COLLECT_TOOL`, `noun: 'round'`, `payload` = `roundPayload(answersResult(…))`,
  `handedBackPayload` = `roundPayload(handedBackResult(…))`, `noFormPayload` = `roundPayload(noRoundResult())`,
  `notShownPayload` = `roundPayload(notShownResult(…))`. `autoAnsweredPayload` moves from `round.ts` to
  `round-type.ts`, as `roundPayload(answersResult(round, 'auto_answered', body))`; `start.ts` imports it from there.
  `recommendedBody` stays in `round.ts` (drafter).
- `tool-definitions.ts` names its two tools with `ROUND_OPEN_TOOL` and `ROUND_COLLECT_TOOL`. Its description
  strings do not change (drafter).
- `ItemFormat.arraySchema` becomes the method `describe()`, which returns the same schema object. Each format's
  description constants and its `describe` stay in its own `<kind>-format.ts` (drafter: Lane E's Forms item kinds as
  registrations carries the format object whole, so a file split now would be re-cut by it; a separate schema file
  would also need the field lists both halves read, which makes an import cycle).
- `ItemFormat.parse(raw, where: string)` becomes `parse(raw, at: RoundItemPath)`. In `fields.ts`, `requireText`,
  `parseLayoutField` and `parseRecommend` take `at: RoundErrorPath` in place of `where: string`. `parseItems` in
  `round.ts` builds `{ at: 'item', kind, number: i + 1 }`, so it takes the kind beside the format (drafter).
- `requireKnownLayouts` keeps its order: the round's layout (path `{ at: 'field', field: 'layout' }`), then each
  item's in `ITEM_KINDS` order (item path).
- The `preview skipped a saved round:` log line in `preview/layout-preview.ts` now shows the message without its
  prefix. It is a log line no script parses; the file does not change (drafter).

Mandatory:
- `AGENTS.md` § Architecture: "An item kind", "An agent form type", "An agent form source", "An MCP tool"; § Running
  and testing, the self-test paragraph.
- The marketplace's `plugins/wigley/scripts/forms/README.md` § the outcome table (about line 212), for what the agent
  does with each outcome.
- `wigley:writing-tests` § Assertions that go stale: the full text of a message is asserted here because an agent
  reads it.

GIVEN a malformed `ask_round` call WHEN the tool session returns it THEN the error text is byte-identical to today's
GIVEN any `ask_round` or `collect_last_round` result WHEN the tool session returns it THEN its text is byte-identical to today's
GIVEN the tool list WHEN `FORMS_TOOLS` is built from each format's `describe()` THEN its JSON is byte-identical to today's
GIVEN a form type WHEN its `parse` throws an args error THEN the tool session's error text and the unreadable-form error both carry `type.argsErrorText(error)`
GIVEN an error `argsErrorText` returns `null` for WHEN a tool call throws it THEN the call rejects with it, as today
GIVEN `answersResult`, `handedBackResult`, `notShownResult` or `noRoundResult` WHEN it builds a result THEN the result's `reason` names why, per the table in Decisions

Tests:
- `src/plugins/forms/main/mcp-wording.test.ts` › `describe('round wire text')` — the golden test. Its expected
  values are captured from today's tree in step 1, as literals in the file. Every case goes through
  `createAgentFormToolSession(session, roundType)` and asserts `result.content[0].text` with `toBe`:
  - `it.each(ERROR_ROWS)('words $name as today')` — a fake session whose `open` runs
    `requireKnownLayouts(parseRound(args), ['default', 'compact'])`. One row per `new RoundError(` site (46, measured
    at plan time, re-verify: 6 in `round.ts`, 4 in `kinds/fields.ts`, 4 in `notice-format.ts`, 7 in
    `question-format.ts`, 25 in `finding-format.ts`). Three more rows give the shared helpers their other prefix:
    one per shared helper, each with the prefix its site row does not use: `requireText` (on `heading`, no prefix,
    and on an item field), `parseLayoutField` (on the round and on an item), `requireKnownLayout` (on the round and on
    an item). Each row also asserts `isError: true`.
  - `it.each(PAYLOAD_ROWS)('returns $name as today')` — a fake session whose `open` resolves the payload. The round
    is `{ heading: 'Cache review', overview: 'Reviewing the cache.', notices: [notice()], findings: [finding()],
    questions: [question(), question({ title: 'Second' })] }`, with the `question`, `finding` and `notice` builders
    copied from `round.test.ts`. The body: question 1 choice 1; question 2 `not_applicable` with notes `'later'`;
    finding 1 choice 1, action `'fix_now'`, `dont_ask: true`, `dont_ask_reason: 'obvious'`; notice 1 comment
    `'looks right'`; note `'All good'`. Rows: `roundType.payload` with `'submitted'`, `'cancelled'`, and `'draft'`
    over `readFormBody(round, {})`; `roundType.handedBackPayload` with `'submitted'`; `roundType.noFormPayload()`;
    `roundType.notShownPayload(round, 'Other round')`; `roundType.notShownPayload(round, null)`;
    `autoAnsweredPayload(round, recommendedBody(round))`; `roundType.payload` with `'submitted'` over the round
    `{ heading: 'Notes', notices: [notice()] }` and `readFormBody` of `{}`.
  - `it('publishes the round tools as today')` —
    `expect(JSON.stringify(FORMS_TOOLS, null, 2)).toMatchFileSnapshot('./forms-tools.golden.txt')`. The `.txt`
    extension keeps `oxfmt` off the file.
- `src/plugins/forms/main/round.test.ts`:
  - The `roundError` and `layoutError` helpers return `roundErrorText(error)` in place of `error.message`. Their
    assertions do not change.
  - The payload tests call through `roundType`: `answersPayload(…)` becomes `roundType.payload(…)`,
    `handedBackPayload(…)` becomes `roundType.handedBackPayload(…)`, `noRoundPayload()` becomes
    `roundType.noFormPayload()`, and `autoAnsweredPayload` is imported from `./round-type`. The
    `toBe(NEXT_ON_AUTO_ANSWERED)` assertion becomes `toBe(<the literal text>)`, the text captured in step 1. The
    other assertions do not change.
  - New: `it.each` `'gives a $name result the reason $reason'` — `answersResult` with `'draft'` → `{ kind:
    'stillOpen' }`, `'submitted'` → `{ kind: 'finished' }`, `'cancelled'` → `{ kind: 'finished' }`,
    `'auto_answered'` → `{ kind: 'autoAnswered' }`; `handedBackResult` → `{ kind: 'handedBack', heading: 'H' }`;
    `notShownResult(round, 'Other')` → `{ kind: 'notShown', heading: 'H', blockingHeading: 'Other' }`;
    `noRoundResult()` → `{ kind: 'noRound' }`. The round's heading is `'H'`.
- `src/plugins/forms/main/kinds/notice/notice-format.test.ts`, `question/question-format.test.ts`,
  `finding/finding-format.test.ts`: each `parseError` helper passes `{ at: 'item', kind: <its kind>, number: 1 }`
  in place of `'<Noun> 1: '`, and returns `roundErrorText(error)`. Every other `parse(…, '<Noun> 1: ')` call passes
  the same path. Assertions do not change.
- `src/plugins/forms/main/kinds/fields.test.ts` › `parseLayoutField` — calls pass
  `{ at: 'item', kind: 'question', number: 1 }`. The refusal row asserts `roundErrorText` of the thrown error matches
  `/^Question 1: .*layout/`, in place of `toThrow(/^Question 1: .*layout/)`.
- `src/shared/agent-forms/tool-session.test.ts` › the args-error test, renamed `'returns the args error as an error
  result carrying the type's text for it'` — expects text `'Bad form: questions must hold at most 20 items'`.
- `src/shared/agent-forms/tool-session.test.ts` › new: `'rejects with a plain Error the type has no text for'` — a
  fake session whose `open` throws `const error = new Error('boom')`; `argsErrorText(error)` is `null` for it, so
  `toolSessionOver(session).call('open_form', {}, context())` rejects with `toBe(error)`. The existing
  `'lets any other error out'` test (a `TypeError`) stays.
- `src/shared/agent-forms/form-service.test.ts` › `'reports a saved form that no longer parses to collect_last_form
  and leaves it unreturned'` — the assertion `toThrow('items must be a non-empty array of strings')` becomes
  `toThrow('(Bad form: items must be a non-empty array of strings)')`.
- `src/plugins/primer/main/primer-type.test.ts` — new: `'returns a malformed open_primer's message as its tool error
  text'`: `createAgentFormToolSession(session, primerType)` over a fake session whose `open` runs
  `primerType.parse(args)`, args `{ feature: SAMPLE_PRIMER_ARGS.feature, entries: [] }`; the result is
  `{ content: [{ type: 'text', text: "'entries' must be a non-empty array: the primer rows, then the standing tasks." }], isError: true }`.
- `src/plugins/audio-picker/main/picker-type.test.ts` — new: `'returns a malformed open_audio_picker's message as its
  tool error text'`: `createAgentFormToolSession(session, createAudioPickerType(paths))` over a fake session whose
  `open` runs the type's `parse(args)`, args `'nope'`; the result is `{ content: [{ type: 'text', text: <the message
  parseAudioPicker('nope', paths) throws> }], isError: true }`. The existing `'rejects a malformed open_audio_picker
  with its AudioPickerError and shows nothing'` test stays as it is.
- `round-type.test.ts`, `tool-definitions.test.ts`, `start.test.ts`: no change; they must still pass.
- Self-test: no new step. The task adds no behaviour. The forms self-test already checks the fixture round's
  `summary` string and the unknown-layout refusal's text (`src/plugins/forms/main/selftest-script.ts`,
  `payloadProblems` and `unknownLayoutProblems`).

Approach — the five steps, in order:

1. **Capture.** Before any source edit, write `mcp-wording.test.ts` against today's tree. It imports `parseRound`,
   `requireKnownLayouts`, `readFormBody`, `recommendedBody` and `autoAnsweredPayload` from `./round`, `roundType`
   from `./round-type`, `FORMS_TOOLS` from `./tool-definitions`. Capture each row's text from today's code (for
   example, a throwaway test that writes each row's text to a JSON file in the session scratchpad, then the rows
   copy them in), and write each as the row's literal `expected`. Delete the throwaway. Run
   `npm test -- src/plugins/forms/main/mcp-wording.test.ts`: it must pass, and the first run writes
   `forms-tools.golden.txt`. A throw site no input reaches gets no row: name it in Proof. Paste the passing run's
   summary line into Proof.
2. **Structured errors.** Change `RoundError`, the helpers in `fields.ts`, `ItemFormat.parse` and all 46 sites to
   paths, problems and details. Add `roundErrorText`, `ROUND_OPEN_TOOL` and `ROUND_COLLECT_TOOL` to `mcp-wording.ts`.
   Update the error helpers in the tests listed above.
3. **Results.** Add `RoundReason`, `RoundResult` and the four result functions to `round.ts`. Move the payload
   wording to `roundPayload` in `mcp-wording.ts`. Compose `roundType` and `autoAnsweredPayload` in `round-type.ts`.
   Point `start.ts` and `round.test.ts` at them. Move the step 1 imports of `autoAnsweredPayload` to `./round-type`.
4. **Contract.** Replace `argsErrorName` with `argsErrorText` in `AgentFormType`. `tool-session.ts` returns
   `type.argsErrorText(error)` as the error text when it is not `null`, else rethrows; its `AgentFormTools` pick
   names `argsErrorText`. `form-service.ts`'s `formFromRecord` uses `session.type.argsErrorText(error)`, and
   `unreadableFormError` takes that text in place of the cause `Error`, writing it where `cause.message` is today.
   Fill the member in `roundType`, `primerType`, the audio picker type and `TEST_FORM_TYPE`.
5. **Schema and outcomes.** Turn `arraySchema` into `describe()` in the three formats; `tool-definitions.ts` calls
   `FORMATS[kind].describe()` and uses the tool-name constants. Remove `'needs_manual_open'` from `Outcome`,
   `PrimerOutcome` and `AudioPickerOutcome`, and delete the audio picker contract's two-line comment over it
   (`Only the wigley-forms relay returns …`); the primer comment `` // `no_primer` and `needs_manual_open` carry no `feature` and no `entries`. ``
   becomes `` // `no_primer` carries no `feature` and no `entries`. ``. Reword the comments that name `ask_round` or
   `collect_last_round` in the files the grep in Decisions covers; `fixtures.ts`'s comment may keep `ask_round`.
   In `AGENTS.md` § Architecture "An item kind", change `` `round.ts`'s fixed keys (`parseRound`, `readFormBody`, the
   answers payload) `` to `` `round.ts`'s fixed keys (`parseRound`, `readFormBody`, the answers result) and
   `mcp-wording.ts`'s answers payload ``. Run the golden test after each step; it must stay green with no edit to its
   literals or to `forms-tools.golden.txt`.

Done when:
- compiles: `npm run lint` and `npm run typecheck` pass.
- the test gate runs every test file in Tests.
- `grep -rn 'ask_round\|collect_last_round' src/plugins/forms/main/round-error.ts src/plugins/forms/main/round.ts src/plugins/forms/main/round-type.ts src/plugins/forms/main/kinds --include='*.ts' | grep -v '\.test\.ts'` prints nothing.
- `grep -rn needs_manual_open src --include='*.ts'` prints only the three tool-definitions description lines
  (`src/plugins/forms/main/tool-definitions.ts`, `src/plugins/primer/main/tool-definitions.ts`,
  `src/plugins/audio-picker/main/tool-definitions.ts`).
- `grep -rn argsErrorName src` prints nothing.
- Proof holds step 1's passing run on the untouched tree, and states that no literal in `mcp-wording.test.ts` and
  nothing in `forms-tools.golden.txt` changed after it.

Commit: one commit for the group. It also removes the **Structured round results** entry from
`docs/features/followups.md` § Harness seams, and ticks `- [ ] Structured round results` in
`docs/features/intent-alignment/master-plan.md` (step 3 of Lane H). Lane E's forms chain starts only after this
commit (plan.md, Lane gates).

## Proof
