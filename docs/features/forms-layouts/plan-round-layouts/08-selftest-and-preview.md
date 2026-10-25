# 08 — Self-test and preview round

Status: done
Type: Batch
Wave: 6 · Depends on: 05
Plan: [plan.md](plan.md)

The layout cycle keys are gone, and 01 deleted the `layout cycle` group with them. This task adds the `round
layouts` group in its place, which reaches the layouts through what replaces the cycle: a round's and an item's `layout`, the `forms.layout` setting, and saving a
layout file. The finding steps move from the removed `f` / `u` / `s` keys to the numbered entries of the grouped card.
The preview round shows the grouped card's new cases.

Files:     modify `src/plugins/forms/main/selftest-script.ts` · modify `src/plugins/forms/main/start.ts` ·
           modify `src/plugins/forms/main/preview/preview-round.ts` ·
           test `src/plugins/forms/main/preview/preview-round.test.ts`
Consumes:  round `layout`, item `layout`, choice `action`, `action_reasons`, optional `recommend`, the unknown-layout
           error from `ask_round` (its text names the unknown name and lists the folder's names), and `parseRound` as
           02 left it (it may take the layout names) ← 02
           `FindingChoice.action`, `FindingFields.actionReasons`, `FindingFields.recommend: number | null` in
           `src/plugins/forms/contract.ts` ← 02
           `FormsService` deps `layoutNames: () => readonly string[]`, filled from the registry's `names()` in
           `src/plugins/forms/main/start.ts`, listing every self-test layout once the fixture write settles ← 02, 01
           the registry reloading any layout folder whose file is saved, and the `forms.layout` setting
           (`settings.layout` in forms' manifest) ← 01
           the page line `layout <name> not found, drawing default` (source `forms`) ← 01, 03
           the card lines `layout <name> <kind> card failed: <error>` and `layout <name> <kind> card update failed:
           <error>`, and a throwing card falling back to `default` ← the tree (`layout-cards.ts`), as 05 left them
           the kit parts the self-test layouts call (`el`, `itemHead`, `section`, `textBox`, and the question card's
           answer parts, today `choiceList` + `answerControls`) and the message `<kind> card has no <field> box` ←
           05 (rename a part the self-test layout calls when 05 renamed it)
           the pick log lines of the `chooseN` handlers in `src/plugins/forms/page/forms-commands.ts`: `chose <n> on
           <item>` with `<n>` the entry number down the card, and `cleared the choice on <item>` for the same entry
           picked again ← 04
           the payload of a pick: a bare header gives `choice` `0`, `choice_text` `''`, status `answered` ← 04, 02
Produces:  `export const SELFTEST_LAYOUTS: readonly { path: string; text: string }[]` in
           `src/plugins/forms/main/selftest-script.ts`, replacing `SELFTEST_LAYOUT`; each `path` relative to forms'
           data folder (`layouts/<name>/layout.js`)
           `formsSelfTestScript(sessions)` keeps its signature; its `open` result becomes
           `Promise<{ fixture: ToolResult; unknownLayout: ToolResult }>` and `problems` reads both
           `PREVIEW_ROUND_ARGS` keeps its type, with the cases below
Decisions: the setting is changed with `writeFile` of `.config/wigley-ai-gui/settings.json`, not the script's
           `settings`: `applySelfTestConfig` lays the script's settings over the user's file for the whole run, so a
           script setting could never change back
           the layouts round runs in a session of its own, connected third (`selftest 3`), so the fixture round's
           answers and the groups that read them stay as they are, and the preview's left neighbour is still the Codex
           session (connected fourth) that `cancelled preview` selects
           the unknown-layout call goes to the Codex session with no project: it fails before it opens anything, so
           that session still never shows a round
           each layout save writes the layout's text plus a trailing `// save <n>` line, so every save changes the
           file; each step checks one of the lines a save logs at once (the old group's rule)
           settings.json is written through a new `USER_SETTINGS_FILE` constant
           (`.config/wigley-ai-gui/settings.json`) beside `USER_KEYMAP_FILE`
           01 deleted `LAYOUT_CYCLE_STEPS` and the cycle keys; this task removes any `revision` lines left in the
           script and the comment on inactive folders in `start.ts`
           the deleted group's `k`, `2` / `Enter` / `j` steps answered the fixture round's question 1 (Enter took its
           recommendation) and left the focus where `REVIEW_STEPS` starts; the `round layouts` group gives the same
           answers and focus (its last three steps), so the review group and the `problems` checks read what they
           read today
           the first gallery step (`Space z l o`) moves into a new first group, `preview round`, which screenshots the
           preview's finding cards before any step raises a toast

## Self-test layouts

`SELFTEST_LAYOUTS`, written by `start.ts` before the registry starts (each with `api.data.write`, one promise for
all), in this order:

- `layouts/selftest/layout.js` — today's `SELFTEST_LAYOUT` text: its question card builds through the kit and throws
  `selftest update throw` on every update; its finding card mounts its notes box, then throws `selftest throw`; its
  notice card mounts a notes box, which a notice lacks.
- `layouts/selftest-partial/layout.js` — `cards.question` only: appends `article.item question` with `kit.el`, then
  throws `selftest partial throw`.
- `layouts/selftest-user/layout.js` — `cards.notice` only: appends `article.item notice`, then throws
  `selftest user throw`.

A step that saves one writes `plugin-data/forms/<path>` (relative to the temp home: `dataFolder` puts plugin data in
`<home>/plugin-data/<pluginId>/` outside a live run).

## Fixtures

- `fixtureRound(run)`: finding 3 (design) becomes choices `{ text: 'Per user', reason: 'Each user keeps their own.' }`
  and `{ text: 'Shared', reason: 'One file is simpler.', action: 'follow_up' }`, `recommend: 2`,
  `recommend_action: 'follow_up'`, `action_reasons: { follow_up: 'Who owns the settings needs a plan first.' }`.
  Findings 1 and 2 stay as they are (no `action`, so every choice is `fix_now`).
- New `layoutsRound(run)`, asked in session `selftest-${run}-layouts` (project `selftest`, harness `claude`):
  `heading: 'Layouts self-test round'`, `overview: 'Draws its cards in the self-test layouts.'`,
  `layout: 'selftest'`; one notice (`title: 'Drawn by the round layout'`, `context: \`Run ${run}: the round names
  selftest.\``, `badge: 'Decided'`); one Nit finding (`title: 'Drawn by the round layout'`, one choice, `recommend: 1`,
  `recommend_action: 'fix_now'`); question 1 (`title: 'Drawn by its own layout'`, `layout: 'selftest-partial'`,
  choices `['Yes', 'No']`, `recommend: 1`) and question 2 (`title: 'Drawn by the round layout'`, no `layout`, choices
  `['Yes', 'No']`, `recommend: 1`). Every other field the formats require copies the fixture round's Nit and
  second question, with `Run ${run}` in each context, so no run opens pre-filled from an earlier run.
- New `unknownLayoutRound(run)`, asked in the Codex session with no project: `heading: 'Unknown layout round'`,
  `overview: \`Run ${run}: names a layout the folder lacks.\``, `layout: 'nosuch'`, one notice.
- `open(run)` connects, in order: `selftest-${run}` (claude), `selftest-${run}-2` (codex),
  `selftest-${run}-layouts` (claude), `selftest-${run}-3` (codex, no project); asks the fixture round, the second
  round, the layouts round, then the unknown-layout round. `shownLine` becomes
  `'[forms] round shown: selftest · Layouts self-test round'`. Nothing checks the layouts round's end.

## Steps (new and changed groups, in script order)

`preview round` (new, first) — why: "The preview's sample round opens in a session of its own after the other four
and selects its row; its Defect card groups a deferral choice under Follow-up, its Decision card shows its follow-up
reason, and its Nit recommends a bare Leave it header with its reason."

| keys | expect | extras |
|---|---|---|
| `' ', 'z', 'l', 'o'` | `[sessions] activated Layout preview` | checksFit, screenshot `preview-notice` |
| `j` | `[page] j ran forms.nextItem` | checksFit, screenshot `preview-defect` |
| `j` | `[page] j ran forms.nextItem` | checksFit, screenshot `preview-decision` |
| `j` | `[page] j ran forms.nextItem` | checksFit, screenshot `preview-nit` |

`gallery` — loses its first step; its why becomes "Gallery mode pages to the end and back under full and reduced
transparency, Sessions mode shows under both, and the shell swaps to the gallery's test layout and back."

`finding picks` (replaces `finding actions`) — why: "Findings 1 to 3 number their choices and bare action headers down
the card; a number picks a choice or a header and sets the action with it, the same number again clears it, Space a
and a number picks from inside the notes box, and Enter takes the recommendation."

| keys | expect | why |
|---|---|---|
| `' ', 'k', 'k'` | `[page] k ran forms.prevItem` | today's step and why, checksFit |
| `j` | `[page] j ran forms.nextItem` | checksFit, screenshot `round`: Fix now holds 1 and 2, then `Follow-up (3)` and `Leave it (4)` as bare headers, each number in its `span.choice-number` |
| `2` | `[forms] chose 2 on finding 1` | |
| `2` | `[forms] cleared the choice on finding 1` | The same number again clears the pick. |
| `4` | `[forms] chose 4 on finding 1` | 4 is the bare Leave it header. |
| `a` | `[forms] focused notes on finding 1` | today's why |
| `...'agreed', 'Escape', ' ', 'a', '3'` | `[forms] chose 3 on finding 1` | Space a 3 in NORMAL inside the box is the editor bind; 3 is the bare Follow-up header, replacing Leave it. |
| `Escape` | `[forms] left the box` | today's why |
| `j` | `[page] j ran forms.nextItem` | checksFit |
| `2` | `[forms] chose 2 on finding 2` | A Nit offers no follow-up, so Leave it is 2. |
| `1` | `[forms] chose 1 on finding 2` | |
| `j` | `[page] j ran forms.nextItem` | checksFit, screenshot `finding-reason`: Plan it holds the recommended 2 with its reason under the header |
| `3` | `[forms] chose 3 on finding 3` | |
| `Enter` | `[forms] accepted the recommendation on finding 3` | Accept replaces the Drop it pick with choice 2 and its action. |

`cancelled preview` — the `y` step's why: "Cancelling closes the session and selects its left neighbour, the Codex
session with no folder, …" (the rest as today).

`round layouts` (new, at the place of the `layout cycle` group 01 deleted) — why: "Each card takes the first layout that defines its kind
among the item's, the round's, the forms.layout setting's and default; a partial layout loads with one card; a card
that throws falls back to default and the form keeps working; saving a layout redraws the cards that use it; a
setting naming no layout draws default. Each save logs every card's line at once, so each step checks one."

| step | expect | why |
|---|---|---|
| keys `<A-S-o>`, `<A-S-o>` | `[sessions] activated selftest 3` | checksFit, screenshot `round-layout-notice`: the round's selftest notice card mounts a box a notice lacks, so the notice draws in default. |
| keys `j`, `j`, `j`, `1` | `[forms] layout selftest question card update failed: selftest update throw` | Question 2 names no layout, so the round's selftest draws it, and its update throws. |
| keys `1` | `[forms] cleared the choice on question 2` | The card still takes answers after the throwing update. |
| writeFile `selftest-partial` (save 1), no keys | `[forms] layout selftest-partial question card failed: selftest partial throw` | Question 1's own layout beats the round's; the partial layout loads with only a question card. |
| writeFile `selftest` (save 1), no keys | `[forms] layout selftest finding card failed: selftest throw` | Saving selftest redraws the cards that use it. |
| writeFile `selftest` (save 2), no keys | `[forms] layout selftest notice card failed: notice card has no notes box` | |
| keys `<A-S-i>`, `<A-S-i>` | `[sessions] activated selftest` | |
| writeFile settings.json `{"forms":{"layout":"selftest-user"}}`, no keys | `[forms] layout selftest-user notice card failed: selftest user throw` | The fixture round names no layout, so its notice takes the setting's layout; its other cards fall through to default. Screenshot `user-layout-setting`. |
| writeFile settings.json `{"forms":{"layout":"nosuch"}}`, no keys | `[forms] layout nosuch not found, drawing default` | |
| writeFile settings.json `{}`, no keys | `[config] applied a new config` | Default again for the groups after. |
| keys `k`, `2` | `[forms] chose 2 on question 1` | The focus is still on question 2, where the group found it; k moves to question 1. |
| keys `Enter` | `[forms] accepted the recommendation on question 1` | The review group and the `problems` checks read this answer. |
| keys `j` | `[page] j ran forms.nextItem` | Leaves the focus where the review group starts. |

`REVIEW_STEPS`' `<C-k>` step (the `why` today names "the layout cycle's last reload", `selftest-script.ts` line
519): its `why` becomes "Ctrl+k reaches the review's round: the round layouts group left the main column at the top (its
last redraw of this round, the nosuch settings write, and its last j both scroll it there), and opening the review
puts its cursor on the first row, finding 1's, which sits in view there, so the column stays at the top." (The `{}`
write changes no pick, so it redraws nothing.) Its keys and `expect` stay.

