# 07 — Primer page view, review and start

Status: done
Type: Task
Wave: 5 · Depends on: 04, 06
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

The Primer tab: a rail of rows beside the selected row's card, a review pane before send, and the cancel prompt; the
page part that starts it on the agent form channel; the page events and export; and the registration that turns the
primer page on. Model each piece on its forms counterpart (`src/plugins/forms/page/forms-view.ts`, `round-view.ts`,
`forms-events.ts`, `start.ts`) as task 03 left it; this document gives what differs. `DESIGN.md` governs the look:
primitives only, tokens only.

Files:
- create `src/plugins/primer/page/primer-view.ts` (the tab, rail, card and status line)
- create `src/plugins/primer/page/primer-review.ts`, test `src/plugins/primer/page/primer-review.test.ts`
- create `src/plugins/primer/page/primer-events.ts`, test `src/plugins/primer/page/primer-events.test.ts`
- create `src/plugins/primer/page/start.ts`
- create `src/plugins/primer/page/primer.css`
- modify `src/plugins/page.ts`, `scripts/check-layers.mts`

Consumes:
- `primerManifest` (commands and scopes from 06) in `src/plugins/primer/manifest.ts`; `PresentedPrimer`,
  `PrimerChannel`, `PrimerPageEvents`, `PrimerPageExports`, `PrimerFinishOutcome`, `PrimerNeed`, `PRIMER_NEEDS` in
  `src/plugins/primer/contract.ts` ← 05
- `formShown`, `formClosed` messages and `openForms`, `draft`, `finish` invokes of `AgentFormChannel`
  (`src/contracts/agent-forms.ts`) ← 02
- every export of `src/plugins/primer/page/{ids,primer-state,primer-store,boxes,primer-commands}.ts` ← 06
- `createEditorBoxes`, `keepFocusedBox` (`src/shared/page/editor-boxes.ts`); `startAutosave`, `saveLabel`
  (`src/shared/page/autosave.ts`); `appendKeyHint` (`src/shared/page/key-hint.ts`); `createConfirmPrompt`
  (`src/shared/page/confirm-prompt.ts`); `createSessionFormTabs` (`src/shared/page/session-form-tabs.ts`) ← 03
- `toggleMark`, `setToggleMark` (`src/shared/page/ui/toggle-mark.ts`) ← 04
- in the tree: `createSplit`, `row`, `tag`, `sectionHeader`, `emptyState`, `textButton` (`src/shared/page/ui/`),
  `src/shared/page/markdown.css`, `scrollText` (`src/shared/content-scroll.ts`), `errorText`
  (`src/shared/error-text.ts`), `PageApi`, `PagePart`, `QualifiedEvents` (`src/contracts/plugin.ts`),
  `SessionsPageEvents`, `SessionsPageExports` (`src/plugins/sessions/contract.ts`), `KeysPageExports`
  (`src/plugins/keys/contract.ts`), and `api.services.markdown`, `api.services.uiState`, `api.areas`

Produces:

`src/plugins/primer/page/start.ts`:
```ts
export const primerPagePart: PagePart<typeof primerManifest>;
```
Its `start` returns `exports: PrimerPageExports` and `commands: primerCommandHandlers(...)` (06). `activePrimer()`
returns `presentedOf` of the active primer, or null.

`src/plugins/primer/page/primer-events.ts`:
```ts
export type PrimerPageEvent = {
  [K in keyof PrimerPageEvents]: { name: K; data: PrimerPageEvents[K] };
}[keyof PrimerPageEvents];
// The events one change makes, in this order: a `primerShown` per primer `next` adds, in `next.primers` order; a
// `needChanged` per task of a primer in both whose need differs, in `entries` order (a task new in `next` makes
// none); a `primerFinished` per primer `next` drops.
export function primerEventsBetween(previous: PrimerState, next: PrimerState): PrimerPageEvent[];
export function startPrimerEvents(store: PrimerStore, emit: (event: PrimerPageEvent) => void): void;
export function createPrimerEventLog(log: Log): (event: PrimerPageEvent) => void;
// The primer as the export and `primerShown` name it: `form` as sent, `draft` the user's current body.
export function presentedOf(primer: OpenPrimer): PresentedPrimer;
```

`src/plugins/primer/page/primer-review.ts`:
```ts
export interface ReviewTallies { yes: number; no: number; unclear: number; included: number; items: number }
export function reviewTallies(primer: OpenPrimer): ReviewTallies;
// `3 needed, 1 not needed, 0 unclear. 9 of 12 items included.`
export function talliesText(tallies: ReviewTallies): string;
export function renderReview(primer: OpenPrimer, deps: ReviewDeps): HTMLElement;
```

