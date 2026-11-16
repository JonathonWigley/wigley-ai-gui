# 08 — Finding origin specs, open layout unions, proof off a Nit

Status: not started
Type: Task
Wave: 4 · Depends on: 06, 07
Plan: [plan.md](plan.md)

All paths are under `src/plugins/forms/` unless they start with `src/`. Tree facts were read at plan time (2026-11-09)
on `main`. Lane H's Structured round results lands before this task (plan.md Precondition 2): read
`git log --oneline -- src/plugins/forms/main/round.ts src/plugins/forms/main/kinds` first, and report a moved member
as a concern.

## Files

- modify `finding-origins.ts` — becomes the spec list and the per-process registry
- create `finding-origins.test-support.ts` — `useBuiltInFindingOrigins()`
- modify `contract.ts` — `FindingOriginSpec`, open `FindingOrigin` and `FindingCard`, one `Finding`, `action_label`,
  `registerFindingOrigin` on `FormsMainExports` and `FormsPageExports`
- modify `finding-pick.ts` — reads the registry; adds `findingActionLabel`
- modify `main/kinds/finding/finding-format.ts` — parser, schema and fingerprint read the registry; proof rule
- modify `main/kinds/finding/finding-text.ts` — every text reads the registry
- modify `main/tool-definitions.ts` — the ask_round description reads the registry
- modify `main/round.ts` — `readFormBody` and `recommendedBody` write `action_label`
- modify `main/start.ts` — registers the built-ins, exports `registerFindingOrigin`, rebuilds the tool on a change
- modify `main/selftest-script.ts`, `main/preview/preview-round.ts` — proof only on a `nit`
- modify `page/kinds/finding/verdict.ts`, `page/kinds/finding/finding-card.ts` — read the spec; `originToken`
- modify `page/form-state.ts` — `findingActionWord` reads the spec (the page writes no action labels: see the rulings)
- modify `page/layout/card-kit.ts` — chip colour from `originToken`; `actionLabelOf` fallback
- modify `page/start.ts` — registers the built-ins, exports `registerFindingOrigin`, redraws on a change
- modify `page/forms.css` — one `.badge-origin` rule replaces the four per-origin rules
- modify `page/test-rounds.ts` — one `Finding` type; proof only on `nit()`
- modify `layouts/layout.d.ts` — open unions, `originToken`
- modify `layouts/default/layout.js` — comment only (the unknown-card fallback)
- test `finding-origins.test.ts`, `finding-pick.test.ts`, `main/kinds/finding/finding-format.test.ts`,
  `main/round.test.ts`, `main/tool-definitions.test.ts`, `page/kinds/finding/verdict.test.ts`,
  `page/kinds/card-input.test.ts`, `page/layout/card-kit.test.ts`, `page/form-state.test.ts`, `page/start.test.ts`,
  and each other test file whose run reaches an origin lookup (add `useBuiltInFindingOrigins()`; at plan time:
  `main/round-type.test.ts`, `main/preview/layout-preview.test.ts`,
  `main/preview/preview-round.test.ts`, `page/boxes.test.ts`, `page/forms-commands.test.ts`,
  `page/layout/card-answer.test.ts`, `page/layout/layout-cards.test.ts`, `page/layout/layout-panes.test.ts`,
  `page/layout/layout-resolver.test.ts`, `page/view-model.test.ts`, `page/round-view.test.ts`,
  `page/forms-view.test.ts` — measured at plan time, re-verify with a run of the forms tests)

No change expected in `page/view-model.ts` (its `actionLabel` reads `findingActionWord`, whose signature stays) or
`page/layout/layout-panes.ts` (it reads `row.actionLabel` alone, lines 627 and 644 at plan time); a compile error
there is fixed in place and named in the report.

Not this task's: `AGENTS.md` "A finding origin" (task 11), the marketplace and `~/wigley-agents/forms.md` (task 09).

## Consumes

