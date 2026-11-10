# 06 — Forms item kinds register in main

Status: not started
Type: Task
Wave: 1 · Depends on: none in this plan · Gated: Lane H's Structured round results (plan.md precondition 2)
Plan: [plan.md](plan.md)

**Read first.** This document was written against the tree before Lane H's Structured round results landed. That
work rewrites `main/round.ts`, `main/round-type.ts`, `main/kinds/*` and `contract.ts`'s `Outcome` and `RoundError`.
Before the first edit, read its commits
(`git log --oneline -- src/plugins/forms/main/round.ts src/plugins/forms/main/kinds src/plugins/forms/contract.ts`).
The decisions below name responsibilities and members, not lines. Report as a concern each Produces item that the
Lane H work moved, renamed or made impossible, and each member below that no longer exists.

## What this task does

Main's closed per-kind tables become one registry. Each item kind registers a `MainItemKind` through
`registerKind`. The three built-in kinds register through the same call in forms' main start. Every round function
in main reads the registered kinds instead of a fixed table. The `ask_round` schema follows the registry, and the
live sessions get the new schema without losing an open round. Saved round files stay byte-identical.

The page side (`PageKind`, page tables, the page's `Round` reads) is task 07. This task edits no page file and
does not edit `src/plugins/forms/manifest.ts` (task 01 owns it in Wave 1).

## The page stays unchanged in this task

The page reads `ItemKind` in mapped types (`[K in ItemKind]` in `page/kinds/item-format.ts`, `page/layout/card-kit.ts`,
`page/layout/layout-cards.ts`, `page/form-state.ts`) and builds `Round` and `FormBody` literals with the named arrays
(`page/test-rounds.ts` `presentedRound`, `page/form-state.ts` `buildBody`, and the page tests). So this task keeps
these contract shapes compiling for the page:

- `ItemKind` stays the closed union of the built-ins in this task. Task 07 widens it to `string`.
- `Round` keeps `questions`, `notices` and `findings`. Main's own form type extends it with the record by kind
  (`KindRound`, below). Task 07 moves the record into the contract `Round` and drops the named members.
- `FormBody` and `AnswersPayload` keep their named members and gain an index signature, so a registered kind's
  list sits at its own wire key at the top level, as the saved file and the tool result hold it.

## Files

- modify `src/plugins/forms/contract.ts`
- create `src/plugins/forms/item-kinds.ts` (`BUILT_IN_KIND_SPECS`, the built-in specs both processes import)
- create `src/plugins/forms/main/kinds/registry.ts` · test `src/plugins/forms/main/kinds/registry.test.ts`
- modify `src/plugins/forms/main/kinds/formats.ts` (becomes the built-in list) · delete
  `src/plugins/forms/main/kinds/formats.test.ts` (its two order checks have nothing left to check; the registry test
  owns the rules now)
- modify `src/plugins/forms/main/kinds/item-format.ts` (`ItemOf`, `ItemFormat`, `AnswerableFormat`, `FormatTable` and
  `PythonJsonValue` leave; `AnswerSubject` stays if the finding and question results still use it, else the file is
  deleted)
- modify `src/plugins/forms/main/kinds/notice/notice-format.ts`, `finding/finding-format.ts`,
  `question/question-format.ts` (each becomes a `MainItemKind`)
- create `src/plugins/forms/main/kinds/answer-results.ts` (the shared answer result rules that leave `round.ts`:
  `answerResult`, `addNotesAndDontAsk`, the answer entry reader)
- modify `src/plugins/forms/main/round.ts` · test `src/plugins/forms/main/round.test.ts`
- modify `src/plugins/forms/main/round-type.ts` · test `src/plugins/forms/main/round-type.test.ts`
- modify `src/plugins/forms/main/tool-definitions.ts` · test `src/plugins/forms/main/tool-definitions.test.ts`
- create `src/plugins/forms/main/tool-contribution.ts` · test `src/plugins/forms/main/tool-contribution.test.ts`
- modify `src/plugins/forms/main/start.ts` · test `src/plugins/forms/main/start.test.ts`
- modify `src/plugins/forms/main/preview/layout-preview.ts` · test `layout-preview.test.ts`,
  `preview/preview-round.test.ts` (each passes the built-in kinds)
- modify `src/plugins/forms/main/fixtures.ts` (tool name from `ROUND_TOOLS`)
- modify the kind format tests (`notice-format.test.ts`, `finding-format.test.ts`, `question-format.test.ts`) only
  where they import a renamed const

No file under `src/plugins/forms/page/`, `src/plugins/forms/layouts/`, `src/plugins/sessions/` or
`src/shared/agent-forms/` changes. Counts and names in this list were measured at plan time; re-verify after the
Lane H commits.

## Consumes

- `SessionsMainExports.contributeTools(tools, start, options?): Disposable` in `src/plugins/sessions/contract.ts`
  (the tree holds it). Behaviour verified at plan time in `src/plugins/sessions/main/session-list.ts` and
  `main/start.ts`: a contribution's tool list is fixed for its life; `contributeTools` starts its tool session in
  every live session, sends MCP `notifications/tools/list_changed` and rewrites `tools.json`; `dispose` ends the
  contribution's tool session in every live session, synchronously, and sends `list_changed` again. Ending a forms
  tool session ends its forms session, which closes the session's open round.
- `Registrations.track` in `src/contracts/disposable.ts`; `MainStart.exports?(consumer: Registrations): unknown` in
  `src/contracts/plugin.ts` (the tree holds both).

## Produces

In `src/plugins/forms/contract.ts`:

```ts
export type BuiltInItemKind = 'notice' | 'finding' | 'question';
// The kinds the page draws. A registered kind's id is any string (ItemKindSpec.id).
export type ItemKind = BuiltInItemKind;
export type AnswerableKind = Exclude<BuiltInItemKind, 'notice'>;

// The values Python's json.dumps writes for a fingerprint (moved from main/kinds/item-format.ts).
export type PythonJsonValue =
  | string
  | number
  | PythonJsonValue[]
  | { [key: string]: PythonJsonValue };

export interface ItemKindSpec {
  id: string;
  argsKey: string;
  bodyKey: string;
  resultKey: string;
  fingerprintJoinsWhenEmpty: boolean;
  answerable: boolean;
}

export interface MainItemKind<Item = unknown, Entry = unknown, Result = unknown> {
  readonly spec: ItemKindSpec;
  readonly noun: string;
  readonly arraySchema: Readonly<Record<string, unknown>>;
  parse(raw: unknown, where: string): Item;
  layout(item: Item): string | null;
  fingerprintContent(item: Item): PythonJsonValue;
  readEntry(index: number, saved: Readonly<Record<string, unknown>>): Entry;
  recommendedEntry(item: Item, index: number): Entry;
  finishedEntry?(entry: Entry): Entry;
  result(item: Item, entry: Entry): Result;
  status?(result: Result): AnswerStatus;
}

export interface FormsMainExports {
  registerKind(kind: MainItemKind): Disposable;
}

export const formsMainKey: DependencyKey<FormsMainExports, 'main', 'forms'> = {
  id: 'forms',
  process: 'main',
};
```

Member meanings (write each as the comment over the member):

- `noun`: singular, lower case; the error prefix (`Notice 2: `) and the summary count (`2 notices`).
- `arraySchema`: the JSON Schema of the `ask_round` field `spec.argsKey`.
- `parse`: throws an `Error` whose `name` is `ROUND_ERROR_NAME` and whose message starts with `where`.
- `layout`: the layout the item names, null for none.
- `readEntry`: never throws; `saved` is the saved entry with that 1-based index, `{}` when the body holds none.
- `recommendedEntry`: the entry a headless session answers the item with.
- `finishedEntry`: the entry a finished round's saved copy hands a re-sent round's draft; absent keeps the entry
  whole.
- `status`: present exactly when `spec.answerable` is true.

`FormsMainExports` gains `registerFindingOrigin` in task 08; this task adds only `registerKind`.

Also in `contract.ts`: `FormBody` gains `readonly [bodyKey: string]: unknown;` and `AnswersPayload` gains
`readonly [resultKey: string]: unknown;`, each with a comment: a registered kind's list sits at its wire key.
`Round`, `PresentedRound`, `FormsItemRef`, `FormsCardPart` and `FormsCardPartItem` do not change.

In `src/plugins/forms/main/kinds/registry.ts`:

```ts
export interface KindRegistry {
  register(kind: MainItemKind): Disposable;
  // The registered kinds in registration order.
  kinds(): readonly MainItemKind[];
  onChanged(listener: () => void): Disposable;
}
export function createKindRegistry(): KindRegistry;
```

In `src/plugins/forms/main/kinds/formats.ts`: `export const BUILT_IN_KINDS: readonly MainItemKind[]` —
`noticeKind`, `findingKind`, `questionKind`, in that order. Each kind module exports its const under that name
(`noticeKind: MainItemKind<Notice, NoticeComment, NoticeResult>`, `findingKind: MainItemKind<Finding,
FindingAnswerEntry, FindingResult>`, `questionKind: MainItemKind<Question, AnswerEntry, AnswerResult>`).
`FORMATS`, `ITEM_KINDS` and `ANSWERABLE_KINDS` leave the tree.

In `src/plugins/forms/main/round.ts`:

```ts
// A parsed round: every registered kind's items by kind id, and the built-ins' lists the page reads.
export interface KindRound extends Round {
  readonly items: Readonly<Record<string, readonly unknown[]>>;
}
export function parseRound(kinds: readonly MainItemKind[], args: unknown): KindRound;
export function requireKnownLayouts(kinds: readonly MainItemKind[], round: KindRound, layoutNames: readonly string[]): void;
export function readFormBody(kinds: readonly MainItemKind[], round: KindRound, raw: unknown): FormBody;
export function answersPayload(kinds: readonly MainItemKind[], round: KindRound, outcome: RoundOutcome, body: FormBody): AnswersPayload;
export function handedBackPayload(kinds: readonly MainItemKind[], round: KindRound, outcome: FinishedOutcome, body: FormBody): AnswersPayload;
export function recommendedBody(kinds: readonly MainItemKind[], round: KindRound): FormBody;
export function autoAnsweredPayload(kinds: readonly MainItemKind[], round: KindRound, body: FormBody): AnswersPayload;
export function noRoundPayload(kinds: readonly MainItemKind[]): AnswersPayload;
export function fingerprint(kinds: readonly MainItemKind[], round: KindRound): string;
```

In `src/plugins/forms/main/round-type.ts`:

```ts
export const ROUND_TOOLS = {
  openTool: 'ask_round',
  collectTool: 'collect_last_round',
  argsErrorName: ROUND_ERROR_NAME,
} as const;
export function createRoundType(
  kinds: () => readonly MainItemKind[],
): AgentFormType<KindRound, FormBody, AnswersPayload>;
export function withKnownLayouts(
  service: FormsService,
  kinds: () => readonly MainItemKind[],
  layoutNames: () => readonly string[],
): FormsService;
```

In `src/plugins/forms/main/tool-definitions.ts`: `export function formsTools(kinds: readonly MainItemKind[]): ToolDefinition[]`
(replaces `FORMS_TOOLS`).

In `src/plugins/forms/main/tool-contribution.ts`:

```ts
export function contributeFormsTools(deps: {
  sessions: Pick<SessionsMainExports, 'contributeTools'>;
  tools: () => ToolDefinition[];
  startSession: (session: AgentSession) => FormsSession;
  type: Pick<AgentFormType<unknown, unknown, unknown>, 'openTool' | 'collectTool' | 'argsErrorName'>;
}): { refresh(): void } & Disposable;
```

In `src/plugins/forms/main/start.ts`: `formsMainPart.start` returns `exports: (consumer) => FormsMainExports`.

## Decisions

**Built-in specs.** Pinned verbatim; saved files and retro read these keys. They live once, in
`src/plugins/forms/item-kinds.ts` as `export const BUILT_IN_KIND_SPECS: Readonly<Record<BuiltInItemKind,
ItemKindSpec>>`, because task 07's page kinds read the same values and the page may not import `main/`. Each main
kind's `spec` is `BUILT_IN_KIND_SPECS.<id>`.

| id | argsKey | bodyKey | resultKey | fingerprintJoinsWhenEmpty | answerable |
|---|---|---|---|---|---|
| `notice` | `notices` | `notice_comments` | `notices` | true | false |
| `finding` | `findings` | `finding_answers` | `findings` | false | true |
| `question` | `questions` | `answers` | `answers` | true | true |

The join rules are today's `FINGERPRINT_LISTS` `joinsWhenEmpty` values in `round.ts`.

**Registration.** Forms' main start creates one registry and registers `BUILT_IN_KINDS` in order through
`registry.register`, before the first tool contribution. The exports' `registerKind` calls the same
`registry.register` and files the handle with `consumer.track`. `register` throws, registering nothing, and the
message starts with `Item kind "<id>": `, when:

- another registered kind holds the same `id`, `argsKey`, `bodyKey` or `resultKey`
- `argsKey` is `heading`, `overview` or `layout`; `bodyKey` is `note`; or `resultKey` is `outcome`, `summary`,
  `next`, `note` or `earlier_heading`
- `spec.answerable` is true and `status` is absent, or false and `status` is present
- `spec.fingerprintJoinsWhenEmpty` is true and `id` is not a `BuiltInItemKind`. Reason: a kind that joins when empty
  adds its key to every round's fingerprint, so no saved round matches a re-send while the kind is registered.

`dispose` removes the kind; a second `dispose` does nothing. `onChanged` fires once per register and once per
first dispose.

**One order, from registration.** The registry's order is registration order: `notice`, `finding`, `question`, then
each later kind. Each use reads it as follows:

- Forward order: `ask_round`'s accepted fields (`heading`, `overview`, `layout`, then each `argsKey`), the parse
  order, the noun list in the empty-round error (`ask_round needs at least one notice, finding or question.`), the
  schema's item properties, `requireKnownLayouts` (the round's own layout first), and the summary's count order
  over answerable kinds (`finding`, then `question`).
