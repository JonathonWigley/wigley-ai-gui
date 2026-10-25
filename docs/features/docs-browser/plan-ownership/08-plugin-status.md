# 08 — Plugin status in main

Status: done
Type: Task
Wave: 3 · Depends on: 06, 07
Plan: [plan.md](plan.md)
Repo: wigley-ai-gui

Files:     create `src/plugins/docs/main/plugin-status.ts` · test `src/plugins/docs/main/plugin-status.test.ts`
           modify `src/plugins/docs/main/index-sources.ts` · `src/plugins/docs/main/start.ts`
           test `src/plugins/docs/main/index-sources.test.ts` · `src/plugins/docs/main/start.test.ts`
Consumes:  `installedCopies(entry: IndexEntry): InstalledCopy[] | null` ← 06 (`index-document.ts`)
           `FileStatus`, `CloneStatus`, `PluginStatusRead`, `DocsChannel.invoke.pluginStatus` ← 06 (`contract.ts`)
           `run(command, args, options?: { cwd?: string; timeoutMs?: number })`, `ProcessResult.timedOut` ← 07
           `FakeRun.timeoutMs` ← 07 (tests)
           `metaString(entry, key)` in `index-document.ts`; `Paths.commonFolder`, `Paths.segmentsBelow`,
           `Paths.join`, `Paths.samePath`, `Paths.isAbsolute` in `src/contracts/paths.ts`; `Files.readBytes`,
           `Files.modified` in `src/contracts/files.ts`; `createMemoryFiles(clock)` and `FakeProcesses` (tests)
Produces:  `export interface PluginStatusDeps { processes: ProcessRunner; files: Files; paths: Paths; log: Log }` in `src/plugins/docs/main/plugin-status.ts`
           `export async function readPluginStatus(entries: readonly IndexEntry[], deps: PluginStatusDeps, options: { fetch: boolean }): Promise<PluginStatusRead>` in `src/plugins/docs/main/plugin-status.ts`
           `sourceEntries(id: string): readonly IndexEntry[];` (member of `IndexSourceRegistry`) in `src/plugins/docs/main/index-sources.ts`
           `channel.handle('pluginStatus'` in `src/plugins/docs/main/start.ts`