- `interface FormsMainExports { registerKind(kind: MainItemKind): Disposable }`, `formsMainKey`, and forms' main
  `exports` ← 06 (in `contract.ts` and `main/start.ts`).
- The finding kind's `MainItemKind` registration (its parse, schema and fingerprint) and the path 06 uses to publish
  the ask_round tool from the registered kinds ← 06. 08 makes the finding schema and the ask_round description
  functions of the origin registry and calls 06's publish path again when the registry changes.
- `FormsPageExports.registerKind(kind: PageKind): Disposable` and the finding `PageKind`'s `cardInput` ← 07 (in
  `page/kinds/finding/finding-card.ts` at plan time).
- Members the tree holds: `MAX_ENTRIES`, `FINDING_ACTIONS`, `FindingAction`, `Severity`, `SEVERITIES` in
  `contract.ts`; `themeVariable(token: string): string` in `src/shared/theme-variables.ts`; `requireText`,
  `quotedList` in `main/kinds/fields.ts`; `completeFindingPick` in `finding-pick.ts`; `contributions.onChanged(() =>
  view.rebuild())` in `page/start.ts` as the redraw pattern.

## Produces

In `contract.ts`:

```ts
// One finding origin, registered unchanged in main and on the page. Card-level fields (card, words, choiceNoun,
// minChoices, maxChoices, actions) are equal across every origin that shares a card.
export interface FindingOriginSpec {
  id: string;                 // the wire `origin` value: 'caused'
  card: string;               // the card it draws as: 'defect'
  words: { kind: string; finding: string; proof: string };  // card kind label and its two section titles
  choiceNoun: string;         // what the card's choices are, in the tool text: 'its solutions'
  meaning: string;            // what the origin means, in the tool text
  minChoices: number;
  maxChoices: number;
  requiresSeverity: boolean;
  requiresProof: boolean;
  actions: Readonly<Partial<Record<FindingAction, string>>>;  // each offered action, with the card's word for it
  chip: string;               // the verdict's origin chip text
  themeToken: string;         // the qualified theme token of the chip colour: 'forms.origin-caused'
}
export type FindingOrigin = string;   // known: 'caused' | 'pre_existing' | 'design' | 'nit'
export type FindingCard = string;     // known: 'defect' | 'decision' | 'nit'
export interface Finding { …FindingFields as today, origin: FindingOrigin; severity: Severity | null; proof: string }
export interface FindingAnswerEntry extends AnswerEntry {
  action: FindingAction | ''; action_label: string; recommend_action_label: string
}
// FormsMainExports gains:  registerFindingOrigin(spec: FindingOriginSpec): Disposable;
// FormsPageExports gains:  registerFindingOrigin(spec: FindingOriginSpec): Disposable;
```

`FINDING_ORIGINS`, `DefectFinding`, `DecisionFinding` and `NitFinding` are removed. `FindingAction`,
`FINDING_ACTIONS`, `Severity` and `SEVERITIES` stay closed in `contract.ts`.

In `finding-origins.ts`:

```ts
export const FINDING_ORIGIN_SPECS: readonly FindingOriginSpec[];  // the four built-ins, in this order
export interface FindingOriginRegistry {
  register(spec: FindingOriginSpec): Disposable;
  spec(origin: string): FindingOriginSpec | undefined;  // registered, else retired, else undefined
  list(): readonly FindingOriginSpec[];                 // registered only, in registration order
  onChanged(listener: () => void): Disposable;
}
export function createFindingOriginRegistry(): FindingOriginRegistry;
export const findingOrigins: FindingOriginRegistry;      // this process's registry
export function actionLabel(origin: string, action: FindingAction): string | null;
export function actionWords(): readonly string[];        // every distinct action word of list(), in list order
```

`FINDING_ORIGIN_RULES`, `OriginRules`, `ACTION_WORDS` and `isFindingOrigin` are removed.

In `finding-pick.ts`:

