# 12 — Window adapter hears page load 1

Status: not started
Type: Task
Rung: hard · reorders the window's first load against the self-test's and the drive run's load counting, a start-order (lifecycle) change with no unit test able to pin the composition root
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: **Window adapter misses page load 1** (`followups.md` L98).

Files:     modify `src/main/window.ts` · modify `src/main/main.ts` · modify `src/main/selftest.ts` ·
           test `src/main/selftest.test.ts`

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main`):
- `grep -n "loadURL\|loadFile" src/main/window.ts` → lines 70 and 72, inside `createMainWindow`: the factory starts
  the first load before it returns.
- `grep -n "electronDrivenWindow(" src/main/main.ts src/main/selftest.ts` → `main.ts:1083` (inside the
  `startDriveRun` call in `createWindow`) and `selftest.ts:228` (inside `startSelfTest`): two adapters, each made
  after `createMainWindow` returned.
- `grep -n "navigations += 1" src/main/electron-driven-window.ts` → one line, in the `did-navigate` listener: the
  count holds only the commits seen after the adapter was made.

Consumes:  nothing from another task. `DrivenWindow` (`src/main/drive/driven-window.ts`), `electronDrivenWindow`
           (`src/main/electron-driven-window.ts`), `startDriveRun`'s `window` dep — in the tree.

Produces:  `export function loadAppPage(window: BrowserWindow): void` in `src/main/window.ts`
           `startSelfTest(window: BrowserWindow, drivenWindow: DrivenWindow, homeFiles: Files, cleanUp: () => Promise<void>, screenshotFolder: string, filter: SelfTestFilter): SelfTestDriver` in `src/main/selftest.ts`

Decisions:
- **The load leaves the factory.** `createMainWindow` stops loading: its `loadURL` / `loadFile` branch moves into the
  new `loadAppPage(window)`, unchanged. The header comment of `createMainWindow` gains one clause: the caller loads
  the page with `loadAppPage` once every listener that counts loads is in place. Reason: the item's option "create
  the adapter before the first load"; a separate load call makes the order a line in `createWindow` that a reader
  sees, rather than an accident of one synchronous pass.
- **One adapter.** `createWindow` (`src/main/main.ts`) makes one `const drivenWindow = electronDrivenWindow(window)`
  right after `createMainWindow` and the `pageLog` listeners, and hands it to both `startSelfTest` and
  `startDriveRun` (`window: drivenWindow`). `startSelfTest` takes it as a new second parameter and no longer imports
  `electronDrivenWindow`; it keeps the `BrowserWindow` for its `did-finish-load` listener. Two adapters over one
  window counted the same commits twice for no reader.
- **Where the load starts.** `loadAppPage(window)` is called in `createWindow` straight after the drive-run block
  (the last consumer of `drivenWindow`), with a comment: the page loads only once every `DrivenWindow` over it
  exists, so its navigation count numbers the first load 1. Everything in `createWindow` is synchronous, so the
  serving calls after that point (`serveLayouts`, `serveSlots`, …) stay ahead of any load event as they are today.
- **`DrivenWindow.navigationCount`'s comment** (`driven-window.ts`) already says "Made before the window's first
  load commits, as main makes it"; after this change that is true by construction, so it stays.
- **Scheduled-tasks merge.** That plan's tasks 06 and 18 add login-start wiring to `createWindow`. It does not touch
  the window load or either adapter call; place `loadAppPage` after the drive-run block wherever those lines land.

GIVEN `createWindow` in any run mode WHEN the window is made THEN `loadAppPage(window)` is the only load call and
runs after `electronDrivenWindow(window)`, so the self-test's first run line reads `[selftest] page load 1 starts its
run` and a drive run's `ready` returns `load: 1` on the first load, whatever `await` a later change adds before the
parts start.

Tests:
- `selftest.test.ts`: the `vi.mock('./electron-driven-window', …)` block goes; its object becomes a module-level
  `fakeDrivenWindow` (same members, `navigationCount: () => navigation.count`), passed as the new second argument
  at each `startSelfTest(` call (four sites today). Every existing test in the file passes unchanged otherwise.
- No new unit test: the order lives in the composition root, which no test starts. The final verification task
  checks it live (see Done when).

Done when: compiles (`npm run typecheck`); `npm test` runs `src/main/selftest.test.ts` green; `npm run lint` clean
(the layer check: `window.ts` and `selftest.ts` stay in `src/main`). The live checks below go to the final
verification task.

Commit:    one commit for the group, e.g. "Window loads its page after the driven window exists, so load 1 is
           counted (follow-up: Window adapter misses page load 1)"

## Proof
