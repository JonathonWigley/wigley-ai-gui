# 05 — permission-review page: verdict part and layout

Status: in progress
Type: Task
Rung: deep · its parts live through chat's and forms' redraw lifecycles with no dispose, held by connection, across two async slots
Wave: 3 · Depends on: 02, 03, 04
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/permission-review/layouts/layout.d.ts`
- create `src/plugins/permission-review/layouts/default/layout.js`
- create `src/plugins/permission-review/layouts/default/layout.css`
- create `src/plugins/permission-review/page/verdict-input.ts`
- test `src/plugins/permission-review/page/verdict-input.test.ts`
- create `src/plugins/permission-review/page/verdict-part.ts`
- test `src/plugins/permission-review/page/verdict-part.test.ts`
- create `src/plugins/permission-review/page/start.ts`
- test `src/plugins/permission-review/page/start.test.ts`
- create `src/plugins/permission-review/page/demo-steps.ts`
- create `src/plugins/permission-review/page/layout/read-permission-review-layout.ts`
- modify `src/plugins/permission-review/main/start.ts` (registers the layout types)
- modify `src/plugins/permission-review/manifest.ts` (`sessions` joins the page's `dependsOn`)
- modify `src/plugins/permission-review/main/selftest-script.ts` (04's: the step's screenshot)
- modify `src/plugins/page.ts`

Consumes:
- `ChatEntryPart`, `ChatEntryPartContext`, `addEntryPart` (on `ChatPageExports`) and `PermissionInput.summary` ← 02
- `formsConfirmsSlot` and `OpenConfirm` ← 03
- `Review`, `permissionReviewsSlot`, `chatReviewKey` and `confirmReviewKey` ← 04
- the demo step id `permission-review.verdict`, whose main half 04 registers, and its session under the key `session` ← 04
- `permissionReviewManifest` in `src/plugins/permission-review/manifest.ts` and `permissionReviewMainPart` in `main/start.ts` ← 04
- in the tree: `FormsCardPart`, `FormsCardPartItem` and `formsPageKey` (`src/plugins/forms/contract.ts`); `chatPageKey` (`src/plugins/chat/contract.ts`); `sessionsPageKey` and `SessionsPageExports['activate']` (`src/plugins/sessions/contract.ts`); `createLayoutParts`, `createBaseKit`, `ownerBaseKitDeps`, `kitCommandsOf`, `readLayoutParts` (`src/shared/page/layout-host/`); `api.layouts.show` and `api.layouts.register`

Produces:
- `src/plugins/permission-review/layouts/layout.d.ts`:
  ```ts
  export interface VerdictInput {
    state: 'reviewing' | 'done' | 'unavailable';
    heading: string;
    detail: string | null;
    verdict: 'approve' | 'deny' | null;
    risk: 'low' | 'medium' | 'high' | null;
  }
  export interface VerdictPart { element: HTMLElement; update?(input: VerdictInput): void; }
  export interface Layout { verdict?(parent: HTMLElement, input: VerdictInput, kit: BaseKit): VerdictPart; }
  export interface CompleteLayout extends Required<Layout> {}
  ```
- `export function verdictInput(review: Review | null): VerdictInput | null` in `page/verdict-input.ts`
- `page/verdict-part.ts`:
  ```ts
  export interface VerdictPartsDeps {
    kit: OwnerKitServices;
    log: PluginLog;
    review(key: string): Review | undefined;
    isConfirmRound(roundId: string): boolean;
  }
  export interface VerdictParts {
    entryPart: ChatEntryPart<'permission'>;
    cardPart: FormsCardPart;
    reviewChanged(key: string): void;
    confirmChanged(roundId: string): void;
    setLayouts(shown: ShownLayouts<Layout>): void;
  }
  export function createVerdictParts(deps: VerdictPartsDeps): VerdictParts;
  ```
- `export const permissionReviewPagePart: PagePart<typeof permissionReviewManifest>` in `page/start.ts`
- `export function readPermissionReviewLayout(module: unknown, name: string): Layout` in `page/layout/read-permission-review-layout.ts`
- `export function registerDemoSteps(services: PageServices, deps: PermissionReviewDemoPageDeps): Disposable` in `page/demo-steps.ts`, with `PermissionReviewDemoPageDeps { activate: SessionsPageExports['activate'] }`
- the page log line `verdict <key>: <heading>` (for example `verdict s1/e3: Approve · low risk`)

Decisions:
- **Model.** Each file follows its counterpart in `src/plugins/context-sources/`: `layouts/layout.d.ts`, `layouts/default/layout.js` and `layout.css`, `page/start.ts`, `page/context-section.ts` (for `verdict-part.ts`: `createLayoutParts` with owner `permission-review`, the base kit through `createBaseKit(ownerBaseKitDeps(manifest, deps.kit, null, rollback))`), `page/breakdown-input.ts`, `page/demo-steps.ts` and `page/layout/read-context-sources-layout.ts`.
- **The layout contract imports only the kit.** `src/shared/layouts/layout-contracts.test.ts` fails a `layout.d.ts` with any relative import but the kit's, so `VerdictInput` spells its verdict and risk unions itself instead of importing `Review`. The header comment states what the app keeps (the wrapper chat or forms gives the part; no keys, no focus) and the `data-layout-owner="permission-review"` and `data-layout="<name>"` attributes, as context-sources' header does.
- **`verdictInput` is pure.** `null` (no review under the key) maps to `null`, and the part then calls no layout and leaves its wrapper empty. The rows:

  | Review | heading | detail | verdict | risk |
  |---|---|---|---|---|
  | `{ state: 'reviewing' }` | `Reviewing…` | null | null | null |
  | `{ state: 'done', summary, verdict: 'approve', risk: 'low' }` | `Approve · low risk` | summary | `approve` | `low` |
  | `{ state: 'done', summary, verdict: 'deny', risk: 'high' }` | `Deny · high risk` | summary | `deny` | `high` |
  | `{ state: 'unavailable', reason }` | `Review unavailable` | reason | null | null |

  The heading is the verdict with its first letter capitalised, ` · ` (space, U+00B7, space), the risk in lower case, then ` risk`. `Reviewing…` ends in U+2026.
- **Default layout.** `verdict` draws `div.permission-review-verdict` with `data-state` set to `input.state` and `data-risk` to `input.risk` (left off when null), holding `div.permission-review-verdict-heading` (the heading) and, when `detail` is not null, `div.permission-review-verdict-detail`. It defines no `update`. CSS selects `[data-layout-owner='permission-review'][data-layout='default']`. Colours are theme roles only: the heading is `--wg-status-success` for `data-risk='low'`, `--wg-status-warning` for `medium`, `--wg-status-error` for `high`, `--wg-fg-tertiary` while `data-state='reviewing'`, and `--wg-fg-secondary` for `unavailable`. The detail is `--wg-fg-secondary`. Sizes and gaps use `--wg-text-12` and `--wg-space-1`; `.permission-review-verdict` takes `margin-bottom: var(--wg-space-1)`, so the verdict stands off the head below it (chat's wrapper has no spacing of its own, and the layout draws only when a review exists, so a card with no verdict keeps its spacing), and the heading takes `font-weight: var(--wg-weight-semibold)`. No raw colour (DESIGN.md: views name roles).
- **One subscription per slot, held parts by connection (lead's settled design).** Neither `ChatEntryPart.build` nor `FormsCardPart.build` returns a dispose, and chat builds a part again each time its entry redraws. So `createVerdictParts` holds each built part as a holder `{ key, parent, drawn }` in a `Map<string, Set<holder>>` by review key, and the page part keeps one `reviews.on` and one `confirms.on`, both filed in the part's registrations. On a change it redraws every holder of that key, connected or not, so a view that sessions takes out of the DOM and puts back (`src/plugins/sessions/page/session-tabs-view.ts`) shows the current verdict when it returns. Stale holders go at the next build of their key: `build` first drops every holder of that key whose `parent.isConnected` is false, disposing its last draw, then adds the new one. A chat rebuild (an answer, a layout change, `addEntryPart`'s redraw of every tab) builds the same key again, so each rebuild sweeps the holders it left behind and a key keeps about one holder per card on screen.
- **The chat part.** `entryPart` is `{ id: 'permission-review.verdict', kinds: ['permission'], build }`. `build(parent, { sessionId, input })` holds the parent under `chatReviewKey(sessionId, input.id)` and draws `verdictInput(deps.review(key) ?? null)`. Its `update(input)` draws again from the slot, so an answered entry keeps its verdict.
- **The confirm card part.** `cardPart` is `{ id: 'permission-review.verdict', kinds: ['question'], build }`. `build(parent, { roundId })` holds the parent under `confirmReviewKey(roundId)` and draws only while `deps.isConfirmRound(roundId)` is true; otherwise its wrapper stays empty, whatever the reviews slot holds. `confirmChanged(roundId)` redraws that key's holders, so a `forms.confirms` key that reaches the page after the card was built still draws the verdict. Its `update()` draws again from the slots.
- **Entry ids match the main slot's ids (checked).** Chat main writes a permission card to `chat.entries` as `rowEntryOf(request.entry, processStart)` (`src/plugins/chat/main/chat-sessions.ts` `permission(request)`, about line 1766), and an answered card through the same `rowEntryOf` in `entry(entry)` (about line 1741). The page reads that slot unchanged: `entryInput` in `src/plugins/chat/page/entry-list.ts` returns a permission entry as it came, so `PermissionInput.id` is the row entry id that 04 keys by when it watches `chat.entries`.
- **Reading the slots.** `api.state.read` accepts a slot whose owner is the plugin itself, its `dependsOn` or its `reads` for that process (`ReadableOwner` in `src/contracts/plugin.ts`). `permission-review.reviews` is the plugin's own, and `forms.confirms` is forms', which is in the page's `dependsOn`, so the manifest's `reads.page` needs no entry.
- **Redraws.** A redraw disposes the holder's last draw and empties its parent, then draws, as `context-section.ts` `draw` does. When the last draw returned an `update` and both inputs are not null, it calls `update(input)` instead. `setLayouts` redraws every connected holder.
- **A deleted review empties its cards.** When a key's review is deleted (04 deletes at session end, at a round's end and on a `replace`), `reviewChanged` draws the null input: each holder's last draw is disposed and its wrapper emptied, and nothing is logged. The holders stay, so a review written again under the key draws.
- **Log.** After a draw, the part logs `verdict <key>: <heading>` when the heading differs from the last logged for that key. A null draw forgets the key's logged heading. Nothing is logged for a null input.
- **`page/start.ts`.** It reads `permissionReviewsSlot` and `formsConfirmsSlot`, builds the parts with `review: (key) => reviews.get(key)` and `isConfirmRound: (roundId) => confirms.get(roundId) !== undefined`, adds `entryPart` through `api.dependency(chatPageKey).addEntryPart` and `cardPart` through `api.dependency(formsPageKey).addCardPart`, and calls `api.layouts.show<Layout>` with `defaultLayout`, `defaultStylesheet`, `read: readPermissionReviewLayout`, `userLayout: () => api.settings().layout` and `setLayouts`. In `ready()` it subscribes `reviews.on((key) => parts.reviewChanged(key))` and `confirms.on((roundId) => parts.confirmChanged(roundId))`, then calls `reviewChanged` for every key of `reviews.all()` and `confirmChanged` for every key of `confirms.all()`, as context-sources replays `breakdowns.all()` in `ready()`, so a part built before `ready()` draws what the slots hold now.
- **Layout types in main.** `main/start.ts` (04's) gains `api.layouts.register({ layoutTypes })` from `import layoutTypes from '../layouts/layout.d.ts?raw'`, as context-sources' `main/start.ts` does. This task owns that line, since the file it imports lands here.
- **Manifest.** The page's `dependsOn` becomes `['chat', 'forms', 'sessions']`, for the demo step's `activate` (context-sources reaches `activate` the same way).
- **Demo step, page half.** `registerDemoSteps` registers `{ id: 'permission-review.verdict', section: 'sessions', order: 75, title: 'Permission review', caption: 'A second model reviews each approval and shows its verdict on the card.', files: ['src/plugins/permission-review/page/verdict-part.ts', 'src/plugins/permission-review/main/review-requests.ts', 'src/plugins/permission-review/layouts/default/layout.js'] }`. Its `enter` takes `context.sessions.session` and returns one beat, `{ name: 'verdict', show: () => deps.activate(session) }`, with a dispose that does nothing. Order 75 sits between `chat.headless` (70) and `agent-strip` (80). 140 is taken by session-stash; re-check that 75 is free with `grep -rn "order: 75" src/plugins --include=demo-steps.ts`.
- **Registration.** `permissionReviewPagePart` joins `pageParts` in `src/plugins/page.ts` right after `contextSourcesPagePart`.
- **The self-test's screenshot.** In 04's `main/selftest-script.ts`, the one step gains `screenshot: 'permission-review-verdict'` and `checksFit: true`. When it is taken the Chat tab shows both cards: the Write card from `open` with `Review unavailable` and `fake ask failed`, and the Bash card with `Deny · medium risk`. 07 reads it. `scrollsItself` gains no selector: the verdict does not scroll.

GIVEN no review under a permission entry's key WHEN chat builds the part THEN the wrapper stays empty and no layout part is called
GIVEN a review that moves from reviewing to done WHEN the reviews slot changes THEN every connected part of that key redraws, and one logs `verdict <key>: Approve · low risk`
GIVEN a done review WHEN chat updates the entry with its answer THEN the part draws the same verdict
GIVEN a holder whose parent is no longer connected WHEN chat builds the same key again THEN the old holder's draw is disposed and only the new holder stays
GIVEN a done review on screen WHEN its key is deleted THEN its wrappers empty and nothing is logged
GIVEN parts built before `ready()` and a review written meanwhile WHEN `ready()` runs THEN they draw that review
GIVEN shown parts WHEN `setLayouts` hands a new layout THEN every holder redraws through it
GIVEN a question card of a round not in `forms.confirms` WHEN forms builds the card part, even with a review at `confirm/<roundId>` THEN the wrapper stays empty
GIVEN a card part built before its round reached `forms.confirms` WHEN the round's key arrives THEN the verdict draws

Tests:
- `verdict-input.test.ts`, `describe('verdictInput')`: one `it.each` over the table above plus the null row (`null → null`) and a `medium` row, each with its literal expected `VerdictInput`.
- `verdict-part.test.ts`, `describe('createVerdictParts')`, over a recording layout as `context-section.test.ts` builds one, and `FakeElement` parents attached under a page root (`isPageRoot = true`) or detached:
  - `it('draws nothing for an entry with no review')`
  - `it('redraws every connected part of a key when its review changes, and logs the heading once')`
  - `it('keeps the verdict when chat updates an answered entry')`
  - `it('sweeps a detached holder of a key when chat builds that key again, disposing its draw')`: build under a detached parent, build again under an attached one; a review change draws once (the new parent) and the old draw's dispose ran.
  - `it('redraws a detached holder, so a view put back shows the current verdict')`: a holder detached when the review changes holds the new verdict once re-attached.
  - `it('empties every holder when its review is deleted, and logs nothing')`
  - `it.each` `redraw` rows over a recording layout whose `verdict` returns an `update`: a done-to-done change calls `update` and builds nothing; a change to a null review disposes the draw and empties the wrapper without calling `update`; `setLayouts` with a second layout redraws every holder through it.
  - `it.each` `confirm card` rows: round not in forms.confirms with a review present → empty; round in forms.confirms → draws; round arriving in forms.confirms after the build → draws after `confirmChanged`.
  - `it.each` `default layout` rows, over `withUser(defaultLayout, {})` as `context-section.test.ts`'s `defaultLayout_$case` does: for a reviewing, a done and an unavailable review, the heading element's text is the input's heading, the detail element is present exactly when the input's detail is not null, and `data-risk` equals the input's risk (absent when null).
- `start.test.ts`, `describe('permissionReviewPagePart')`, on `startPagePart` with `fakeDependency` for chat (`addEntryPart`), forms (`addCardPart`) and sessions, as `src/plugins/context-sources/page/start.test.ts` does: `stop leaves no live registration`, `stop then start starts again`, and the `ready` table (page load, live restart): a review written before load draws at ready, and the next change redraws.

Done when: `npm run typecheck` passes; `npm run lint` passes (layers, styles); the test gate runs `verdict-input.test.ts`, `verdict-part.test.ts`, `start.test.ts` and `src/shared/layouts/layout-contracts.test.ts`; the self-test group runs in 07's filtered self-test. The card on screen, its colours and the confirm card are checked in [07 — Final verification](07-final-verification.md).

Commit: one commit for the group, by pathspec: `git commit -m "permission-review page: verdict part in chat's permission entries and forms' confirm card, drawn through its own layout" -- src/plugins/permission-review src/plugins/page.ts` (the folder pathspec covers 04's `main/start.ts`, `manifest.ts` and `main/selftest-script.ts` edits)

## Proof