```ts
// The card's word for the pick when it is one of the finding's entries; '' otherwise.
export function findingActionLabel(finding: PickableFinding, choice: number, action: FindingAction | ''): string;
```

In `finding-origins.test-support.ts`:

```ts
// Registers FINDING_ORIGIN_SPECS in `findingOrigins` before each test and disposes them after it.
export function useBuiltInFindingOrigins(): void;
```

In `layouts/layout.d.ts`: `type FindingAction = string`; `FindingCard.card: string`, `.origin: string`,
`.severity: string | null`; new member `FindingCard.originToken: string`. `CardAnswer.action` stays
`FindingAction | null`.

## Pinned values

`FINDING_ORIGIN_SPECS`, verbatim from today's five homes (`FINDING_ORIGIN_RULES`, `ORIGIN_MEANINGS` and
`CARD_CHOICES` in `finding-format.ts`, `ORIGIN_CHIPS` in `verdict.ts`, `CARD_TEXT` in `finding-card.ts`, the
`origin-*` tokens in `manifest.ts`):

| id | card | words (kind / finding / proof) | choiceNoun | min–max | severity | proof | actions | chip | themeToken |
|---|---|---|---|---|---|---|---|---|---|
| `caused` | `defect` | Defect / Finding / Proof | its solutions | 1–`MAX_ENTRIES` | true | false | fix_now Fix now · follow_up Follow-up · leave_it Leave it | Caused by this change | `forms.origin-caused` |
| `pre_existing` | `defect` | Defect / Finding / Proof | its solutions | 1–`MAX_ENTRIES` | true | false | as `caused` | Pre-existing | `forms.origin-pre-existing` |
| `design` | `decision` | Decision / Decision / Context | the options a plan would weigh | 2–`MAX_ENTRIES` | false | false | fix_now Decide now · follow_up Plan it · leave_it Drop it | Design decision | `forms.origin-design` |
| `nit` | `nit` | Nit / Finding / Why it's safe | the fix | 1–1 | false | true | fix_now Fix anyway · leave_it Leave it | Nit | `forms.origin-nit` |

Meanings, verbatim: `caused` "a defect the change under review introduced"; `pre_existing` "a real defect in code the
change read but did not cause"; `design` "a design call, options to weigh now or in a feature plan"; `nit` "nothing
builds on it, and it cannot be shown happening".

Tool text for the built-ins stays byte-identical except the proof sentences below. `cardName(origin)` and every text
that capitalised the card id now use the spec's `words.kind` (today the two agree: "Defect", "Decision", "Nit").

New proof text:

- `PROOF_DESCRIPTION` becomes `` `Required on a ${PROOF_ORIGINS} finding (${PROOF_CARDS}): why it cannot happen, shown
  under its ${PROOF_TITLES} title. Optional on every other origin, where the default card does not draw it. Short
  bullets naming the file, line, output or behaviour. No prose paragraphs. Markdown.` `` For the built-ins:
  `Required on a nit finding (a Nit): why it cannot happen, shown under its Why it's safe title. Optional on every
  other origin, where the default card does not draw it. Short bullets naming the file, line, output or behaviour. No
  prose paragraphs. Markdown.` `PROOF_ORIGINS` is `orList` of the `requiresProof` origin ids, `PROOF_CARDS` the
  distinct `a ${words.kind}` of those origins, `PROOF_TITLES` the distinct `words.proof` of those origins, each
  joined with `orList`.
