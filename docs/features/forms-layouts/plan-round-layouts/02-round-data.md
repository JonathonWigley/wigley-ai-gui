# 02 — Round data: layout names, choice actions, deferral reasons

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Forms main accepts the new round fields, checks layout names against the layouts folder, and answers a finding as
one pick of a choice or an action header. The page gets only the type changes it needs to compile; the page's
answer model is task 04's.

Files:
- modify `src/plugins/forms/contract.ts` (the round, item and answer types only)
- modify `src/plugins/forms/finding-pick.ts`
- modify `src/plugins/forms/main/kinds/fields.ts` · test `src/plugins/forms/main/kinds/fields.test.ts`
- modify `src/plugins/forms/main/kinds/finding/finding-format.ts` · test
  `src/plugins/forms/main/kinds/finding/finding-format.test.ts`
- modify `src/plugins/forms/main/kinds/question/question-format.ts` · test
  `src/plugins/forms/main/kinds/question/question-format.test.ts`
- modify `src/plugins/forms/main/kinds/notice/notice-format.ts` · test
  `src/plugins/forms/main/kinds/notice/notice-format.test.ts`
- modify `src/plugins/forms/main/round.ts` · test `src/plugins/forms/main/round.test.ts`
- modify `src/plugins/forms/main/tool-definitions.ts` · test `src/plugins/forms/main/tool-definitions.test.ts`
- modify `src/plugins/forms/main/forms-service.ts` · test `src/plugins/forms/main/forms-service.test.ts`
- modify `src/plugins/forms/main/preview/layout-preview.ts` · test
  `src/plugins/forms/main/preview/layout-preview.test.ts`
- modify `src/plugins/forms/main/preview/preview-round.ts` (the Decision and the Nit of `PREVIEW_ROUND_ARGS` only) ·
  test `src/plugins/forms/main/preview/preview-round.test.ts` (no change; it must still pass)
- modify `src/plugins/forms/main/start.ts`
- modify (compile only) `src/plugins/forms/page/kinds/finding/finding-card.ts`, `src/plugins/forms/page/form-state.ts`
- test (compile only) `src/plugins/forms/page/test-rounds.ts`, `src/plugins/forms/page/form-state.test.ts`,
  `src/plugins/forms/page/view-model.test.ts`, `src/plugins/forms/page/forms-commands.test.ts`,
  `src/plugins/forms/main/channel-presenter.test.ts`, and every other typed `Round`, `Question`, `Notice`,
  `Finding` or `FindingChoice` literal `npm run typecheck` names
- no change: `src/plugins/forms/main/round-store.ts` and its test. The store writes `args` as sent (an `unknown`)
  and reads no item field, so the new keys are saved with no edit.

Consumes:
- `LayoutRegistry.names(): string[]` ← 01 (`src/shared/layouts/layout-registry.ts`)
- `serveLayouts(api, written): Promise<LayoutRegistry>` in `src/plugins/forms/main/start.ts` (01 keeps its shape)
- existing: `FINDING_ORIGIN_RULES`, `ACTION_WORDS` (`src/plugins/forms/finding-origins.ts`), `quotedList`,
  `requireText`, `parseRecommend`, `fieldsMissing`, `fieldsOutside` (`main/kinds/fields.ts`), `orList`,
  `unofferedActionsText`, `actionLabelsText`, `cardChoicesText` (`main/kinds/finding/finding-text.ts`), `capitalised`
  (`src/shared/capitalised.ts`)

