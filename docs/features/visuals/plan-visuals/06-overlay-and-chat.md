# 06 — Overlay, key and chat wiring

Status: in progress
Type: Batch
Wave: 4 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/visual/manifest.ts` · modify `src/plugins/visual/page/start.ts` ·
           modify `src/plugins/visual/page/html-fence.ts` · modify `src/plugins/visual/page/visual.css` ·
           modify `src/plugins/visual/page/layout/visual-kit.ts` · modify `src/plugins/visual/page/layout/visual-parts.ts` ·
           modify `src/plugins/visual/page/layout/read-visual-layout.ts` ·
           modify `src/plugins/visual/layouts/layout.d.ts` · modify `src/plugins/visual/layouts/default/layout.js` ·
           create `src/plugins/visual/page/visual-registry.ts` · create `src/plugins/visual/page/visual-overlay.ts` ·
           create `src/plugins/visual/page/visual-commands.ts` · test `src/plugins/visual/page/visual-commands.test.ts` ·
           modify `src/plugins/keymap.ts` · modify `src/plugins/chat/contract.ts` (`focusedEntry`) ·
           modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/page/chat-view.ts` ·
           modify `src/plugins/chat/page/entry-list.ts` · modify `src/plugins/chat/layouts/default/layout.js` ·
           test `src/plugins/visual/page/visual-registry.test.ts` · test `src/plugins/visual/page/visual-overlay.test.ts` ·
           test `src/plugins/visual/page/html-fence.test.ts` · test `src/plugins/visual/page/layout/read-visual-layout.test.ts` ·
           test `src/plugins/chat/page/entry-list.test.ts` · test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `visualManifest`, `createHtmlFence`, `HtmlFenceDeps`, `createVisualParts`, `VisualParts`, `VisualKit`,
           `Layout`, `readVisualLayout` ← 05
           `VisualFrames.open(source: string): VisualFrame`, `fakeVisualFrames()` in `src/shared/page/fake-visual-frames.ts` ← 04
           `BaseKit.markdown(parent: HTMLElement, text: string, className?: string, options?: { liveFences?: boolean }):
           HTMLElement` in `src/shared/page/layout-host/kit.d.ts` ← 01; `liveFences: false` skips only contributions
           with `live: true`
           `FakeElement.querySelectorAll(selector: string): FakeElement[]` in `src/shared/page/test-dom.ts` ← 01
Produces:  `ChatPageExports.focusedEntry(): HTMLElement | null` in `src/plugins/chat/contract.ts` — the visible Chat
           tab's focused stop's slot element (an entry, an activity line or a pending row); null with no visible
           Chat tab or no focused stop
           `ChatView.focusedEntry(): HTMLElement | null` in `src/plugins/chat/page/chat-view.ts`
           `EntryList.focusedElement(): HTMLElement | null` in `src/plugins/chat/page/entry-list.ts`
           `createVisualRegistry(): VisualRegistry` in `src/plugins/visual/page/visual-registry.ts`, where
           `VisualRegistry { add(host: HTMLElement, source: string): Disposable; sourcesIn(root: HTMLElement): string[] }`
           `createVisualCommands(deps: { chat: Pick<ChatPageExports, 'focusedEntry'>; registry: VisualRegistry;
           overlay: VisualOverlay; log: Log }): Record<'openVisuals' | 'nextVisual' | 'prevVisual' | 'closeVisual',
           () => void>` in `src/plugins/visual/page/visual-commands.ts`
           `createVisualOverlay(deps: VisualOverlayDeps): VisualOverlay` in `src/plugins/visual/page/visual-overlay.ts`,
           where `VisualOverlay { open(sources: readonly string[], index: number): void; next(): void; previous(): void;
           close(): void }`
           visual commands `openVisuals`, `nextVisual`, `prevVisual`, `closeVisual` and scope `overlay`
           binds `v` in `chat.chat` → `visual.openVisuals`; `h`, `l`, `<Esc>` in `visual.overlay` →
           `visual.prevVisual`, `visual.nextVisual`, `visual.closeVisual`
           the log lines (source `visual`): `visual overlay showing <i> of <count>`, `no next visual`,
           `no previous visual`, `visual overlay closed`, `no focused entry`, `no visuals in the focused entry`
