# 02 — Floating: pickers, dialogs, toasts

Status: done
Type: Task
Wave: 1 · Depends on: none (plans A and B closed)
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/list-picker.ts` · create `src/shared/page/list-picker.css` ·
           modify `src/shared/page/dialog.css` (its list picker rules leave) · modify `src/renderer/toasts.ts` ·
           create `src/renderer/toasts.css` · modify `src/renderer/shell/shell.css` (its toast rules leave; 01 owns
           the rest of the file in wave 2)
Consumes:  `floatingPanel(): HTMLElement` in `src/shared/page/ui/floating-panel.ts` ← plan B ·
           `row(options: RowOptions): HTMLElement` in `src/shared/page/ui/row.ts` ← plan B ·
           `inputFrame(): HTMLElement` in `src/shared/page/ui/input-frame.ts` ← plan B ·
           `statusDot(status: DotStatus): HTMLElement`, `type DotStatus` in `src/shared/page/ui/status-dot.ts` ← plan B ·
           `createDialog(title: string): Dialog` in `src/shared/page/ui/dialog.ts` ← plan B (named for the plugin tasks; this task builds none) ·
           `ToastTone = 'success' | 'info' | 'error'` in `src/contracts/plugin.ts` ← tree ·
           the toast layer `div.toasts` contributed to `overlay` by `src/renderer/renderer.ts` ← tree ·
           `--wg-status-bar-height` published by `src/renderer/shell/shell.ts` ← tree ·
           `node scripts/check-styles.mts --no-legacy`: checks every file, ignoring LEGACY_FILES ← plan B task 03 ·
           the self-test's fit check treating the primitives' ellipsis parts (`.ui-row-label`, `.ui-row-detail`,
           `.ui-tab-label`, `.ui-collapsible-summary`) as allowed to clip ← plan B task 02 ·
           `src/shared/page/ui` in the `src/shared/page` layer in `scripts/check-layers.mts` ← plan B task 06
Produces:  `createListPicker(deps: ListPickerDeps): ListPicker` in `src/shared/page/list-picker.ts`, signature and
           `ListPickerDeps` / `ListPicker` / `ListPickerRequest` members unchanged; `overlayClass` and `dialogClass`
           keep their names with the meanings in **Decisions** ·
           `createToasts(layer: HTMLElement, timers: Timers): { show(text: string, tone: ToastTone): void }` in `src/renderer/toasts.ts`, unchanged
Decisions: see **Decisions** below
GIVEN a picker open WHEN the user clicks the layer outside its panel THEN it cancels, as `cancel()` does
GIVEN a toast of tone `info` WHEN shown THEN it carries no status dot
Tests:     none new: the picker's logic is `list-picker-state.ts`, already tested; the rest is DOM, judged on screen
Done when: compiles; `npm run typecheck`, `npm run lint`, `npm test` and `npm run selftest` pass (chat's and docs'
           picker steps logging `picker shown: <title>` among them);
           `node scripts/check-styles.mts --no-legacy 2>&1 | grep -E 'src/shared/page/list-picker|src/renderer/toasts'` prints nothing;
           `grep -n 'list-picker' src/shared/page/dialog.css` and `grep -n 'toast' src/renderer/shell/shell.css`
           print nothing; this task's live checks are in [12 — Final verification](12-final-verification.md)
Commit:    one commit

## Decisions

- **A picker is floating, not a dialog** (DESIGN.md § Surfaces: pickers use the floating material; dialogs sit
  over the scrim): no scrim, `radius-lg` from `floatingPanel()`.
- **The layer.** `element` (the `ListPicker` member the caller places) is `div.ui-picker-layer`, plus
  `deps.overlayClass` when it is not `''`: `position: absolute; inset: 0; display: grid; justify-items: center;
  align-items: start; padding: var(--wg-space-8) var(--wg-space-4); z-index: var(--wg-z-floating)`. Absolute fills
  whatever the caller placed it in: the shell's fixed `overlay` area (chat) or a positioned docs view (docs). The
  panel is anchored at the top, so filtering never moves it (drafter: a centred panel jumps as its list shrinks).
  The layer stays transparent and takes the pointer; a `click` whose target is the layer itself runs `cancel()`,
  and its `mousedown` prevents the default so focus stays where it was (drafter: with no scrim, a click on nothing
  that does nothing reads as broken).
- **The panel.** `floatingPanel()` plus `ui-picker` and `deps.dialogClass` when not `''`; `role="dialog"`,
  `aria-label` the request's title. Flex column, `gap: var(--wg-space-1)`, `width: min(100%,
  calc(var(--wg-space-8) * 14))` (448px, the `28rem` chat's and docs' pickers set today), `max-height: 100%`. It
  holds `h2.ui-picker-title` (`margin: 0`, `padding: var(--wg-space-1) var(--wg-space-2) 0`, `font-size:
  var(--wg-text-12)`, `font-weight: var(--wg-weight-semibold)`, `color: var(--wg-fg-secondary)`), then the filter
  frame when given, then the list.
- **The filter box** is `inputFrame()` plus class `ui-picker-filter`, handed to `filterEditor.create` as today's
  `div.list-picker-filter` is; its `contains(document.activeElement)` test is unchanged.
- **The list** is `ol.ui-picker-list`: `list-style: none`, `margin: 0`, `padding: 0`, `max-height: 50vh`,
  `overflow-y: auto`. Each visible item is `row({ density: 'list', label: state.labels[index], tag: 'li',
  onClick })`, `onClick` setting the cursor to that index and calling `choose()`, as today's click does (the row
  already prevents the `mousedown` default). The row's `title` attribute is its label, since a row ends in an
  ellipsis where today's item wrapped (drafter). The cursor's row carries `is-selected` and `is-cursor`
  (DESIGN.md § Surfaces: the selected row takes `list-active-background`; the keyboard cursor adds the focus
  ring), and `draw` scrolls `.is-cursor` into view as today.
- **`ListPickerDeps` stays as it is** (plan.md: shared builders keep their signatures), so chat's `picker.ts` and
  docs' `docs-dialogs.ts` compile untouched: `overlayClass` is the caller's class on the layer and
  `dialogClass` the caller's class on the panel, each beside the picker's own. Chat passes `'overlay'` /
  `'chat-picker'` and docs `'docs-overlay'` / `'docs-picker'` today; until wave 2 chat's layer still carries
  dialog.css's `.overlay` scrim. Tasks 06 and 08 set `overlayClass: ''` and `dialogClass: ''` at their call
  sites and drop their `.chat-picker` / `.docs-picker` width rules (plan.md).
- **`list-picker.css`** holds every rule above and is imported by `list-picker.ts`, after the primitives it
  imports. `dialog.css` loses `.list-picker-list`, `.list-picker-filter + .list-picker-list`,
  `.list-picker-filter .cm-editor`, `.list-picker-item`, `:hover` and `.is-cursor`, and their comment; the rest of
  `dialog.css` stays until its last user converts (below).
- **`shell.css`** loses `.toasts`, `.toast`, `.toast[data-tone='success']` and `.toast[data-tone='error']`, so
  no two rule sets style a toast; nothing else in `shell.css` changes here (01 restyles the chrome in wave 2).
- **Toasts.** Each toast is `floatingPanel()` plus class `toast`, `data-tone`, `role="status"`: a leading status
  dot, then `span.toast-text` holding the text. The dot is `TOAST_DOTS[tone]`, a `Record<ToastTone, DotStatus |
  null>` in `toasts.ts`: `success` → `'success'`, `error` → `'error'`, `info` → `null` (no dot). A dot keeps the
  floating material's own edge and shadow, where a 2px status edge would replace its `box-shadow` (drafter;
  DESIGN.md § Colour: status as a small mark, and an info note carries no status). The toast's timing (4000 ms)
  and newest-last order stay.
- **`toasts.css`**, imported by `toasts.ts` after `floating-panel.ts`:
  - `.toasts`: `position: fixed; right: var(--wg-space-4); bottom: calc(var(--wg-status-bar-height) +
    var(--wg-space-4)); display: flex; flex-direction: column; align-items: flex-end; gap: var(--wg-space-2);
    z-index: var(--wg-z-toast)` — above dialogs, below nothing; the runtime status bar height keeps toasts
    clear of a wrapped status bar
  - `.toast`: `display: flex; align-items: center; gap: var(--wg-space-2); max-width:
    min(calc(var(--wg-space-8) * 12), calc(100vw - var(--wg-space-8))); padding: var(--wg-space-2)
    var(--wg-space-3); font-size: var(--wg-text-13)`
  - `.toast-text`: `min-width: 0; overflow-wrap: anywhere`

## Retiring `dialog.css` — every user, for the task that converts it

Each plugin's dialogs move onto `createDialog` and its buttons onto `textButton` in that plugin's task
(plan.md); each of those tasks drops its `import '../../../shared/page/dialog.css'`. Measured at plan time,
re-verify with `grep -rn "dialog.css\|'overlay'\|'dialog \|dialog-title\|dialog-text\|dialog-actions\|'button\b\|button-primary\|button-danger\|key-hint\|appendKeys\|overlayClass" src`:

| Task | File | Uses |
|---|---|---|
| 01 | `src/plugins/keys/page/help-view.ts`, `start.ts` | `.overlay`, `.dialog dialog-help`, `.dialog-title`, `.button` Close; the import |
| 04 | `src/plugins/forms/page/forms-view.ts` | the cancel confirm: `.overlay`, `.dialog dialog-confirm`, `.dialog-title`, `.dialog-text`, `.dialog-actions`, `button button-danger`, `button`; `appendKeys` |
| 04 | `src/plugins/forms/page/round-view.ts` | Submit `button button-primary`, Cancel round `button`; `appendKeys` (rail, review) |
| 04 | `src/plugins/forms/page/kinds/card-parts.ts`, `layout/card-kit.ts` | `appendKeys` (choices, toggles, Accept, action picks) |
| 04 | `src/plugins/forms/page/forms.css` | `.rail-item .key-hint`, `.toggle .key-hint` |
| 04 | `src/plugins/forms/page/start.ts` | the import |
| 06 | `src/plugins/chat/page/chat-dialogs.ts` | the reason dialog and the end-session confirm: `.overlay`, `.dialog chat-reason`, `.dialog dialog-confirm`, `.dialog-title`, `.dialog-text`, `.dialog-actions`, `button button-danger`, `button`; `appendKeys` |
| 06 | `src/plugins/chat/page/chat-kit.ts` | Allow `button button-primary`, Deny `button`; `appendKeys` |
| 06 | `src/plugins/chat/page/picker.ts` | `overlayClass: 'overlay'` |
| 06 | `src/plugins/chat/page/chat.css`, `start.ts` | `.chat-picker`, `.chat-reason` widths; the import |
| 08 | `src/plugins/docs/page/docs-dialogs.ts` | `.dialog docs-box-dialog`, `.dialog docs-confirm`, `.dialog-title`; picker `overlayClass: 'docs-overlay'`, `dialogClass: 'docs-picker'` |
| 08 | `src/plugins/docs/page/docs.css`, `start.ts` | `.docs-overlay` (its own scrim), `.docs-picker` width; the import |

`src/shared/page/dialog.css` itself, `appendKeys` in `src/shared/page/dom.ts` and the global `kbd` rule in
`src/renderer/index.css` (it styles only the raw `<kbd>` hints these files draw) are deleted by task 10 (wave 5),
once every user above has converted in wave 2. `dialog.css` stays on `LEGACY_FILES` until then.

## Live checks

Merged into [12 — Final verification](12-final-verification.md) § Floating.

## Proof

Commit `cd87ae7`. Diff read against Decisions: layer, panel, rows, filter frame, toasts and both stylesheets as specified; typecheck, lint, tests (1895) and the self-test (chat's and docs' picker steps among them) pass. Concerns: chat's and docs' layers still carry `.overlay` / `.docs-overlay` until 06 and 08; the `statusbar-height` theme token may now be unread.
