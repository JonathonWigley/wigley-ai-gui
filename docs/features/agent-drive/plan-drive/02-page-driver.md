# 02 — Page driver shared with the self-test

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/main/drive/driven-window.ts` · create `src/main/drive/page-driver.ts` · test `src/main/drive/page-driver.test.ts` · create `src/main/electron-driven-window.ts` · modify `src/main/selftest.ts` · modify `src/main/selftest-config.ts` · test `src/main/selftest-config.test.ts` · modify `scripts/check-layers.mts`
Consumes:  nothing
Produces:  `Box`, `DrivenInput`, `Modifier`, `ConsoleMessage`, `DrivenWindow` in `src/main/drive/driven-window.ts`, exactly as plan.md § Shared names writes them
           in `src/main/drive/page-driver.ts`: `press(window: DrivenWindow, key: string): void` · `typeText(window: DrivenWindow, text: string): Promise<void>` · `click(window: DrivenWindow, box: Box, button: 'left' | 'right', count: number): Promise<void>` · `drag(window: DrivenWindow, box: Box, dx: number, dy: number): Promise<void>` · `boxOf(window: DrivenWindow, selector: string): Promise<Box | null>` · `readLog(window: DrivenWindow): Promise<string[]>` · `waitFor(check: () => Promise<boolean>, timeoutMs?: number): Promise<boolean>` · `waitForNewLogLine(window: DrivenWindow, line: string, seen: number, timeoutMs?: number): Promise<boolean>` · `waitForRedraw(window: DrivenWindow): Promise<boolean>` · `isReadyForKeys(window: DrivenWindow): Promise<boolean>` · `readStartFailure(window: DrivenWindow): Promise<string | null>` · `capturePng(window: DrivenWindow, box?: Box): Promise<Uint8Array | string>` · `cutOffAtWidth(window: DrivenWindow, width: number, scrollsItself: string[]): Promise<string[]>` · `export const STEP_TIMEOUT_MS = 5000` · `export const PRIMITIVE_ELLIPSIS_SELECTORS: readonly string[]` · `export function withPrimitiveEllipsis(scrollsItself: readonly string[]): string[]` · `export const SCREENSHOT_NAME: RegExp`
           `export function electronDrivenWindow(window: BrowserWindow): DrivenWindow` in `src/main/electron-driven-window.ts`
Decisions: the driver reuses the self-test's input, frame wait and capture code (round 1) · `DrivenWindow` seam with an Electron adapter and a test fake (design review) · `src/main/drive` never imports electron (design review)

## What changes

- Move from `selftest.ts` into `page-driver.ts`, rewritten over `DrivenWindow`: `KEY_CODES`, `pressChord`, `press`, `readLog`, `isPageReady` (now `isReadyForKeys`, which also requires `window.hasPaintedSinceNavigation()`), `readStartFailure`, `cutOffScript` with `CORE_SCROLLS_ITSELF`, `waitFor`, `waitForNewLogLine`, `waitForPageWidth`, `waitForRedraw`, and `cutOffAtMinimumWidth` generalised to `cutOffAtWidth` (shrinks to `width`, lists cut-offs, restores the old size, as today). Behaviour, timeouts and comments carry over unchanged.
- `PRIMITIVE_ELLIPSIS_SELECTORS`, `withPrimitiveEllipsis` and `SCREENSHOT_NAME` move from `src/main/selftest-config.ts` into `page-driver.ts` (exported, unchanged), since `src/main/drive` cannot import `src/main`; `selftest-config.ts` imports them, and their test cases move with them.
- Every `DrivenWindow` size is a content size: `setSize` maps to `setContentSize`, `minimumWidth` is the content width at the window's minimum size, and `cutOffAtWidth` shrinks with `setContentWidth(width)` and restores the content width it read. The hidden or inset title bar makes outer and content widths coincide here, so the self-test's lines stay the same.
- `capturePng` waits for a redraw then captures; it returns the PNG bytes or the failure text the self-test's `saveScreenshot` reports today (`the page produced no frames`, `the capture came back empty`, or the error's text). `selftest.ts` keeps `saveScreenshot` as a thin writer over it.
- New: `typeText` presses each character with a 30 ms gap, as `runStep` spaces keys; `boxOf` returns the first match's `getBoundingClientRect()` or null; `click` sends mouseMove, mouseDown, mouseUp at the box centre with `clickCount`; `drag` sends mouseDown at the box centre, mouseMove in ten steps to the centre plus `(dx, dy)`, then mouseUp.
- `electronDrivenWindow` owns the `paint` and `did-navigate` listeners and the `hasPaintedSinceNavigation` state that sit at `selftest.ts` module level today; `capture` calls `capturePage(box, { stayHidden: true })`; `onFrame` listens to `paint` and hands a lazy `toPNG`; `onConsole` listens to `console-message`. `minimumWidth` reads `getMinimumSize()[0]`; `setContentWidth` keeps the current height.
- `selftest.ts` runs on `electronDrivenWindow(window)` and the page-driver functions; its `startSelfTest(window: BrowserWindow, …)` signature is unchanged.
- `check-layers.mts`: add `'src/main/drive': { layers: ['src/contracts', 'src/shared'], packages: ['node:'] }`; add `'src/main/drive'` to the `src/main` entry's layers and to `src/main/main.ts`'s.

GIVEN a fake window whose log grows by `'[x] done'` on its third read WHEN `waitForNewLogLine(window, '[x] done', 0)` runs THEN it resolves true
GIVEN a fake window WHEN `press(window, '<A-o>')` runs THEN it sends keyDown and keyUp with keyCode `o` and modifiers `['alt']`, and no char
GIVEN a fake window WHEN `press(window, 'G')` runs THEN keyDown carries `['shift']` and a char `G` is sent
GIVEN a fake window WHEN `press(window, '<X-q>')` runs THEN it throws naming the chord rule
GIVEN a box `{x: 10, y: 20, width: 100, height: 40}` WHEN `click(window, box, 'left', 1)` runs THEN mouseDown and mouseUp land at `(60, 40)` with clickCount 1

Tests:     `page-driver.test.ts` over a fake `DrivenWindow` that records inputs and answers `run` from a table: the five cases above, plus `waitFor gives up at its timeout` with a 100 ms timeout
Done when: typecheck, lint (the layer check included) and the tests pass; `npm run selftest` passes with the same lines as before the change
Commit:    one commit for the group

## Proof
