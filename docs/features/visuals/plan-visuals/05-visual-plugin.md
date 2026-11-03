# 05 — Visual plugin: fence, card and session note

Status: in progress
Type: Task
Wave: 3 · Depends on: 01, 03, 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/visual/manifest.ts` · create `src/plugins/visual/contract.ts` ·
           create `src/plugins/visual/main/start.ts` · create `src/plugins/visual/main/session-note.ts` ·
           create `src/plugins/visual/page/start.ts` · create `src/plugins/visual/page/html-fence.ts` ·
           create `src/plugins/visual/page/visual.css` · create `src/plugins/visual/page/layout/visual-kit.ts` ·
           create `src/plugins/visual/page/layout/visual-parts.ts` ·
           create `src/plugins/visual/page/layout/read-visual-layout.ts` ·
           create `src/plugins/visual/layouts/layout.d.ts` · create `src/plugins/visual/layouts/default/layout.js` ·
           modify `src/plugins/manifests.ts` · modify `src/plugins/main.ts` · modify `src/plugins/page.ts` ·
           modify `scripts/check-layers.mts` (see Decisions: plan.md lists this file for 02 only) ·
           test `src/plugins/visual/page/html-fence.test.ts` ·
           test `src/plugins/visual/page/layout/read-visual-layout.test.ts`
Consumes:  `interface FenceContribution { language: string; live: boolean; mount(source: string, closed: boolean): FenceView }`
           and `interface FenceView { readonly element: HTMLElement; dispose(): void }` in `src/contracts/markdown.ts` ← 01
           `MarkdownRenderer.addFence(fence: FenceContribution): Disposable` ← 01
           `ChatMainExports.addInstructions(text: string): Disposable` in `src/plugins/chat/contract.ts` ← 03
           `VisualFrames.open(source: string): VisualFrame` in `src/contracts/visual-frames.ts` ← 04
           `PageServices.visualFrames: VisualFrames` in `src/contracts/plugin.ts` ← 04
           `fakeVisualFrames(): { frames: VisualFrames; opened: FakeVisualFrame[] }` in
           `src/shared/page/fake-visual-frames.ts` ← 04 (tests)
Produces:  `visualManifest` in `src/plugins/visual/manifest.ts`: id `visual`, `dependsOn: ['chat', 'keys']`, no
           commands, no scopes, `settings: { layout: 'default' }`
           `visualMainPart: MainPart<typeof visualManifest>` in `src/plugins/visual/main/start.ts`
           `visualPagePart: PagePart<typeof visualManifest>` in `src/plugins/visual/page/start.ts`
           `SESSION_NOTE: string` in `src/plugins/visual/main/session-note.ts`
           `createHtmlFence(deps: HtmlFenceDeps): HtmlFence` in `src/plugins/visual/page/html-fence.ts`, where
           `HtmlFence { contribution: FenceContribution; redraw(): void }` and
           `HtmlFenceDeps { frames: VisualFrames; parts: VisualParts; log: Log }`
           `createVisualParts(deps: VisualPartsDeps): VisualParts` in `src/plugins/visual/page/layout/visual-parts.ts`,
           where `VisualParts { card(parent: HTMLElement): Drawn; visual(parent: HTMLElement, frame: HTMLElement): Drawn;
           setLayouts(shown: ShownLayouts<Layout>): void }` and `Drawn { element: HTMLElement; dispose(): void }`
           `readVisualLayout(module: unknown, name: string): Layout` in
           `src/plugins/visual/page/layout/read-visual-layout.ts`
           `Layout`, `CompleteLayout`, `VisualKit` in `src/plugins/visual/layouts/layout.d.ts`
           the log line `[visual] visual mounted: <title>` (source `visual`, message `visual mounted: <title>`), where
           `<title>` is the trimmed text of the source's first `<title>` element, or `untitled` when it has none;
           task 07's self-test waits on it (pinned by 07)
Decisions: The plugin id is `visual` (round 2). The manifest depends on `chat` (plan.md) and on `keys` (drafter:
           every plugin that draws a layout kit reads `keys.anchor` through `api.dependency('keys')`, as
           `src/plugins/usage/page/start.ts` does; plan.md's boundary rule names only chat — reported as a gap).
           An open block draws the card with the copy `drawing visual…` (round 2). A closed block draws
           `services.visualFrames.open(source)` (round 3). The session note goes through chat main's
           `addInstructions` (round 1, round 3). The plugin adds no `Space z l` preview of its own: the chat
           preview (task 07, `previewEntries()`) draws the sample visuals from `src/shared/sample-visuals.ts`, so it
           previews this layout (lead); the card shows there only if 07 adds an entry with an unclosed html block
           (reported). The built-in default layout's CSS goes in
           `page/visual.css`, imported by `page/start.ts`, as every built-in plugin's does (drafter: plan.md names
           `layouts/default/layout.css`, but no built-in default ships one — `find src -path '*layouts*' -name
           '*.css'` finds none at plan time — reported). The expand control is task 06's: it opens the overlay,
           which 06 builds (drafter: an expand control with nothing to open would be a dead control at this
           commit — reported). `scripts/check-layers.mts` is edited here because `npm run lint` fails on a plugin
           folder with no `LAYERS` entry (drafter; plan.md lists the file for 02 only — reported).
GIVEN an html fence mounts with `closed` false WHEN `mount` runs THEN the view's element holds the default card,
      and no frame opens
GIVEN an html fence mounts with `closed` true WHEN `mount` runs THEN one frame opens with that source, the view's
      element holds the frame's element, in its slot, inside the `visual` part, and `visual mounted: <title>` is logged once
GIVEN a user layout's `visual` part that never calls `kit.frame` WHEN a closed block mounts THEN the frame's
      element's slot sits at the end of that part's root
GIVEN a closed view WHEN the layouts change THEN its part redraws around the same frame slot and no frame opens
GIVEN a closed view WHEN its `dispose` runs THEN its frame's `dispose` runs and the frame's slot is detached
GIVEN a user `layout.js` module WHEN `readVisualLayout` reads it THEN it accepts the known parts and names the first
      key that is no part, or the first part that is not a function
Tests:     `html-fence.test.ts` › `htmlFence_Mount_DrawsByClosedFlag $name` — one `it.each` table over
           `{ name, layouts, source, closed, opened, host, logs }` with `fakeVisualFrames()` from
           `src/shared/page/fake-visual-frames.ts` (task 04; `opened` lists each frame's `source`, `element`
           `div.visual-frame` and `disposed`); `opened` below is the sources in `opened`; `host` is what the host's one `div.visual-draw` holds:
           | name | layouts | source | closed | opened | host | logs |
           |---|---|---|---|---|---|---|
           | open block draws the card | default | `<p>half` | false | `[]` | one `.visual-card` | `[]` |
           | closed block draws the frame | default | `<title> Flow </title><p>done</p>` | true | `['<title> Flow </title><p>done</p>']` | `.visual` holding `.visual-frame-slot` holding `.visual-frame` | `['visual mounted: Flow']` |
           | left-out frame is placed at the root's end | user `mine` whose `visual` returns `div.mine` and never calls `kit.frame` | `<b>x</b>` | true | `['<b>x</b>']` | `.mine` whose last child is `.visual-frame-slot` | `['visual mounted: untitled']` |
           Break caught: a flipped `closed` branch; a dropped `placeIfLeftOut`; a title read that keeps the spaces
           or misses the `untitled` fallback, which 07's self-test waits on.
           `html-fence.test.ts` › `htmlFence_DisposeClosedView_DisposesTheFrame` — mounts a closed block, calls
           the view's `dispose`, and asserts the frame's `opened` record reads `disposed: true` and `.visual-frame-slot` has no parent.
           Break caught: a view that leaks its frame and the frame's theme listener.
           `html-fence.test.ts` › `htmlFence_Redraw_KeepsTheFrame` — mounts a closed block, calls `redraw()` after
           `parts.setLayouts` with a user layout `mine`, and asserts `opened` holds one record with `disposed: false`,
           the host holds one `div.visual-draw` whose part is `.mine`, and `.visual-frame-slot` sits in it (the fake
           DOM has no `moveBefore`, so the slot moves by `append`). Break caught: a redraw that reopens the frame, or
           an old part's dispose that removes the slot from the new part.
           `read-visual-layout.test.ts` › `readVisualLayout_Shapes_AcceptsOrNamesTheFirstBadKey $error` — the same
           four-row table as `src/plugins/keys/page/layout/read-keys-layout.test.ts`: `{}` → `default export`;
           `{ default: { footer: part } }` → `footer`; `{ default: { visual: 3 } }` → `visual`;
           `{ default: { card: part } }` → accepted, `card` is `part`. Break caught: a part missing from
           `LAYOUT_PARTS`, so a user layout defining it throws.
           The card's and the visual's look, and the session note reaching the agent → 09 Final verification. The
           note reaching `AgentStart.instructions` is task 07's fake harness record.
Approach:
  - **Manifest.** Copy the shape of `src/plugins/keys/manifest.ts`: a header comment naming what the plugin does,
    `definePlugin({ id: 'visual', dependsOn: ['chat', 'keys'], commands: {}, scopes: {}, settings: { layout:
    'default' }, settingInfo: { layout: { label: 'Visual layout', description: 'The layout that draws each visual
    and its drawing card: a folder in the layouts/visual folder, or default.' } }, themeTokens: {} })`.
  - **Contract.** `contract.ts` holds `VisualChannel`, the empty channel both parts type `api` with:
    `{ invoke: Record<never, never>; messages: Record<never, never> }`, as the keys page part types its own. It
    imports only `src/contracts`.
  - **Session note.** `SESSION_NOTE` in `main/session-note.ts` is exactly this text:

    ```
    This app renders a fenced ```html code block in your reply as a live visual: a sandboxed frame where scripts run, the network is blocked, and the user's theme styles the page. Before you draw a visual — a UI mockup, a flowchart or any diagram — load the `wigley:visuals` skill and follow it.
    ```

  - **Main part.** `visualMainPart.start` calls `api.layouts.register({ layoutTypes })` (`layoutTypes` from
    `../layouts/layout.d.ts?raw`, as `src/plugins/keys/main/start.ts` does) and
    `api.dependency<ChatMainExports>('chat').addInstructions(SESSION_NOTE)`. It returns `commands: {}` and a
    `dispose` that disposes both Disposables.
  - **Layout contract** (`layouts/layout.d.ts`, importing only `BaseKit` from the kit, as every owner's does). A
    header comment says what the app keeps: the frame, its height and focus, and every key. Members:
    - `VisualKit extends BaseKit` with `frame(parent: HTMLElement): HTMLElement` — appends the app's frame
      element to `parent` and returns it; a part that never calls it gets the frame at its root's end; a second
      call throws `frame placed twice`.
    - `Layout { card?(parent: HTMLElement, kit: BaseKit): HTMLElement; visual?(parent: HTMLElement, kit:
      VisualKit): HTMLElement }` — each appends one element to `parent` and returns it.
    - `CompleteLayout extends Required<Layout>`.
  - **Default layout** (`layouts/default/layout.js`, `// @ts-check`, typed `CompleteLayout`):
    - `card`: `kit.card(parent, 'visual-card')`, then into it `kit.statusDot(card, 'running')` and
      `kit.el(card, 'span', 'visual-card-text', 'drawing visual…')`; returns the card.
    - `visual`: `kit.el(parent, 'div', 'visual')`, then `kit.frame(root)`; returns the root.
  - **CSS** (`page/visual.css`, tokens only): `.visual-card` lays its dot and text in a row with `--wg-space-2`
    gap, text `--wg-fg-secondary` at `--wg-text-12`. `.visual` is a block as wide as its column with
    `--wg-radius-md` corners and its overflow clipped. `.visual-frame-slot > *` is `display: block`,
    `width: 100%`, no border, so the service's element takes the column's width. No rule sets the frame's
    height: the service sets it through `--visual-frame-height` (task 04).
  - **Kit and parts.** `visual-kit.ts` copies `src/plugins/keys/page/layout/keys-kit.ts`: the base kit from
    `ownerBaseKitDeps(visualManifest, services, scope, rollback)` plus `frame`. `visual-parts.ts` copies
    `keys-parts.ts`'s `draw`: `createLayoutParts<Layout, CompleteLayout>({ owner: 'visual', … })`; both parts'
    kit scope is `null`. The fence wraps `frame.element` once, at mount, in a plugin-made `div.visual-frame-slot` and
    passes that slot as `visual(parent, frame)`'s `frame`; the slot, not the frame, is what each draw places. Each draw runs into a fresh
    `div.visual-draw` appended to `parent`, so the part adds only its root to its own parent. The frame slot is a
    plugin-local `frameSlot(slot, rollback)` in `visual-parts.ts`, shaped as `appSlot` (`place`, `placeIfLeftOut`,
    `frame placed twice` on a second `place`), with two differences that keep the frame loaded: it moves the
    slot with `at.moveBefore(slot, null)` when `moveBefore` exists and the slot and `at` are both connected, else
    `at.append(slot)`; and its recorded destroy removes the slot only while the slot's parent is still the element
    this draw placed it into. `kit.frame = (at) => frameSlot.place(at)`; after the builder returns, call
    `frameSlot.placeIfLeftOut(root)`. The caller places the frame element once, into its slot, and never moves it;
    only the slot moves (task 04's rule). `read-visual-layout.ts` copies `read-keys-layout.ts` with
    `LAYOUT_PARTS = { card: true, visual: true }`.
  - **Fence contribution** (`html-fence.ts`). `contribution.language` is `'html'` and `contribution.live` is `true` (it runs the source, so
    `liveFences: false` keeps it as code). `mount(source, closed)`
    creates a host `div.visual-host` (the `FenceView.element`):
    - `closed` false: `parts.card(host)`; `dispose` disposes the drawn part.
    - `closed` true: `const frame = deps.frames.open(source)`, then `parts.visual(host, slot)` with `slot`
      the `div.visual-frame-slot` holding `frame.element`, then
      `deps.log('visual', \`visual mounted: ${visualTitle(source)}\`)`, where `visualTitle` (module-private) returns the
      trimmed text of the first match of `/<title[^>]*>([\s\S]*?)<\/title>/i`, or `untitled` with no match or an empty
      match; `dispose` disposes the drawn part, then
      runs `frame.dispose()`.
    Each live view is held in a `Set` from mount to dispose. `redraw()` draws each live view's part again into its host (a new
    `div.visual-draw`) with the same frame slot, then disposes the old drawn part and removes its `div.visual-draw`.
    Drawing first moves the slot while it is connected, so the frame stays loaded; no frame is opened again.
  - **Page part** (`page/start.ts`, importing `./visual.css`). Read `const keys = api.dependency<KeysPageExports>('keys')` first (`api.keys` has no
    `anchor`). Build the parts with `kit: { markdown:
    services.markdown, keys: { anchor: keys.anchor, keysFor: keys.keysFor }, commands: { exists, run },
    platform: api.platform }`, as `src/plugins/usage/page/start.ts` does. Build the fence with
    `frames: services.visualFrames`. Call `services.markdown.addFence(fence.contribution)` once; the page part
    keeps the registration for the page's life. Call `api.layouts.show<Layout>({ defaultLayout, read:
    readVisualLayout, userLayout: () => api.settings().layout, setLayouts(shown) { parts.setLayouts(shown);
    fence.redraw(); } })`. Return `{ commands: {} }`.
  - **Registration.** Add `visualManifest` to `builtInManifests` after `workflowManifest`, `visualMainPart` to
    `mainParts` after `workflowMainPart`, and `visualPagePart` to `pageParts` after `usagePagePart`; each host
    starts a part after the parts its `dependsOn` names. Before you edit `src/plugins/manifests.ts`, `main.ts` or
    `page.ts`, run `git status --short` on it and stage only your own hunks.
  - **Layers.** In `scripts/check-layers.mts`, add entries shaped as the `src/plugins/usage*` ones (lines 471–506
    at plan time): `src/plugins/visual`, `src/plugins/visual/contract.ts` (`src/contracts` only),
    `src/plugins/visual/main` (adds `src/plugins/chat/contract.ts` and `src/plugins/visual/layouts`),
    `src/plugins/visual/layouts` (`src/shared/page/layout-host` only), `src/plugins/visual/page` (adds
    `src/shared/page`, `src/shared/page/ui`, `src/shared/page/layout-host`, `src/plugins/visual/layouts`,
    `src/plugins/keys/contract.ts`, `src/plugins/chat/contract.ts`). Add `src/plugins/visual` and
    `src/plugins/visual/main` to `src/plugins/main.ts`'s entry, `src/plugins/visual` to
    `src/plugins/manifests.ts`'s, and `src/plugins/visual` and `src/plugins/visual/page` to
    `src/plugins/page.ts`'s.
Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

<empty — wigley:make writes it>
