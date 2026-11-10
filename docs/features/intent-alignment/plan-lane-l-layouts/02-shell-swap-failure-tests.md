# 02 — Shell layout swap failure tests

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     test `src/renderer/shell/shell.test.ts`
Consumes:  `mountShell(root, layout, uiState, timers, keys): Shell` and `Shell.setLayout(layout): Disposable` (tree,
           `src/renderer/shell/shell.ts`) · `defaultShellLayout` (tree, `src/renderer/shell/shell-layout.ts`) ·
           the file's own helpers `mountMeasuredShell`, `measuredLayout`, `stubShellGlobals`, `NO_TIMERS`,
           `stateOver` (tree, `shell.test.ts`)
Produces:  one table test in `src/renderer/shell/shell.test.ts`, inside `describe('mountShell')`:
           `mountShell_SwapFails_KeepsTheRightLayoutMounted ($row)`
Decisions: one table over three failures (round 1 notice) · the test pins what `shell.ts` does today; it changes no
           source file
GIVEN a shell swapped to layout A WHEN `setLayout` gets a layout whose `mount` throws THEN `setLayout` rethrows that
      error, A is mounted again with every contribution back in its track, and A's restore handle still restores the
      initial layout
GIVEN a shell swapped to layout A WHEN `setLayout` gets a layout that returns no element for `statusBar` THEN
      `setLayout` throws `Shell layout returned no element for statusBar`, and the outcome is the same as the row above
GIVEN `setLayout(A)` then `setLayout(B)` WHEN A's handle is disposed THEN B stays mounted; WHEN B's handle is disposed
      THEN the initial layout is mounted
Tests:     `mountShell_SwapFails_KeepsTheRightLayoutMounted ($row)` — see Approach for the rows and the assertions.
Done when: `npm run lint` and the typecheck pass; the test gate runs `src/renderer/shell/shell.test.ts`.
Commit:    one commit for the group: `src/renderer/shell/shell.test.ts`

## Approach

What `shell.ts` does, read from the code (`replaceLayout`, `setLayout`, `mountLayout`, `mountedArea`):

- `replaceLayout(next)` reads each area's scroll, then calls `mountLayout(root, next)`. When that throws, it mounts the
  previous layout again (`mountLayout(root, previous)`, so the previous layout's `mount` runs a second time), runs
  `fillElements()` (every contribution goes back into its alignment's track, the handles go back into the root, the
  chrome `data-layout` marks are set again), restores each area's scroll, and rethrows. It does not run
  `drawBarWidths()` on that path.
- `generation` rises only after a mount that did not throw. A failed `setLayout` returns no handle and leaves
  `generation` unchanged, so a handle from an earlier swap still restores.
- A handle's `dispose` restores `initialLayout` only while `generation` equals the value it took at its swap; after a
  later swap it does nothing.
- `mountedArea` throws `Shell layout returned no element for <name>` for an area the layout left out, and
  `Shell layout returned no <align> track for <name>` for an aligned area missing a track. The areas are checked in
  `AREA_NAMES` order: `titleBar`, `activityBar`, `sideBar`, `main`, `rightBar`, `panel`, `statusBar`, `overlay`.
- `shell.ts` logs nothing. The error reaches the caller of `setLayout`.

Test layouts. Each test layout wraps `measuredLayout(DEFAULT_EDGES)`: its `mount` calls the wrapped `mount`, then sets
`dataset.mountedBy = '<name>'` on the returned `main` element, and counts its calls. The initial layout is named
`initial`, the swaps `A` and `B`. The failing layouts:

- `throws`: `mount` throws `new Error('mount failed')`.
- `missesStatusBar`: `mount` calls the wrapped `mount` and returns its areas with `statusBar` deleted.

Setup per row: install the fake DOM as `mountShell_SetLayoutThenDispose_KeepsChromeLayoutName` does, mount the shell on
`initial`, call `setChromeLayout('mine')`, and contribute one `FakeElement` to `main` (align `start`) and one to
`statusBar` (align `end`) before the first swap.

Rows (`row`, the steps, then what the row asserts):

1. `mount throws` — `const a = setLayout(A)`; `setLayout(throws)` throws `mount failed`.
2. `layout misses an area` — `const a = setLayout(A)`; `setLayout(missesStatusBar)` throws
   `Shell layout returned no element for statusBar`.
3. `second swap before the first restore` — `const a = setLayout(A)`; `const b = setLayout(B)`; `a.dispose()`.

Assertions, each row as one `expected` object compared whole:

- `mountedBy`: the `dataset.mountedBy` of the main contribution's parent after the steps — rows 1 and 2: `A`; row 3: `B`.
- `contributionsIn`: whether each contribution's parent is inside `root` — `[true, true]` in every row.
- `chrome`: the five chrome areas' `[data-layout, data-layout-owner]` through the file's `chromeLayouts(root)` — five
  `['mine', 'shell']` pairs in every row.
- `afterRestore`: then dispose the handle that is still live (`a` in rows 1 and 2, `b` in row 3) and read `mountedBy`
  again — `initial` in every row.

- `mountsOfA`: how many times `A.mount` ran before the restore — rows 1 and 2: `2` (the swap, then the rollback);
  row 3: `1`.

## Proof