- The ask_round description's sentence `A card shows the finding and a brief proof, then a verdict: the origin and
  severity and the impact.` becomes `A card opens on a verdict: the origin and severity and the impact; then it shows the finding, and a Nit also
  its proof.` (`a ${orList(PROOF card kinds)}`; the clause is left out when no registered origin
  requires proof).
- The parser's missing-field error becomes `` `${where}missing ${missing}. Every finding needs ${FINDING_FIELDS}; a
  ${SEVERITY_ORIGINS} finding also needs severity, and a ${PROOF_ORIGINS} finding also needs proof.` `` —
  `FINDING_FIELDS` no longer holds `proof`: `title, origin, impact, finding, choices, recommend_action`.
- A `requiresProof` origin missing proof fails with `` `${where}a ${origin} finding needs proof.` ``.

Chip colour: `page/forms.css` replaces the four `.badge-origin[data-origin=…]` rules with one:

```css
:where(.form-tab) .badge-origin {
  border-color: var(--forms-origin-color, var(--wg-fg-tertiary));
  color: var(--forms-origin-color, var(--wg-fg-tertiary));
}
```

`buildVerdict` in `card-kit.ts` sets `origin.style.setProperty('--forms-origin-color', `var(${input.originToken})`)`
when `input.originToken !== ''`, and keeps `data-origin`. `originToken` is `themeVariable(spec.themeToken)`
(`--wg-forms-origin-caused`). The four `origin-*` entries in `manifest.ts` keep their names and defaults; this task does not edit `manifest.ts`. A spec
whose token no manifest declares draws in `--wg-fg-tertiary`: the undefined variable makes `--forms-origin-color`
invalid, and the rule's fallback applies. The three `.badge-severity` rules stay.

## Decisions

- **One registry per process.** `findingOrigins` is a module-level registry in `finding-origins.ts`. Main and the page
  each load their own copy of the module, so each process holds its own registry. Every reader of origin data reads
  it: the parser, the tool texts, `findingEntries`, `actionLabel`, `verdictOf`, the card input and
  `findingActionWord`.
- **Built-ins register in forms' own start.** Forms' main start and page start each register every spec of
  `FINDING_ORIGIN_SPECS` through `findingOrigins.register`, in list order, before the kinds and the ask_round tool are
  built. Each start disposes those registrations when the part stops, as it disposes its other registrations.
- **Exports.** Main's and the page's `registerFindingOrigin(spec)` is `consumer.track(findingOrigins.register(spec))`,
  so the consumer's stop disposes it.
- **`register` checks.** It throws an `Error`, and registers nothing, when: `id` is blank or already registered
  (`` `finding origin ${id} is already registered` ``); `minChoices < 1`, `maxChoices > MAX_ENTRIES` or
  `minChoices > maxChoices`; `actions` lacks `fix_now` (every finding needs a fix_now choice) or holds a blank word; or
  a registered spec shares `card` and differs in `words`, `choiceNoun`, `minChoices`, `maxChoices` or `actions`
  (`` `finding origin ${id} draws as card ${card}, whose ${field} differs from ${other.id}'s` ``). The card-level
  check keeps `findingCardsText`, which groups origins by card and reads the first origin's fields, true.
- **Dispose and the open round.** A disposed spec leaves `list()` and moves to the registry's retired specs. `spec(id)`
  reads a registered spec first, then a retired one. So: a new ask_round naming the origin fails, and the tool text
  no longer lists it; a round already open keeps its cards, its entries, its answers and its result, because every
  lookup for a parsed finding reads `spec(id)`. Registering the same id again replaces the retired spec (a plugin's
  hot reload). A saved open round whose origin no process registers fails `parseRound` after a restart and is
  reported unreadable, as any saved round in a shape the parser refuses is today. `onChanged` fires once after each
  register and each dispose; a second dispose does nothing.
- **Changes reach the tool and the page.** Main: `findingOrigins.onChanged` publishes the ask_round tool again through
  06's publish path. Page: `findingOrigins.onChanged(() => view.rebuild())`, beside the contributions listener; a
  rebuild keeps every answer.
- **Page miss.** When the page holds no spec for a finding's origin (a plugin registered in main alone),
  `verdictOf` and the card input use the `caused` spec's card fields, `chip` set to the origin id, and `originToken`
  `''`. Main's entries and the page's then may differ; registering in both processes is the plugin's job.