- Reverse order: the keys of a written `FormBody` after `note`, and the result lists of an `AnswersPayload` after
  `next`. Today's saved body is `note, answers, finding_answers, notice_comments` and today's payload is
  `outcome, summary, next, answers, findings, notices`, which is the reverse of the parse order. Reverse order keeps
  both byte-identical. A later kind's key comes before `answers`.
- The fingerprint does not depend on order: `pythonJsonDumps` sorts object keys. A kind joins
  `content[spec.argsKey]` when `fingerprintJoinsWhenEmpty` is true or its list is not empty.

**Record inside, named lists at the edge.** Main's round logic reads a kind's items only from `KindRound.items`, by
`spec.id`. The named members are edges:

- `KindRound.questions`, `notices`, `findings`: the page's view, copied from the built-ins' entries in `items` in
  `parseRound`. That copy is the one place main narrows a kind's items to a built-in item type.
- `FormBody`: the store edge and the page edge. Each kind's entries sit at `spec.bodyKey`. `readFormBody` and
  `recommendedBody` write them; every other function reads a kind's entries from `body[spec.bodyKey]` through one
  helper, which is the one place main narrows body entries. `readFormBody` reads `body.note` and each registered
  kind's saved list with today's `entriesByIndex` rule, then calls `readEntry(i + 1, saved ?? {})` per item.