Decisions: `v` on the focused chat entry opens its visuals; `h`/`l` move between them; `Esc` closes (rounds 2, 3).
           Every visual has an expand control, the route outside chat (round 3). Chat exports `focusedEntry`
           (round 3, design review). The transcript stays pinned to the bottom when an entry's content grows (round
           1). The user's own messages draw with live fences off (round 2). The overlay finds a root's visuals
           through a registry in the visual plugin keyed by each closed visual's host element, read in document
           order with `querySelectorAll('.visual-host')` (drafter: a layout-drawn data attribute could be left out
           by a user layout; the host is plugin-made). The expand control opens the overlay on that one visual
           (drafter). When a user layout's `visual` part never calls `kit.expand`, the app places the button at the
           part root's end, as it does the frame (lead). The overlay shows its own frame: a second
           `visualFrames.open(source)`, which serves the same `wigley-visual:` URL by hash; it never moves the inline
           frame (drafter: moving it would leave a hole in the transcript, reload it on the way out and back, and the
           caller never moves a frame — task 04). A layout change with the overlay open redraws its part around the
           same frame slot and never reopens the frame (lead). The expand control carries the `v` hint in scope `chat.chat`, so it shows only in chat and
           hides, keeping its space, in forms, the primer and docs; it shows on every visual in the chat, not only
           the focused entry's (drafter: the only on-screen place for the `v` anchor the placement check needs —
           reported). `focusedEntry` on an activity line returns the line's slot, which holds no visual: a
           thinking entry's visuals are reached by its expand control (drafter). `h`, `l` and `<Esc>` are vim's own
           keys and need no anchor (`src/plugins/keys/page/vim-keys.ts`); the chat image viewer anchors none.
           `v` gets no leader route: entry focus shows only after the box loses focus (DESIGN.md § Keys and focus).
GIVEN a visual registered under a root WHEN `sourcesIn(root)` runs THEN it lists that root's closed visuals'
      sources in document order, and leaves out other roots', disposed ones and open cards
GIVEN the overlay opens on two sources at index 0 WHEN `next`, `next`, `previous`, `close` run THEN it shows 2 of 2,
      logs `no next visual`, shows 1 of 2, then closes, each step opening one frame and disposing the last
GIVEN the overlay is open WHEN the pushed scope's base changes THEN it closes
GIVEN the overlay is open WHEN the layouts change THEN its part redraws around the same frame and no frame opens
GIVEN a user layout whose `visual` part never calls `kit.expand` WHEN a closed block mounts THEN the expand button
      sits at the end of that part's root
GIVEN `v` WHEN the visible Chat tab has no focused stop, or its focused stop holds no visual, or holds two THEN it
      logs `no focused entry`, logs `no visuals in the focused entry`, or opens the overlay on both at index 0
GIVEN a visual's expand control WHEN it is clicked THEN the overlay opens on that visual's source alone
GIVEN a following transcript WHEN an entry's slot resizes after it was drawn THEN the list scrolls to its bottom;
      a list scrolled up off the bottom keeps its scroll
GIVEN a focused stop WHEN `focusedElement` runs THEN it returns that stop's slot element; with no stops, null
GIVEN a user entry WHEN the default chat layout draws or updates it THEN its markdown draws with
      `{ liveFences: false }`, and an assistant entry's draws without options
GIVEN an assistant or thinking entry already drawn WHEN its `update` runs THEN the new markdown is drawn into the
      same parent while the old markdown element is still in it, and the old element is removed after, so the
      mount adopts each unchanged visual and its frame stays loaded (on screen → 09 check 3)
