# UI design plan B — primitives — plan

Feature: UI design rework · Implements: none · Ticket: none
Target: main · Written: 2026-10-21

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Give the app its look and its building blocks, on the foundation plan A landed:

- the JetBrains Mono font, the L0 backdrop, the `material-chrome` / `material-floating` helpers
  with the reduced-transparency path, and reduced motion (plan A gave Mocha the brief's values)
- the primitives `DESIGN.md` § Primitives calls for, in `src/shared/page/ui/`, limited to what the
  existing surfaces use
- the Gallery mode (`Space z g`), showing every primitive in every state, with a raw key that
  switches transparency
- self-test screenshot steps, and `scripts/check-styles.mts` in `npm run lint`

Plan C rebuilds every surface on these primitives.

## Architecture

Systems touched:

- **config** — `src/config/theme-tokens.ts` and `catppuccin-mocha.json` (`duration-instant`, for reduced motion)
- **shared/page/ui** — new primitives, each a builder with its CSS beside it; `materials.css`
- **renderer** — `index.css` (backdrop, base type, the JetBrains Mono faces)
- **contracts / main** — `SelfTestStep.screenshot`, `src/main/selftest.ts` saving PNGs
- **plugins** — new `src/plugins/gallery/` (manifest and page part, no main part), joined to
  `src/plugins/manifests.ts` and `src/plugins/page.ts`
- **scripts** — new `scripts/check-styles.mts`, joined to `npm run lint`

## Preconditions

| Claim | Command | Expected |
|---|---|---|
| Plan A has closed | `test -d docs/features/ui-design/plan-a-foundation && echo open` | prints nothing |
| Plan A's foundation is in the tree | `test -f src/contracts/disposable.ts && test -f src/main/config/config-store.ts && test -f src/shared/page/ui/icon.ts && test -f src/renderer/shell/shell-layout.ts && echo ok` | `ok` |
| `formatChord` and the served platform exist | `grep -n 'export function formatChord' src/shared/key-hints.ts; grep -n 'platform: Platform' src/contracts/settings.ts` | one line each |
| The core token registry exists | `test -f src/config/theme-tokens.ts && echo ok` | `ok` |
| Mocha holds the brief's values, the material tokens among them | `grep -c 'material-floating-bg' src/config/themes/catppuccin-mocha.json` | at least `1` |
| The approved font package resolves | `npm view @fontsource/jetbrains-mono version` | `5.3.0` measured at plan time, re-verify; a newer version is fine |
| No uncommitted source edits from another session | `git status --short src scripts` | prints nothing |

The user approved `@fontsource/jetbrains-mono` (weights 400, 500 and 600 only) for this plan
(interview round 1), so its install in task 01 is approved. No other package reaches the machine.

## Docs written ahead

Commit `e1f6b73` holds `DESIGN.md`, `AGENTS.md` and `docs/features/ui-design/design.md`; plan A's
doc re-read corrected them against plan A's code. Task 07 re-reads them against this plan's code.

## Mandatory Reads

- `AGENTS.md`
- `DESIGN.md`
- `docs/features/ui-design/design.md`

## Design Overview

```
catppuccin-mocha.json ──(ConfigStore, plan A)──► --wg-<role> on <html>
                                                  data-transparency="full|reduced"
        │
        ▼
src/shared/page/ui/
  materials.css   .material-chrome  .material-chrome--dense  .material-floating
                  (the only backdrop-filter in src/)
  icon.ts (plan A) · kbd.ts · button.ts · …   one builder + CSS each
        │                         │
        ▼                         ▼
  plan C surfaces            gallery plugin (Space z g)
                               every primitive × every state
                               raw key → transparency full ⇄ reduced
                               self-test screenshots ──► PNGs the agent checks against DESIGN.md
scripts/check-styles.mts (npm run lint): no raw colour, length, duration or font stack in CSS or
inline styles under src/, backdrop-filter only in materials.css; plan C's surfaces sit on a
legacy list a plain run skips (--no-legacy checks them) until plan C's final task deletes it
```

Decisions (interview; `design.md` holds the reasons):

- Primitives live in `src/shared/page/ui/`, one builder per primitive with its CSS beside it.
- Only primitives an existing surface uses are built; a later feature adds its own.
- Kbd draws every key hint through `formatChord(chord, platform)`.
- The gallery is a plugin with a mode on `Space z g` and a raw key in its scope that switches
  transparency.
- A self-test step can save a PNG of the window; the agent checks the PNGs against `DESIGN.md`, and
  the user does the final visual check.
- Every package is bundled by Vite; nothing loads from the network at run time.

Decided at plan time:

- **check-styles skips a legacy list.** Plan C rebuilds the surfaces, so their stylesheets still
  hold raw values when this plan lands. The script carries a named list of those files, skipped
  by a plain run. Plan C's surface tasks run in parallel, so none edits the list: each checks its
  own rebuilt files with `node scripts/check-styles.mts --no-legacy <path>…`, which checks only those files and
  ignores the list, and a listed file that now passes prints a note rather than failing; with file paths after the flag (`node scripts/check-styles.mts --no-legacy <path>…`) it judges only those files, so a plan C task runs it with its own rebuilt files' paths and exits 1 only on their violations. Plan C's
  final task deletes the list. New code under `src/shared/page/ui/`, `src/plugins/gallery/` and
  `src/renderer/shell/` is checked from the start.
- **Reduced motion reads a token.** CSS cannot hold a raw duration, so under
  `prefers-reduced-motion` the duration tokens are set to `var(--wg-duration-instant)`, a token task
  01 adds to the registry and Mocha.

Out of scope: the surfaces themselves and the key changes (plan C); the command palette, Latte,
native vibrancy (follow-ups).

## File Structure

### Shared names and signatures

Every primitive lives in `src/shared/page/ui/`, a builder with its CSS beside it. Plan C consumes
these exactly as spelled.

Convention for every primitive (task 04 pins it, 05 follows it): a builder returning an element is a
noun (`chip`), one returning a handle is `create<Name>`; classes are `ui-<name>` with modifiers
`ui-<name>--<variant>`; boolean states are `is-selected`, `is-active`, `is-cursor`, `is-disabled`
(a `<button>` uses its `disabled` property); enumerated values are `data-<name>` attributes;
`is-hover` and `is-pressed` exist so the gallery can draw those states at rest. A primitive that
shows a key hint takes a Kbd element or null; it never builds one.

```ts
// 04 — controls
export interface KbdPart { kind: 'key' | 'chord' | 'or'; text: string }            // kbd-parts.ts
export function kbdParts(keys: string): KbdPart[];
export function kbd(keys: string, platform: Platform): HTMLElement;                 // kbd.ts
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';           // button.ts
export interface TextButtonOptions { variant?: ButtonVariant; hint?: HTMLElement | null }
export function textButton(label: string, onClick: () => void, options?: TextButtonOptions): HTMLButtonElement;
export type IconButtonSize = 'sm' | 'md';                                           // icon-button.ts
export function iconButton(iconName: string, label: string, onClick: () => void, size?: IconButtonSize): HTMLButtonElement;
export function chip(label: string, value: string, onClick: (() => void) | null): HTMLElement; // chip.ts
export type TagTone = 'neutral' | 'accent' | 'running' | 'success' | 'warning' | 'attention' | 'error'; // tag.ts
export function tag(text: string, tone?: TagTone): HTMLElement;
export type DotStatus = 'idle' | 'running' | 'success' | 'warning' | 'attention' | 'error'; // status-dot.ts
export function statusDot(status: DotStatus): HTMLElement;
export function setDotStatus(dot: HTMLElement, status: DotStatus): void;
export function inputFrame(): HTMLElement;                                          // input-frame.ts

// 05 — containers
export type RowDensity = 'list' | 'tree';                                           // row.ts
export interface RowOptions { density: RowDensity; label: string; detail?: string | null; leading?: HTMLElement | null; trailing?: HTMLElement | null; depth?: number; tag?: 'div' | 'li'; onClick?: () => void }
export function row(options: RowOptions): HTMLElement;
export function tabStrip(tabs: readonly HTMLElement[]): HTMLElement;                // tabs.ts
export function tab(label: string, onSelect: () => void): HTMLButtonElement;
export function sheet(): HTMLElement;                                               // sheet.ts
export interface SplitLimits { initial: number; min: number; max: number }          // split-width.ts
export function clampSplitWidth(width: number, limits: SplitLimits): number;
export function storedSplitWidth(state: UiState, key: string, limits: SplitLimits): number;
export interface SplitOptions extends SplitLimits { uiState: UiState; stateKey: string } // split.ts
export interface Split { element: HTMLElement; start: HTMLElement; end: HTMLElement; width(): number; setStartHidden(hidden: boolean): void }
export function createSplit(options: SplitOptions): Split;
export type CardEdge = 'attention' | 'error';                                       // card.ts
export function card(edge?: CardEdge | null): HTMLElement;
export interface CollapsibleCardOptions { summary: string; mono?: boolean; leading?: HTMLElement | null; open?: boolean; body(): HTMLElement }
export interface CollapsibleCard { element: HTMLElement; isOpen(): boolean; setOpen(open: boolean): void }
export function createCollapsibleCard(options: CollapsibleCardOptions): CollapsibleCard;
export function floatingPanel(): HTMLElement;                                       // floating-panel.ts
export interface Dialog { element: HTMLElement; body: HTMLElement; actions: HTMLElement; setTitle(title: string): void; show(): void; hide(): void; isShown(): boolean } // dialog.ts
export function createDialog(title: string): Dialog;
export function emptyState(text: string, hint?: HTMLElement | null): HTMLElement;  // empty-state.ts
export function sectionHeader(text: string, trailing?: HTMLElement | null): HTMLElement; // section-header.ts

// 06 — src/contracts/plugin.ts
export interface PageTransparency { override(transparency: 'full' | 'reduced' | null): void; overridden(): 'full' | 'reduced' | null }
//   PageApi.transparency: PageTransparency  (page-only, until reload; never writes settings.json)

// 02 — src/contracts/plugin.ts, src/main/selftest-config.ts, src/main/selftest.ts
//   SelfTestStep.screenshot?: string   (PNG at `.selftest/screenshots/<plugin>-<name>.png`, git-ignored)
//   screenshotFiles(handed: readonly HandedScript[]): Map<SelfTestStep, string>
//   PRIMITIVE_ELLIPSIS_SELECTORS, withPrimitiveEllipsis(scrollsItself: readonly string[]): string[]
//     (selftest-config.ts; the driver adds the four primitive ellipsis selectors to every script's scrollsItself)
//   startSelfTest(…, screenshotFolder: string)

// 03 — scripts/style-rules.mts, scripts/check-styles.mts
//   StyleRule, StyleViolation, cssViolations(css, allowsBackdropFilter), inlineStyleViolations(fileName, source)
//   legacyListProblems(list: readonly string[], filesInSrc: ReadonlySet<string>, filesWithViolations: ReadonlySet<string>): { failures: string[]; notes: string[] }
//   parseStyleArguments(args, filesInSrc): { ignoreLegacy: boolean; paths: string[]; failures: string[] }
//   LEGACY_FILES: the files plan C still has to rebuild, skipped by a plain run; a listed file
//   that passes prints a note, never a failure; plan C's final task deletes the list
//   `node scripts/check-styles.mts --no-legacy [<path>…]`: ignores LEGACY_FILES; with paths it judges only
//   those files and exits 1 only on their violations, with none it judges every file
```

### New files

- `src/shared/page/ui/` — `materials.css` (01); `kbd-parts.ts`, `kbd.ts`, `button.ts`, `icon-button.ts`,
  `chip.ts`, `tag.ts`, `status-dot.ts`, `input-frame.ts`, each with its CSS (04); `row.ts`, `tabs.ts`,
  `sheet.ts`, `split-width.ts`, `split.ts`, `card.ts`, `floating-panel.ts`, `dialog.ts`,
  `empty-state.ts`, `section-header.ts`, each with its CSS (05); tests beside them
- `src/plugins/gallery/` — `manifest.ts`, `page/start.ts`, `page/gallery-view.ts`, `page/gallery.css`,
  `page/transparency-toggle.ts` and `page/transparency-toggle.test.ts` (06)
- `scripts/check-styles.mts` (with its `--no-legacy` flag), `scripts/style-rules.mts`,
  `scripts/style-rules.test.mts` (03)

### Existing files modified

- `package.json` and `package-lock.json` (font package 01; lint script 03), `vitest.config.mts` and
  `tsconfig.json` (03)
- `index.html` CSP `font-src` (01), `src/renderer/renderer.ts` (01 imports; 06 the transparency
  override), `src/renderer/index.css` (01), `src/renderer/shell/shell.css` and any other file under
  `src/renderer/shell/` or plan A's `src/shared/page/ui/` files the style check fails (03, onto tokens)
- `src/config/theme-tokens.ts`, `src/config/themes/catppuccin-mocha.json` (01, `duration-instant`)
- `scripts/check-layers.mts` (01 the font package; 06 the gallery's layers and the ui layer for plugin pages)
- `src/contracts/plugin.ts` (02 `screenshot`, 06 `PageApi.transparency`), `src/renderer/plugins/page-api.ts`
  and `page-api.test.ts` (06)
- `src/main/selftest.ts`, `src/main/selftest-config.ts`, `src/main/selftest-config.test.ts`,
  `src/main/main.ts`, `.gitignore` (02)
- forms' `main/selftest-script.ts` (02 one screenshot; 06 the gallery and mode screenshots), docs'
  `main/selftest-script.ts` (06)
- `src/plugins/manifests.ts`, `src/plugins/page.ts` (06)
- `DESIGN.md` (01 the reduced-motion bullet; 07), `AGENTS.md`, `docs/features/ui-design/design.md` (07)

Files touched by two tasks sit in different waves: `package.json` (01, 03), `scripts/check-layers.mts`
(01, 06), `src/contracts/plugin.ts` (02, 06), `src/renderer/renderer.ts` (01, 06), forms'
`selftest-script.ts` (02, 06), `DESIGN.md` (01, 07). In wave 2, 03 fixes only files that exist
when it starts; 04's and 05's new files pass the style check as written.

### Boundary rules

- `scripts/check-layers.mts`'s `src/shared/page/ui` layer (added by plan A task 04) holds every
  primitive; plan B adds no layer for it. Task 06 adds `src/shared/page/ui` to the `layers` of every
  plugin `page/` layer and of the `src/shared/page` layer, so plan C's surfaces import primitives with
  no layer edit. `@fontsource/jetbrains-mono` is listed under the
  `src/renderer/renderer.ts` entry only.
- `backdrop-filter` appears only in `materials.css`, which check-styles enforces.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [JetBrains Mono, backdrop, materials and reduced motion](01-fonts-and-materials.md)
- [x] [Self-test screenshot steps](02-selftest-screenshots.md)

### Wave 2
- [x] [Style check in lint](03-check-styles.md) — after 01
- [x] [Primitives: key hints and controls](04-primitives-controls.md) — after 01
- [x] [Primitives: rows, tabs, sheets, splits and floating panels](05-primitives-containers.md) — after 01

### Wave 3
- [x] [Gallery mode](06-gallery.md) — after 02, 04, 05

### Wave 4
- [x] [Doc re-read](07-doc-re-read.md) — after 01–06

### Wave 5
- [x] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: ed5d846987f144614a41307b3783613533e761a8

### Groups
- 01 · d0ba3ee · proved (diff read, typecheck; worker: lint, test, selftest green) · concerns: none
- 02 · bd6455e · proved (diff read, typecheck; worker: lint, test, selftest green) · concerns: none; forms comment line over 80 columns after the edit (cosmetic, for review)
- 04 · 944722e · proved (diff read, typecheck; worker: test, check-layers, oxlint) · concerns: `.ui-input .cm-editor { background: transparent }` (0,2,0) may lose to the CodeMirror theme — check in 08; check-styles to run over 04 files after 03 lands
- 05 · 9927864 · proved (diff read, typecheck; worker: test, lint) · concerns: `.ui-scrim[hidden] { display: none }` duplicates `index.css`'s global `[hidden]` !important rule; a layout read per `pointermove` in `split.ts`; check-styles to run over 05 files after 03 lands
- 03 · 1fd6472 · proved (diff read, typecheck, lint; `--no-legacy` over every 04/05 file clean; worker: test 1868) · concerns: none
- 06 · ff715d2 · proved (diff read, typecheck, lint; worker: test 1871, selftest green, N = 6) · concerns: seven leftover forms toasts stack over the right of every gallery and shell-layout screenshot, hiding part of IconButton and Kbd; the pinned frame height (`row-list * 6`, 168px) clips the dialog; IconButton cells cramped; the `d` steps expect exact pixel lines, brittle to layout change
- 07 · 833cf9e · proved (diff read, lint) · concerns: global `:focus-visible { box-shadow: var(--wg-focus-ring) }` is a second focus-ring form beside the inset `focus-border` ring DESIGN.md calls the one ring; AGENTS.md lines over the wrap width
### Contract changes
### Rulings
- Screenshot paths and the fit-check list enter the chain in `runScript` (the doc said `startRun`), where the script's list already enters — tree shape — cost if wrong: none · group 02
- A failed capture fails the step and skips its fit check; a step whose line never came still saves its screenshot — Decisions line — cost if wrong: one line · group 02
- `saveScreenshot` adds a third failure reason, `the page produced no frames`, when the redraw wait times out — never capture a half-drawn frame — cost: one message · group 02
- The font package was installed by the user (`npm install` is deny-listed for agents); the worker only imported it — no behaviour change · lead
- Two one-line comments added in `index.css` (the html backdrop, the `!important` reason); DESIGN.md's Durations bullet left unchanged, only Reduced motion names `duration-instant` — cost if wrong: one line · group 01
- Disabled beats hover and press (`:not(:disabled)` on every hover/press rule) and comes after `is-selected`; a disabled primary's hint reads `fg-disabled` — the plan was silent — cost: gallery state priority differs from intent · group 04
- Chip gets `gap: var(--wg-space-1)` between label and value, and `is-active` keeps its fill under hover — the plan gave neither — cost: one rule · group 04
- `kbdParts` reads any `<…>` with no inner angle brackets as a chord (`<Space>` too; `formatChord` returns it unchanged) — cost: none visible · group 04
- A selected or disabled row takes no hover (`.ui-row:not(.is-disabled, .is-selected):hover`) — the plan named both backgrounds, not which wins — cost: one selector · group 05
- UA resets added to `.ui-tab`, `.ui-collapsible-head`, `.ui-empty`, `.ui-dialog-title`; collapsible mono is the modifier `ui-collapsible-summary--mono`; `is-start-hidden` sets the grid to one column — the plan was silent — cost: gallery look only · group 05
- Transitions (`duration-fast` / `ease-out`) on row, tab, collapsible head and split line, per the 04 convention — cost: none · group 05
- `LEGACY_FILES` is the doc's eight, re-measured; every violation in them is `raw-length` · group 03
- `.shell-side-bar[data-side-bar='over']` box-shadow blur `1rem` (not in the fix table) → `var(--wg-space-4)` — the doc's rule for values outside the table — cost: none · group 03
- A bad argument prints its failures and exits 1 before judging anything — never fall back to judging every file on a typo — cost: none · group 03
- `raw-duration` is case-sensitive as tabled; inline writes are judged by running their CSS text through `cssViolations`, which also catches `webkitBackdropFilter` · group 03
- Gallery page count N = 6 at the self-test window (sheet 521px, scrollHeight 2857px) · group 06
- `d` step expects carry the exact pixel (`[gallery] scrolled to 521px` …): the driver matches whole lines, so the plan's "line's start" cannot pass — cost: a layout change breaks those steps until re-measured · group 06 — resolved by review finding 3 (a795b5b): `d` logs `paged down` / `reached the end`
- The gallery block opens the forms self-test, after `Space z l o` opens the layout preview, so no toast covers a gallery or Sessions shot; the later Option+Shift+i wrap lands on the preview and cancels it — cost: `forms-round.png` shows a fourth, unselected Layout preview row · fix a795b5b
- The `focus-ring` token is removed with the global ring's move to an outline; plan C 09's document-editor ring is now the inset `focus-border` outline (3a164f7) · fix 49e9f5b
- Settled by the agent under the user's word in the triage round ("take your suggestions for these and the remainder of this session"): re-review 2's test nit applied in b2c210c; step 8's deferred items decided by the agent, shown in the report · lead
- The plan's table saved `gallery-6-reduced` twice (the `t` step and the last reduced `d`); the driver forbids that, so the `t` step keeps it and the last `d` saves nothing — the view is identical · group 06
- The override wraps the `ThemeApplier` in `renderer.ts` (`overrideTransparency`), handed to both the start apply and `createConfigPush`; `config-push.ts` untouched — fact sheet: the push apply lives there — cost: none · group 06
- The test shell layout styles its areas with its own `gallery-test-*` classes plus the `material-chrome` helpers, not `shell.css`'s; frames get `isolation: isolate` so the scrim and floating panel stack inside them · group 06
### Review rounds
- 1 · 893d47b · NEEDS FIXES · report: 16 findings (4 Important), 2 applied by the lead in 34f20b7; 6 determined dispatched; 8 open to triage
- 2 (re-review) · a795b5b · NEEDS FIXES · prior findings all closed; 3 Minor: split stuck-drag guard (619e1f2), two comment wraps and the 08 count (lead, 2caf0f6)
- 3 (re-review) · 619e1f2 · NEEDS FIXES · prior findings closed; 1 Minor: split test picks the handle by build order — applied by the lead in b2c210c; fix cycles at their cap of 2
### Test gate
- Pass 1 (written in range): `scripts/style-rules.test.mts`, `src/main/selftest-config.test.ts`, `src/plugins/gallery/page/transparency-toggle.test.ts`, `src/renderer/plugins/page-api.test.ts`, `src/shared/page/ui/kbd-parts.test.ts`, `src/shared/page/ui/split-width.test.ts`; pass 2 (reference changed code): `src/main/built-in-themes.test.ts` (Mocha JSON), plus page-api and selftest-config again · every test in these 7 files references the changed code · 80 passed
- Final gate at b2c210c: `npm run typecheck` exit 0 · `npm run lint` exit 0 (styles: 276 files clean, 8 legacy) · `npm test` 133 files, 1895 passed · `npm run selftest` all passed, 19 screenshots