Decisions: - The git algorithm below is pinned by lead, steps 1–9. Every git call is
             `deps.processes.run('git', ['-C', root, …])`, no `cwd` option. `git` is found on PATH as `python3` is
             for the index runs (`spawn` with no shell; `main/login-shell-path.ts` fixes PATH for a Finder start).
             No other plugin runs git today, so there is no pattern to reuse (checked: no `'git'` run under `src/`).
           - A **clone** is each distinct `root` (compared with `paths.samePath`) of the entries whose
             `installedCopies(entry)` is non-null. Its **merged entries** are those entries. `clones` lists the clones
             in the order each root first appears in `entries`. Entries with no clone give `{ clones: [] }` and run
             no git. The clones run in parallel (`Promise.all`); the commands of one clone run in sequence (Decided).
           - The **scope** is `paths.commonFolder` of the merged entries' `path`s, written as
             `paths.segmentsBelow(scope, root).join('/')`; `.` when that is empty, or when `commonFolder` gives null
             or a folder not inside root (Decided).
           - A git path `p` (relative to root, `/`-separated) names each merged entry whose `entry.path` is
             `paths.samePath` to `paths.join(root, p)`. So every hook entry of one `hooks.json` gets that file's status
             (pinned by lead step 7). `root` is the clone's top folder, where git reports paths from (README § Entry
             `root`).
           - Step 1, with `options.fetch`: `['-C', root, 'fetch', '--quiet']` with `{ timeoutMs: 15000 }`.
             `fetchFailed` is true on a non-zero code or `timedOut`. With `fetch: false` there is no fetch.
           - Step 2: `['-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']`. A non-zero code means
             no upstream: the clone computes only `uncommitted`, and that is no failure.
           - Step 4, uncommitted: `['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', <scope>]`.
             The output is NUL-separated records `XY <path>`: the path starts at index 3. A record whose `X` is `R` or
             `C` is followed by one more field, the original path, which is skipped. Each record's path is
             uncommitted.
           - Step 5, unpushed: `['-C', root, 'diff', '--name-only', '-z', '@{u}...HEAD', '--', <scope>]`. Each
             NUL-separated path is unpushed.
           - Step 6, not installed: `['-C', root, 'ls-tree', '-r', '-z', '@{u}', '--', <scope>]`. Each record is
             `<mode> <type> <sha>\t<path>`; only type `blob` counts. The harnesses the plugin is installed for are the
             `meta.harness` values (`'claude'` or `'codex'`, read with `metaString`) of the `kind: 'plugin'` entries in
             `entries` whose `plugin` equals the merged entry's `plugin`. For each such harness, in `['claude', 'codex']`
             order, the merged entry is not installed for it when the file is absent upstream, when
             `installedCopies(entry)` holds no copy for it, or when any copy for it does not match. A copy matches when
             the git blob id of its bytes (`files.readBytes(copy.path)`), or of those bytes with every CRLF turned to
             LF, equals the upstream sha. A copy that cannot be read does not match. The blob id is the hex sha1
             (`node:crypto`) of `blob <byte length>\0` followed by the bytes (pinned by lead; "any copy for it" when a
             harness has two copies, as with two Claude config folders, Decided).
           - Step 8, `fetchedAt`: `['-C', root, 'rev-parse', '--git-path', 'FETCH_HEAD']`, its stdout trimmed, joined to
             root unless `paths.isAbsolute`. `fetchedAt` is `new Date(await files.modified(that)).toISOString()`; null
             when the run fails, exits non-zero or the file is absent. It runs last, after any failure too (Decided).
           - Step 9: a run that rejects (git cannot start), or a non-zero code from status, diff or ls-tree, stops that
             clone. The clone keeps `fetchFailed: true` and every status set so far, logs
             `plugin status <root>: <reason>` under `docs`, and the read goes on with the other clones.
             `readPluginStatus` never rejects for one clone (pinned by lead).
           - `files` holds only entries with a status set: `uncommitted` or `unpushed` true, or `notInstalled` non-empty.
             Each entry's `notInstalled` is in `['claude', 'codex']` order.
           - `sourceEntries(id)` returns the entries the source `id` last loaded (the same record `loadedEntries`
             reads), and throws `No docs index source <id>` for an id not registered, as `load` rejects. The
             `pluginStatus` handler reads `registry.sourceEntries(sourceId)` and calls `readPluginStatus` with
             `services.processes`, `services.files`, `services.paths`, `services.log` and `{ fetch }` (pinned by lead;
             the registry member is new, see the report to the lead).
