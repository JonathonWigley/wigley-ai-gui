# 01 — Hub frame

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` · modify `src/shared/page/contributed-parts.ts` · modify `src/plugins/chat/page/chat.css` · modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` · modify `src/plugins/chat/layouts/default/layout.css` · modify `src/plugins/chat/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/chat/main/selftest-script.ts` · modify `src/plugins/workflow/page/start.ts` (only as the Decisions below say) · create `src/plugins/chat/page/side-sections.ts` · test `src/plugins/chat/page/side-sections.test.ts`
Consumes:  `addSidePart`, `.chat-side-parts`, `.chat-side-part`, `.chat-main`, `sideParts` in `ChatViewDeps` (the side pane plan, in the tree at the run)
Produces:  in `src/plugins/chat/contract.ts`: `ChatSideSection` and `ChatSidePart` as `plan.md` § File Structure writes them
           in `src/plugins/chat/layouts/layout.d.ts`:
           `export interface SideSectionInput { title: string; summary: string | null; collapsed: boolean }`
           `export interface SideSectionKit extends BaseKit { head(parent: HTMLElement): HTMLButtonElement; body(parent: HTMLElement): HTMLElement }`
           `Layout.sideSection?(parent: HTMLElement, input: SideSectionInput, kit: SideSectionKit): PartView<SideSectionInput>`
           in `src/plugins/chat/page/side-sections.ts`: `export function createSideSections(deps): SideSections`
           `chat.toggleSideParts` command in `src/plugins/chat/manifest.ts`
Decisions:
- `ChatSidePart` stops extending `ContributedPart`. `side-sections.ts` adapts each part to a `ContributedPart` for `placeContributedPart`, the one-part form `buildSidePart` in `chat-view.ts` calls. The adapter's `build(wrapper, sessionId)` draws the frame into the wrapper, then calls the part's `build` with the body and a `ChatSideSection`.
- `PartStore` and `createPartStore` in `contributed-parts.ts` loosen their constraint to `P extends { id: string }`, because `ChatSidePart` no longer fits `ContributedPart`. `placeContributedPart` stays on `ContributedPart`, because the adapter produces those. Add `sideSection` to `PART_SET` in `read-chat-layout.ts`.
- Chat sorts the parts by `order` before it places them. Equal orders keep add order. `order` is required, so a part cannot leave it out. `syncSideParts` in `chat-view.ts` appends a new part's wrapper at the end of the holder and leaves built parts in place, so a part added late must go to its sorted position.
- Keep every `addSidePart` rule from the side pane plan: it throws on an id already added, a part draws in every Chat tab, and it takes no stop and no key scope.
- A chat layout change rebuilds every tab's side parts, at the `deps.layouts.onChange` handler in `mountChatView`. `syncSideParts` leaves a built part alone, so the handler calls `disposeSideParts(tab)`, then `syncSideParts(tab, deps)`. The frame is drawn through a layout, so it must redraw on a hot reload. A status line draw still does not rebuild a part.
- Place a tab's side parts after the tab is in the map `mountChatView` holds, so a chat part can find its tab by session id (04, 07).
- Default `sideSection` draws `section.chat-side-section`. Its children are `kit.head`, then `kit.body`. The head holds a chevron codicon (`chevron-down`, or `chevron-right` while collapsed), `span.chat-side-section-title` and `span.chat-side-section-summary`. `update` changes the chevron, summary text and `is-collapsed` in place.
- `kit.head` makes a `button.chat-side-section-head` that toggles the section on click. It takes no key and no focus: `tabIndex = -1`, and `mousedown` calls `preventDefault`, so a click leaves the focus in place.
- `kit.body` makes the `div.chat-side-section-body` the part draws in. A layout that leaves out `kit.body` gets the body at the end of its element, as a composer that leaves out a slot does. `side-sections.ts` holds one body element per build, and `kit.body` returns that element at each frame draw.
- A frame change runs the part view's `update`. When the view has no `update`, or `update` throws, draw the frame again through `chatPartDraws` (a throw falls to `default`, as every part does). The new draw's `kit.body` returns the held body, so the part's content moves over and the part does not rebuild.
- When the `sideSection` part fails in the default layout too, log it, make a bare `div.chat-side-section-body` in the wrapper, and build the part there, so the section's content still shows and the hide rule still holds. With no frame, `setSummary` and the toggle change nothing.
- `setSummary` is a frame change. Null leaves the summary span empty.
- `side-sections.ts` holds its live frames by tab and part id. The build's dispose removes a frame from that registry, whether a tab closes, a part leaves or a layout change rebuilds. `setSummary` after dispose does nothing.
- A section's collapse toggles in every tab, for every session, and logs `section <title> collapsed` or `section <title> expanded`. `uiState` key `collapsed-sections` holds a string array of part ids. A value that is not an array reads as none. A part id nobody registers stays in the array.
- Toggling a section updates its frames in place. It does not rebuild the part.
- `chat.toggleSideParts` sets `is-side-hidden` on every `.chat-tab`, sets `uiState` key `hub-hidden` to a boolean, and logs `session hub hidden` or `session hub shown`. A tab built later reads the key. Command label: `Hide or show the session hub`. Bind `<Leader>vs` in scope `any`, in the View block of `src/plugins/keymap.ts` beside `<Leader>vu`.
- CSS replaces the side pane plan's rules. In `chat.css`:
  - `.chat-side-parts`: width `264px` from a token-checked length, as the workflow pane holds it now; `flex: none`; a column; `align-self: stretch`; `min-height: 0`; a left `--wg-border-default` line; `--wg-block-background`.
  - `.is-side-hidden .chat-side-parts { display: none; }`
  - `.chat-side-part`: `flex: 0 1 auto`; `min-height: 0`; `overflow: hidden`; a column.
  - `.chat-side-part:not(:has(.chat-side-section-body > :not([hidden]))) { display: none; }` and `.chat-side-parts:not(:has(.chat-side-section-body > :not([hidden]))) { display: none; }`. These replace the side pane plan's `:not(:empty)` rule, which stops working once a wrapper holds a frame. A part that draws nothing hides its frame, and the column hides when no part has content. So a part draws directly into `parent`, or sets `hidden` on its own child.
  - The frame and body are columns with `min-height: 0`. The head is `flex: none`. The body is `flex: 0 1 auto` with `overflow-y: auto` and `padding: var(--wg-space-2) var(--wg-space-3)`. Every section's content takes this padding and adds none of its own.
  - `.chat-side-section.is-collapsed .chat-side-section-body { display: none; }`
  - A `--wg-border-subtle` line between sections.