- **One `Finding`.** `severity` is `null` on an origin that does not require it; `'severity' in finding` checks become
  `finding.severity !== null`. The `SameType` and `_severityOriginsAreDefectOrigins` compile check is removed with the
  union. The fingerprint keeps severity out when it is `null`, as today.
- **Proof.** On a `requiresProof` origin, `requireText(item.proof, 'proof', where)` as today. On every other origin,
  an absent, `null` or blank proof reads as `''`; a non-string fails `` `${where}proof must be a string.` ``; any other
  string is kept as sent. The schema's `required` drops `proof`; its property stays. `fingerprintContent` adds
  `proof` only when `finding.proof !== ''`. Proof that the old hashes stay: today `parseFinding` runs
  `requireText(item.proof, …)`, which refuses an absent or blank proof, so every round ever opened, and every saved
  file, carries a non-blank proof, which still joins the hash. Saved `args` stay as sent.
- **Drafts and saves keep `''`.** `Finding.proof` stays `string` in the contract and in `FindingCard.proof`; an
  omitted proof is `''` everywhere after the parse.
- **`action_label`.** `findingActionLabel` returns `actionLabel(finding.origin, action)` when
  `completeFindingPick(finding, choice, action)` is not null, else `''`. `not_applicable` does not change it.
  `readFormBody` sets each entry's `action_label` from the entry's `choice` and `action` and ignores any saved
  `action_label`; every body main saves passes through `readFormBody` (`form-service.ts` `readBody` before
  `saveBody` and on the end), except the auto-answer body. `recommendedBody` sets `action_label` to
  `actionLabel(finding.origin, finding.recommend_action)`. `buildBody` on the page sets it with
  `findingActionLabel`. A body with no pick saves `action_label` `''`. Every finding entry also saves
  `recommend_action_label`: `actionLabel(finding.origin, finding.recommend_action)`, whatever the pick, so retro
  names the recommendation in the card's words (`readFormBody`, `recommendedBody` and `buildBody` set it the same
  way, and `readFormBody` ignores a saved value). The fingerprint hashes `args` only, so it does
  not change. The tool result (`FindingResult`) does not change.
- **Layout fallbacks.** `actionLabelOf` in `card-kit.ts` returns the action value itself when `input.actions` lacks
  it, in place of the throw. The default layout draws an unknown card as it draws a Defect: `itemHead` with
  `input.words.kind`, the verdict, the finding text, no proof section (`input.card === 'nit'` stays the only proof
  branch). An unknown severity draws a neutral tag: no `.badge-severity` rule matches it. `data-origin` and
  `data-severity` stay on the chips.