GIVEN entries with no `meta.installed` WHEN read THEN `{ clones: [] }` and no git run
GIVEN a clean clone whose copies match upstream WHEN read THEN one clone with `files` `{}` and `fetchFailed` false
GIVEN `fetch: true` WHEN read THEN the first run is the fetch with `timeoutMs` 15000
GIVEN a fetch that exits 1 or times out WHEN read THEN `fetchFailed` is true and the statuses are still computed
GIVEN a modified, an untracked and a renamed file in the scope WHEN read THEN each is uncommitted, the rename's old path ignored
GIVEN `hooks.json` in the diff WHEN read THEN every hook entry of that file is unpushed
GIVEN a copy in CRLF whose LF form is the upstream blob WHEN read THEN that harness is installed
GIVEN a Codex copy that differs, or no copy, or a file absent upstream WHEN read THEN `notInstalled` names that harness
GIVEN no upstream WHEN read THEN only `uncommitted` is computed, and no diff or ls-tree runs
GIVEN git that cannot start WHEN read THEN the clone is kept with `fetchFailed: true` and `readPluginStatus` resolves
GIVEN an unknown source id WHEN the page asks `pluginStatus` THEN it rejects `No docs index source <id>`
Tests:     in `plugin-status.test.ts`, over `createMemoryFiles(clock)`, `FakeProcesses` and `posixPaths`. Fixture: root
           `/Users/u/dev/m`; merged entries (`source: 'repo'`, `owner: 'mine'`, `plugin: 'w@m'`) `A`
           `/Users/u/dev/m/plugins/w/skills/a/SKILL.md` with copies Claude `/Users/u/.claude/plugins/cache/m/w/1.0.0/skills/a/SKILL.md`
           and Codex `/Users/u/.codex/plugins/cache/m/w/0.1.0/skills/a/SKILL.md`; `B` `…/plugins/w/skills/b/SKILL.md`
           with `installed: []`; hook entries `H0`, `H1` with ids `…/plugins/w/hooks/hooks.json#hook:PreToolUse:0` and
           `:1`, path `…/plugins/w/hooks/hooks.json`, each with copies Claude `…/cache/m/w/1.0.0/hooks/hooks.json` and
           Codex `…/cache/m/w/0.1.0/hooks/hooks.json`; plugin entries `kind: 'plugin'`, `plugin: 'w@m'`, `meta.harness`
           `'claude'` and `'codex'`; and `/Users/u/dev/m/AGENTS.md` with no `meta.installed`. Scope `plugins/w`.
           Upstream blob for `a\n` is `78981922613b2afb6025042ff6bd878ac1994e85`.
           `readPluginStatus_NoCloneEntries_NoClones` — only the AGENTS.md entry → `{ clones: [] }`, `runs` `[]`
           `readPluginStatus_CleanClone_NoFiles` — status, diff empty; ls-tree lists A (sha above) and hooks.json with a
             sha its copies match; B is left out of `entries` for this test → clone
             `{ root: '/Users/u/dev/m', fetchedAt: null, fetchFailed: false, files: {} }`
           `readPluginStatus_Fetch_FirstRunCapped` — `fetch: true` → `runs[0]` is `git ['-C', '/Users/u/dev/m', 'fetch', '--quiet']`
             with `timeoutMs` 15000
           `readPluginStatus_NoFetch_NoFetchRun` — `fetch: false` → no run has `fetch` in its args
           `readPluginStatus_FetchExitsOne_FetchFailed` — fetch `{ code: 1, … }` → `fetchFailed` true; A still uncommitted
           `readPluginStatus_FetchTimedOut_FetchFailed` — fetch `{ code: -1, stdout: '', stderr: '', timedOut: true }` → `fetchFailed` true
           `readPluginStatus_StatusRecords_Uncommitted` — status ` M plugins/w/skills/a/SKILL.md\0?? plugins/w/skills/b/SKILL.md\0`
             → `files[A.id].uncommitted` and `files[B.id].uncommitted` true
           `readPluginStatus_RenameRecord_SkipsOldPath` — status `R  plugins/w/skills/a/SKILL.md\0plugins/w/hooks/hooks.json\0`
             → A uncommitted; H0 and H1 not uncommitted
           `readPluginStatus_HooksJsonInDiff_EveryHookUnpushed` — diff `plugins/w/hooks/hooks.json\0` → `files[H0.id]`
             and `files[H1.id]` each `{ uncommitted: false, unpushed: true, notInstalled: [] }`
           `readPluginStatus_CrlfCopy_Installed` — Claude copy bytes `a\r\n`, Codex `a\n` → A not in `files`
           `readPluginStatus_CodexCopyDiffers_NotInstalledCodex` — Codex copy `old\n` → `files[A.id].notInstalled` `['codex']`
           `readPluginStatus_NoCopies_NotInstalledEveryHarness` — ls-tree lists B → `files[B.id].notInstalled` `['claude', 'codex']`
           `readPluginStatus_AbsentUpstream_NotInstalled` — ls-tree omits A → `files[A.id].notInstalled` `['claude', 'codex']`
           `readPluginStatus_OnlyClaudePlugin_CodexNotChecked` — drop the Codex plugin entry; ls-tree lists B →
             `files[B.id].notInstalled` `['claude']`
           `readPluginStatus_NoUpstream_OnlyUncommitted` — rev-parse `@{u}` `{ code: 128, … }`, status names A → `files`
             `{ [A.id]: { uncommitted: true, unpushed: false, notInstalled: [] } }`; no run has `diff` or `ls-tree`
           `readPluginStatus_FetchHead_FetchedAtIso` — `--git-path` prints `.git/FETCH_HEAD\n`; that file written at
             clock `Date.parse('2026-10-24T09:30:00.000Z')` → `fetchedAt` `'2026-10-24T09:30:00.000Z'`
           `readPluginStatus_NoFetchHead_FetchedAtNull` — the file absent → `fetchedAt` null
           `readPluginStatus_GitCannotStart_CloneKept` — nothing scripted → resolves to one clone with
             `fetchFailed: true`, `files: {}`, `fetchedAt: null`
           `readPluginStatus_DiffFails_KeepsUncommitted` — status names A, diff `{ code: 128, … }` → `fetchFailed` true,
             `files[A.id].uncommitted` true; no ls-tree run; one log line starting `plugin status /Users/u/dev/m: `
           `readPluginStatus_TwoClones_OrderOfFirstEntry` — a second root `/Users/u/dev/n` listed after the first →
             `clones.map((c) => c.root)` `['/Users/u/dev/m', '/Users/u/dev/n']`
           `readPluginStatus_ScopeIsRoot_PathspecDot` — merged entries at `/Users/u/dev/m/a.md` and `/Users/u/dev/m/x/b.md` →
             the status run's last arg is `.`
           in `index-sources.test.ts`: `sourceEntries_EachSource_ItsOwnEntries` — after `withSessionLoaded()`,
             `sourceEntries('machine')` equals `[ENTRY]` and `sourceEntries('session:row-1')` equals `[SESSION_ENTRY]`;
             `sourceEntries_UnknownId_Throws` — throws `No docs index source nope`
           in `start.test.ts`: `pluginStatus_UnknownSource_Rejects` — `invoke('pluginStatus', 'nope', false)` rejects
             `No docs index source nope`; `pluginStatus_MachineSourceNoClones_Empty` — after `loadIndex('machine')`,
             `invoke('pluginStatus', 'machine', false)` resolves `{ clones: [] }`
