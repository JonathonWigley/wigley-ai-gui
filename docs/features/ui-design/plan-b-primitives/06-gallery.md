# 06 — Gallery mode

Status: not started
Type: Task
Wave: 3 · Depends on: 02, 04, 05
Plan: [plan.md](plan.md)

Files:     create `src/plugins/gallery/manifest.ts` · create `src/plugins/gallery/page/start.ts` ·
           create `src/plugins/gallery/page/gallery-view.ts` · create `src/plugins/gallery/page/gallery.css` ·
           create `src/plugins/gallery/page/transparency-toggle.ts` · create `src/plugins/gallery/page/test-shell-layout.ts` · test `src/plugins/gallery/page/transparency-toggle.test.ts` ·
           modify `src/plugins/manifests.ts` · modify `src/plugins/page.ts` · modify `scripts/check-layers.mts` ·
           modify `src/contracts/plugin.ts` · modify `src/renderer/plugins/page-api.ts` · modify `src/renderer/plugins/page-api.test.ts` ·
           modify `src/renderer/renderer.ts` · modify `src/plugins/forms/main/selftest-script.ts` · modify `src/plugins/docs/main/selftest-script.ts`
Consumes:  every Produces of [04](04-primitives-controls.md) and [05](05-primitives-containers.md) ·
           `SelfTestStep.screenshot?: string` in `src/contracts/plugin.ts` ← 02 (a step's PNG lands at `<repo>/.selftest/screenshots/<pluginId>-<screenshot>.png`; a name is lowercase words joined by `-`) ·
           `export type Transparency = 'system' | 'full' | 'reduced';` in `src/contracts/settings.ts` ← plan A task 01 ·
           `PageApi.platform: Platform` ← plan A task 03 · `PageServices.uiState: UiState` ← plan A task 05 ·
           `Mode` gains `icon: string` (a Codicon name) · `ModeHandle` gains `setContext(context: ModeContext | null): void` ·
           `interface ModeContext { title: string; detail: string | null }` ← plan A task 04 ·
           `PluginManifest` gains `themeTokens: Readonly<Record<string, TokenDecl>>` ← plan A task 01 ·
           `ThemeApplier.apply(theme: Theme, settings: Pick<Settings, 'transparency' | 'fonts'>): void` in `src/renderer/theme.ts` ← plan A task 01, called by `renderer.ts` at start (plan A task 01) and on each pushed config (plan A task 03) ·
           the `src/shared/page/ui` layer in `scripts/check-layers.mts` ← plan A task 04 ·
           `.material-chrome`, `.material-chrome--dense`, `.material-floating` ← 01
Produces:  `export const galleryManifest` in `src/plugins/gallery/manifest.ts` ·
           `export const galleryPagePart: PagePart<typeof galleryManifest>` in `src/plugins/gallery/page/start.ts` ·
           `export function nextTransparency(overridden: 'full' | 'reduced' | null): 'full' | 'reduced';` in `src/plugins/gallery/page/transparency-toggle.ts` ·
           `export const testShellLayout: ShellLayout` in `src/plugins/gallery/page/test-shell-layout.ts` ·
           in `src/contracts/plugin.ts`:
           `export interface PageTransparency { override(transparency: 'full' | 'reduced' | null): void; overridden(): 'full' | 'reduced' | null }` and
           `PageApi.transparency: PageTransparency`
Decisions: see **Decisions** below
Tests:     `src/plugins/gallery/page/transparency-toggle.test.ts`:
           `goes to reduced from no override` — `nextTransparency(null)` → `'reduced'` ·
           `goes to full from reduced` — `nextTransparency('reduced')` → `'full'` ·
           `goes to reduced from full` — `nextTransparency('full')` → `'reduced'` ·
           `page-api.test.ts`'s `deps` gains a fake `transparency` (the new required dep); no new
           test there, since `createPageApi` hands the dep through unchanged
Done when: the gallery shows on `Space z g` with every primitive of 04 and 05 in every state below;
           `t` switches transparency in place without writing `settings.json`; `npm run typecheck`,
           `npm run lint` (check-layers and check-styles over `src/plugins/gallery/`) and `npm test`
           pass; `Space z s` swaps the shell to the test layout and back; `npm run selftest` passes with the steps below and saves the screenshots
           named there (`gallery-<n>-full` and `gallery-<n>-reduced` for every page, `shell-layout-test`, `sessions-*`, `docs-*`); the visual checks are 08's
Commit:    one commit for the group

## Decisions

- **Plugin shape** (plan.md, AGENTS.md § Architecture): page part only, as `keys` is. The
  manifest joins the end of `manifests` in `src/plugins/manifests.ts`, the page part the end of
  `pageParts` in `src/plugins/page.ts`, so the Gallery mode is added last and its activity-bar icon
  sits last. `scripts/check-layers.mts` gains `src/plugins/gallery` (layers `src/contracts`,
  `src/shared`) and `src/plugins/gallery/page` (layers `src/contracts`, `src/shared`,
  `src/shared/page`, the `src/shared/page/ui` layer as `LAYERS` names it after plan A,
  `src/plugins/gallery`), and `src/plugins/gallery` joins the lists of `src/plugins/manifests.ts`,
  and `src/plugins/gallery` with `src/plugins/gallery/page` those of `src/plugins/page.ts`.
- **Plugin pages import primitives** (lead decision): the same edit adds `src/shared/page/ui` to the
  `layers` of every plugin `page/` layer `LAYERS` holds (`src/plugins/chat/page`, `docs/page`,
  `forms/page`, `keys/page`, `sessions/page`, and the gallery's) and of the `src/shared/page` layer,
  so plan C's surfaces import primitives with no layer edit. Re-read the file when this lands: add
  to every `src/plugins/<id>/page` entry that exists then.- **No main part, no script of its own** (drafter): a self-test script is handed from a main part
  (`MainServices.selfTest`), and its `open` must log a shown line, which the gallery has no fixture
  to give. Its steps join forms' script and docs' script, whose fixtures give Sessions and Docs
  modes real content, as the keys plugin's steps live in forms' script (AGENTS.md § Running and
  testing). Task 07 adds that sentence for the gallery.
- **Manifest** (pinned):

  | Command | Label | Group | Key | Scope |
  |---|---|---|---|---|
  | `showMode` | `gallery` | `modes` | `[' ', 'z', 'g']` | `any` |
  | `toggleTransparency` | `switch transparency` | `gallery` | `['t']` | `gallery` |
  | `swapShellLayout` | `swap the shell layout` | `gallery` | `[' ', 'z', 's']` | `any` |
  | `scrollTop` | `scroll to the top` | `gallery` | `['g', 'g']` | `gallery` |
  | `scrollEnd` | `scroll to the end` | `gallery` | `['G']` | `gallery` |
  | `pageDown` | `scroll down a page` | `gallery` | `['d']` | `gallery` |

  `id: 'gallery'`, `dependsOn: []`, `scopes: { gallery: 'In the gallery' }`, no editor, app,
  global or intercept keys, `settings: {}`, `themeTokens: {}`. Every command runs in the page.
  Checked at plan time: no other bind starts with `Space z g` or is `Space z s` (`Space z l …` is forms', `Space z c …`
  chat's; re-check `src/config/keymap.ts` and every manifest when this lands), and no `any`-scope bind is `t`, `g`, `G` or `d` (chat's `G` is in `chat`; `d` is forms' in `forms` and docs' in `tree`, neither in `gallery`). No editor bind:
  the gallery is a debug view with no text box (drafter).
- **Shell layout swap** (deferred from plan A's review, finding 8): `mountShell`'s DOM behaviour —
  sorted insertion into alignment tracks, dispose, per-area `hidden`, `setLayout` moving live
  contributions, rollback on a bad layout, the restore guarded by generation — has no caller of
  `shell.setLayout` and no test, since vitest has no DOM. `swapShellLayout` (`Space z s`, a debug key
  under `Space z`) holds a `Disposable` field: with none held it calls `api.shell.setLayout(testShellLayout)`,
  keeps the result and logs `[gallery] shell layout swapped`; with one held it calls `dispose()`, clears
  the field and logs `[gallery] shell layout restored`. `testShellLayout` (`test-shell-layout.ts`,
  tokens only) mounts every `AreaName` with its tracks split by `AlignedArea` and a layout the default
  does not make (the status bar above the main area, the activity bar on the end side), so a
  contribution that fails to move shows in the screenshot. The gallery's `hidden` does not restore it:
  the swap lives until `Space z s` or a page load. The rollback and stale-generation paths stay
  unreached by the self-test; they need a layout that throws and a second `setLayout`, which this task
  does not add.
- **Mode** (drafter): `api.modes.add({ id: 'gallery', title: 'Gallery', icon: 'symbol-color',
  element, shown, hidden })`; `shown` sets the `gallery` scope; `hidden` does nothing; the handle's
  `setContext({ title: 'Gallery', detail: 'Every primitive in every state' })` runs once after `add`.
  No side bar: `showMode` shows the mode when it is hidden and does nothing when it shows. The
  modes registry logs `[page] showed Gallery mode` on each show.
- **Transparency override** (drafter): the gallery must not write `settings.json`, so the page core
  holds a session override, reached through a new `PageApi.transparency`:
  - `override(value)` holds the page's transparency at `full` or `reduced` until the page loads
    again; `null` hands it back to the `transparency` setting. `overridden()` returns the override
    in force, null for none.
  - `renderer.ts` keeps `transparencyOverride: 'full' | 'reduced' | null` (null at load) and the last
    `AppConfig` it applied. It reaches plan A's applier through `ThemeApplier.apply` only: both of
    plan A's calls — `applier.apply(config.theme, config.settings)` at start (plan A task 01) and
    `applier.apply(next.theme, next.settings)` on each push (plan A task 03) — pass
    `{ transparency: transparencyOverride ?? config.settings.transparency, fonts: config.settings.fonts }`
    as the settings argument. A call to `override` sets the field and calls `applier.apply` at once
    with the last config's theme and those settings. With an override in force the applier sees
    `full` or `reduced`, never `system`, so its OS reduced-transparency listener re-applies nothing
    until the override is cleared. Nothing else reads the override, so a settings change under an
    override keeps the override; a page reload drops it.
  - `PageApiDeps` gains `transparency: PageTransparency`, and `createPageApi` hands it to every
    plugin unchanged.
- **The switch's order** (drafter): `t` sets `nextTransparency(api.transparency.overridden())`:
  no override or `full` → `reduced`, `reduced` → `full`. It reads the override, not the OS, so the
  first press always lands on `reduced` and the self-test's lines are the same on every machine; a
  user whose setting already reduces transparency presses twice to see the change. Each press logs
  `[gallery] transparency <value>` (`reduced` or `full`) and updates the gallery's status line.
- **Scrolling**: the mode's element is a `div.gallery` holding, top to bottom, the transparency
  status line (a fixed row, outside the scrolling part, so every screenshot shows which
  transparency is in force), a `tabStrip` and a `sheet`; the sheet scrolls. The strip holds one
  `tab('Gallery', () => {})` with `is-active`. `scrollTop` calls `sheet.scrollTo({ top: 0, behavior:
  'instant' })` and logs `[gallery] scrolled to the top`; `scrollEnd` scrolls to `sheet.scrollHeight`
  the same way and logs `[gallery] scrolled to the end`; `pageDown` scrolls to `sheet.scrollTop +
  sheet.clientHeight` the same way and logs `[gallery] scrolled to <n>px`, `<n>` the sheet's
  `scrollTop` after the scroll, rounded. The self-test takes one screenshot per page, from the top
  until the end is reached (a `pageDown` that does not move the sheet is the end), so the gallery has
  as many pages as its sections make at the default window size; measure the page count when this
  lands. Sections are a CSS grid, `grid-template-columns: repeat(auto-fill, minmax(calc(var(--wg-row-list) * 12), 1fr))`,
  `gap: var(--wg-space-4)`, `padding: var(--wg-space-4)` (`var(--wg-space-3)` below 800px).
- **The gallery's look** (`gallery.css`, tokens only, checked by check-styles from the start):
  the status line, the fixed row above the strip — `Transparency: from settings` / `Transparency: full` /
  `Transparency: reduced`, then `kbd('t', platform)` and `switches` — in `text-12` `fg-secondary`;
  each section a `section.gallery-section` with a `sectionHeader` (the primitive's name) over
  `div.gallery-states`, a flex-wrap row (`gap: var(--wg-space-3)`) of `figure.gallery-cell`, each
  the sample over a `figcaption.gallery-caption` (the state's name, `text-11`, `fg-tertiary`).
  Frames that hold a split, a floating panel or a dialog are `div.gallery-frame` (`position:
  relative`, `height: calc(var(--wg-row-list) * 6)`, `border: 1px solid
  var(--wg-border-default)`, `border-radius: var(--wg-radius-md)`, `overflow: hidden`), and
  `.gallery-frame .ui-scrim { position: absolute }` keeps a shown dialog inside its frame. Each frame's section spans the full
  grid row (`grid-column: 1 / -1` on its `section.gallery-section`, the frame filling it), so the
  Split's 160/400 clamp is visible in a frame wider than 400px.

## What the gallery shows

Sentence-case sample copy, pinned; "live" is an unforced sample the mouse can try. Forced states
use the 04 convention (`is-hover`, `is-pressed`, `is-selected`, `is-active`, `is-cursor`,
`disabled` / `is-disabled`). Buttons have no focus state: they never take focus.

| Section | Cells |
|---|---|
| Materials | `material-chrome` strip, `material-chrome material-chrome--dense` strip, a `material-floating` panel — each holding the text `Chrome`, `Chrome, dense`, `Floating` |
| Kbd | `Space z g`, `<A-o>`, `<D-Enter>`, `j / k`, `1–9` — each `kbd(keys, api.platform)` with its keys as caption |
| Button | one row per variant (primary `Submit` with `kbd('<D-Enter>')`, secondary `Cancel round`, ghost `Close`, danger `Cancel the round`): live, hover, pressed, selected (secondary and ghost only), disabled |
| IconButton | `iconButton('send', 'Send', …)` and `iconButton('close', 'Close', …, 'sm')`: live, hover, pressed, active, disabled |
| Chip | `chip('Mode', 'default', …)`: live, hover, active, disabled; `chip('Effort', 'high', null)`: static |
| Tag | `Nit` neutral, `Recommended` accent, `Running` running, `Applied` success, `Minor` warning, `Needs you` attention, `Critical` error |
| StatusDot | idle, running, success, warning, attention, error, each captioned with its status |
| InputFrame | an `inputFrame()` holding a `span` with `Type a message` in `input-placeholder` (no editor, so no box takes the gallery's keys): default, hover, focus (`is-cursor`) |
| Row, list | `row({ density: 'list', label: 'selftest', detail: 'Needs you', leading: statusDot('attention'), trailing: tag('claude'), onClick })`: live, hover, selected, cursor, selected and cursor, disabled |
| Row, tree | `row({ density: 'tree', label, leading: icon('chevron-right') })` at depth 0 `Instructions`, 1 `CLAUDE.md`, 2 `style.md`; the second selected |
| Tabs | `tabStrip([tab('Form'), tab('Chat'), tab('Docs')])` over a `sheet()`: Form `is-active`, Chat `is-hover`; a click on a tab moves `is-active` to it |
| Split | in a frame: `createSplit({ uiState: api.services.uiState, stateKey: 'split', initial: 240, min: 160, max: 400 })`, the start pane three list rows, the end pane the text `Drag the line to resize; the width is kept.` |
| Card | `card()` default, `card()` with `is-cursor`, `card('attention')` holding `Allow once` / `Deny` buttons, `card('error')` |
| Collapsible card | `createCollapsibleCard` closed `summary: 'Bash  npm test', mono: true, leading: statusDot('running')`; open with `statusDot('success')` and a body `Tests passed`; closed `summary: 'Thinking'` |
| FloatingPanel | in a frame: `floatingPanel()` holding `sectionHeader('Space z')` and two list rows, `trailing` `kbd('g')` `Gallery` and `kbd('l')` `Layouts` |
| Dialog | in a frame: `createDialog('Cancel the round?')`, shown, body `The agent gets no answers.`, actions `textButton('Keep it')` and `textButton('Cancel the round', …, { variant: 'danger' })` |
| EmptyState | `emptyState('No sessions yet. Start one with', kbd('Space k n', platform))` |
| SectionHeader | `sectionHeader('Findings')`, `sectionHeader('Keys', kbd('Space ?', platform))` |

A click on a live sample logs nothing and changes nothing outside the gallery.

## Self-test steps

The Screenshot column is each step's `screenshot` value; 02 saves it as
`.selftest/screenshots/forms-<name>.png` or `docs-<name>.png` by the script's plugin. `<n>` counts
the gallery's pages from 1 and `N` is the last page, the count measured when this task lands; the
rows marked `× (N−1)` are written out once per page after the first, `d` each time, with the expect
`[gallery] scrolled to` (the line's start; its pixel number is the page's own).

Appended to the end of `STEPS` in `src/plugins/forms/main/selftest-script.ts` (Sessions mode then
shows the layout preview's sample round, every card kind), and the script's comment above `STEPS`
gains one sentence naming them:

| Keys | Expect | Screenshot |
|---|---|---|
| `[' ', 'z', 'g']` | `[page] showed Gallery mode` (with `checksFit: true`) | `gallery-1-full` |
| `['d']` × (N−1) | `[gallery] scrolled to` | `gallery-<n>-full`, n = 2…N |
| `['G']` | `[gallery] scrolled to the end` | — |
| `['t']` | `[gallery] transparency reduced` | `gallery-N-reduced` |
| `['g', 'g']` | `[gallery] scrolled to the top` | `gallery-1-reduced` |
| `['d']` × (N−1) | `[gallery] scrolled to` | `gallery-<n>-reduced`, n = 2…N |
| `[' ', 'k', 's']` | `[page] showed Sessions mode` | `sessions-reduced` |
| `[' ', 'z', 'g']` | `[page] showed Gallery mode` | — |
| `['t']` | `[gallery] transparency full` | — |
| `[' ', 'k', 's']` | `[page] showed Sessions mode` | `sessions-full` |
| `[' ', 'z', 's']` | `[gallery] shell layout swapped` | `shell-layout-test` |
| `[' ', 'z', 's']` | `[gallery] shell layout restored` | `shell-layout-restored` |

Appended to the end of `STEPS` in `src/plugins/docs/main/selftest-script.ts` (Docs mode shows the
fixture's tree with neat.md renamed), with a sentence in its comment:

| Keys | Expect | Screenshot |
|---|---|---|
| `[' ', 'z', 'g']` | `[page] showed Gallery mode` | — |
| `['t']` | `[gallery] transparency reduced` | — |
| `[' ', 'k', 'd']` | `[page] showed Docs mode` | `docs-reduced` |
| `[' ', 'z', 'g']` | `[page] showed Gallery mode` | — |
| `['t']` | `[gallery] transparency full` | — |
| `[' ', 'k', 'd']` | `[page] showed Docs mode` | `docs-full` |

The two last forms rows run in Sessions mode, whose title bar, activity bar, side bar and status bar
contributions the swap moves; `shell-layout-restored` is checked against `sessions-full` to prove the
restore. Forms' group leaves the override at `full`, so chat's script runs as before and docs' first `t`
lands on `reduced`. A reload starts with no override, as every run does. The switch from another
mode is: show the gallery, press `t`, show the mode again — no extra command.

## Proof