- **Test rounds send proof only on a Nit.** `page/test-rounds.ts` `finding()` and `decision()` set `proof: ''` and
  `severity` (`null` on `decision()` and `nit()`); `nit()` keeps `` `${title} proof` ``. The self-test findings at
  `main/selftest-script.ts` (the `caused` and `design` findings near lines 1001–1040) and the preview round's
  `caused` and `design` findings (`main/preview/preview-round.ts` near lines 39 and 67) drop `proof`; every `nit`
  keeps it. No self-test step reads a finding's proof (checked at plan time: `grep -n proof
  main/selftest-script.ts` finds only the four senders).

## Behaviour

- GIVEN the built-ins WHEN `findingCardsText()` runs THEN it returns `a Defect (caused or pre_existing; actions Fix
  now, Follow-up, Leave it), a Decision (design; actions Decide now, Plan it, Drop it) or a Nit (nit; actions Fix
  anyway, Leave it)`.
- GIVEN a `caused` finding with no proof WHEN `parseRound` runs THEN it parses with `proof` `''`.
- GIVEN a `nit` finding with no proof WHEN `parseRound` runs THEN it fails with `Finding 1: a nit finding needs proof.`
- GIVEN a `design` finding with `proof: null` or `proof: '  '` WHEN it parses THEN `proof` is `''`, and its
  fingerprint equals the same finding with no proof.
- GIVEN the finding that `round.test.ts` hashes to `fc3a3a26e21f0c6e85e8ad1f4d000380e032b3b52e3bc6b2ffae5226034e77b1`
  WHEN it is hashed THEN the hash is unchanged; the same finding with no proof hashes differently.
- GIVEN a plugin spec `{ id: 'security', card: 'risk', actions: { fix_now: 'Patch', leave_it: 'Accept' }, … }`
  registered in main WHEN a round sends `origin: 'security'` THEN it parses; a choice whose text opens with `Patch`
  fails as an action word; the ask_round schema's `origin` enum lists `security`.
- GIVEN that spec disposed WHEN a new round sends `origin: 'security'` THEN it fails with `origin must be one of`
  the four built-ins; a round opened before the dispose keeps its entries and its result.
- GIVEN a registered spec with card `defect` and other `words` WHEN another spec registers THEN `register` throws and
  `list()` is unchanged.
- GIVEN a Decision finding with its `follow_up` choice picked WHEN the body is saved THEN its entry holds
  `action_label: 'Plan it'`; with no pick, `action_label: ''`; with a saved `action_label: 'x'` and no pick,
  `readFormBody` gives `''`. In each case, on a Decision recommending `fix_now`, `recommend_action_label` is
  `'Decide now'`.
- GIVEN a headless round WHEN `recommendedBody` builds it THEN each finding entry's `action_label` is the recommended
  action's card word.
- GIVEN a `caused` card WHEN the kit draws its verdict THEN the origin chip's `--forms-origin-color` is
  `var(--wg-forms-origin-caused)`.
- GIVEN a page spec registered while a round is open WHEN it registers or disposes THEN the open round redraws and
  keeps its answers.

## Tests

Rows added to the tests that own each rule (`wigley:writing-tests` § One test per behaviour); `wigley:make` owns when
they run.

- `finding-origins.test.ts` — new `describe('findingOrigins registry')`: `register_TakenId_Throws`;
  `register_SharedCardDifferentWords_Throws` (list unchanged); `register_NoFixNowOrBoundsPastKeys_Throws` (cases in a
  table); `dispose_LeavesListKeepsSpecLookup`; `register_SameIdAfterDispose_ReplacesRetired`;
  `onChanged_FiresOnRegisterAndDispose_OnceEach`. The existing `actionLabel` row stays, with the built-ins registered.
- `main/kinds/finding/finding-text.ts` has no test file: add `findingCardsText_BuiltIns_ListsEachCard` to
  `main/tool-definitions.test.ts` with the exact string in Behaviour.
- `main/kinds/finding/finding-format.test.ts` — in `findingFormat.parse`: `parses a caused finding with no proof as
  empty proof`; `refuses a nit finding with no proof, naming proof`; `reads a null or blank proof off a Nit as none`
  (table); `refuses a proof that is not a string`; `parses a registered plugin origin and refuses a choice opening
  with its action word`; `refuses an origin disposed before the call`. In `findingFormat.fingerprintContent`:
  `leaves an omitted proof out of the content`.
- `main/round.test.ts` — the row `numbers a finding's errors from 1` deletes `impact` instead of `proof` (proof is no
  longer required on `caused`); in `readFormBody`: `writes each finding entry's action_label from its pick` (Plan it,
  '' for none, '' for an incomplete pick, a saved value ignored); rows comparing whole `finding_answers` entries gain
  `action_label`; in `fingerprint`: `hashes a finding with no proof apart from one with proof`, beside the fixed-hash
  row, which stays; in `autoAnsweredPayload`, or a new `recommendedBody` describe: `labels each finding entry with
  its recommended action's word`.
