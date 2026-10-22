# 01 — Chrome: title bar, activity bar, side bar, status bar, key bar, which-key, help

Status: done
Type: Task
Wave: 2 · Depends on: 02 (it removed the toast rules from `shell.css`)
Plan: [plan.md](plan.md)

Files:     modify `src/renderer/shell/shell.css` · modify `src/renderer/shell/shell-layout.ts` ·
           modify `src/plugins/keys/page/keys.css` · modify `src/plugins/keys/page/which-key-view.ts` ·
           modify `src/plugins/keys/page/help-view.ts` · modify `src/plugins/keys/page/key-bar-view.ts` ·
           modify `src/plugins/keys/page/key-bar.ts` ·
           modify `src/plugins/keys/page/start.ts` · modify `src/plugins/keys/page/help-sections.ts` ·
           test `src/plugins/keys/page/help-sections.test.ts` · test `src/plugins/keys/page/key-bar.test.ts` ·
           modify `src/plugins/keys/manifest.ts` · modify `src/shared/key-hints.ts` ·
           test `src/shared/key-hints.test.ts`
Consumes:  `kbd(keys: string, platform: Platform): HTMLElement` in `src/shared/page/ui/kbd.ts` ← plan B ·
           `row(options: RowOptions): HTMLElement` in `src/shared/page/ui/row.ts` ← plan B ·
           `floatingPanel(): HTMLElement` in `src/shared/page/ui/floating-panel.ts` ← plan B ·
           `createDialog(title: string): Dialog` in `src/shared/page/ui/dialog.ts` ← plan B ·
           `textButton(label: string, onClick: () => void, options?: TextButtonOptions): HTMLButtonElement` in `src/shared/page/ui/button.ts` ← plan B ·
           `iconButton(iconName: string, label: string, onClick: () => void, size?: IconButtonSize): HTMLButtonElement` in `src/shared/page/ui/icon-button.ts` ← plan B ·
           `sectionHeader(text: string, trailing?: HTMLElement | null): HTMLElement` in `src/shared/page/ui/section-header.ts` ← plan B ·
           `.material-chrome`, `.material-chrome--dense` in `src/shared/page/ui/materials.css` ← plan B ·
           `defaultShellLayout: ShellLayout` in `src/renderer/shell/shell-layout.ts` ← plan A ·
           `PageApi.platform: Platform` ← plan A ·
           `mountHelpView(…)` returning `setSections(sections: HelpSection[])`, `mountKeyBarView(…)` returning `{ render(): void }`,
           `formatVimToken(token: string, platform: Platform)`, `editorHints` unchanged ← plan A task 03 ·
           keys `themeTokens` `which-key-command`, `which-key-prefix` ← plan A task 01 ·
           `node scripts/check-styles.mts --no-legacy`: checks every file, ignoring LEGACY_FILES ← plan B task 03 ·
           the self-test's fit check treating the primitives' ellipsis parts (`.ui-row-label`, `.ui-row-detail`,
           `.ui-tab-label`, `.ui-collapsible-summary`) as allowed to clip ← plan B task 02 ·
           `src/shared/page/ui` in every plugin page layer in `scripts/check-layers.mts` ← plan B task 06
Produces:  `export function readVimKeys(keys: string, leader: string, platform: Platform): string` in `src/shared/key-hints.ts` ·
           `export function editorHints(editor: EditorKeymap, label: CommandLabel, platform: Platform): KeyHint[]` in `src/shared/key-hints.ts` (gains `platform`)
Decisions: see **Decisions** below
GIVEN an editor bind `<Leader>a<C-j>` and leader `<Space>` WHEN read for `macos` THEN its hint keys are `Space a ⌃J`
GIVEN editor binds `<Leader>1` … `<Leader>3` with one label WHEN hinted THEN they read `Space 1–3`
GIVEN an insert-mode remap `jk` WHEN help lists it THEN its keys read `j k`
Tests:     see **Tests** below
Done when: compiles; `npm run typecheck`, `npm run lint`, `npm test` (the tests below among them) and `npm run selftest` pass;
           `node scripts/check-styles.mts --no-legacy 2>&1 | grep -E 'src/(renderer/shell|plugins/keys)/'` prints nothing;
           `grep -rn "element('kbd'" src/plugins/keys` prints nothing;
           `grep -rn 'dialog.css' src/plugins/keys` prints nothing; this task's live checks are in
           [12 — Final verification](12-final-verification.md)
