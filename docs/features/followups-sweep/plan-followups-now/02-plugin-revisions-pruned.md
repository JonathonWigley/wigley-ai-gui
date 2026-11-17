# 02 — Old plugin code revisions are pruned

Status: in progress
Type: Task
Rung: hard · adds a folder-removal dependency to the user folder source and deletes folders on disk during a load
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md`, "Old plugin code revisions stay on disk".

Files:
- modify `src/main/plugin-catalog/user-folder-source.ts`
- test `src/main/plugin-catalog/user-folder-source.test.ts`
- modify `src/main/main.ts` (`startCatalog`, one dependency line)
- modify `AGENTS.md` (the user plugin paragraph, ≈line 568)
- modify `docs/features/plugin-framework/design.md` (§ Main imports from a per-revision copy, ≈line 332)

Preconditions (run from `wigley-ai-gui/`):

| Claim | Command | Expected |
|---|---|---|
| Nothing deletes a revision folder | `grep -n 'deleteFile\|trash\|removeFolder' src/main/plugin-catalog/user-folder-source.ts` | no output |
| `nextRevision` reads the revisions an earlier launch left | `grep -n 'const nextRevision' src/main/plugin-catalog/user-folder-source.ts` | one line (≈113) |
| `Files` has no folder delete (`deleteFile` refuses a folder; `trash` sends to the OS Trash) | `grep -n 'deleteFile\|trash(' src/contracts/files.ts` | `trash(path…)` and `deleteFile(path…)` only |
| `main.ts` already imports `rm` | `grep -n "import { rm } from 'node:fs/promises'" src/main/main.ts` | one line |
| The docs state the old behaviour | `grep -n 'no step deletes an old revision' AGENTS.md; grep -n 'its folder stays on disk' docs/features/plugin-framework/design.md` | one line each |

Lane H and Lane E both edit `src/main/main.ts`; Lane H's `startCatalog` hunk changes the `builtIn:` line, four lines
above this task's edit. Merge on the newer tip and keep both.

Consumes: nothing from another task. `UserFolderSourceDeps`, `createUserFolderSource` (tree).

Produces: `UserFolderSourceDeps.removeFolder: (folderPath: string) => Promise<void>` in
`src/main/plugin-catalog/user-folder-source.ts`, given an absolute path; `main.ts` passes
`(folder) => rm(folder, { recursive: true, force: true })`.

Decisions:
- **Which revisions go.** The running process imports only revisions it copied itself, and every one of those numbers
  above what the disk held at the id's first load this launch (`nextRevision`). So at an id's first load in this
  launch (`revisions.get(id) === undefined`), `nextRevision` removes every revision folder it found on disk, after
  computing the next number from them. Revisions copied during this launch stay until the next launch's first load:
  a page part, a lazy import or a stylesheet may still read the running one, and a failed reload keeps the last good
  revision running.
- **Plugins that are gone.** `loadAll` (once per launch), after its loads, runs one more step through
  `loads.run`, so no load copies while it sweeps: it removes each folder directly under the code folder
  (`codeFolder.list('')`, kind `folder`) whose name is not among the plugin names it listed and has no `revisions`
  entry. A plugin the watch or a `reload` loaded this launch, even one added after the listing, has a `revisions`
  entry and keeps its code. A plugin folder deleted mid-launch keeps its copies until the next launch.
- **Absolute paths.** `removeFolder` gets `paths.join(deps.codeRoot, id, String(n))` for an old revision and
  `paths.join(deps.codeRoot, name)` for a gone plugin, as the import path at line ≈270 is built. `codeFolder` paths
  are scoped and never reach `removeFolder`.
- **A dependency, not the `Files` contract.** `Files` has no folder delete, `contracts/files.ts` is the
  scheduled-tasks run's to edit (plan.md § Decisions), and `trash` would fill the user's Trash with a folder per save.
  The source takes `removeFolder` as a dependency, as it takes `importModule`; the composition root wires Node's `rm`.
- **A failed removal never fails a load.** Each `removeFolder` is awaited in turn inside the serial load queue; a
  rejection is logged under `plugin-catalog` and the load goes on. Pinned log texts:
  - `plugin <id> old revision <n> not deleted: <errorText(error)>`
  - `plugin code <name> not deleted: <errorText(error)>` (a gone plugin's folder)
- **Numbering is unchanged.** The next revision is still one above the highest on disk, so a revision number never
  repeats within a code folder's life.

GIVEN `plugin-code/notes/1` and `plugin-code/notes/4` on disk from an earlier launch
WHEN the source's first load of `notes` runs
THEN it loads at revision 5 and `removeFolder` received `/data/plugin-code/notes/1` and `/data/plugin-code/notes/4`

GIVEN that source after its first load
WHEN `notes` reloads twice more (revisions 6 and 7)
THEN `removeFolder` receives nothing more

GIVEN `plugin-code/old/3` on disk and no `plugins/old` folder
WHEN `loadAll` runs
THEN `removeFolder` received `/data/plugin-code/old`

GIVEN `notes` loaded by `reload` and then its plugin folder removed, and `plugin-code/old/3` on disk
WHEN `loadAll` runs
THEN `removeFolder` received only `/data/plugin-code/old`

GIVEN `removeFolder` rejects with `busy` for `/data/plugin-code/notes/1`
WHEN the first load of `notes` runs
THEN the load is `loaded` at revision 2 and the log holds `[plugin-catalog] plugin notes old revision 1 not deleted: busy`

Tests (in `user-folder-source.test.ts`; `createSource` gains a fake `removeFolder` that records each path in a
`removed: string[]` reset in `beforeEach`, and rejects with `new Error('busy')` for a path in a `failingRemovals` set):
- the existing `numbers revisions above the copies already on disk` additionally expects
  `removed` to equal `['/data/plugin-code/notes/1', '/data/plugin-code/notes/4']` after all four reloads
- `loadAll_RemovesCodeOfPluginsNoLongerPresent`: `code.makeFolder('old/3')`, `writePlugin('notes')`, `loadAll` →
  `removed` equals `['/data/plugin-code/old']` (no `notes` path: it had no revision on disk)
- `loadAll_KeepsCodeOfAPluginLoadedThisLaunch`: `writePlugin('notes')`, `source.reload('notes')`,
  `plugins.remove('notes')`, `code.makeFolder('old/3')`, `loadAll` → `removed` equals `['/data/plugin-code/old']`
  (`notes` is not listed, but its revision 1 was copied this launch)
- `reload_RemovalFails_LoadsAndLogs`: `code.makeFolder('notes/1')`, `failingRemovals` holds
  `/data/plugin-code/notes/1` → the load's revision is 2 and `logLines` contains
  `[plugin-catalog] plugin notes old revision 1 not deleted: busy`

Done when: compiles; `npm test` runs `user-folder-source.test.ts` and it passes; `AGENTS.md` ≈568 reads "Each load
copies the folder to `<userData>/plugin-code/<id>/<revision>/`; a plugin's first load in a launch deletes the revisions
an earlier launch left, and `loadAll` deletes the copies of plugins no longer in the folder."; the design doc's
sentence "and its folder stays on disk (`docs/features/followups.md`)" becomes "and its folder stays on disk until the
next launch's first load of the plugin deletes it".

Commit: one commit, "plugin catalog: delete the revision copies an earlier launch left (old plugin code revisions follow-up)".

## Proof