- `AnswersPayload`: the payload edge. `answersPayload` builds each kind's results with `kind.result(item, entry)` and
  writes them at `spec.resultKey`. `noRoundPayload` writes `[]` at each registered `resultKey`.
- A kind registered after a round parsed has no entry in `items` and reads as an empty list. A list in `items`
  whose kind is no longer registered is left out of the body, the payload and the fingerprint.

**Per-kind code moves into the kinds.** Today's fixed code moves as follows:

| Today | After |
|---|---|
| `parseRound`'s three `parseItems` calls and the item count | one loop over the kinds |
| `ROUND_ITEM_LISTS` (round.ts) | `round.items[spec.id]` |
| `FINGERPRINT_LISTS` (round.ts) | `spec.fingerprintJoinsWhenEmpty` and `kind.fingerprintContent` |
| `readFormBody`'s three lists, `readAnswerEntry`, `readFindingAnswerEntry`, `oldFileNotes` | `kind.readEntry`; question and finding share the answer entry reader in `answer-results.ts` |
| `recommendedBody`'s three lists | `kind.recommendedEntry` |
| `answerResult`, `findingResult`, `noticeResult`, `addNotesAndDontAsk` | `kind.result`; question and finding share `answerResult` and `addNotesAndDontAsk` in `answer-results.ts` |
| `summarise`'s `results` record and `ANSWERABLE_KINDS` | answerable kinds in registration order, statuses from `kind.status` |
| `ANSWER_LISTS` and `withoutDontAsk` (round-type.ts) | `kind.finishedEntry` on question and finding |
| `FORMATS`, `ITEM_KINDS`, `ANSWERABLE_KINDS` (kinds/formats.ts) | `BUILT_IN_KINDS` and the registry |
| `ITEM_FIELDS`, `ROUND_FIELDS` constants (round.ts) | computed from the kinds at each parse |