Tests:     `visual-registry.test.ts` › `sourcesIn_Roots_ListsClosedVisualsInDocumentOrder $name` — one `it.each`
           table on fake DOM, the test building a root `ol` with two `li` slots, each holding `.visual-host`
           elements; hosts `A` and `B` in slot 1 (A before B), `C` in slot 2, and an unregistered `.visual-host`
           (an open card) in slot 1:
           | name | registered | disposed | root | expected |
           |---|---|---|---|---|
           | document order inside one slot | B then A | none | slot 1 | `['a', 'b']` |
           | another slot left out | A, B, C | none | slot 2 | `['c']` |
           | disposed left out | A, B | A | slot 1 | `['b']` |
           | whole list | A, B, C | none | `ol` | `['a', 'b', 'c']` |
           Break caught: insertion order in place of document order; a dispose that leaves its source listed.
           `visual-overlay.test.ts` › `overlay_Steps_ShowsEachSourceAndStopsAtTheEnds` — `fakeVisualFrames()` (task 04), a fake `pushScope` recording `pop`; `open(['a', 'b'], 0)`,
           then `next`, `next`, `previous`, `close`. Asserts the sources in `opened` are `['a', 'b', 'a']`, every
           record `disposed: true`, the logs `['visual overlay showing 1 of 2', 'visual overlay showing 2 of 2', 'no next visual',
           'visual overlay showing 1 of 2', 'visual overlay closed']`, the backdrop hidden and `pop` run once.
           Break caught: an off-by-one at the last visual; a step that leaks the frame it leaves.
           `visual-overlay.test.ts` › `overlay_BaseChanged_Closes` — opens, fires the scope's `onBaseChanged`
           listener, asserts `visual overlay closed` logged and the frame disposed. Break caught: an overlay left
           over a view that moved on.
           `entry-list.test.ts` › `followsGrowth_SlotResizes_ScrollsOnlyWhileFollowing $name` — a new `it.each`
           with a ResizeObserver stub that records every observed element and its callback (as
           `src/shared/page/ui/split.test.ts` stubs one); the test sets the list's `scrollHeight` to `500`:
           | name | scrolled up first | scrollTop after the slot's resize |
           |---|---|---|
           | following | no | `500` |
           | scrolled up | `scrollBy('line', -1)` | the value before the resize |
           Break caught: a slot never observed, so a visual's height change leaves the transcript short of its end.
           `entry-list.test.ts` › `focusedElement_Stops_ReturnsTheFocusedSlot` — puts a user and an assistant
           entry and asserts `focusedElement()` is the assistant's slot (the following focus); `move(-1)` makes it
           the user's slot; an empty list returns null. Break caught: returning the drawn entry in place of its slot,
           or a stale slot after a move.
           `layout.test.ts` (chat default) › `user_cardHoldsMarkdown_updateReplacesIt` — change the fake kit's
           `markdown` to append ` (fences off)` to its text when `options?.liveFences === false`; the existing
           expectations become `markdown:hello (fences off)` and `markdown:hello there (fences off)`.
           `assistant_update_UpdatesInPlace` keeps `markdown:Hi there`. Break caught: a user's pasted html block
           running live.
           `layout.test.ts` (chat default) › `assistant_update_UpdatesInPlace` and `thinking_rowBodyRefilledInPlace`
           — the fake kit's `markdown` also records the number of children its `parent` holds when it is called;
           each update's call records `1` (the old markdown still there), and the final children stay
           `['markdown:Hi there']` and `['markdown:step 1 step 2']`. Break caught: `replaceChildren()` before the
           draw, which detaches every frame and reloads it on each streaming delta.
           `html-fence.test.ts` › `htmlFence_Mount_DrawsByClosedFlag` — add the column `registered`: the closed
           rows expect `registry.sourcesIn(host)` to equal `[source]`, the open row `[]`; and
           `htmlFence_DisposeClosedView_DisposesTheFrame` asserts `sourcesIn(host)` is `[]` after dispose. The
           `mine` row also expects `.mine`'s last children to be `.visual-frame-slot`, then `button.ui-icon-button`
           (the left-out expand control). Add the row `expand runs with the source`: default layout, `<i>e</i>`,
           closed; clicking the drawn `button.ui-icon-button` calls the fence deps' `expand` with `['<i>e</i>']`.
           Break caught: a user layout that drops the route outside chat; an expand bound to the wrong source.
           `read-visual-layout.test.ts` — the table gains a `part` column naming the part the accepted row reads:
           keep `{ default: { card: part } }` (`card`) and add `{ default: { overlay: part } }` (`overlay`); the
           assertion reads `read()[row.part]`. Break caught: `overlay` or `card` missing from `LAYOUT_PARTS`.
           `visual-overlay.test.ts` › `overlay_LayoutsChanged_RedrawsAroundTheSameFrame` — opens on `['a']`, fires
           the `onLayoutsChanged` listener, asserts `opened` has length 1 with `disposed: false` and
           `.visual-frame-slot` sits in the backdrop's new `div.visual-draw`. Break caught: a layout change that
           reloads the visual the user is reading.
           `visual-commands.test.ts` › `openVisuals_FocusedEntry_OpensOrLogs $name` — one `it.each` with a fake
           overlay recording `open` calls and a registry the test builds with `createVisualRegistry()`:
           | name | focusedEntry | logs | opened |
           |---|---|---|---|
           | no focused stop | null | `['no focused entry']` | `[]` |
           | an entry with no visual | an `li` with no `.visual-host` | `['no visuals in the focused entry']` | `[]` |
           | an entry with two visuals | an `li` holding hosts registered as `a`, `b` | `[]` | `[[['a', 'b'], 0]]` |
           Break caught: a flipped null check; an empty list handed to the overlay.
           `visual-commands.test.ts` › `overlayCommands_CallTheOverlay` — `nextVisual`, `prevVisual` and
           `closeVisual` each call the fake overlay's `next`, `previous` and `close` once, in that order. Break
           caught: two handlers swapped.
           `chat-view` has no test file; `focusedEntry`'s `visibleTab()?.entries.focusedElement() ?? null` is one
           line over `focusedElement`, which `entry-list.test.ts` pins.
           The overlay's look at full window size, the expand control and its `v` hint, and `v` on the preview's
           entry → 09 Final verification.
