# 04 — Inbox detail pane

Status: not started
Type: Task
Rung: hard · adds the pane commands that 05 binds, and moves the focused reply box across a split and its redraws
Wave: 4 · Depends on: 01, 03 (look sign-off on 03's render)
Plan: [plan.md](plan.md)

Paths below are under `wigley-ai-gui/src/plugins/work-inbox/` unless they start with `src/` (then under
`wigley-ai-gui/`).

Files:
- modify `wigley-ai-gui/src/plugins/work-inbox/contract.ts`
- modify `wigley-ai-gui/src/plugins/work-inbox/manifest.ts`
- modify `wigley-ai-gui/src/plugins/work-inbox/page/inbox-view.ts`
- modify `wigley-ai-gui/src/plugins/work-inbox/page/inbox-state.ts`
- modify `wigley-ai-gui/src/plugins/work-inbox/page/start.ts`
- modify `wigley-ai-gui/src/plugins/work-inbox/page/sample-state.ts`
- modify `wigley-ai-gui/src/plugins/work-inbox/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/work-inbox/page/inbox.css`
- modify `wigley-ai-gui/src/plugins/work-inbox/page/layout/read-layout.ts`
- modify `wigley-ai-gui/src/plugins/work-inbox/layouts/layout.d.ts`
- modify `wigley-ai-gui/src/plugins/work-inbox/layouts/default/layout.js`
- modify `wigley-ai-gui/src/plugins/work-inbox/layouts/default/layout.css`
- modify `wigley-ai-gui/AGENTS.md` (the `work-inbox/` entry of the file list)
- modify `wigley-ai-gui/docs/features/layouts/design.md` (the `work-inbox` row of § Adopters)
- test `wigley-ai-gui/src/plugins/work-inbox/page/inbox-state.test.ts`
- test `wigley-ai-gui/src/plugins/work-inbox/page/inbox-view.test.ts`
- test `wigley-ai-gui/src/plugins/work-inbox/page/start.test.ts`
- test `wigley-ai-gui/src/plugins/work-inbox/page/demo-steps.test.ts`

This task does not edit `src/plugins/keymap.ts`, `docs/keymap.md`, `DESIGN.md` or the feature `design.md`. Task 05
binds the keys. Task 06 re-reads the docs. As 03 does for the Board, this task updates the `work-inbox/` entry in
`AGENTS.md` (the Inbox's cards and detail pane in the sheet's split) and the `work-inbox` row of
`docs/features/layouts/design.md` § Adopters (the `detail` and `detailEmpty` parts, the draft box now in `detail`).

Consumes:
- `ThreadDetail`, `DetailMessage`, `WorkDetail` and `workDetailsSlot: KeyedSlotKey<WorkDetail, 'main', 'work'>` in
  `src/plugins/work/contract.ts` ← 01
- `KeyedSlotReader<V>` (`get(key)`, `all()`, `on((key, value) => …)`) in `src/contracts/state.ts` — tree
- `createSplit(options: SplitOptions): Split` (`setEndHidden`, `dispose`, `ResizeTarget.nudge`) in
  `src/shared/page/ui/split.ts` — tree
- `scrollContent(scroller, step, direction, lineHeightPx): ContentScroll` and
  `scrollText(what, step, direction, scroll): string` in `src/shared/content-scroll.ts` — tree
- `textLineHeightPx(scroller: Element): number` in `src/shared/page/text-line.ts` — tree
- `work.send` (`workSendCommand`, arg `{ itemId, text }`) in `src/plugins/work/contract.ts` — tree. It accepts every
  open item and queues a nudge for a Waiting on others item. Do not change it.

Produces:
- In `contract.ts`: `WorkInboxPlace` gains `paneOpen: boolean`. Its comment names it: "whether the detail pane is
  open".
- In `manifest.ts`, five new page commands with no arg, in a new group `pane`. Each id is exact:
  - `togglePane: { label: 'open or close the detail pane', group: 'pane', runsIn: 'page' }`
  - `paneLineDown: { label: 'scroll the detail a line down', group: 'pane', runsIn: 'page' }`
  - `paneLineUp: { label: 'scroll the detail a line up', group: 'pane', runsIn: 'page' }`
  - `paneHalfPageDown: { label: 'scroll the detail half a page down', group: 'pane', runsIn: 'page' }`
  - `paneHalfPageUp: { label: 'scroll the detail half a page up', group: 'pane', runsIn: 'page' }`
- In `manifest.ts`, existing ids kept with new labels: `openSlack` keeps `'open in Slack'`; `editDraft` becomes
  `'write a reply'`; `send` becomes `'send the reply'`; `leaveBox` becomes `'leave the reply box'`; scope `box`
  becomes `'In an Inbox reply box'`. The manifest's head comment and `description` say the drafts sit in a detail
  pane beside the cards.
- In `inbox-state.ts`:
  - `InboxViewState` gains `paneOpen: boolean`; `initialInboxState()` sets `paneOpen: false`.
  - `InboxAction` gains `{ type: 'pane'; open: boolean }`. The reducer returns `state` itself when `paneOpen`
    already equals `open`.
  - The `placed` case sets `paneOpen: place.paneOpen === true`. A place saved before this task has no `paneOpen`,
    and reads as closed. There is no other place reader: `start.ts` hands `placeWriter.get()` to the view as it is.
  - `export function detailInput(item: WorkItem, view: InboxViewState, detail: ThreadDetail | null, now: number):
    DetailInput`
  - `cardInput(item, view, now): CardInput` keeps its signature and returns the slim `CardInput` below.
  - `cardActions(item, view)` puts `send` first on every open item (the reply box on every thread). The rest of the
    order and gating stays: `snooze` on Waiting on others only, then `dismiss`, `startSession`, `addToBoard`;
    `['restore']` alone on an item that is not open.
- In `layouts/layout.d.ts` (types; each gets a contract comment in the file's style):
  - `export interface DetailMessageInput { author: string; age: string; text: string }` — `age` from `cardAge`;
    `text` is markdown.
  - `export interface DetailInput { id: string; channel: string; author: string; age: string; title: string;
    sectionTitle: string | null; stateTag: string | null; fetched: string | null; participants: string[];
    tickets: CardTicket[]; summary: string; why: string | null; root: DetailMessageInput | null;
    replies: DetailMessageInput[]; replyCountText: string | null; draft: string | null; isSending: boolean;
    note: string | null; url: string; actions: InboxCardAction[] }`
  - `export interface DetailKit extends InboxKit { draftBox(parent: HTMLElement): HTMLElement }` — throws
    `no draft box` while `draft` is null and `draftBox placed twice` on a second call.
  - `CardInput` becomes `{ id: string; section: string; sectionTitle: string | null; channel: string;
    author: string; age: string; title: string; summary: string | null; latest: string; state: 'open' | 'cleared' |
    'dismissed' | 'snoozed'; stateTag: string | null; isSending: boolean; isDirect: boolean; isCursor: boolean;
    note: string | null; prompt: PromptActionInput[] }`. It drops `participants`, `why`, `tickets`, `draft`, `url`
    and `actions`. `summary` is null while the pane is open.
  - `CardKit` is removed. `card?(parent: HTMLElement, input: CardInput, kit: InboxKit): HTMLElement`.
  - `InboxLayout` gains `detail?(parent: HTMLElement, input: DetailInput, kit: DetailKit): HTMLElement` and
    `detailEmpty?(parent: HTMLElement, kit: InboxKit): HTMLElement`.
  - The slot comment for `draftBox` moves to the detail kit. The kit scope comment says: `detail` and `detailEmpty`
    draw in `work-inbox.list`; the `draftBox`'s own hints fire in `work-inbox.box`.
- In `page/layout/read-layout.ts`: `LAYOUT_PARTS` gains `detail: true` and `detailEmpty: true`.
- In `inbox-view.ts`:
  - `InboxViewDeps` gains `uiState: UiState` and `detailOf(id: string): ThreadDetail | null`. `timers` widens from
    `Pick<Timers, 'set' | 'clear'>` to `Timers`, because `createSplit` takes `Timers`.
  - `InboxView` gains `detailChanged(id: string): void`.
  - `InboxView.showSample(state: WorkState, details: readonly ThreadDetail[]): Disposable` (was `(state)`).
  - `InboxCommand` takes the five new commands through the manifest; `commands` gets a handler for each.
- In `sample-state.ts`: `export function sampleInboxDetails(now: number): ThreadDetail[]`.
- In `demo-steps.ts`: `InboxDemoPageDeps.showSample(state: WorkState, details: readonly ThreadDetail[]): Disposable`
  and `InboxDemoPageDeps.togglePane(): void`.

Decisions:

**Split.** Replace `contentSheet.append(mainPane)` with a split:
- `createSplit({ initial: 420, min: 320, endMin: 480, sizedPane: 'end', stateKey: PANE_WIDTH_KEY, uiState:
  deps.uiState, anchor: deps.kitServices.keys.anchor, timers: deps.timers })`, with
  `const PANE_WIDTH_KEY = 'pane-width'`: the same values as 03's Board split, so both panes size alike. `uiState` is
  this plugin's own, so the key needs no prefix. Follow
  `src/plugins/primer/page/primer-view.ts:682-705`.
- `split.start` holds `mainPane`. `split.end` holds the app-owned `div.work-inbox-detail` (the scroller). The sheet
  holds `split.element`.
- `split.setEndHidden(!state.paneOpen)` on each render.
- `inbox.css` gives `.work-inbox-detail` `overflow-y: auto`, `min-height: 0`, `height: 100%` and the cards' padding.
  Do not give it `tabIndex`: focus stays in the list.
- `dispose()` calls `split.dispose()` with the other steps in its `callEach`.
- Replace the comment "the sheet has no split" at `syncTargets`. `syncTargets` runs when the focus or `paneOpen`
  changed, or `always`. It calls `deps.setResizeTarget(state.paneOpen ? split : null)`. `deps.setFocusTarget(null)`
  stays: the focus scopes stay `sections`, `list` and `box`.

**Pane draw.**
- While `paneOpen` is false, the view draws no `detail` part. It disposes the drawn one and empties
  `div.work-inbox-detail`.
- While `paneOpen` is true, the view draws `detail` for the cursor item, or `detailEmpty` when the list has no
  cursor item.
- The draw key is the JSON of the `DetailInput`. While the box is editable, the cursor's own draft text is left out
  of the key, as `drawCards` does today, so typing never redraws the pane.
- The pane draws again when the key changes, on `detailChanged(id)` for the cursor item id, and on `setLayouts`.
  `detailChanged` for any other id draws nothing.
- A change of the cursor item id sets `div.work-inbox-detail`'s `scrollTop` to 0, as primer's `isRowChanged` does
  (primer-view.ts `update`).
- `detailInput` gets `deps.detailOf(item.id)`, or the sample's detail while a sample shows. `showSample` keeps
  `details` in a `Map` by id, and its dispose drops the map.

**Reply box.** One box, its keys unchanged:
- `draftBoxSlot` moves from the card draw to the detail draw. It keeps its form `work-inbox-draft`, box id = item
  id, placeholder `Write a reply…`, the read-only sending text and its two hints (`editDraft` in `list` labelled
  `edit`, `send` in `box` labelled `send`).
- `keepFocusedBox(boxes, DRAFT_FORM, …)` wraps the detail redraw, not the cards redraw.
- `isRedrawingCards` becomes `isRedrawing` and is set during both draws.
- The dropped-box check (`isBoxDropped`, then `changeFocus('list', true)`) moves to the detail draw.
- The `boxes.setText(cursor.id, text)` call and the `.work-inbox-draft` `is-empty` toggle move to the detail draw,
  and query inside `div.work-inbox-detail`.
- `draft` in `DetailInput` follows the old `cardInput` rule: the sending text while `isSending`, else `draftText`,
  else `''` for an open item, and null for an item that is not open.

**`i` (`editDraft`).**
- On an item that is not open, or while sending: log `no editDraft for <id>` and change nothing.
- With the pane closed: dispatch `{ type: 'pane', open: true }`, which renders and places the box. Then call
  `setFocus('box')`.
- With the pane open: call `setFocus('box')` as today.
- `Esc` in the box (`leaveBox`) leaves the pane open.
- `togglePane` runs only in the list scope (05 binds it there), so it never closes the pane under a focused box.

**`togglePane`.** Dispatch `{ type: 'pane', open: !paneOpen }`. Log `pane open` or `pane closed`.
The pane may open on an empty list (it shows `detailEmpty`).

**`openSlack`.** Keep it unchanged: `core.openLink` with the cursor item's `url`.

**Pane scroll.** The four commands call `scrollContent(detailPane, step, direction, textLineHeightPx(detailPane))`
with `'line'` or `'halfPage'` and `1` or `-1`. They log `scrollText('the detail', step, direction, scroll)`. With
the pane closed, they log `no pane` and scroll nothing. The model is `scrollPrimer` in
`src/plugins/primer/page/primer-commands.ts:583-592`.

**Place.** `writePlace` adds `paneOpen: state.paneOpen`. `showSample`'s `reset` puts back the `paneOpen` from before
the sample.

**Slim card.** The default `card` draws, in order: the meta line (`channel · author`, the section Tag while
`sectionTitle` is set, the state Tag, a `sending` Tag while `isSending`, the age at the end), the title, the summary
while `summary` is not null, the latest line while not empty, then the cursor prompt, then `note` last. The card
draws no buttons, no ticket chips, no participants, no `Why:` and no draft. The card keeps `note` so that a failed
Send shows while the pane is closed. The cursor prompt stays on the cursor card (DESIGN.md cursor prompt rule).

**Detail part (default layout).** Root `div.work-inbox-detail-pane`. In order:
1. Head: the title as an `h2`. The meta line as on the card. `fetched` in `fg-tertiary` while not null.
2. `With <participants joined by ", ">` while `participants` is not empty.
3. The ticket chips, each a ghost Button running `work-inbox.openTicket` with its key and `title` = its reason, as
   the card draws them today.
4. The summary.
5. `Why: <why>` while `why` is not null.
6. The thread. With `root` null, the one line `No thread detail yet: the next sweep fetches it.` Else the root
   message, then `replyCountText` while not null, then each reply. A message is `author · age` in `fg-secondary`,
   then `kit.markdown(block, text, 'work-inbox-detail-text')`.
7. `kit.draftBox(root)` while `draft` is not null.
8. The buttons as `cardButtons` draws them today: Open in Slack (`ghost`, `core.openLink` with `url`), then each of
   `actions` with today's labels, commands and variants. Send reads `Sending…` and is disabled while `isSending`.
   Send always carries its `send` control hint. Open in Slack carries the `openSlack` control hint
   (`kit.keyHint(button, 'openSlack', { className: 'work-inbox-control-hint' })`). That hint is the pinned `gx` hint.
9. `note` in `status-error` while not null.

The default `detailEmpty` draws `kit.emptyState(root, 'No thread selected.')`. `layout.css` styles the pane under
`[data-layout-owner='work-inbox']` with tokens only. Prose blocks take `text-prose`, `leading-prose` and
`prose-measure` (DESIGN.md:161-162). The pane's head, field and message look match the look the user signed off on
03's Board pane render: read 03's landed default `layout.css` detail rules first, and use the same spacing, type sizes
and message block. The two views share no code.

**`detailInput` values (pinned).**
- `fetched`: null with no detail. `Fetched just now` when `cardAge(detail.fetchedAt, now)` is `now`. Else
  `Fetched <age> ago` (`Fetched 5m ago`).
- `root` and `replies`: from the detail, each message's `age` = `cardAge(message.at, now)`. `replies` keeps the
  detail's order (oldest first). With no detail: `root` null and `replies` `[]`.
- `replyCountText`: `<replies.length> of <replyCount> replies` while `replyCount > replies.length`. Else null.
- `actions`: `cardActions(item, view)`. `tickets`, `participants`, `why`, `summary`, `url`, `note`, `stateTag` and
  `sectionTitle` as `cardInput` computes them today.
- `detailOf` in `start.ts` returns the entry when its `kind` is `'thread'`, else null (a missing entry, or a ticket
  record).

**start.ts.**
- Pass `uiState: services.uiState`.
- Pass `detailOf: (id) => …` over `const details = api.state.read(workDetailsSlot)`.
- Add a listener `details.on((key) => view.detailChanged(key))`, disposed in `dispose`'s `callEach` before the view.
- `registerDemoSteps` gets `showSample: (sample, sampleDetails) => view.showSample(sample, sampleDetails)` and
  `togglePane: () => view.commands.togglePane()`.

**Sample and demo.**
- `sampleInboxDetails(now)` returns three `ThreadDetail` records, with `fetchedAt` = 3 minutes ago and `stamp` the
  ISO time of the latest message:
  - `sample-review`: root by Ann ("Could someone review the sync retry change before Friday? The diff is in
    **PR 482**."), 2 replies (Bo: "I can look tomorrow if nobody gets to it.", Ann: "any chance today?"),
    `replyCount: 4`. It reads `2 of 4 replies`.
  - `sample-nudge`: root by You ("Does the schema change look right to you, Dee?"), 0 replies, `replyCount: 0`.
  - `sample-thread`: root by You ("The upload test fails about one run in five on CI."), 2 replies (Eli:
    "reproduced it on CI", Fay: "same on my machine with `--repeat 20`"), `replyCount: 2`.
  - `sample-dm` and `sample-old-ask` have no record, so the demo shows the missing line.
- `inboxStage` calls `deps.showSample(sampleInboxState(now), sampleInboxDetails(now))`.
- Beats in order: `needs you` (as today, pane closed), `detail` (`deps.togglePane()`; the pane opens on the cursor
  card `sample-review` with its draft), `waiting` (as today; the pane follows to `sample-nudge`), `all` (as today;
  the cursor goes to `sample-old-ask`, Restore only, the missing line).
- The step's `files` add `src/plugins/work-inbox/layouts/default/layout.css`. Its caption becomes
  `Inbox: Slack threads sorted by what needs you, each with its thread and a reply box in the detail pane.`

GIVEN the pane is closed WHEN `togglePane` runs THEN the end pane shows the cursor item's `detail`, the split is the
resize target, the place holds `paneOpen: true`, and the log reads `pane open`.
GIVEN the pane is closed and the cursor is on an open My threads item WHEN `editDraft` runs THEN the pane opens, the
reply box holds the item's draft text or `''`, and the scope is `box`.
GIVEN the box is focused WHEN `work.state` changes and the cursor item stays THEN the box keeps its focus and text.
GIVEN the pane is open WHEN a `work.details` entry changes for an item that is not the cursor item THEN the pane
does not redraw.

Tests:
- `inbox-state.test.ts` › `cardActions` table: change the rows for My threads, You promised, Around Slack and Worth
  knowing open items to `['send', 'dismiss', 'startSession', 'addToBoard']`. Keep Waiting
  (`['send', 'snooze', 'dismiss', 'startSession', 'addToBoard']`) and a not-open item (`['restore']`).
- `inbox-state.test.ts` › `inboxReducer` table: add rows. `pane` open from closed gives `paneOpen: true`. `pane` with
  the same value returns the same state object. `placed` with `paneOpen: true` gives true. `placed` with a place
  that has no `paneOpen` (cast) gives false.
- `inbox-state.test.ts`, new `describe('cardInput')` table (a new rule: the slim card): pane closed gives
  `summary: 'S'`; pane open gives `summary: null`; an item with `sending: 'x'` gives `isSending: true`.
- `inbox-state.test.ts`, new `describe('detailInput')` table, one literal expected value per row:
  - detail with 2 of 4 replies at 5 minutes: `fetched: 'Fetched 5m ago'` and `replyCountText: '2 of 4 replies'`
  - detail fetched 20 seconds ago with every reply shown: `fetched: 'Fetched just now'` and `replyCountText: null`
  - no detail: `fetched: null`, `root: null`, `replies: []`
  - dismissed item: `draft: null` and `actions: ['restore']`
  - sending item: `draft: 'x'` and `isSending: true`
  - open My threads item with no draft: `draft: ''` and `actions[0]: 'send'`
- `inbox-view.test.ts`, new `it.each` for `togglePane` (open, then closed). Each row asserts the end pane's
  `hidden`, the resize target (`split` or null), the last place's `paneOpen` and the log line. Give the setup a fake
  `uiState` and a `detailOf` fake. When the fake DOM lacks `ResizeObserver`, stub it as
  `src/plugins/backlog/page/backlog-view.test.ts` does.
- `inbox-view.test.ts`: `editDraft` rows. With the pane closed on an open item, the pane opens and the scope is
  `box`. On a dismissed item, the log is `no editDraft for <id>` and the pane stays closed.
- `inbox-view.test.ts`: the existing box tests (the send table at :237, "a sending card reads Sending…" at :287,
  "a slot change keeps the focused draft box" at :303, "a redraw that drops the focused draft box" at :328) open the
  pane first and find the box and the buttons in the detail pane, not the card. The Sending… assertion moves to the
  pane's Send button. The send table adds a row: a My threads item sends `work.send` with `{ itemId, text }`.
- `inbox-view.test.ts`: the button-press table at :355 finds Dismiss in the pane.
- `inbox-view.test.ts`: the card click table at :435 keeps its body row. Its "a button in it" row clicks a ticket
  chip or button in the pane and asserts no `selectItem` run.
- `inbox-view.test.ts`: `detailChanged` rows. The cursor id redraws the pane (the root text shows). Another id draws
  no part.
- `inbox-view.test.ts`: scroll rows. `paneLineDown` with the pane closed logs `no pane`. With the
  pane open over a fake scroller of `scrollHeight` 1000 and `clientHeight` 200, it logs
  `scrolled the detail down a line`.
- `start.test.ts` › "a page load puts back the place": also run `togglePane` before the restart. Assert that the
  saved place has `paneOpen: true` and that the restarted view shows the end pane.
- `demo-steps.test.ts` › the Inbox step: the beat names are `['needs you', 'detail', 'waiting', 'all']`. The events
  include the toggle. `showSample` receives the three sample detail ids.

Done when: `npm run typecheck`, `npm run lint` and `npm test -- src/plugins/work-inbox` pass. `npm run selftest --
--plugin demo` passes, and its Inbox beats draw the pane. Grep `CardKit` in `wigley-ai-gui/src` prints nothing.
Grep `no split` in `inbox-view.ts` prints nothing.

Commit: one commit for the group.

## Proof