- The rule that hides `.chat-side-parts` under `640px` stays in `layouts/default/layout.css`. Title and summary type come from `DESIGN.md` (`text-12`, semibold `fg-tertiary`, tabular numerals).
- `src/plugins/workflow/page/start.ts` adds its part through `addSidePart`. The contract change breaks that call. In this task, wrap it with `{ ...view.sidePart, title: 'Plan', order: 20, build: (parent, sessionId) => view.sidePart.build(parent, sessionId) }` so that the tree compiles. Task 06 replaces the wrap. Leave every other workflow file alone.
- Rewrite the doc comments of `addSidePart`, `ChatPageExports`, `createTab` and `chat.css`'s header for the frame.
GIVEN parts with orders 30, 10, 20 WHEN a tab builds THEN the sections sit in order 10, 20, 30, whatever order they were added in
GIVEN two tabs WHEN a section's head is clicked in one THEN it collapses in both, `uiState` holds its id, and neither part rebuilds
GIVEN `collapsed-sections` holds a part's id WHEN a tab builds THEN that section starts collapsed
GIVEN a section WHEN its part calls `setSummary('5/7')` then `setSummary(null)` THEN the summary reads `5/7`, then empty, in that tab's frame only
GIVEN a tab WHEN `chat.toggleSideParts` runs THEN the tab has `is-side-hidden`, `uiState` holds true, and a tab built later has the class too
GIVEN `collapsed-sections` holds a value that is not an array WHEN a tab builds THEN no section is collapsed
GIVEN `hub-hidden` is true at the start WHEN the first tab builds THEN it has `is-side-hidden`
GIVEN a `sideSection` part with no `update` WHEN its section collapses THEN the frame draws again, the body element is the same one, and the part's build count stays 1
GIVEN a `sideSection` part that throws, in the default layout too, WHEN a part builds THEN its content sits in a bare `.chat-side-section-body`, and `setSummary` does not throw
GIVEN a section's build is disposed WHEN its part calls `setSummary` THEN nothing changes and nothing throws
GIVEN a tab with a part WHEN the chat layout changes THEN the part's last build is disposed once and it builds again
Tests:     in `side-sections.test.ts`, one test per GIVEN above, with `jsdom`, a fake `uiState` and the layout's default part. Assert the sequence of `data-part` values, the `is-collapsed` class, the array in the fake `uiState`, the build and dispose counts, and the summary span's text. Add a row to the chat self-test: `Space v s` expects `[chat] session hub hidden`, again expects `[chat] session hub shown`
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. Height, width and the section look are checks in [09](09-final-verification.md)
Commit:    one commit for the group

## Proof

Commit 11ecd75f · proof: diff read: every Produces present; typecheck clean at the commit; worker: lint clean, 224 tests in the touched files pass · concerns: self-test row and hub look unseen until task 09; Plan section looks wrong until 06; command label capitalised while its neighbours are lowercase, for the review; one chatPartDraws serves all sections, so one update throw moves all to default until layouts change