The steps of every other group not named in this task stay as they are.

## Problems the script checks

- `fixture` (today's `payloadProblems`), with finding 1 now: `status` `answered`, `choice` `0`, `choice_text` `''`,
  `took_recommendation` `false`, `action` `follow_up`, `took_action_recommendation` `false`, `notes` `agreed`; finding
  2: `status` `answered`, `choice` `1`, `took_recommendation` `true`, `action` `fix_now`,
  `took_action_recommendation` `true`; finding 3 unchanged (`choice` `2`, `took_recommendation` `true`, `follow_up`,
  `took_action_recommendation` `true`). The summary stays
  `3 findings, 2 questions: 4 answered, 1 not applicable, 0 untouched.`
- `unknownLayout`: `isError` is `true`; its text contains `nosuch`, and contains `selftest-partial` (the folder's
  names are listed). Each failing check is one problem line, as `payloadProblems` writes them.

## Preview round (`PREVIEW_ROUND_ARGS`)

Every card kind stays. 02 already made the Decision and the Nit valid under its finding rules (the Decision's second
choice carries `action: 'follow_up'` with `recommend: 2`; the Nit has no `recommend`). Changes here:

- The Defect finding: its third choice ("Keep the round queued until the user reopens the row.") gains
  `action: 'follow_up'`. Card: Fix now with choices 1 and 2; Follow-up with
  choice 3 (this choice) under it; `Leave it (4)`, a bare header.
- The Decision finding gains `action_reasons: { follow_up: 'No layout draws on canvas yet, so a plan can weigh the
  token object when one does.' }`.
- The Nit gains `action_reasons: { leave_it: 'Comments are not shipped, so nobody reads the typo.' }`.

GIVEN `PREVIEW_ROUND_ARGS` WHEN it parses THEN some finding has a choice whose `action` is not `fix_now`, some
finding has `actionReasons.follow_up`, and some finding has `actionReasons.leave_it` with `recommend` `null`
Tests:     `preview-round.test.ts`: `previewRoundArgs_Parse_HoldEveryCardKind` stays (call `parseRound` as 02 left
           it, with `['default']` when it takes layout names); new
           `previewRoundArgs_Parse_HoldGroupedChoicesAndReasons` — asserts the three facts of the GIVEN above
           the self-test's own groups, run by `npm run selftest` at the test gate: each step's `expect` line above,
           and the `problems` checks
Done when: compiles; `npm run lint` passes; the test gate runs the test above and `npm run selftest` with every group
           passing; the screenshots `forms-preview-notice`, `forms-preview-defect`, `forms-preview-decision`,
           `forms-preview-nit`, `forms-round`, `forms-finding-reason`, `forms-round-layout-notice` and
           `forms-user-layout-setting` are read against `DESIGN.md`
Commit:    one commit for the group

## Proof

Commit 26c5cf00 · proof: diff read: every Produces signature present; typecheck passes over the whole tree; worker ran lint and the preview-round test · concerns: settings.json left as {} for the later settings self-test; unchecked whether the config store accepts forms.layout 'nosuch' (self-test run shows); header '(3)' badge overflow (screenshots)
