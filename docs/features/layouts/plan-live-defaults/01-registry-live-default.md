# 01 — The registry announces a live default from the owner's default folder

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/layouts/layout-registry.ts` · modify `src/contracts/layouts.ts` (the `LayoutEntry` comment only) · modify `src/main/layouts/layout-service.ts` (pass `defaultFolder: null` only) · test `src/shared/layouts/layout-registry.test.ts`
Consumes:  `Files` (`src/contracts/files.ts`), `scopedFiles` (`src/shared/scoped-files.ts`) — both in the tree
Produces:  `defaultFolder: Files | null` on `LayoutRegistryDeps` in `src/shared/layouts/layout-registry.ts`
           — the owner's default folder in the repo clone, scoped to that folder; null when there is no clone

Decisions:
- The registry stays the one module that announces an owner's layouts. It reads the default folder beside the user
  folder (plan.md § Decisions, design review).
- Entry rule (plan.md § File Structure). `default` is `{ name: 'default', revision: n, hasCss, builtIn: false }`
  while the default folder holds `layout.js`. `hasCss` is true when the folder also holds `layout.css`. In every
  other case `default` is `{ name: 'default', revision: 1, hasCss: false, builtIn: true }`, as today. "Every other
  case" is: `defaultFolder` is null, the folder is missing, or the folder holds no `layout.js`.
- Only `layout.js` and `layout.css` directly in the default folder count. Other files in the folder
  (`layout.test.ts`) and files in subfolders change nothing.
- The live default's revision starts at 1. It rises by one on each change the registry announces for the default
  folder. It never resets for the life of the process, so a default that goes built in and then comes back live
  takes a revision above every earlier one. Keep it apart from the user layouts' `revisions` map, because a user
  folder named `default` stays ignored (plan.md § Out of scope).
- A save of `layout.js` or `layout.css` in the default folder lists the default folder again and sends the set with
  `changed: 'default'`. Run it through the same `serially` queue as the user folder, so two listings never
  interleave. A delete of `layout.js` sends the set with `default` built in.
- The registry watches the default folder only when the folder exists at start (`defaultFolder.stat('')` is a
  folder). `Files.watch` makes a missing folder, and the registry must never make a folder in the user's clone. A
  default folder that appears later is seen on the next app start.
- A failed default-folder watch logs `default layout watch failed: <error>` under `logSource`, as the user-folder
  watch logs its failure. Saves then go unseen until the next start.
- `dispose` closes both watches.
- The user-folder rules stay as they are: a user folder named `default` is ignored and logged once
  (`layout-registry.ts` lines 71–86), and its watch events are dropped (lines 150–166).
- `src/main/layouts/layout-service.ts` (`register`, lines 84–94): pass `defaultFolder: null` to
  `startLayoutRegistry`, so the tree compiles. Task 04 replaces the null with the owner's folder.
- `src/contracts/layouts.ts`: rewrite the `LayoutEntry` comment. `builtIn` now marks the bundled `default`, which
  the page draws from its own bundle. A `default` with `builtIn: false` is the live default from the repo clone.

GIVEN a default folder that holds `layout.js` and `layout.css` WHEN the registry starts THEN `current()` lists
`{ name: 'default', revision: 1, hasCss: true, builtIn: false }` first
GIVEN no clone (`defaultFolder` null) WHEN the registry starts THEN `default` is built in, revision 1, no CSS
GIVEN a live default at revision n WHEN the user saves `layout.js` or `layout.css` THEN the registry sends a set with
`changed: 'default'` and `default` at a revision above n
GIVEN a live default WHEN `layout.js` is deleted and later written again THEN the first set lists `default` built
in, and the second lists it live at a revision above every earlier live revision
GIVEN a default folder that is missing at start WHEN the registry starts THEN it does not watch that folder and does
not make it

Tests:     all in `src/shared/layouts/layout-registry.test.ts`. Give `start()` a `defaultFolder` argument (default
           null, so the existing tests keep their meaning). Build the default folder as a second memory `Files`.
- `start_DefaultEntry_FollowsTheDefaultFolder` — new `it.each` table. Rows: no clone (null) → built in, revision 1,
  `hasCss: false`; folder missing → built in; folder with only `layout.test.ts` → built in; `layout.js` only →
  `builtIn: false`, revision 1, `hasCss: false`; `layout.js` and `layout.css` → `builtIn: false`, `hasCss: true`.
  Each row asserts the whole `default` entry.
- `watch_SaveInDefaultFolder_RaisesTheDefaultRevision` — new `it.each` over `layout.js` and `layout.css`: the sent
  set has `changed: 'default'`, and `default`'s revision is greater than its start revision. Assert "greater than",
  not a fixed number.
- `watch_OtherFileInDefaultFolder_SendsNothing` — new `it.each` over `layout.test.ts` and `parts/card.js`: after the
  write, a save of a user layout is the only set sent (the shape of `watch_SaveInFolderThatIsNoLayout_SendsNothing`).
- `watch_DefaultLayoutJsRemovedThenWritten_BuiltInThenHigherRevision` — new: the first set lists `default` built
  in; the second lists it live at a revision greater than the one before the removal.
- `start_DefaultFolderMissing_IsNotWatchedOrMade` — new: wrap the default folder's `Files` so it records `watch`
  calls; after start it records none, and `stat('')` is still null.
- `watch_Fails_LogsIt` — add a row for a failing default-folder watch: the log holds a line under `[demo]` that
  names the watch and the error.
- `start_UserFolderNamedDefault_IsSkippedAndLogged` and `watch_SaveInDefaultFolder_SendsNothing` stay as they are.
  They pin that a user folder named `default` is still ignored.

Done when: `npm run typecheck` passes; the test gate runs the tests above.
Commit:    one commit for the group.

## Decisions from the cold plan read

These close gaps a cold reader found. Each binds as the Decisions above do.

- **Fixtures.** Every default-folder fixture in this task's tests is `scopedFiles(memory, <path>, posixPaths)` over
  one memory `Files`, as task 04 builds it. "Missing" means no file under that path: a bare memory root is always a
  folder (`src/shared/memory-files.ts`), so it cannot stand for a missing folder.
- **`hasCss` follows the live folder.** Writing `layout.css` into a live default folder sends `default` with
  `hasCss: true`; deleting it sends `hasCss: false`; each at a higher revision. Test: rows in the save-raises-revision
  table, or one test beside `hasCss_TrueWhenLayoutCssPresent`.
- **Send only on a change the page sees.** The registry sends a set only when the announced `default` entry differs
  from the last one sent (`builtIn`, `hasCss` or the live revision). A save of `layout.css` while the folder holds no
  `layout.js` sends nothing. Test: a row in `watch_OtherFileInDefaultFolder_SendsNothing`.
- **The counter.** The live-default counter rises on every announced default change, the delete of `layout.js`
  included. The built-in entry still reports revision 1.
- **Comments.** Update the header comment of `layout-registry.ts` and the `logSource` comment for the default-folder
  watch, and give `defaultFolder` a doc comment.

## Proof