Approach:
  - **Manifest.** Add `commands`: `openVisuals: { label: "open the focused entry's visuals", group: 'visual',
    runsIn: 'page' }`, `nextVisual: { label: 'next visual', group: 'visual', runsIn: 'page' }`, `prevVisual:
    { label: 'previous visual', group: 'visual', runsIn: 'page' }`, `closeVisual: { label: 'close the visual',
    group: 'visual', runsIn: 'page' }`; `scopes: { overlay: 'In the visual overlay' }`. The layout setting's
    description becomes `'The layout that draws each visual, its drawing card and the full-size overlay: a
    folder in the layouts/visual folder, or default.'`.
  - **Keymap.** Add a `// ── Visual ──` banner section after the Chat section in `src/plugins/keymap.ts`:
    `{ keys: 'v', scope: 'chat.chat', command: 'visual.openVisuals' }`, `{ keys: 'h', scope: 'visual.overlay',
    command: 'visual.prevVisual' }`, `{ keys: 'l', scope: 'visual.overlay', command: 'visual.nextVisual' }`,
    `{ keys: '<Esc>', scope: 'visual.overlay', command: 'visual.closeVisual' }`. `v` checked at plan time
    (docs/keymap.md § Adding a bind, step 3): `chat.chat`'s page binds are `i a j k <CR> G gg <C-j> <C-k> <C-S-j>
    <C-S-k> y n <C-c> <D-Enter> m e o c`, its box binds are `<CR> <Esc>` and `<Leader>c…`, and every `any` bind
    is a leader sequence or a chord; no page bind starts with `v`. No bind in `keymap.ts` today names one
    plugin's command in another plugin's scope (measured at plan time, re-verify); if startup refuses
    `visual.openVisuals` in `chat.chat`, stop and report. Run `git status --short src/plugins/keymap.ts` first
    and stage only your own hunks.
  - **Entry list** (`entry-list.ts`). Add `focusedElement()`: `slotElement(focus.entryId)` when `focus.entryId`
    is not null, else null. Add one `ResizeObserver` (`followSlotSizes`) whose callback calls `followBottom`;
    observe every slot element the list creates (entry, activity and pending slots), unobserve a slot when its
    element leaves (`putQueued`'s removals, `rebuild`'s dispose of all slots), and disconnect it in `dispose`
    beside `listSize.disconnect()`. Update the `EntryList` header comment: a following focus also scrolls to the
    bottom when any slot's box resizes.
  - **Chat view and exports.** `ChatView` gains `focusedEntry(): HTMLElement | null`, implemented as
    `visibleTab()?.entries.focusedElement() ?? null`. `ChatPageExports` gains `focusedEntry`, documented in the
    contract's exports comment as in Produces, and `start.ts` exports `focusedEntry: () => view.focusedEntry()`.
    `src/plugins/chat/contract.ts` and `src/plugins/chat/main/start.ts` hold another session's uncommitted edits
    at plan time (`git status --short`): stage only your own hunks.
  - **User entry.** In the chat default layout's `fillUserTurn`, call `kit.markdown(turn, input.text, 'md',
    { liveFences: false })`.
  - **Assistant and thinking updates.** Each builder keeps the markdown element it drew (`let md = kit.markdown(entry,
    input.text, 'md')`; thinking's inside `body`). `update` runs `const drawn = kit.markdown(<same parent>, next.text,
    'md'); md.remove(); md = drawn;` in place of `<parent>.replaceChildren(); kit.markdown(…)`. The mount adopts a
    view whose language, source and closed flag are unchanged from a record whose host is the same parent (task 01
    § Mount, step 1), so draw first and remove second. The assistant's `chat-streaming` toggle stays.
  - **Registry** (`visual-registry.ts`). A `Map<HTMLElement, string>`. `add` sets the host and returns a
    Disposable that deletes it. `sourcesIn(root)` returns `[...root.querySelectorAll('.visual-host')]` filtered
    to hosts in the map, mapped to their sources. Tests use `FakeElement.querySelectorAll` from task 01, which
    returns matches depth first, which is document order.
  - **Fence.** `HtmlFenceDeps` gains `registry: VisualRegistry` and `expand(source: string): void`. A closed view
    calls `registry.add(host, source)` at mount and disposes it first in its `dispose`. `parts.visual` gains a
    third argument `expand: () => void`, which the fence passes as `() => deps.expand(source)`.
  - **Layout contract.** `VisualKit` gains `expand(parent: HTMLElement): HTMLButtonElement` — a
    `button.ui-icon-button.ui-icon-button--sm` holding the Codicon `screen-full`, `Expand` as its tooltip and
    aria-label, never taking focus, whose click opens the overlay on this visual. Add `OverlayInput { index:
    number; count: number }` (index from 0) and `OverlayKit extends BaseKit { frame(parent: HTMLElement):
    HTMLElement }`, and `Layout.overlay?(parent: HTMLElement, input: OverlayInput, kit: OverlayKit): HTMLElement`.
    `read-visual-layout.ts` adds `overlay: true`.
  - **Kit and parts.** `expand` uses `iconButton('screen-full', 'Expand', onClick, 'sm')`, as
    `src/plugins/keys/page/layout/keys-kit.ts` does. Each draw of the `visual` part builds the button once and
    wraps it in `appSlot(button, 'expand', rollback)`: `kit.expand = (at) => expandSlot.place(at)` (a second call
    throws `expand placed twice`), and after the builder returns `expandSlot.placeIfLeftOut(root)` runs after the
    frame's. A left-out button is placed bare, with no `v` hint: the hint is the layout's. The default layout
    still builds its own `div.visual-bar` and places the button in it. The `visual` part's kit scope becomes
    `{ qualified: 'chat.chat' }`, so its `keyHint` shows only while chat's scope is in force. Add
    `overlay(parent: HTMLElement, frame: HTMLElement, input: OverlayInput): Drawn` (`frame` is the slot), whose kit scope is
    `'overlay'` and whose frame goes through the same `frameSlot` and fresh `div.visual-draw` as `visual`'s (task 05).
  - **Default layout.** `visual`: after `kit.frame(root)`, `const bar = kit.el(root, 'div', 'visual-bar')`,
    `const button = kit.expand(bar)`, `kit.keyHint(button, 'openVisuals')`. `overlay`: root
    `kit.el(parent, 'div', 'visual-overlay-part')`; in it `kit.el(root, 'div', 'visual-overlay-body')` holding
    `kit.frame(body)`, then `kit.el(root, 'div', 'visual-overlay-count', \`${input.index + 1} of ${input.count}\`)`,
    its `hidden` set when `input.count < 2`, as chat's `showImage` does.
  - **CSS** (`visual.css`, tokens only; copy `chat.css`'s `.ui-scrim.chat-image-viewer` rules for the scrim):
    `.ui-scrim.visual-overlay` is a centred column with `--wg-space-2` gap and `display: none` while `hidden`;
    `.visual-overlay-part` is `display: contents`; `.visual-overlay-body` fills the scrim less a `--wg-space-8`
    margin on each side, scrolls on `overflow: auto`, and takes `--wg-transcript-background` and `--wg-radius-lg`
    (a visual's body is transparent); no rule sets the frame's height, which the service sets through
    `--visual-frame-height`; `.visual-overlay-count` is `--wg-fg`, `--wg-text-12`, tabular numerals;
    `.visual-bar` ends the visual with its button at the end, `--wg-space-1` padding.
  - **Overlay** (`visual-overlay.ts`), copying `src/plugins/chat/page/image-viewer.ts`. Deps: `overlay:
    PluginAreas['overlay']`, `pushScope(): PushedScope`, `frames: VisualFrames`, `parts: VisualParts`, `log: Log`,
    `onLayoutsChanged(listener: () => void): void`. A backdrop `div.ui-scrim.visual-overlay`, `hidden`, `role`
    `dialog`, `aria-modal` `true`, contributed to the overlay area once. `open(sources, index)` closes first,
    blurs the focused element, pushes the scope (its `onBaseChanged` closes this open), shows the backdrop and
    shows `index`. Showing an index disposes the last frame and drawn part, opens its own frame with
    `frames.open(sources[index])` (never the inline frame's element), draws
    `parts.overlay(backdrop, slot, { index, count })` with `slot` a `div.visual-frame-slot` holding
    `frame.element` and logs
    `visual overlay showing <index + 1> of <count>`. `next` / `previous` past an end log `no next visual` /
    `no previous visual` and change nothing; each does nothing while closed. `close` hides the backdrop, disposes
    the drawn part and the frame, pops the scope and logs `visual overlay closed`. A layout change while open
    draws the part again around the held frame (new part first, old part disposed after, as task 05's fence
    `redraw` does) and opens no frame; while closed it does nothing.
  - **Page part.** `const chat = api.dependency<ChatPageExports>('chat')` beside `keys`. Build, in this order:
    the registry, the parts, the overlay (`pushScope: () => api.keys.pushScope('overlay')`, `onLayoutsChanged`
    adding to a listener list the page part holds), the fence (`expand: (source) => overlay.open([source], 0)`),
    then `addFence`, then `api.layouts.show`, since `show` may call `setLayouts` before it returns. `setLayouts`
    runs `parts.setLayouts(shown)`, then `fence.redraw()`, then each layouts-changed listener. Return
    `commands: createVisualCommands({ chat, registry, overlay, log: services.log })`.
  - **Commands** (`visual-commands.ts`). `openVisuals` reads `chat.focusedEntry()`; null logs `no focused
    entry`; else `registry.sourcesIn(entry)`; empty logs `no visuals in the focused entry`; else
    `overlay.open(sources, 0)`. `nextVisual`, `prevVisual` and `closeVisual` call `next`, `previous`, `close`. The overlay closes only on its own keys and on a base scope change, as the
    image viewer's own rule does; it does not hear a session switch.
  - **Placement check.** The `v` anchor draws only where a visual draws in chat. Until task 07's fixture draws
    one during the self-test's page load, the self-test logs `[keys] unplaced v visual.openVisuals in chat.chat`
    and fails; this task's gate does not run the self-test.
Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

<empty — wigley:make writes it>