- `main/tool-definitions.test.ts` — `askRoundSchema_ListsRegisteredOrigins` (a plugin spec appears in the `origin`
  enum, and leaves it after its dispose, read through 06's tool builder); the `it.each` row for `findings` keeps
  working as `required` loses `proof`.
- `finding-pick.test.ts` — `findingActionLabel_CompletePickOrEmpty`.
- `page/kinds/finding/verdict.test.ts` — `chips a registered plugin origin with its spec`;
  `falls back to the caused card with the origin id as chip text when the page holds no spec`.
- `page/kinds/card-input.test.ts` — `findingCardInput_OriginToken_IsThemeVariable` (`--wg-forms-origin-caused`);
  `findingCardInput_PluginOrigin_UsesSpecWordsAndActions`.
- `page/layout/card-kit.test.ts` — `verdict_SetsOriginColourFromToken`; `choiceGroups_UnofferedAction_LabelsValue`.
- `page/start.test.ts` — a `registerFindingOrigin` row in the `it.each` table "a dependent's contribution leaves when
  the dependent stops ($member)" (the table gains the expected error text per row: `is already added` for the two
  rows there now, `is already registered` for this one); and `registerFindingOrigin_RedrawsOpenRoundsKeepingAnswers`.
  If 06 adds a like table to `main/start.test.ts` for `registerKind`, add the main `registerFindingOrigin` row there.
- Each other test file in Files: one `useBuiltInFindingOrigins()` call at the top of its outer `describe`. A test file
  that starts forms' main or page part (`main/start.test.ts`, `page/start.test.ts`, and any other that calls
  `startPagePart` or `startDrawingPagePart` with `formsPagePart`) does not call it: the part's start registers the
  built-ins, and a second register of a built-in id throws.

## Done when

`npm run typecheck` (`tsc --noEmit`) and `npm run lint` pass (lint covers `check-styles.mts` on the new `.badge-origin` rule and the
`setProperty` call); the test gate runs the rows above. Every Produces signature is present in the file named.
Runtime checks (chip colours, the live tool list, a live round sent without proof) are task 12's ("Final
verification").

## Commit

One commit in wigley-ai-gui for the group, for example `Forms: finding origins register as one spec in each process;
proof required on a Nit alone; saved finding answers carry action_label`.

## Rulings from the plan's cold read

Where the text above and these differ, these win.

- **Main alone writes the labels.** The page's `restore.encode` writes neither `action_label` nor
  `recommend_action_label`; main's `readFormBody` computes both on every body it reads (every save path goes
  through `type.readBody`), and `recommendedBody` sets both. A finding entry's key order is `index, choice,
  not_applicable, notes, dont_ask, dont_ask_reason, action, action_label, recommend_action_label`. 06's byte-for-byte
  `readFormBody` row changes its fixture to that labelled shape in this task.
- **The schema follows the registry.** `findingKind.arraySchema` becomes a getter rebuilt on each read, and
  `formsTools(kinds)` builds the `ask_round` description inside the call (the origin, severity, proof, choices and
  action-word texts with it), since 06's `refresh()` calls `tools()` each time.
- **Republish order.** Forms' main start subscribes the republish listener to `findingOrigins.onChanged` after the
  four built-ins register, and its `dispose` unsubscribes before disposing them, so start and stop each publish once.
- **A saved open round naming a plugin origin** whose plugin has not registered yet fails `parseRound` on restore and
  reads as unreadable, as any rejected shape does; its file stays, so a later re-send after the plugin registers
  works. No new code.
- **Chip selector.** The replacement rule is `:where(.form-tab) .badge-origin[data-origin]`, keeping the (0,2,0)
  specificity the four rules had over `.ui-tag--neutral`.
- **No origin requires proof** (only reachable with `nit` disposed): the proof sentence is left out whole from the
  `ask_round` description, the `proof` schema description and the parser's missing-field error.
- **More rows:** in `main/round.test.ts`, a round whose origin spec was disposed still reads its body and payload
  (`findingEntries`, `readFormBody`, `answersPayload`) as before the dispose; the `readFormBody` and
  `recommendedBody` rows assert `recommend_action_label` (`'Decide now'` on a Decision recommending `fix_now`,
  whatever the pick, a saved value ignored).

## Proof