The summary text does not change. When no answerable kind has items, the count text is `0 questions`, as today.

**Tool schema and live sessions.** `formsTools(kinds)` builds today's two tools; `ask_round`'s item properties come
from each kind's `spec.argsKey` and `arraySchema`, in forward order. `contributeFormsTools` makes the contribution:

- It keeps one forms session per agent session id across contributions.
- `refresh()` disposes the current contribution, then calls `contributeTools` again with `tools()`. While that
  dispose runs, a tool session's `end` leaves its forms session open. In the new contribution, `start` returns a
  tool session over the forms session it kept for that agent session id.
- Any other tool session `end` (the agent session ended, or the contribution's own `dispose`) ends the forms
  session and drops it.
- Forms' main start calls `refresh()` from `registry.onChanged`. The first contribution runs once, after the
  built-ins register.

Each refresh sends two `list_changed` notices and rewrites `tools.json`; the relay forwards both. Each refresh also
files one more handle with forms' own consumer of sessions; a disposed handle's second `dispose` does nothing.
Reason for re-contributing over a sessions change: the settled path is the disposable tool contribution, and
sessions has no way to replace a contribution's tools.

**No manifest change.** A main part's `exports` needs no manifest field. A plugin that registers a kind lists
`forms` in its own `dependsOn.main`.

## Behaviour

- GIVEN forms' main start ran WHEN `registry.kinds()` is read THEN it lists `notice`, `finding`, `question`, in that
  order.
- GIVEN a test kind `poll` (`argsKey: 'polls'`, `bodyKey: 'poll_answers'`, `resultKey: 'polls'`, answerable) is
  registered WHEN `ask_round` gets `{ heading: 'H', overview: 'O', polls: [<one poll>] }` THEN `parseRound` accepts it;
  `readFormBody` returns keys `note, poll_answers, answers, finding_answers, notice_comments` in that order; the
  payload's keys after `next` are `polls, answers, findings, notices`.
- GIVEN that `poll` registration is disposed WHEN the same args are parsed THEN `parseRound` throws
  `ask_round got unknown field(s): polls. It takes ...`, and the `ask_round` schema has no `polls` property.
- GIVEN a body saved today WHEN `readFormBody` reads it with the built-ins THEN `JSON.stringify` of the result equals
  the saved text byte for byte.
- GIVEN a live session with an open round WHEN a kind registers THEN the session's forms session is not ended and the
  round stays open; the new `ask_round` schema reaches `sessions.contributeTools`.
- GIVEN a plugin that registered a kind through `exports` WHEN that plugin stops THEN the kind leaves the registry
  and the schema.

## Tests

Before the first code change, add the fixed-hash test below and run it on the unchanged tree. It must pass there.
When it fails on the unchanged tree, write the hash that today's code prints as the literal and report the change
as a concern; today's code is the source of truth.

- `round.test.ts` § `fingerprint` — new test `pins a round of all three kinds to the hash saved files hold`.
  The round is `parseRound(BUILT_IN_KINDS, args)` with these args (every field explicit, so no default joins):

  ```json
  {
    "heading": "Ignored", "overview": "Ignored",
    "notices": [{ "title": "Renamed", "context": "done", "badge": "Applied" }],
    "findings": [{ "title": "Leak", "origin": "caused", "severity": "important", "impact": "Memory grows.",
      "finding": "The cache never empties.", "proof": "- cache.ts:10",
      "choices": [{ "text": "Clear the cache on close", "reason": "Frees memory." }],
      "recommend": 1, "recommend_action": "fix_now" }],
    "questions": [{ "title": "Naming", "summary": "Which name?", "context": "ctx", "choices": ["a", "b"],
      "recommend": 1, "rationale": "r" }]
  }
  ```

  Rows: as written → `9d2a6bcc16872111817bb133ca6884d80cac3374686004c367e408207b52b598`; with `findings: []` →
  `11c9cd9ef9ccd6280164980a1ef91d1e45f8bf2cc27cf035526c83b6bb911412` (findings join only when not empty). Both were
  computed at plan time with Python's `json.dumps(content, sort_keys=True, ensure_ascii=False)` and SHA-256 over
  the fingerprint content today's `fingerprintContent` functions produce. The existing test
  `equals Python's json.dumps hash for the same round` keeps its literal `58960c3e...77a7`.
- `round.test.ts` § `fingerprint` — new row: the built-ins registered in the order `question, finding, notice` give
  the same hash as `BUILT_IN_KINDS` for the args above (keys sort).
- `round.test.ts` § `readFormBody` — new test `writes a saved body back byte for byte`: `JSON.stringify` of
  `readFormBody(BUILT_IN_KINDS, round, JSON.parse(text))` equals `text`, for this text with a round of one question,
  one finding (choices 1, action `fix_now` offered) and one notice:
  `{"note":"n","answers":[{"index":1,"choice":2,"not_applicable":false,"notes":"","dont_ask":false,"dont_ask_reason":""}],"finding_answers":[{"index":1,"choice":1,"not_applicable":false,"notes":"","dont_ask":false,"dont_ask_reason":"","action":"fix_now"}],"notice_comments":[{"index":1,"comment":"ok"}]}`.
- `round.test.ts` — new `describe('a registered kind')` with the `poll` test kind (in the test file): parse accepts
  `polls`; the unknown-field error lists `polls` after `questions`; the empty-round error reads
  `ask_round needs at least one notice, finding, question or poll.`; body key order and payload key order as in
  Behaviour; the summary counts polls after questions; after dispose, `polls` is an unknown field and a parsed
  round's poll list is left out of the body and payload.
- Every existing `round.test.ts` and `round-type.test.ts` call passes `BUILT_IN_KINDS` (or `() => BUILT_IN_KINDS`);
  their expected values do not change. A changed expected value is a behaviour change: report it.
- `registry.test.ts` — one `it.each` over the throw rules in Decisions › Registration (each row: the spec change and
  the message start); plus registration order, dispose removes, a second dispose does nothing, `onChanged` fires
  once per register and per first dispose.
- `tool-definitions.test.ts` § `FORMS_TOOLS ask_round schema` — rename the describe to `formsTools ask_round schema`;
  new row: a registered `poll` kind adds `polls` with its `arraySchema` after `questions`. The existing per-argsKey
  rows run over `BUILT_IN_KINDS`.
- `tool-contribution.test.ts` — with a recording `contributeTools` fake: `refresh` disposes the old contribution and
  contributes `tools()` again; across a refresh the agent session keeps the same forms session and its `end` is not
  called; an agent session's own end, and the handle's `dispose`, end its forms session.
- `start.test.ts` § `forms main part` — new test: a kind registered through `exports(consumer).registerKind` puts its
  `argsKey` in the `ask_round` schema the part contributed; disposing the consumer's registrations takes it out.
- `round-type.test.ts` § `pre-fill` — the existing rows (a finished round's copy drops Don't ask, an open draft's
  keeps it) now run through `finishedEntry`; no new row.

## Done when

`npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. No file outside the Files list
changed. Live checks defer to task 12 (Final verification).

## Commit

One commit for the group: "Forms item kinds register in main: a kind registry replaces main's per-kind tables,
built-ins register through it, and the ask_round schema follows it".

## Proof

