# 01 — Toasts through the shell layout

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/renderer/shell/layouts/layout.d.ts` · modify `src/renderer/shell/layouts/default/layout.js` ·
           modify `src/renderer/shell/layouts/default/layout.css` · modify `src/renderer/shell/read-shell-layout.ts` ·
           modify `src/renderer/shell/shell-chrome.ts` · modify `src/renderer/toasts.ts` · modify `src/renderer/toasts.css` ·
           modify `src/renderer/renderer.ts` · create test `src/renderer/toasts.test.ts` ·
           test `src/renderer/shell/shell-chrome.test.ts` · create test `src/renderer/shell/layouts/layout.test-d.ts`
Consumes:  `createLayoutParts(...).draw(key, parent, build): DrawnPart<R>` (tree, `src/shared/page/layout-host/layout-parts.ts`) ·
           `floatingPanel()` and `openFloatingPanel(panel)` (tree, `src/shared/page/ui/floating-panel.ts`) ·
           `BaseKit.statusDot(parent, status)` and `BaseKit.el` (tree, `src/shared/page/layout-host/kit.d.ts`)
Produces:  in `src/renderer/shell/layouts/layout.d.ts`:
           `export type ToastTone = 'success' | 'info' | 'error';`
           `export interface ToastInput { text: string; tone: ToastTone }`
           `ShellKit` gains `floatingPanel(parent: HTMLElement): HTMLElement`
           `Layout` gains `toast?(parent: HTMLElement, input: ToastInput, kit: ShellKit): HTMLElement`
           in `src/renderer/shell/shell-chrome.ts`:
           `ShellChrome.drawToast(parent: HTMLElement, input: ToastInput): { element: HTMLElement; dispose(): void }`
           in `src/renderer/toasts.ts`:
           `export type DrawToast = (parent: HTMLElement, input: ToastInput) => { element: HTMLElement; dispose(): void };`
           `export function createToasts(layer: HTMLElement, timers: Timers, drawToast: DrawToast, log: (message: string) => void): { show(text: string, tone: ToastTone): void }`
Decisions: the layout draws the whole toast; the core sets `data-tone` and `role=status` on the returned root, fades it
           in with `openFloatingPanel` and removes it after `TOAST_MS` (round 1) · `createToasts` takes its draw as a
           parameter, so it names no layout and a test hands it a fake (design review) · `ShellKit` gains
           `floatingPanel`, as chat's composer kit has it, so a layout draws the glass panel the fade keys on without
           naming the primitive's classes 
           · the removal is `try { drawn.dispose() } finally { root.remove() }`, so a `dispose` that throws still removes the
           root, as `parts.redraw` guards the same pair · a `default` toast part that throws is caught in `show` and logged
           through the `log` parameter (`renderer.ts` passes `(message) => log('toasts', message)`, the `[toasts]` tag) naming the error; it never reaches `show`'s caller (config-problem announcements and plugin
           toasts), and no toast shows for that call · `ToastTone` is declared twice (`contracts/plugin.ts`, `layout.d.ts`);
           a type test pins the two unions mutually assignable
GIVEN a toast shown WHEN `TOAST_MS` (4000) passes THEN the core runs the draw's `dispose` once, then removes the root
GIVEN a toast shown whose `dispose` throws WHEN `TOAST_MS` passes THEN the root is still removed from the layer
GIVEN the draw throws (a `default` toast part that throws) WHEN `show` runs THEN `show` returns without throwing, the
      layer holds no child, and a `[toasts]` line names the error
GIVEN a user shell layout that leaves `toast` out WHEN a toast shows THEN `default` draws it
GIVEN tone `info` WHEN `default` draws the toast THEN it holds no status dot; `success` and `error` lead with a dot of
      their own status
Tests:     `createToasts_Show_MarksFadesAndRemovesAfterToastMs` (new, `toasts.test.ts`) — the fake draw hears
           `{ text: 'Saved', tone: 'success' }` with the layer as parent; its root carries `data-tone="success"` and
           `role="status"`, is not hidden and carries `is-opening`; `timers.set` was called once with `4000`; before
           the timer runs the root is in the layer and `dispose` ran 0 times; after it runs `dispose` ran once and the
           layer holds no child.
           `drawToast_Tone_DefaultDrawsTheDotOnlyForSuccessAndError` (new `it.each`, `shell-chrome.test.ts`) — rows
           `success` → one `span.ui-dot` with `data-status="success"`; `info` → no `.ui-dot`; `error` → one `span.ui-dot`
           with `data-status="error"`. Every row: the root carries
           `ui-floating`, `toast` and `data-layout-owner="shell"`, `data-layout="default"`, and `.toast-text` holds the
           row's text (a different text per row).
           `createToasts_DisposeThrows_StillRemovesTheRoot` (new, `toasts.test.ts`) — the fake draw's `dispose` throws; after
           the timer runs the layer holds no child (the timer callback's throw is the test's to catch or expect).
           `createToasts_DrawThrows_LogsAndShowsNothing` (new, `toasts.test.ts`) — the fake draw throws `new Error('bad
           toast')`; `show('Saved', 'info')` does not throw, the layer holds no child, `timers.set` was not called, and the
           fake `log` heard one message naming `bad toast`.
           `ToastTone_TwoDeclarations_AreMutuallyAssignable` (new, `layout.test-d.ts`) — `expectTypeOf` that `ToastTone` from
           `layout.d.ts` and from `src/contracts/plugin.ts` are `toEqualTypeOf` each other, so a tone added to one fails the
           typecheck; the file follows the other `*.test-d.ts` files (`vitest --typecheck`).
           No row in `readShellLayout_Shapes_AcceptsOrNamesTheFirstBadKey`: the reader's `Record<keyof Layout, true>`
           fails to compile without `toast`, and the shape rule does not change.
Done when: `npm run lint` and the typecheck pass; the test gate runs the tests above and the existing
           `shell-chrome.test.ts`, `read-shell-layout.test.ts` and `layout-contracts.test.ts`. Live check: task 15.
Commit:    one commit for the group: `src/renderer/shell/layouts/layout.d.ts`
           `src/renderer/shell/layouts/default/layout.js` `src/renderer/shell/layouts/default/layout.css`
           `src/renderer/shell/read-shell-layout.ts` `src/renderer/shell/shell-chrome.ts`
           `src/renderer/shell/shell-chrome.test.ts` `src/renderer/toasts.ts` `src/renderer/toasts.css`
           `src/renderer/toasts.test.ts` `src/renderer/renderer.ts`
           `src/renderer/shell/layouts/layout.test-d.ts`

## Approach

- **Contract** (`layout.d.ts`). Add `ToastTone`, `ToastInput`, the `toast` part and `ShellKit.floatingPanel`. Write the
  file's header comment again so it names the toast beside the title bar and the activity bar, and says what the app
  keeps for a toast: the layer, `data-tone`, `role=status`, the fade, the 4000 ms timing and the removal. The `toast`
  comment says: the toast's whole look, drawn once per toast into the toasts layer; a shown toast keeps the layout it
  drew with, and a layout change applies from the next toast. `floatingPanel`'s comment: `div.ui-floating`, the glass
  panel, appended to `parent`; the core's fade keys on it. `ToastTone` is declared here because the generated contract
  text cannot import `src/contracts/plugin.ts`; it has the same members as that file's `ToastTone`.
- **Default** (`default/layout.js`). `toast(parent, input, kit)`: `kit.floatingPanel(parent)` with class `toast` added,
  then `kit.statusDot(root, tone)` for `success` and `error` only (move the `TOAST_DOTS` table from `toasts.ts` here,
  `info` mapped to null), then `kit.el(root, 'span', 'toast-text', input.text)`; return the root.
- **CSS.** Move the `.toast` and `.toast-text` rules from `src/renderer/toasts.css` into `default/layout.css`
  unchanged, under a comment that names the toast. `toasts.css` keeps the `.toasts` layer rule only, and its comment
  says the toast's own look is in the shell default's `layout.css`. The file header comment of `layout.css` names the
  toast too.
- **Reader** (`read-shell-layout.ts`). Add `toast: true` to `LAYOUT_PARTS`.
- **Kit** (`shell-chrome.ts`, `createShellKit`). Add `floatingPanel(parent)`: `floatingPanel()` from
  `src/shared/page/ui/floating-panel.ts`, appended to `parent`, returned.
- **Chrome** (`shell-chrome.ts`, `ShellChrome`). Add `drawToast(parent, input)`: `parts.draw('toast', parent, …)` with a
  fresh `createShellKit` per draw, as `drawSlot` builds one; return `{ element: drawn.built.element, dispose:
  drawn.dispose }`. It uses no slot: the toast's parent is the layer the core gives. `setLayouts` does not redraw shown
  toasts. Extend the `ShellChrome` comment with one sentence for `drawToast`.
- **Core** (`toasts.ts`). `createToasts(layer, timers, drawToast, log)`. `show(text, tone)` now: `drawToast(layer, { text,
  tone })` inside a `try`; a throw is logged as a `[toasts]` line naming the error and `show` returns. On the returned
  root set `dataset.tone = tone`, `role="status"` and `hidden = true`, then `openFloatingPanel(root)`, then
  `timers.set(() => { try { drawn.dispose(); } finally { root.remove(); } }, TOAST_MS)`. Remove the code
  build (`floatingPanel`, `TOAST_DOTS`, `statusDot`, `element`) and their imports. Keep `TOAST_MS = 4000` and the
  `toasts.css` import. Rewrite the function comment to say the shell layout draws each toast and the core keeps the
  marks, the fade, the timing and the removal.
- **Wiring** (`renderer.ts`, at the `createToasts(toastLayer, timers)` call, about line 282). Pass
  `(parent, input) => chrome.drawToast(parent, input)` as the third argument and `(message) => log('toasts', message)` as
  the fourth. `chrome` is already built above that line.
- No doc edit: `docs/features/layouts/design.md` (the shell Adopters row, § What a layout draws) and `AGENTS.md` were
  written ahead. Ticking the master-plan box and removing the follow-up ride in task 10.

## Proof

