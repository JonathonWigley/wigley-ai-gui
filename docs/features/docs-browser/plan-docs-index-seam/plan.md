# Docs index seam — plan

Feature: docs browser, master-plan step 3 · Implements: none · Ticket: none
Target: `main`, in the main tree, after the drive-reliability plan closes · Written: 2026-10-23

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Open the docs plugin's index to other plugins, and stop the index failing on what the app does not know yet:

- index sources become registrations by id: `addSource` in main, with the machine source and one source per live
  session registered through it
- the page exports `addView` (a docs view over any source, each session's Docs tab built through it) and `openDoc`
- an index entry of an unknown kind or source loads, grouped under a title from its id
- deleting a doc also trashes every link the index walked to it (index schema 2, `walked` on each entry, in both
  repos)
- the open doc's folder is watched one level deep, through a `recursive` option on `Files.watch`

## Architecture

Systems touched:

- the Files contract and its adapters: `src/contracts/files.ts`, `src/main/files/node-files.ts`,
  `src/shared/memory-files.ts`, and its callers `src/shared/scoped-files.ts`,
  `src/shared/layouts/layout-registry.ts`, `src/main/config/config-store.ts`, `src/plugins/docs/main/doc-files.ts`
- the docs plugin: contract, index parsing, tree, kinds, path guard (`src/plugins/docs/*.ts`), main
  (`index-sources.ts`, `doc-files.ts`, `start.ts`, the self-test fixture and script), page (`docs-view.ts`,
  `docs-state.ts`, `start.ts`)
- wigley-ai-marketplace `plugins/wigley/scripts/docs-index/model.py`: `to_json` and `SCHEMA_VERSION`

## Preconditions

`wigley:make` re-runs each before the first dispatch.

- The drive-reliability plan has closed, so its final verification's drive runs are not running against this run's
  commits: `test ! -d docs/features/drive-reliability/plan-drive-reliability` exits 0 (at plan time its box 12, Final
  verification, was open). Until then the run waits.
- No peer's uncommitted edit sits in a file this plan changes: `git status --short -- src` prints nothing.
- The docs written ahead are in the tree: `git merge-base --is-ancestor c09b7fb HEAD` exits 0; in
  wigley-ai-marketplace, `git merge-base --is-ancestor 6a1a551 HEAD` exits 0.
- Sessions emits `connected` in the same tick as it sends the new row to the page, so docs main registers a session's
  source before the page can ask for it: `grep -n -A1 'sendState();' src/plugins/sessions/main/session-list.ts`
  shows `deps.emit('connected', entry.session);` on the next line, twice.
- The marketplace's wigley version already differs from `origin/main`'s (a peer run's unpushed bump), so task 02
  makes no bump: `grep '"version"' plugins/wigley/.claude-plugin/plugin.json` read `1.9.0` and
  `git show origin/main:plugins/wigley/.claude-plugin/plugin.json | grep '"version"'` read `1.8.0` at plan time.
  Re-read both; task 02 bumps the patch version in both manifests only if they match.
- Self-test lines this plan changes, measured at plan time, re-verify:
  `grep -n "index rebuilt\|session index" src/plugins/docs/main/selftest-script.ts src/plugins/forms/main/selftest-script.ts`
  prints docs lines 46 and 190 (`[docs] index rebuilt: …`), docs 303 and 353 and forms 415 (`[docs] session index …`),
  and docs 427 (a `why:` naming "its own session index", unchanged).

## Docs written ahead

- wigley-ai-gui `7a6a996`: `AGENTS.md` § Intent (one user, no backwards compatibility), § Architecture (the docs
  folder line, the new "A docs index source" entry); `docs/features/docs-browser/design.md` (index sources, page
  exports, unknown kinds and sources, trash of walked links, the one-level watch); `master-plan.md` and
  `followups.md` (the stale task-07 deadline removed)
- wigley-ai-gui `c09b7fb`: `design.md` (`hasUnsavedEdits()` on the `addView` handle); `.agents/skills/drive/SKILL.md`
  (`docs.openDoc`)
- wigley-ai-marketplace `6a1a551`: `plugins/wigley/scripts/docs-index/README.md` (schema 2, `walked`)

## Mandatory Reads

- `AGENTS.md` (the whole file; § Intent and § Architecture above all)
- `docs/features/docs-browser/design.md` § Docs browser (plan B)
- `.agents/skills/drive/SKILL.md` — for tasks 06 and 08
- `DESIGN.md` — for task 08's screen checks only
- wigley-ai-marketplace `AGENTS.md` § Changing a plugin — for task 02
- No `CLAUDE*.md`, `AGENTS.local.md` or `.claude/rules/*.md` exist in this repo (`find . -path ./node_modules -prune
  -o -path ./.drive -prune -o -path ./.vite -prune -o \( -name 'CLAUDE*.md' -o -name 'AGENTS*.md' -o -path
  '*/.claude/rules/*' \) -print` prints only `./AGENTS.md`; re-verify)

## Design Overview

### Flow after the change

```
 docs main start
   registry = createIndexSourceRegistry()            exports { addSource }  ◄── any plugin's main
   registry.add(machine source)       id 'machine'          title 'machine index'
   sessions.connected ─► registry.add(session source) id 'session:<id>' title 'session index'
   sessions.ended     ─► that handle.dispose()
   docFiles.entries = registry.loadedEntries        (write guard + trash targets)

 docs page start
   machine view  ── Docs mode (side bar + sheet)
   addView(sourceId, {isVisible}) ─► { element: split(tree | doc), shown, hasUnsavedEdits, dispose }
        ▲ each session's Docs tab                    ▲ any plugin's page
   openDoc(path, line?) ─► Docs mode shows ─► machine view waits for its first read ─► opens or toasts

 a view's first show:  loadIndex(sourceId) ─► SourceRead { title, canRebuild, document, message }
                       canRebuild ─► rebuildIndex(sourceId)
                R:     rebuildIndex(sourceId)  (main runs load for a source with no rebuild)

 trash(path) targets:  real target · the path itself when a link · each walked link resolving into the target
```

### Decisions

- Index sources register by id through `addSource`, which returns a Disposable and throws on a taken id (round 1,
  choice 2: full scope; round 2 notice).
- Each live session registers its own source, disposed when it ends; this replaces `retainSessions` and
  `sessionKey` (round 1, Session sources).
- The page exports a small `addView` handle; docs keeps the split, key routing, change propagation and overlay
  closing (round 1, View export; design review: depth, one element instead of two panes; `hasUnsavedEdits()` added
  while planning, for the session tab's close guard).
- `openDoc` shows Docs mode and opens there; an unlisted path is refused with a toast (round 1, openDoc target). It
  waits for the machine view's first read, since the view reads on its first show.
- A view runs `load` on its first show, then `rebuild` when the source has one; `R` runs `rebuild`, main falling
  back to `load` (round 2 notice).
- Unknown kinds and sources load, titled from their id; an unknown source is never a create place and its root
  grants no writes (round 1 notice).
- Index schema 2 in both repos, `walked: string[]` required; the README rule stays (round 2, Schema version; the
  user's note: one user, no backwards compatibility, now in `AGENTS.md` § Intent).
- Trash takes every walked link resolving into what goes, or nothing (round 1 notice).
- `Files.watch(folder, onChange, options?: { recursive?, onError? })`, recursive by default (round 2, Watch option
  shape). Expected saving on macOS: the JS callbacks for writes in subfolders, not the FSEvents stream (low
  confidence, unmeasured).
- `docs.openDoc` drive action, through a main-to-page channel message, so `openDoc` gets a live check before any
  plugin calls it (decided while planning).

Pinned strings (every task uses these verbatim):

- busy lines: `Reading the docs index…` for a load, `Rebuilding the docs index…` for a rebuild; `Not read yet` before
  a view's first show
- log lines (plugin `docs`): `<title> read: <n> entries`, `<title> rebuilt: <n> entries`, `<title>: <message>`;
  titles `machine index` and `session index`. A `rebuildIndex` result logs `rebuilt` only when its `canRebuild` is
  true, else `read`, since main ran `load`
- an unknown source id: `No docs index source <id>`
- an unlisted `openDoc` path: `Not an indexed doc: <path>` (the link-follow toast today)

### Out of scope

- Docs events (doc opened, saved, trashed, index rebuilt): master-plan step 18.
- Disposing registrations on plugin reload beyond what `addSource` returns: step 4.
- Pushing either repo and updating the installed wigley plugin. Until the user pushes wigley-ai-marketplace and
  updates the plugin, the user's own app reads the installed schema-1 script's index and shows `Unsupported docs
  index schema 1; this app reads 2`, unless `docs.scriptPath` points at the clone.

### Landing

The run commits on `main` in the main tree; task 02 commits in wigley-ai-marketplace's current branch, leaving a
peer's uncommitted files there alone. A user's `npm start` shares `.vite/build` with the run's dev starts and is
outside the start lock, so the run's drive and self-test starts wait while one is open.

## File Structure

Existing files modified:

| File | Tasks |
|---|---|
| `src/contracts/files.ts` | 01 |
| `src/main/files/node-files.ts` (+ test) | 01 |
| `src/shared/memory-files.ts` (+ test) | 01 |
| `src/shared/scoped-files.ts` (+ test) | 01 |
| `src/shared/layouts/layout-registry.ts` (+ test, its watch fakes only) | 01 |
| `src/main/config/config-store.ts` (+ test, its watch fakes only) | 01 |
| `src/plugins/docs/main/doc-files.ts` | 01 (the watch call), 04 |
| `src/plugins/docs/main/doc-files.test.ts` | 01, 03, 04 |
| marketplace `plugins/wigley/scripts/docs-index/model.py` (+ `tests/test_model.py`, `tests/test_discover.py`, `tests/test_docs_index.py`) | 02 |
| `src/plugins/docs/contract.ts` | 03, 05, 06 |
| `src/plugins/docs/index-document.ts` (+ test) | 03 |
| `src/plugins/docs/tree.ts` (+ test) | 03 |
| `src/plugins/docs/kinds.ts` (+ test) | 03 |
| `src/plugins/docs/path-guard.ts` (+ test) | 03 |
| `src/plugins/docs/page/docs-state.ts` (+ test) | 03, 04 |
| `src/plugins/docs/main/selftest-fixture.ts` (+ test) | 03 |
| `src/plugins/docs/main/index-sources.ts` (+ test) | 03 (test entries and the unsupported-schema test), 05 |
| `src/plugins/docs/main/start.ts` (+ test) | 05, 06 |
| `src/plugins/docs/page/docs-view.ts` | 06 |
| `src/plugins/docs/page/start.ts` | 06 |
| `src/plugins/docs/main/selftest-script.ts` | 06 |

No new source files: the registry and both built-in sources stay in `index-sources.ts`, which already holds the two
sources.

Names more than one task uses:

- `export interface WatchOptions { recursive?: boolean; onError?(error: unknown): void }` and
  `watch(folder: string, onChange: (path: string) => void, options?: WatchOptions): FileWatch` in
  `src/contracts/files.ts` (01).
- `IndexEntry.kind: string`, `IndexEntry.source: string`, `IndexEntry.walked: string[]`,
  `IndexDocument.schemaVersion: 2` in `src/plugins/docs/contract.ts`; `export const DOC_SOURCES`,
  `export function isKnownKind(kind: string): kind is DocKind`, `export function isKnownSource(source: string):
  source is DocSource` in `src/plugins/docs/index-document.ts` (03).
- In `src/plugins/docs/contract.ts` (05): `export interface IndexSource { id: string; title: string; load():
  Promise<IndexLoad>; rebuild?(): Promise<IndexLoad> }`, `export interface SourceRead extends IndexLoad { title:
  string; canRebuild: boolean }`, `export interface DocsMainExports { addSource(source: IndexSource): Disposable }`;
  `DocsChannel.invoke` gains `loadIndex(sourceId: string): Promise<SourceRead>` and `rebuildIndex(sourceId: string):
  Promise<SourceRead>` and loses `machineIndex`, `rebuild`, `sessionIndex`.
- In `src/plugins/docs/contract.ts` (06): `export interface DocsViewHandle { element: HTMLElement; shown(): void;
  hasUnsavedEdits(): boolean; dispose(): void }`, `export interface DocsPageExports { addView(sourceId: string,
  options: { isVisible(): boolean }): DocsViewHandle; openDoc(path: string, line?: number): void }`; `DocsChannel`
  `messages` gains `openDoc: { path: string; line: number | null }`.

Boundary rules: tasks 01 and 03–08 stay in wigley-ai-gui; task 02 is wigley-ai-marketplace's only change. Every
other plugin reaches docs only through `DocsMainExports` and `DocsPageExports` (AGENTS.md § Architecture).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Files.watch options, one-level docs watch](01-watch-options.md)
- [x] [Index export: schema 2 and walked](02-index-walked-export.md)

### Wave 2
- [x] [Schema 2, unknown kinds and sources in the app](03-schema-2-unknown-kinds.md) — after 01 (shares `doc-files.test.ts`)

### Wave 3
- [x] [Trash takes walked links](04-trash-walked-links.md) — after 03
- [x] [Index source registry in main](05-source-registry.md) — after 03

### Wave 4
- [x] [Page views by source id, addView and openDoc](06-page-views.md) — after 05

### Wave 5
- [x] [Doc re-read](07-doc-re-read.md) — after every code task

### Wave 6
- [x] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: c04112eecae26d302e9320a509cba760cb383b58

### Groups
- 02 · marketplace bb31807 · diff read matches Produces (SCHEMA_VERSION = 2, to_json walked); docs-index unittest 155 OK · concerns: none
- 01 · 2884091 · diff read: WatchOptions and watch(folder, onChange, options?) present in src/contracts/files.ts; typecheck clean · concerns: Node non-recursive watch reports a subfolder by its own name on macOS (memory adapter never does); test filters 'sub' — ride to review
- 03 · faa0503 · diff read: every Produces present (contract kind/source string, walked, schemaVersion 2; INDEX_SCHEMA_VERSION 2, DOC_SOURCES exported, isKnownKind, isKnownSource; titleFromId); typecheck clean · concerns: stand-in docs_index.py walked change is covered only by the self-test's fresh.md rebuild
- 04 · c0cb014 · diff read: trashTargets names walked links, trashQuestion words N targets, signatures unchanged; its 2 test files 139 pass; typecheck errors only in task 05's in-progress files · concerns: walkedLink stats every ancestor and calls realPath on each link it meets — a few calls per walked path, only on a user's trash
- 05 · 8c7f218 · diff read: IndexSource, SourceRead, DocsMainExports, loadIndex/rebuildIndex, IndexSourceRegistry, createIndexSourceRegistry/createMachineSource/createSessionSource, exports present; typecheck fails only in page/docs-view.ts (6, expected until 06) · concerns: SessionSourceSpec comment still names sessions' sessionAdded payload as its origin; a failed session load now clears that session's entries (registry rule)
- 06 · 7cfc45e · diff read: DocsViewHandle, DocsPageExports, openDoc message, DocsViewDeps.sourceId, DocsView.openDoc, page exports, docs.openDoc drive action present; typecheck green tree-wide, lint clean · concerns: machine view shows 'Not read yet' and ignores other views' changes until Docs mode's first show; first show logs read then rebuilt — self-test order to check live; openDoc relies on mode.show() reaching showFirstTime; view ids now view:<n>
- 07 · 5766b00 · design.md: 2 stale lines fixed (guard clears on failed load; openDoc waits for first index run); AGENTS.md, drive SKILL.md, marketplace README checked clean — no marketplace commit · concerns: none
- 08 · none (drive runs c08a-c08d) · all 6 checks PASS: selftest all passed with machine index rebuilt 8 / session index read 4; first show never empty, Rebuilding line above tree under indexDelayMs 4000 (Reading line too fast to capture); session tab via addView hides/shows and keeps dragged width 410 across sessions; openDoc opens line 120 with row selected, unlisted path toasts; walked-link trash prompt names folder and link, both gone after y; real docs_index.py context: schemaVersion 2, 0 of 372 entries lack walked. Report: scratchpad/reports/08-1.md · concerns: the 'Reading the docs index…' line was never caught in a capture (read too fast)
### Contract changes
- startDocs (not a listed Produces): startDocs(services, scriptPath) → { sources, docFiles } → startDocs(services, scriptPath, entries) → { indexDeps, docFiles } · why: the registry lives in start and createDocFiles reads registry.loadedEntries() · consumers: none outside main/start.ts and start.test.ts · group 05
- docs.openDoc drive action args string: { path: string; line?: number } → { path: string, line?: number } · why: the other docs drive actions separate fields with commas · consumers: none · group 06
- DocsDriveDeps gains channel: Pick<MainChannel<DocsChannel>, 'send'> → so the openDoc action can send its message · why: addDriveActions had no channel · consumers: main/start.ts, start.test.ts · group 06
### Rulings
- wigley bumped 1.9.0 → 1.9.1 in both manifests: local and origin/main matched, and § Changing a plugin names no other version field — the version rule — none, a later bump in the same push is harmless · group 02 · group 02
- node-files test drops a 'sub' report before asserting ['b.txt'], and the contract comment names the Node adapter's subfolder-name report — macOS fs.watch non-recursive reports the changed subfolder entry; no adapter filter, which would hide direct folder creates — a consumer needing no folder reports would need a stat filter · group 01 · group 01
- watch_WatchesFolderOneLevel uses its own recording fake in the watch describe — the Windows fake near line 920 is out of that describe's reach — none · group 01 · group 01
- isStringArray moved from chat/main/archived-sessions.ts into src/shared/json.ts, exported beside isJsonObject — widen, never copy — two files outside the task's list · group 03 · group 03
- kinds.ts placeTitle takes the narrowed source: DocSource as a parameter — keeps the owner titles record exhaustive — none · group 03 · group 03
- unknown-kind ties in byKindThenTitle break by compareTitles on the kind id, as kindGroups orders them — matches the groups' order — none · group 03 · group 03
- the pinned unsupported-schema test moved to schema 3 (machineIndex_SchemaThree_PinnedMessage); parse_UnknownKind_NamesEntryAndField replaced by parse_UnknownKind_Loads; added parse_UnknownSourceRootNotString_NamesRoot and a fixture-parses test — the old tests asserted the old behaviour — none · group 03 · group 03
- trashQuestion_TwoTargets_NamesLink is the old trashQuestion_LinkAndTarget_NamesBothByPath renamed — no duplicate — none · group 04 · group 04
- walkedLink passes over a link that does not resolve into the real target and keeps climbing — the Behaviour's 'nearest … that is a link and whose realPath is inside' — a link further up could be named · group 04 · group 04
- 'a link inside the real target adds nothing' is judged on the link with its folder resolved — the form the dedupe and guard see — a link inside only through another link could be named · group 04 · group 04
- index-sources.ts also exports MACHINE_SOURCE_ID, MACHINE_SOURCE_TITLE, SESSION_SOURCE_TITLE and sessionSourceId — start's wrappers need id and title before startDocs settles — the page cannot import main code and spells 'machine' and 'session:<id>' itself · group 05 · group 05
- private addStartedSource in start.ts builds the wrappers and attaches a no-op catch to inner — docs.catch already logs a failed start — none · group 05 · group 05
- loadIndex/rebuildIndex handlers call the registry directly without awaiting docs — wrappers await their inner source; an unknown id rejects at once — an unknown-id call before start rejects rather than waits · group 05 · group 05
- registry keeps entries per registration record, so a load outliving its dispose never touches a same-id re-add (extra test dispose_ThenSameIdAdded_OldLoadKeepsNoEntries) — none · group 05 · group 05
- a failed session load now clears its kept entries (before, they stayed) — the registry rule 'a throw clears them' — a session's docs lose write access until its next good load · group 05 · group 05
- machineIndex_*/sessionIndex_* tests renamed load_*, assertions unchanged; extra tests load_MachineSource_TitleAndCanRebuild, load_Throws_ClearsEntriesAndRejects — none · group 05 · group 05
- page exports its own MACHINE_SOURCE_ID = 'machine' from page/docs-view.ts — the page cannot import main's — two spellings, one per side · group 06 · group 06
- openDoc waits on a firstRead that settles on the view's first index run of any kind (load, rescan or outside-change rebuild) — otherwise a rescan before first show would hang openDoc — openDoc may follow a rebuild's result, which lists at least as much · group 06 · group 06
- a superseded result is still unlogged but settles firstRead and returns, so the first show decides rebuild from its canRebuild — none · group 06 · group 06
- addView's shown() keeps the log line 'Docs tab shown' — self-test docs line 299 expects it — the wording names a tab though an added view need not be one · group 06 · group 06
- SessionSourceSpec comment now says main builds it from sessions.connected's info — resolves group 05's concern — none · group 06 · group 06
- R1 #3 openDoc: open at once when the first read lists the path, else wait for the first-show rebuild and check again before toasting — the user's standing instruction to take the agent's recommendations — a doc the rebuild drops still opens from the first read · lead
- R1 #4 memory adapter: a non-recursive watch reports a nested change's first path segment, matching Node — same instruction — a consumer could see a folder name it did not expect · lead
### Review rounds
- R1 implementation review · 4e11b49 · NEEDS FIXES (8 findings: 6 determined, 2 open; 7 applied by lead in 9efa4b9 + marketplace 721687f)
### Test gate
- every test file the range edited (config-store, node-files, index-document, kinds, doc-files, index-sources, selftest-fixture, docs start, docs-state, path-guard, tree, layout-registry, memory-files, scoped-files) plus chat archived-sessions (isStringArray moved out of it); marketplace docs-index unittest ran at group 02 · 15 files, 400 tests passed