Commit:    one commit

## Decisions

- Title bar, activity bar and status bar take `material-chrome`; the side bar takes `material-chrome
  material-chrome--dense` (DESIGN.md § Layers, § Surfaces). The classes are added by the default layout's
  `mount` in `shell-layout.ts`, not copied into `shell.css`: a replaced layout chooses its own material, and
  `backdrop-filter` stays in `materials.css` (plan A: the layout places areas; plan B: the material helpers).
- Each L1 surface draws one hairline in `var(--wg-material-chrome-edge)` (Mocha aliases it to `border-subtle`)
  on its edge toward the content: title bar bottom, activity bar right, side bar right, status bar top
  (DESIGN.md § Space: hairlines on L1 edges). Nothing else in the chrome draws a border.
- The side bar area pads its content `var(--wg-space-1)`, so a list's rounded `radius-sm` hover and selection
  fills sit inset; the sessions list (03) and the docs tree (08) add no padding of their own (drafter).
- The side bar laid over the content below 680px (plan A's `data-side-bar='over'`) keeps its glass and hairline
  and gains no shadow: shadows belong to L3 (DESIGN.md § Space) (drafter).
- Activity items keep plan A's `activity-item` button and mark; hover adds `background:
  var(--wg-button-ghost-hover)` (DESIGN.md § Layers: a control on glass is a plain hover fill). `activity-bar.ts`
  does not change.
- Status bar: `min-height: var(--wg-statusbar-height)`, `font-size: var(--wg-text-12)`, `color:
  var(--wg-fg-secondary)`, `align-items: center`; it keeps `flex-wrap: wrap` so a narrow window wraps items onto
  a second line (the self-test's minimum-width fit check), and `--wg-status-bar-height` keeps publishing the real
  height (tree: `shell.ts`).
- The config problem item (`.status-error` in `shell.css`; find its element in `renderer.ts` after plan A) draws
  on the status bar's material: it loses its own `background`, `border-top`, mono family and mono size, keeps
  `color: var(--wg-status-error)`, and pads `0 var(--wg-space-3)` (DESIGN.md § Surfaces: status colours on status
  items; § Type: a message is not mono).
- `.toasts`, `.toast` and `.toast[data-tone=…]` already left `shell.css` in task 02 (wave 1), which rebuilt
  toasts in `src/renderer/toasts.css` beside `toasts.ts`; this task adds no toast rule.
- **Key bar:** each hint is `span.keys-bar-hint` holding `kbd(hint.keys, platform)` then `span.keys-bar-label`
  (the label, UI font, `text-12`, `fg-secondary`); hints sit `column-gap: var(--wg-space-3)`, `row-gap: 0`. The
  bar loses its background, border, mono family and padding but `0 var(--wg-space-2)` (the status bar draws the
  material). The `Keys` text button becomes `iconButton('record-keys', 'Keys', openHelp, 'sm')` — square
  `icon-button-sm` (24px), which fits `statusbar-height`; a text button at `leading-ui` does not (drafter).
  `record-keys` is the icon VS Code's keybindings editor uses.
- **Which-key** is a `floatingPanel()` with class `which-key`, docked above the status bar: `position: fixed`,
  `left` and `right` `var(--wg-sheet-gutter)`, `bottom: calc(var(--wg-status-bar-height) +
  var(--wg-sheet-gutter))`, `max-height: 50vh`, `overflow: hidden`, `z-index: calc(var(--wg-z-dialog) + 1)` (it
  shows over an open dialog, as today's `z-index: 11` over the backdrop's `10`), `pointer-events: none
  !important` (display only, as today). Its title is `sectionHeader(model.title)`; its entries are rows in
  `div.which-key-list` with `columns: calc(var(--wg-space-8) * 7)` (224px, today's `14rem`) and `column-gap:
  var(--wg-space-4)`, each row `break-inside: avoid`.
- **Which-key rows:** `row({ density: 'list', label: entry.label, trailing: kbd(entry.keys, platform) })`, plus
  class `which-key-row` and `is-<entry.kind>` (`is-command` / `is-prefix`); the hint sits right in the row's
  trailing slot, `fg-tertiary` (DESIGN.md § Surfaces: floating rows, hints right-aligned in `fg-tertiary`). The
  `→` arrow goes.
- **Which-key colours:** `.which-key-row.is-command .ui-row-label` reads `var(--wg-keys-which-key-command)` and
  `.is-prefix` `var(--wg-keys-which-key-prefix)`; the keys manifest's defaults change from
  `var(--wg-status-success)` to `var(--wg-fg)` and from `var(--wg-accent)` to `var(--wg-fg-secondary)`: green
  and mauve meant no status and no selection, and DESIGN.md § Colour allows nothing else at rest; the tokens stay,
  so a theme may still colour them (drafter).
- **Help** is `createDialog('Keys')`, its `element` contributed to `overlay`; `show`/`hide` call the dialog's.
  `dialog.body` holds `div.keys-help-sections` (`display: grid`, `gap: var(--wg-space-4) var(--wg-space-6)`,
  `grid-template-columns: repeat(auto-fit, minmax(min(calc(var(--wg-space-8) * 8), 100%), 1fr))`); each section
  is `section.keys-help-section` holding `sectionHeader(section.title)` and `ul.keys-help-list` (no list style, no
  margin or padding) of `row({ density: 'list', label: hint.label, trailing: kbd(hint.keys, platform), tag: 'li'
  })`. `setSections` replaces the grid's children. The dialog widens for help:
  `.ui-dialog:has(> .ui-dialog-body > .keys-help-sections) { width: min(100%, calc(var(--wg-space-8) * 28)); }`
  (896px, today's `56rem`) — the dialog's own width is `prose-measure` (plan B), too narrow for the grid
  (drafter).
- **Help's Close** is `textButton('Close', close, { variant: 'secondary', hint })` in `dialog.actions`, `hint`
  being `kbd(<keys>, platform)` for `keysFor(keys.keymap(), qualify('keys', 'closeHelp'), qualify('keys',
  'help'), platform)` or null when unbound (AGENTS.md: a control shows its command's key, none when unbound).
  `mountHelpView` gains a last parameter `closeHint: () => HTMLElement | null`, read on each `setSections`, so a
  rebind reaches the button.
- **Editor hints are read as space-separated keys** so Kbd can split them: `readVimKeys(keys, leader, platform)`
  is `vimTokens(keys, leader).map((token) => formatVimToken(token, platform)).join(' ')`. `editorHints` maps each
  bind's keys through it (gaining `platform`), and help's remap section reads `readVimKeys(remap.keys,
  keymap.editor.leader, platform)` in place of `withLeader`. A digit run still merges: `joinKeys` reads `Space 1`,
  `Space 2`, `Space 3` as `Space 1–3` (tree: its `DIGIT_SUFFIX` takes everything before the last digit as the
  prefix). Plan B's Kbd notes left this conversion to plan C. `chordName` and the app and system accelerators stay
  as written: Kbd draws a token with no `<…>` as written.
- No chrome surface shows an empty state today (checked: which-key opens only with entries, help always holds
  the core's sections, the key bar may be empty and shows only the Keys button). This task adds no `emptyState`.

## `shell.css` after this task

Find each rule by its selector (plans A and B rewrote the file). Change only these:

| Selector | Change |
|---|---|
| `.shell-title-bar` | add `border-bottom: 1px solid var(--wg-material-chrome-edge)` |
| `.title-bar-context-title` | add `font-weight: var(--wg-weight-medium)` |
| `.shell-activity-bar` | drop any `background`; `border-right: 1px solid var(--wg-material-chrome-edge)` |
| `.activity-item:hover` (with plan A's `color`) | add `background: var(--wg-button-ghost-hover)` |
| `.shell-side-bar` | drop any `background`; `border-right: 1px solid var(--wg-material-chrome-edge)`; `padding: var(--wg-space-1)` |
| `.shell-status-bar` | `align-items: center`, `color: var(--wg-fg-secondary)`, `font-size: var(--wg-text-12)`, `min-height: var(--wg-statusbar-height)`, `border-top: 1px solid var(--wg-material-chrome-edge)` |
| `.shell-panel` | `border-top: 1px solid var(--wg-material-chrome-edge)` in place of today's border colour |
| `.status-error` | as **Decisions** says |

## `shell-layout.ts`

`defaultShellLayout.mount` sets the area classes: `shell-title-bar material-chrome`, `shell-activity-bar
material-chrome`, `shell-side-bar material-chrome material-chrome--dense`, `shell-status-bar material-chrome`; the
other areas keep theirs. Its file imports nothing new: `materials.css` is imported once by `renderer.ts` (plan B).

## `keys.css` after this task — every rule

| Selector | Declarations |
|---|---|
| `.which-key` | the docked placement in **Decisions** |
| `.which-key-list` | `columns`, `column-gap` as in **Decisions** |
| `.which-key-row` | `break-inside: avoid` |
| `.which-key-row.is-command .ui-row-label` | `color: var(--wg-keys-which-key-command)` |
| `.which-key-row.is-prefix .ui-row-label` | `color: var(--wg-keys-which-key-prefix)` |
| `.ui-dialog:has(> .ui-dialog-body > .keys-help-sections)` | the width in **Decisions** |
| `.keys-help-sections` | the grid in **Decisions** |
| `.keys-help-list` | `list-style: none`, `margin: 0`, `padding: 0` |
| `.keys-bar` | `align-items: center`, `column-gap: var(--wg-space-3)`, `display: flex`, `flex: 999 1 calc(var(--wg-space-8) * 6)`, `flex-wrap: wrap`, `min-width: 0`, `padding: 0 var(--wg-space-2)` |
| `.keys-bar-hint` | `align-items: baseline`, `display: inline-flex`, `gap: var(--wg-space-1)` |
| `.keys-bar-label` | `font-size: var(--wg-text-12)`, `color: var(--wg-fg-secondary)` |

`flex: 999 1 12rem` becomes `calc(var(--wg-space-8) * 6)` (192px = 12rem). `start.ts` drops `import
'../../../shared/page/dialog.css'`; each view file imports nothing CSS beyond the primitives it uses (each
primitive imports its own CSS).

## Views

| File | Member | Now | After |
|---|---|---|---|
| `which-key-view.ts` | `mountWhichKeyView` | `(overlay)`; a `div.which-key` of `kbd` → label entries | `(overlay: Area, platform: Platform)`; the floating panel and rows in **Decisions**; `show` replaces the title and rows, `hide` sets `hidden` |
| `help-view.ts` | `mountHelpView` | backdrop + `.dialog` + `dl` grid + Close `button` | `createDialog`, sections and Close as in **Decisions**; gains `platform: Platform` and `closeHint` |
| `key-bar-view.ts` | `mountKeyBarView` | `span.key-hint` with `<kbd>`, `Keys` text button | hints and icon button as in **Decisions**; `KeyBarDeps` gains `platform: Platform` |
| `key-bar.ts` | `barHints` | calls `editorHints({ ...keymap.editor, binds }, label)` | passes its `platform` (plan A task 03 gave `barHints` the last parameter `platform: Platform`, from `PageApi.platform`) on to `editorHints` |
| `start.ts` | `start` | — | passes `api.platform` to the three views and `closeHint` to help |

## Tests

`src/shared/key-hints.test.ts` (each builds its own keymap):

- `readVimKeys spells the leader and splits tokens` — `readVimKeys('<Leader>a<C-j>', '<Space>', 'macos')` →
  `'Space a ⌃J'`; `readVimKeys('<CR>', ',', 'windows')` → `'Enter'`; `readVimKeys('jk', '<Space>', 'macos')` →
  `'j k'`
- the two `editorHints` tests pass `'macos'` and expect `'Space j'`, `'Space 1–3'` and `'Enter'` in place of
  `'<Space>j'`, `'<Space>1–3'` and `'<CR>'`

`src/plugins/keys/page/help-sections.test.ts`: `helpSections_EditorRemapAndChordSections` expects `'Space w'`
and the remap's keys `'j k'` (label unchanged, `sends <Esc> in insert mode`); every other expectation built from
an editor bind's keys changes the same way. `key-bar.test.ts`: the in-box expectations read `'Esc'` in place of
`'<Esc>'`. No expectation built from page keys changes.

The views are DOM and judged on screen (the test environment is `node`).

## Self-test

No key changes in this task, so no step is added. The forms script's which-key steps (`[keys] which-key shows
Space`, `[keys] which-key closed`) and help steps must still pass unchanged.

## Live checks

Merged into [12 — Final verification](12-final-verification.md) § Chrome.

## Proof

Commit `85cfdd8`. Diff read against Decisions and the shell.css, shell-layout.ts and keys.css tables: materials, hairlines, which-key, help and key bar as specified; typecheck, lint, tests (1907) and the self-test's forms which-key and help steps pass. Concerns: the editor-hint conversion had already landed as `formatVimKeys` (lead ruling); the `record-keys` codicon is judged on screen; dialog.css keeps `.dialog-help` until task 10.