Done when: `npm run typecheck`, `npm test` and `npm run lint` pass; `grep -n "meta.installed\|meta\['installed'\]" -r src/plugins/docs`
           finds only `index-document.ts`. Live fetch against the real clone: task 14.
Commit:    one commit for the group, in wigley-ai-gui, committed by path only (peer sessions have uncommitted edits)

## Lead rulings (cold plan reader)

- One `git fetch` per clone root at a time in main: a read that asks to fetch a clone while a fetch of it runs waits for that fetch's result and runs none of its own. Test: two `readPluginStatus` calls with `fetch: true` at once give one scripted `fetch` run in the fake processes service and the same `fetchFailed`.
- `fetchFailed` comes from the fetch step only. Another git failure (status, diff, ls-tree, rev-parse) logs `plugin status <root>: <reason>` and leaves the statuses computed so far; it never sets `fetchFailed`. Renumber the algorithm steps so every step reference matches.
- A porcelain rename or copy (`R` or `C`) in either the X or the Y column marks both paths uncommitted. Add one porcelain fixture line with Y = `R`.

## Proof

Commit gui 31a6132a · proof: diff read: readPluginStatus, PluginStatusDeps, sourceEntries and the pluginStatus handler present; tsc clean · concerns: fetch dedupe is module-level state (the pinned signature leaves no other home); contract.ts's pluginStatus comment omits the unknown-source rejection; an installed copy is re-read per entry, no cache