`src/plugins/primer/page/primer-view.ts`:
```ts
export interface PrimerTab {
  forgetSession(sessionId: string): void;
  showPrimer(sessionId: string): void;
  scrollBy(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
}
export function mountPrimerTab(deps: PrimerViewDeps): PrimerTab;
```
`PrimerViewDeps` and `ReviewDeps` are this task's own; shape them as `forms-view.ts`'s deps are shaped.

Log lines task 08's self-test may read, source `primer` (with 06's handler lines):
- `event primerShown <primerId>`
- `event needChanged <primerId> <entryId> <need>`
- `event primerFinished <primerId> <outcome>` (`submitted`, `cancelled` or `closed`)
- `open primers not read: <error>`
- `focused <box description>` (the shared boxes' line, source `primer` through `PRIMER_BOX_IDENTITY`)
- `draft not saved for <primerId>: <message>` (the shared autosave's line)
- `cancel prompt dismissed: the view moved on` (the shared confirm prompt's line)

Decisions:
- **Start, listener first** (`listenForRounds` in forms' `start.ts`): subscribe to `formShown` (dispatch
  `primerShown`) and `formClosed` (`closePrimerFromMain`) and `sessions.activeChanged` (dispatch
  `sessionActivated`) before `api.channel.invoke('openForms')`; each form it returns dispatches `primerShown`; a
  rejection logs `open primers not read: <error>`. `sessions.sessionRemoved` calls `forgetSession`.
- **Wiring** follows `formsPagePart.start`, without layouts or contributions: the store from
  `createPrimerStore(initialState([], sessions.selectedSessionId()))`; boxes from `createEditorBoxes(editor, events,
  log, PRIMER_BOX_IDENTITY)` whose `changed` dispatches `setText` and `activated` dispatches `focusActionFor`;
  `startAutosave` saving through `api.channel.invoke('draft', primerId, body)` with `buildBody` and
  `api.settings().autosaveDelayMs`; `finish` through `api.channel.invoke('finish', primerId, end)`; the event log and
  `api.events.emit` on every store change.
- **Events.** `needChanged` comes from the diff, so a need set by key, by click or by a restore all emit it.
  `primerFinished`'s outcome is the dropped primer's `sending?.kind ?? 'closed'`, as forms' `finishOf`.
  `presentedOf` is `{ formId: primerId, sessionId, label, form: primer.primer, draft: buildBody(primer) }`.
- **Tabs.** `createSessionFormTabs` with `tabId: 'primer'`, `title: 'Primer'`, `className: 'primer-tab'`,
  `idleText: "No primer open. The agent's next primer opens here."`, `beforeClose` → 06's `guardClose`. The tab's
  status is 06's `sessionTitle` while a primer is open in its session. A session with both a Form tab and a Primer
  tab shows both; each tab is its own plugin's.
- **Key scope.** While the Primer tab is the visible tab, the scope is `scopeOf(state)` (06), set through
  `api.keys.setScope`, as forms' view sets `forms.<view>`.
- **Layout.** `createSplit` with `stateKey: 'primer-rail-width'`, `initial: 240`, `min: 160`, `max: 400` and
  `api.services.uiState`, rail left, card or review right. While `pane` is `'card'` the rail carries
  `is-pane-inactive`, so its selected row draws as `.is-pane-inactive .ui-row.is-selected` does in settings and docs.
- **Rail rows**, `row({ density: 'list' })`, selected row `is-selected`; a click dispatches `selectRow`:
  - the Feature row first: label `Feature`, detail the feature's name;
  - then `sectionHeader` `Primer` over group `primer` and `Every feature` over group `standing`, each shown only
    when its group holds a task; then `Extra tasks`, always shown, with an `emptyState` line
    `No extra tasks. Press A to add one.` below it while it holds none;
  - a task row: label the task's `task` (an extra task with a blank name shows `Unnamed task`), and in the trailing
    slot a need `tag` (`Yes` tone `success`, `No` tone `neutral`, `Unclear` tone `warning`) and a count
    `<included>/<total>` of its items, drawn with `font-variant-numeric: tabular-nums`.
- **The card** (view `'primer'`), rebuilt inside `keepFocusedBox(boxes, primerId, rebuild)` whenever the selected
  row or its item count changes, with `destroyForm(primerId)` before the rebuild; text edits alone do not rebuild.
  - Feature row: a heading `Feature`, then five labelled boxes `Name`, `Slug`, `Spec`, `Summary`, `Notes`.
  - Task row: the task as heading, then tags for the area (when not blank), `#<number>` (when not null) and the need;
    an extra task shows a `Name` box first. Then markdown sections `Question`, `Evidence`, `Probes`, `Pointer`, each
    only when not blank, through `api.services.markdown`. Then `Items`: one `row` per item with a `toggleMark`
    (`label: 'Include the item'`, click → `selectItem` then `toggleInclude`) in the leading slot, the item text as
    label, an `Added` tag on added items, and below it the item's comment box; the item at `itemCursor` carries
    `is-cursor` while `pane` is `'card'`. Then a `New item` box, then a `Comment` box for the task.
  - Each box is mounted with 06's `boxText` and its key hint through `appendKeyHint` (the `c`, `C`, `a`, `i` binds).
- **The review** (view `'review'`), built by `renderReview`: the tallies line `talliesText`
  (`<yes> needed, <no> not needed, <unclear> unclear. <included> of <items> items included.`), counting every task's
  need and every item; then `submitProblems` (06) as a list under the heading `Before sending`, shown only when not
  empty; then the feature's five fields; then one block per task in rail order: its name, need tag, the included
  items with their comments, the left-out items each tagged `Left out` with their comments, and the task comment
  when not blank. Footer: `textButton`s for `primer.closeReview` (`Back`), `primer.askCancel` (`Cancel primer`) and
  `primer.submit` (`Send`), each with its key hint, as forms' review footer.
- **Confirm prompt** through `createConfirmPrompt`, scope `primer.confirm`, texts verbatim: title
  `Cancel this primer?`, body `The agent is told the primer was cancelled. Your edits stay saved.`, keep
  `Keep editing` → `primer.dismissConfirm`, confirm `Cancel primer` → `primer.confirmCancel`.
- **Status line** in the status bar area while the Primer tab is visible: the mode, then `Sending…` while sending,
  else the shared `saveLabel`.
- **Scrolling.** `scrollBy` scrolls the card or the review, whichever shows; null with no primer shown.
- **CSS** in `primer.css`, tokens only, class names prefixed `primer-`; no colour of its own beyond tokens.
- **Registration.** `src/plugins/page.ts` imports `primerPagePart` and lists it right after `formsPagePart`.
  `scripts/check-layers.mts`: add
  `'src/plugins/primer/page': { layers: ['src/contracts', 'src/shared', 'src/shared/page', 'src/shared/page/ui', 'src/plugins/primer', 'src/plugins/keys/contract.ts', 'src/plugins/sessions/contract.ts'], packages: [] }`,
  and add `'src/plugins/primer'` and `'src/plugins/primer/page'` to the `'src/plugins/page.ts'` entry's layers, in
  name order (lines 362–383, measured at plan time, re-verify).

GIVEN two states where task `3`'s need goes from `no` to `yes` WHEN `primerEventsBetween` runs THEN it returns one
`needChanged` `{ primerId, entryId: '3', need: 'yes' }`.
GIVEN a primer dropped while sending a submit WHEN `primerEventsBetween` runs THEN it returns `primerFinished` with
outcome `submitted`; dropped with no send, `closed`.
GIVEN a primer with needs `yes`, `yes`, `no`, `unclear` and 12 items, 9 included WHEN `talliesText(reviewTallies(...))`
runs THEN it returns `2 needed, 1 not needed, 1 unclear. 9 of 12 items included.`

Tests:
- `primer-events.test.ts` — the two event GIVENs; `primerShown` for a new primer; no event for a text edit;
  `createPrimerEventLog` writes each line above; the queued order when a listener dispatches, as
  `forms-events.test.ts` covers it.
- `primer-review.test.ts` — the tallies GIVEN, and tallies of a primer with no items.
- The view, the card, the CSS and the start wiring need a DOM and the running app: task 14's live checks 1, 2 and 4
  cover them, and task 08's self-test drives them.

Approach: build `primer-view.ts` beside `forms-view.ts` and `round-view.ts`, taking the tab plumbing from
`createSessionFormTabs` and the split from docs' or settings' view. Keep `renderReview` and the tallies in
`primer-review.ts` so their logic is tested without a DOM.

Done when: `npm run typecheck` and `npm run lint` pass (layers and style checks included);
`npm test -- src/plugins/primer/page` passes with the tests above. Running the tab is task 14's.
Commit: one commit for the group in wigley-ai-gui

## Proof

Commit 8d153fb · proof: diff read: primerPagePart, primer-events, primer-review and mountPrimerTab exports present; registration and layer lines added; typecheck passes; worker ran lint and 71 primer page tests; the view, card and CSS first run in task 08's self-test · concerns: startPrimerEvents copies forms' startFormsEvents queue and primer.css copies forms' status-line and box rules (lift candidates); the rail's 'Press A to add one' text is fixed, not read from the keymap; view, re-entrant render and keepFocusedBox rebuild are untested until the self-test; primerPagePart is listed before keysPagePart it depends on, relying on dependency ordering