Produces:
- `src/plugins/forms/contract.ts` (the plan's File Structure, word for word):
  - `Round.layout: string | null`; `Question.layout: string | null`; `Notice.layout: string | null`;
    `FindingFields.layout: string | null`
  - `export interface FindingChoice { text: string; reason: string; action: FindingAction }`
  - `FindingFields.actionReasons: Partial<Record<'follow_up' | 'leave_it', string>>` (wire key `action_reasons`)
  - `FindingFields.recommend: number | null`
  - The comment on `FindingAnswerEntry` says: `choice` is the picked choice's 1-based number in `choices`, 0 for an
    action header; `action` is the picked entry's action, '' for no pick. The comment on `FindingResult` says:
    `choice` and `choice_text` are the picked choice, 0 and '' for a header pick; `took_recommendation` is the
    recommended entry taken whole, `took_action_recommendation` the recommended action.
- `src/plugins/forms/finding-pick.ts`:
  `export function completeFindingPick(finding: Finding, choice: number, action: FindingAction | ''): { choice: number; action: FindingAction } | null`
- `src/plugins/forms/main/kinds/fields.ts`:
  - `export function parseLayoutField(item: JsonObject, where: string): string | null`
  - `export const ITEM_LAYOUT_SCHEMA: Record<string, unknown>`
- `src/plugins/forms/main/round.ts`:
  `export function requireKnownLayouts(round: Round, layoutNames: readonly string[]): void`
- `src/plugins/forms/main/forms-service.ts` — `FormsServiceDeps.layoutNames: () => readonly string[]`
- `src/plugins/forms/main/preview/layout-preview.ts` — `createLayoutPreview` deps gain
  `layoutNames(): readonly string[]`

Decisions (pinned in the interview unless marked Decided):
- **Layout fields.** `layout` is optional on the round and on each question, notice and finding. Absent or JSON
  `null` parses to `null`. Any other value must be a string with text in it (`value.trim() !== ''`), kept as sent,
  not trimmed. Else `parseLayoutField` throws `${where}layout must be a layout name: a non-empty string.` The round
  passes `where` = `ask_round's `, so the round's message is
  `ask_round's layout must be a layout name: a non-empty string.`; an item passes its usual prefix
  (`Question 2: `). `ROUND_FIELDS` becomes `['heading', 'overview', 'layout', ...ITEM_FIELDS]`. Each format adds
  `layout` to its known (not required) fields: question `QUESTION_FIELDS` stays the required list and a new known
  list adds `layout`; notice `NOTICE_FIELDS` adds `layout`; finding `KNOWN_FIELDS` adds `layout`. The notice's
  unknown-field message says `A notice takes only title, context, and the optional badge and layout; the form draws its own comment box, and a notice has no choices to describe.`
- **Unknown layout names fail the call; the check is apart from parsing (Decided).** `parseRound(args)` stays a
  pure shape check with no layout names, so a saved round re-parses (`roundFromRecord`) even when its layout has
  since left the folder; the page then draws `default` for it (plan File Structure, Settings). `requireKnownLayouts`
  runs in `askRoundQueuedOrNow` right after `parseRound`, on every `ask_round` call, re-sends included, before the
  fingerprint and before anything is saved or shown. It checks the round's `layout`, then each item's in
  `ITEM_KINDS` order (notices, findings, questions), and throws a `RoundError` for the first name not in
  `layoutNames`, verbatim:
  `${where}layout '${name}' is not in the layouts folder, which holds ${quotedList(layoutNames)}. Write layouts/${name}/layout.js there first, or leave layout out.`
  with `where` = `ask_round's ` for the round and `${capitalised(noun)} ${i + 1}: ` for an item. Example:
  `Finding 2: layout 'dense' is not in the layouts folder, which holds 'default' and 'compact'. Write layouts/dense/layout.js there first, or leave layout out.`
- **`layoutNames` wiring (plan: Design review, seam).** `FormsServiceDeps` gains `layoutNames`. Each session context
  holds it, so `askRoundQueuedOrNow` reads it per call. `start.ts` keeps the started registry in a variable once
  `serveLayouts`' promise resolves, and passes `layoutNames: () => registry?.names() ?? ['default']` to both
  `createFormsService` calls and to `createLayoutPreview` (Decided: before the registry has started, or when it
  failed to start, only `default` is known, which is all the page can draw then).
- **The preview skips a saved round naming a missing layout (Decided).** `nextRound` runs
  `requireKnownLayouts(parseRound(args), layoutNames())` in its `try`, so such a round is skipped with the existing
  log line `preview skipped a saved round: <message>`.
- **Fingerprint.** Layout names stay out of it (pinned): no format's `fingerprintContent` and no round-level key
  holds `layout`, so a re-send that differs only in layouts matches the open round and keeps the layouts it opened
  with. A choice's `action` and the finding's `action_reasons` join it (Decided): they change what a pick means and
  what the user reads to answer, as a choice's `reason` does today, so a re-send that changes them must not re-fill
  answers given to the old grouping. To keep every round that uses neither hashing as today (and the Python
  fingerprint test passing), a choice's content gains `action` only when it is not `fix_now`, so an omitted action
  and an explicit `fix_now` hash the same, and the finding's content gains `action_reasons` only when it holds an
  entry. `recommend` stays in it as `finding.recommend` when it is a number, and is left out when it is `null`.
- **Choice `action`.** `CHOICE_FIELDS` stays `['text', 'reason']` as the required list; a known list adds `action`.
  An absent `action` parses to `fix_now`. Messages, verbatim (`field` is `choices[<n>]`):
  - not an object: `${where}${field} must be an object with text, reason and an optional action.`
  - missing: `${where}${field} missing ${missing.join(', ')}. Each choice takes text and reason, and an optional action.`
  - unknown: `${where}${field} unknown field(s) ${extra.join(', ')}. Each choice takes text and reason, and an optional action.`
  - not one of the three: `${where}${field}.action must be one of ${quotedList(FINDING_ACTIONS)}.`
  - not offered by the origin:
    `${where}${field}.action is ${action}, which a ${origin} finding does not offer; it offers ${offered.join(' or ')}.`
    (`offered` is the origin's actions in `FINDING_ACTIONS` order; for a nit: `fix_now or leave_it`)
  - opening action word (the rule stays; the message changes):
    `${where}${field}.text opens with "${actionWord}", an action. A choice names a solution; its action field sets the action it sits under.`
- **At least one `fix_now` choice (Decided).** After the choices parse, a finding with no `fix_now`
  choice fails: `${where}no choice has action fix_now. A finding needs at least one fix_now choice; a choice with no action is fix_now.`
  Without it a Fix now / Decide now header pick would carry no solution. A nit (exactly one choice) therefore keeps
  its one fix as `fix_now`.
- **`action_reasons`.** Optional on a finding; absent parses to `{}`. Its keys are the deferral actions
  `follow_up` and `leave_it` (`FINDING_ACTIONS` without `fix_now`). Messages, verbatim:
  - not an object: `${where}action_reasons must be an object with follow_up, leave_it or both.`
  - other keys (`fix_now` included): `${where}action_reasons unknown key(s) ${extra.join(', ')}. It takes follow_up and leave_it, the deferral actions.`
  - an action the origin lacks (a nit's `follow_up`):
    `${where}action_reasons.${key} is for an action a ${origin} finding does not offer; it offers ${offered.join(' or ')}.`
  - a value with no text: the `requireText` message for field `action_reasons.${key}`.
  An entry for an offered action other than `recommend_action` is accepted (the pinned rule is "offered only").
- **`recommend`.** `FINDING_FIELDS` loses `recommend` (it is known, not required). Let `group` be the choices whose
  action is `recommend_action`. Checks after `recommend_action` parses, verbatim:
  - absent and `group` is not empty:
    `${where}missing recommend. recommend_action is ${recommendAction}, which has choices, so recommend names one of them; leave recommend out only when recommend_action has no choices.`
  - present and `group` is empty:
    `${where}recommend names a choice, but no choice has action ${recommendAction}, the recommend_action. Leave recommend out when the recommended action has no choices.`
  - present: `parseRecommend(raw, title, choices.length, 'solution', where)` as today (type and range messages
    unchanged), then a choice of another action fails:
    `${where}recommend is ${recommend}, a ${choiceAction} choice, but recommend_action is ${recommendAction}. recommend names a choice of the recommended action.`
  - absent and `group` is empty: `recommend: null`.
  The missing-fields message reads `FINDING_FIELDS`, so it now lists
  `title, origin, impact, finding, proof, choices, recommend_action`.
- **Check order in `parseFinding`:** missing fields, unknown fields, origin and severity, the texts, the choices
  (each choice with its action), the `fix_now` rule, `recommend_action`, `action_reasons`, `recommend`, `layout`.
  The unknown-field message becomes
  `${where}unknown field(s) ${extra.join(', ')}. The form draws the not-applicable control and the Notes box itself; do not describe them.`
- **`answerSubject` for a finding** gives `recommend: finding.recommend ?? 0` (0: no recommended choice).
  `AnswerSubject` keeps `recommend: number`.
- **The answers payload (plan: the payload keeps the `choice` and `action` keys; retro's reading of a pick changes in
  06).** `findingResult`
  reads the pick through `completeFindingPick`, and `round.ts` stops calling `findingPickIsComplete` and
  `findingSolution`. `completeFindingPick` returns, in this order:
  - `null` when `action` is `''`, or the finding's origin does not offer `action`;
  - for `choice >= 1`: `{ choice, action }` when `choice <= finding.choices.length` and
    `finding.choices[choice - 1].action === action`, else `null`;
  - for `choice` 0 (a header pick): `{ choice: 0, action }` when no choice of the finding has `action`, else
    `null`.
  The result, for an entry that is not not-applicable and a pick `p`:
  - `status`: `answered` when `p` is not `null`; else `untouched`. A not-applicable entry is `not_applicable` and
    reads no pick, as today.
  - `choice`: `p.choice`, else 0; `choice_text`: `finding.choices[choice - 1].text` when `choice > 0`, else `''`.
  - `action`: `p.action`, else `''`.
  - `took_recommendation`: `p` is not `null`, `p.choice === (finding.recommend ?? 0)` and
    `p.action === finding.recommend_action`.
  - `took_action_recommendation`: `p` is not `null` and `p.action === finding.recommend_action`.
  The one-solution leniency (choice 0 read as solution 1) goes: a lone choice is a numbered entry the user picks.
  `readFormBody` and `readFindingAnswerEntry` do not change.
- **`findingPickIsComplete` and `findingSolution` stay** in `finding-pick.ts`, unchanged, for the page until 04
  rewrites them on `findingEntries` (04's Produces gives their new signatures).
- **The preview round stays valid (Decided).** `PREVIEW_ROUND_ARGS` (`main/preview/preview-round.ts`) breaks two of
  the new finding rules today, so `previewRoundArgs_Parse_HoldEveryCardKind` and `Space z l o` would fail from this
  task on. Two edits make it valid:
  - the Decision ("Where theme tokens live"): its second choice ("A typed token object in the layout kit.") gains
    `action: 'follow_up'`, and `recommend` becomes 2 (`recommend_action` stays `follow_up`)
  - the Nit ("Typo"): `recommend` is left out (its one choice is a fix; it recommends `leave_it`, which has no
    choices)
  The Defect's follow-up choice and the `action_reasons` texts are 08's.
- **The self-test fixture stays as it is here.** The fixture round's finding 3 in `selftest-script.ts` (`recommend:
  2`, "Shared", `recommend_action: 'follow_up'`) breaks the new `recommend` rule. 08 owns that file in wave 6 and
  rewrites finding 3 there; 01 is the only other task that edits it, in wave 1. The self-test is not run until task
  10, and no unit test parses the fixture round, so the invalid fixture between 02 and 08 fails nothing.
- **Tool schema** (`finding-format.ts` `arraySchema`, `tool-definitions.ts`, each format's schema):
  - `ask_round.properties.layout`: `{ type: 'string', description: ROUND_LAYOUT_DESCRIPTION }`, not required:
    `The layout that draws this round: a folder name in the app's forms layouts folder. An item's own layout wins over it, and the user's forms.layout setting draws what neither names. A name the folder lacks fails the call with the names it holds.`
  - `ITEM_LAYOUT_SCHEMA` = `{ type: 'string', description: ITEM_LAYOUT_DESCRIPTION }` in each item's `properties`,
    not required: `The layout that draws this item's card, over the round's layout: a folder name in the app's forms layouts folder.`
  - finding `required` drops `recommend`; `recommend.description`:
    `The 1-based number, in choices, of the recommended choice: a choice of recommend_action. Leave it out only when no choice has recommend_action.`
  - choice `properties.action`: `{ type: 'string', enum: [...FINDING_ACTIONS], default: 'fix_now', description }`
    with description `` `The action this choice sits under on the card, one the finding's origin offers; fix_now when left out. ${unofferedActionsText()}` ``;
    the choice's `required` stays `['text', 'reason']`, `additionalProperties: false`.
  - finding `properties.action_reasons`: `{ type: 'object', additionalProperties: false, properties: { follow_up: { type: 'string', description: 'Drawn under the follow-up action. Markdown.' }, leave_it: { type: 'string', description: 'Drawn under the leave-it action. Markdown.' } }, description }`
    with description
    `` `Why to take a deferral action, drawn under that action's header. Only an action the origin offers takes an entry. Send the entry for the action you recommend when it is a deferral. ${unofferedActionsText()}` ``.
  - `CHOICES_DESCRIPTION`:
    `` `One object per choice: ${cardChoicesText(CARD_CHOICES)}. The card draws each choice under its action (its action field; fix_now when left out), and an action with no choices as a header the user picks alone. At least one choice is a fix_now choice. A choice names a solution only: a choice whose text opens with an action's label (${ACTION_WORDS.join(', ')}) fails the call.` ``
  - `RECOMMEND_ACTION_DESCRIPTION`:
    `` `The recommended action. The values are the same three on every card, each card labelling them its own way — ${actionLabelsText()}. ${unofferedActionsText()}`.trimEnd() ``
- **`ASK_ROUND_DESCRIPTION` wording**, as replacements in `tool-definitions.ts`:
  - `The app draws the not-applicable control, the Notes box, the round note, the Don't ask me this control and each finding card's action control by itself`
    → `The app draws the not-applicable control, the Notes box, the round note and the Don't ask me this control by itself`
  - `Under it every choice shows with its reason, the recommended choice and action badged, and the action control; the user takes the recommendation whole with Accept, or picks any choice and action.`
    → `Under it the card's actions show in order, each with its choices and their reasons under it; an action with no choices shows as a header the user picks alone, with its action_reasons entry when you sent one. One pick sets the choice and its action. The recommended choice, or the recommended action's header when it has no choices, is badged; the user takes it with Accept or picks any other entry.`
  - after the sentence ending `Never bundle a decided fix into a question or a finding.`, add:
    `A round and each item may name a layout in 'layout', a folder in the app's forms layouts folder: an item's layout draws its card, the round's draws the rest, and the user's own layout draws what neither names. A name the folder lacks fails the call with the names it holds. For a look no layout has, write a new layout folder, name it in the round, and list each layout file you wrote or changed in a notice on that round.`
  - after `answers to findings in 'findings'.`, add:
    `A finding answer's 'action' is the picked action and its 'choice' the picked choice's 1-based number in 'choices', 0 when the user picked an action with no choices.`
- **Page compile changes only.** `page/kinds/finding/finding-card.ts` reads `finding.recommend ?? 0` in its
  `recommend` and in `cardInput`; `page/form-state.ts` `RECOMMENDED_PICKS.finding` sets
  `choice: finding.recommend ?? 0`. Typed literals gain `layout: null`, `actionReasons: {}` and choice
  `action: 'fix_now'`. Until task 04 the page still draws flat choices with a separate action pick; a page pick of an
  action that does not hold the picked choice now reads as untouched in the payload. Task 10 checks the page only
  after 04 and 05 land.

GIVEN `layoutNames` `['default', 'compact']` WHEN `ask_round` sends finding 2 with `layout: 'dense'` THEN the call
rejects with the unknown-layout message and nothing is saved or shown.
GIVEN an open round WHEN the agent re-sends it with only `layout` changed THEN the call re-attaches to the open
round, whose `Round.layout` is the first send's.
GIVEN a finding whose choices are `fix_now` choice 1 and `leave_it` choice 2, and no `follow_up` choice, WHEN the
body holds `{ choice: 0, action: 'follow_up' }` THEN the payload answer is `answered`, `choice` 0, `action`
`follow_up`.

Tests (`main/kinds/fields.test.ts`):
- `reads an absent or null layout as null` — `{}` and `{ layout: null }` give `null`.
- `keeps a layout name as sent` — `{ layout: ' compact' }` gives `' compact'`.
- `refuses a blank layout or one that is not a string` — `''`, `'  '` and `3` throw
  `Question 1: layout must be a layout name: a non-empty string.` for `where` `Question 1: `.

Tests (`main/kinds/finding/finding-format.test.ts`, sentence names as the file uses):
- `parses a choice with no action as fix_now` — `choices[0].action` is `'fix_now'`.
- `keeps a choice action the origin offers` — a caused choice with `action: 'follow_up'` parses with it.
- `refuses a choice action outside the three` — message
  `Finding 1: choices[2].action must be one of 'fix_now', 'follow_up', and 'leave_it'.`
- `refuses a follow_up choice on a nit finding, naming what it offers` — message
  `Finding 1: choices[1].action is follow_up, which a nit finding does not offer; it offers fix_now or leave_it.`
- `refuses a finding with no fix_now choice` — two `follow_up` choices give the no-fix_now message, verbatim.
- `parses action_reasons for the deferral actions the origin offers` — caused with both keys keeps both.
- `reads absent action_reasons as none` — `actionReasons` is `{}`.
- `refuses action_reasons for fix_now or an unknown key` — `{ fix_now: 'x', later: 'y' }` gives
  `Finding 1: action_reasons unknown key(s) fix_now, later. It takes follow_up and leave_it, the deferral actions.`
- `refuses action_reasons.follow_up on a nit finding` — message
  `Finding 1: action_reasons.follow_up is for an action a nit finding does not offer; it offers fix_now or leave_it.`
- `refuses action_reasons that is not an object` and `refuses a blank action_reasons entry` — the two messages,
  verbatim.
- `leaves recommend null when recommend_action has no choices` — `recommend_action: 'leave_it'`, no `recommend`,
  every choice `fix_now`: `recommend` is `null`.
- `refuses a missing recommend when recommend_action has choices`, `refuses recommend when recommend_action has no
  choices`, `refuses a recommend naming a choice of another action` — the three messages, verbatim, with the
  values in the test.
- Changed: `names a missing origin and impact and what each origin needs` (the list without `recommend`),
  `refuses an extra finding field, saying the form draws its own controls`, `refuses a choice given as a plain
  string`, `names a choice's missing reason`, `refuses an unknown choice field`, the five opening-action-word tests
  (the new message) — each asserts its new message verbatim.
- `gives the result builder its title, choice texts and recommend` — also asserts `recommend` 0 for a `null`
  recommend.
- `declares a choice action defaulting to fix_now and action_reasons with follow_up and leave_it` — the schema
  values listed above.
- `findingFormat.fingerprintContent`: `differs when only a choice's action differs`; `is the same for a choice
  with action fix_now and one with none`; `differs when only action_reasons differs`; `is the same when only layout
  differs`.

Tests (question and notice format tests):
- `accepts an optional layout` (each file) — `layout: 'compact'` parses to `'compact'`; absent parses to `null`.
- `refuses choices on a notice as an unknown field` — asserts the notice's new unknown-field message.

Tests (`main/round.test.ts`):
- `keeps a valid two-question round in order` and every `toEqual` on a parsed round — expect `layout: null` on the
  round and items, choice `action: 'fix_now'`, `actionReasons: {}`.
- `reads an absent or null layout as null on the round` and `keeps a round layout as sent`.
- `refuses a blank round layout` — `ask_round's layout must be a layout name: a non-empty string.`
- `requireKnownLayouts`: `passes a round whose every layout the folder holds`; `refuses an unknown round layout,
  listing the folder's layouts` (message with `ask_round's ` and `'default' and 'compact'`); `refuses an unknown
  item layout, naming the item` (the `Finding 2: ` example verbatim); `names the round before its items` (round and
  item both unknown: the round's name is in the message).
- `answersPayload finding actions` (replaces the four tests on solutions apart from actions; `reports no action on
  a not-applicable finding that holds one` and `leaves a finding with notes alone untouched on the wire` stay). The
  finding has choice 1 `fix_now` and choice 2 `follow_up`, `recommend: 1`, `recommend_action: 'fix_now'`:
  - `reports a picked choice with its number, text and action` — `{ choice: 2, action: 'follow_up' }`: answered,
    choice 2, its text, `follow_up`, both took flags false.
  - `reports a header pick as choice 0 with its action` — `{ choice: 0, action: 'leave_it' }`: answered, choice 0,
    `choice_text` `''`, `leave_it`.
  - `leaves a header pick of an action that has choices untouched` — `{ choice: 0, action: 'fix_now' }`: untouched,
    action `''`.
  - `leaves a choice picked with another action untouched` — `{ choice: 1, action: 'follow_up' }`: untouched.
  - `leaves an action the origin lacks untouched` — a nit with `{ choice: 0, action: 'follow_up' }`: untouched.
  - `marks both recommendations on the recommended choice` — `{ choice: 1, action: 'fix_now' }`: both true.
  - `marks both recommendations on a recommended header` — `recommend_action: 'leave_it'`, no `recommend`,
    `{ choice: 0, action: 'leave_it' }`: both true.
  - `builds the whole payload for a submitted round` and `returns finding answers in their own array, index-parallel
    with the findings` — their bodies change to picks the new rule answers; the expected payloads stay otherwise.
- `fingerprint`: `ignores the round layout and item layouts`; `changes with a finding choice's action`; `equals the
  Python server's fingerprint for the same round` stays as it is.

Tests (`main/tool-definitions.test.ts`):
- `declares findings with every field but severity, recommend, layout and action_reasons required and nothing else
  allowed` — `required` is `['title', 'origin', 'impact', 'finding', 'proof', 'choices', 'recommend_action']`.
- `declares each finding choice as text and reason with an optional action` — `required` `['text', 'reason']`,
  `additionalProperties` false, `action.enum` the three, `action.default` `'fix_now'`.
- `declares action_reasons with only follow_up and leave_it` — property keys and `additionalProperties` false.
- `declares an optional layout on the round and on every item kind` — four `layout` properties of type `string`,
  none in a `required` list.
- `describes choices grouped under their actions, with header picks` (replaces `describes the verdict under the
  finding, with every choice shown`; its first assertion stays) — contains `an action with no choices shows as a
  header the user picks alone` and `One pick sets the choice and its action.`
- `never describes an action control` — the description does not contain `action control`.
- `describes round and item layouts and the unknown-name failure` — contains
  `A name the folder lacks fails the call with the names it holds.`
- `says a header pick answers with choice 0` — contains
  `0 when the user picked an action with no choices.`

Tests (`main/forms-service.test.ts`; `startSession` passes a `layoutNames` the test sets, `['default']` by default):
- `fails ask_round naming a layout the folder lacks, listing the folder's layouts` — the message verbatim; the
  presenter showed nothing and no round file exists.
- `opens a round whose layouts the folder holds` — `layoutNames` `['default', 'compact']`, round `layout:
  'compact'`: the presented round's `round.layout` is `'compact'`.
- `re-attaches a re-send that differs only in layout, keeping the layouts it opened with` — one round shown; its
  `round.layout` is the first send's.
- `returns the answers of a saved round whose layout left the folder` — a finished, unreturned saved round with
  `layout: 'gone'` and `layoutNames` `['default']`: `collectLastRound` returns outcome `submitted`.

Tests (`main/preview/layout-preview.test.ts`):
- `open_SavedArgsNameMissingLayout_SkipsAndLogs` — saved `[namingGone, SECOND_SAVED]`, `layoutNames` `['default']`:
  the second open asks `SECOND_SAVED`, and the one log line starts `[forms] preview skipped a saved round: `.

Done when: `npm run typecheck`, `npm run lint` and `npm test` pass.

Commit: one commit for the group.

## Proof

