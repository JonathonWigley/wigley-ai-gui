# Docs ownership and plugin-source status — plan

Feature: docs-browser plan C · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui and `main` in wigley-ai-marketplace · Written: 2026-10-24

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The Docs view splits every doc into **Mine** (the user's own files on disk: the global layer, every repo clone and
feature home, the user's marketplace clone) and **Third-party** (downloaded copies: plugins whose marketplace has no
clone on the machine, and synced skills), collapsed at the bottom and read-only. The user's own plugin files show once,
at their path in the marketplace clone, carrying the load states of their installed copies and four statuses per
file: uncommitted, unpushed, not installed for a harness, and session stale.

## Architecture

Two repos, one schema between them (no fallback: `AGENTS.md` § Intent, one user):

- **wigley-ai-marketplace** — `plugins/wigley/scripts/docs-index/` (`docs_index.py`): decides `owner`, indexes
  marketplace clones' plugins, merges installs into the clone's entries (`meta.installed`), adds `skill-file`
  entries and the session context's `loadedPlugins`. Schema 2 → 3. The README already states the result (Docs
  written ahead).
- **wigley-ai-gui** — `src/plugins/docs/`: reads schema 3, groups the tree by `owner`, refuses changes to third-party
  docs in main's guard, and computes the git statuses in main through the `processes` service (`ProcessRunner`), which
  gains a timeout for the capped fetch.

The index reads no git beyond the origin URL; the app reads no plugin config. Each side owns one question.

## Preconditions

Each was verified at plan time (2026-10-24) and is re-run by `wigley:make` before the first dispatch.

- This machine's index config indexes the clones: `cat ~/.agents/wigley-docs/config.json` shows `"roots": ["D:/ai-dev"]`
  (changed this session at the user's yes; machine-local, not committed).
- The marketplace URL matches the clone's origin: `~/.claude/plugins/known_marketplaces.json`
  `wigley-ai-marketplace.source.url` and `~/.codex/config.toml` `[marketplaces.wigley-ai-marketplace] source` are both
  `git@github-personal:JonathonWigley/wigley-ai-marketplace.git`, and so is `git -C D:/ai-dev/wigley-ai-marketplace
  remote get-url origin`.
- The clone's `.claude-plugin/marketplace.json` names `wigley-ai-marketplace` with plugin `wigley`, source
  `./plugins/wigley`.
- Installed copies, measured at plan time, re-verify: Claude `~/.claude/plugins/cache/wigley-ai-marketplace/wigley/1.9.1`
  (`installed_plugins.json` records `gitCommitSha`), Codex `~/.codex/plugins/cache/wigley-ai-marketplace/wigley/0.17.1`
  (no commit recorded).
- A transcript names a plugin's cache folder with its version: `command grep -a -o
  'plugins[\\/]*cache[\\/]*wigley-ai-marketplace[\\/]*wigley[\\/]*[0-9.]*' <latest ~/.claude/projects/*/*.jsonl>`
  prints `…\wigley\1.9.1` (a skill's "Base directory for this skill" line).
- `git -C D:/ai-dev/wigley-ai-marketplace config core.autocrlf` is `true`: working files and installed copies may be
  CRLF where the blob is LF (task 08's blob compare).
- The app runs the **installed** `docs_index.py` (`src/plugins/docs/main/script-locator.ts`, through
  `installed_plugins.json`) unless the `docs.scriptPath` setting names another; the live check in task 14 points it at
  the clone.
- Peer sessions hold uncommitted edits in both repos (measured at plan time: marketplace `scripts/check_pointers.py`,
  `docs/features/shared-thinking/…`; gui `src/plugins/forms/…`). They are not this plan's: commit by path only.

## Docs written ahead

- wigley-ai-marketplace `d7a2e51b`, `0a95298d` — `plugins/wigley/scripts/docs-index/README.md`: schema 3 (`owner`,
  marketplace clones, merged installs and `meta.installed`, `skill-file`, `loadedPlugins`, their load rules; `context`
  and `session` find marketplace clones under every root).
- wigley-ai-gui `d53b201c` — `docs/features/docs-browser/design.md` (Tree, Read-only docs, § Ownership and
  plugin-source status (plan C), Out of scope) and `docs/features/followups.md` (the plugin sync action).

## Mandatory Reads

- wigley-ai-gui `AGENTS.md`, `DESIGN.md` (every page task), `docs/features/docs-browser/design.md`
- wigley-ai-marketplace `AGENTS.md`, `plugins/wigley/scripts/docs-index/README.md`
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in either repo (globbed at plan time).

## Design Overview

```
                    wigley-ai-marketplace: docs_index.py (schema 3)
 roots ─► repo walk ─► marketplace clone? ─► walk each listed plugin's source folder
                                               entries: source repo, plugin <p>@<m>, owner mine
 installs ─► plugin walk ─► marketplace URL owner/repo == a clone's origin?
                              ├ yes: per file with a counterpart (rel path + #hook fragment)
                              │        drop the install entry; clone entry.installed += Location
                              │        (load rules judge it there; meta.installed exports it)
                              │      no counterpart: keep, source plugin, owner mine (installed only)
                              └ no:  owner third-party
 ~/.claude/skills/synced/** ─► owner third-party
 skill folders ─► skill-file entries (meta.skill), not-loaded
 session ─► context.loadedPlugins from cache paths in the transcript
                                   │ index.json / stdout
                                   ▼
                    wigley-ai-gui: src/plugins/docs
 main: index-document.ts parse (schema 3) ─► sources ─► path-guard (third-party refused)
       plugin-status.ts ─► git (status, ls-tree @{u}, diff @{u}...HEAD, fetch ≤15 s) ─► pluginStatus
 page: tree.ts  Mine ▸ Global, repo ▸ kinds, plugin ▸ kinds, Installed only; features
                Third-party (collapsed) ▸ Synced skills, plugin ▸ kinds
       doc-view  read-only line · status chips · session stale
       tree-view row status marks and plugin / repo rollups
```

**Decisions** (interview 2026-10-24; the design doc holds the full set)

- Ownership is `owner` on each entry, decided by the index; the app groups, guards and offers create places by it.
- A cache copy of an owned plugin merges into the clone entry (round 5); third-party is a collapsed root (round 6);
  third-party and installed-only docs are read-only (round 8; caches were already refused, synced skills are new).
- The clone match compares URL `<owner>/<repo>`, case-insensitive, `.git` dropped (Decided).
- Statuses replace a content-compare badge: plan C folded in (round 9). Not installed compares the installed copy
  with `origin/<branch>` per file, for both harnesses (Decided). Fetch in the background on first open and Rescan,
  15 s cap (round 10).
- The index keeps installed locations apart from `walked`: `walked` paths are trashed with the file, an installed copy
  never is (Decided, design review).

**Out of scope**: the plugin sync action (`followups.md`), any change to how the app finds `docs_index.py`, Codex's
stale 0.17.1 install (the statuses will show it; updating it is the user's).

## File Structure

**wigley-ai-marketplace** `plugins/wigley/scripts/docs-index/`

- `model.py` — `SCHEMA_VERSION = 3`; `KINDS` gains `skill-file` after `skill`; `OWNERS = ("mine", "third-party")`;
  `Entry` gains `ownership: str = "mine"` (checked against `OWNERS`; named so because `Entry.owner` is already the
  `Owner` property; emitted as JSON `owner`) and `installed: tuple[Installed, ...] = ()`;
  `Installed(location: Location, harness: str, version: str)`, the location's owner the install's plugin `Owner`;
  `Entry.locations` returns the real path, each walked location, then each installed location; `to_json` emits
  `owner` after `source`, `walked` from walked locations only, and, for a marketplace clone plugin file,
  `meta.installed` as `[{harness, version, path}]`. `Context` gains `loaded_plugins: dict[str, str]`, emitted as
  `loadedPlugins`.
- `discover.py` — marketplace clones, the URL match, the merge, `owner`, `skill-file` walk.
- `environment.py` — marketplace URLs: `claude_marketplace_urls(config_dir) -> dict[str, str]` from
  `<config_dir>/plugins/known_marketplaces.json` (`<name>.source.url`, or `source.repo` for a `github` source),
  `codex_marketplace_urls() -> dict[str, str]` from `[marketplaces.<name>] source`; `origin_url(repo_root) -> str |
  None` (the `git remote get-url origin` call the repo name already makes, now shared) and `repo_slug(url) -> str |
  None` (`<owner>/<repo>`, lower-case, `.git` dropped).
- `claude_rules.py`, `codex_rules.py` — `skill-file` is `not-loaded`; nothing else changes (installed locations reach
  the rules through `Entry.locations`).
- `session.py` — `loadedPlugins`.
- `tests/` — beside each module.
- `plugins/wigley/.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` — one version bump for the series.

**wigley-ai-gui** `src/`

- `contracts/processes.ts`, `main/processes/node-processes.ts`, `shared/fake-processes.ts` — `run` options gain
  `timeoutMs?: number`: past it the program is killed and `run` resolves `{ code: -1, stdout, stderr, timedOut: true }`;
  `ProcessResult` gains `timedOut: boolean` (false otherwise).
- `plugins/docs/contract.ts` — shared names, used across parts:
  - `DocKind` gains `'skill-file'`; `export type DocOwner = 'mine' | 'third-party';` `IndexEntry.owner: DocOwner`
  - `export interface InstalledCopy { harness: IndexHarness; version: string; path: string }`
  - `IndexContext.loadedPlugins: Record<string, string>`
  - `export interface FileStatus { uncommitted: boolean; unpushed: boolean; notInstalled: IndexHarness[] }`
  - `export interface CloneStatus { root: string; fetchedAt: string | null; fetchFailed: boolean; files: Record<string, FileStatus> }`
    — `files` keyed by entry id, holding only entries with a status set; `fetchedAt` the clone's `FETCH_HEAD` time
    (ISO), null when never fetched
  - `export interface PluginStatusRead { clones: CloneStatus[] }`
  - `DocsChannel.invoke.pluginStatus(sourceId: string, fetch: boolean): Promise<PluginStatusRead>`
- `plugins/docs/index-document.ts` — `INDEX_SCHEMA_VERSION = 3`; parse checks `owner` and `loadedPlugins`;
  `export function installedCopies(entry: IndexEntry): InstalledCopy[] | null` (null: not a clone plugin file).
- `plugins/docs/main/plugin-status.ts` (new) — `export async function readPluginStatus(entries: readonly IndexEntry[],
  deps: PluginStatusDeps, options: { fetch: boolean }): Promise<PluginStatusRead>`, `PluginStatusDeps { processes;
  files; paths; log }`; one deep module behind the git calls, testable over the fake processes and files services.
- `plugins/docs/main/index-sources.ts` — `IndexSourceRegistry` gains `sourceEntries(id: string): readonly
  IndexEntry[]` (throws `No docs index source <id>`), which the `pluginStatus` handler in `main/start.ts` reads.
- `plugins/docs/path-guard.ts`, `main/doc-files.ts` — `GuardFolders` gains `thirdPartyFolders` (each Claude config
  folder's `skills/synced`); an entry with `owner: 'third-party'` is refused like a cache file.
- `plugins/docs/kinds.ts` — `placesFor` offers no place from a third-party entry.
- `plugins/docs/tree.ts` — `KIND_TITLES['skill-file'] = 'Skill files'` (06, so the `Record<DocKind, string>`
  compiles); `buildTree` roots by owner, `MINE_ROOT_ID = 'owner:mine'`, `THIRD_PARTY_ROOT_ID = 'owner:third-party'`
  (10); `GroupRole` and `TreeGroup.role` for the page's rollups (11).
- `plugins/docs/page/` — `docs-state.ts` (06: `provisionalEntry` gets `owner: 'mine'`; 11: read-only reasons,
  default expansion, status texts and rollups), `doc-view.ts`, `tree-view.ts`, `docs-view.ts` (11).
- `plugins/docs/main/selftest-fixture.ts`, `selftest-script.ts` — schema 3 fixture and the new steps.

Boundary rules: the page reaches git only through `pluginStatus`; no module outside `index-document.ts` reads
`meta.installed`'s shape; no `process.platform` check (CRLF handling is by content, not OS).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Tasks 01–05 land in wigley-ai-marketplace, 06–14 in wigley-ai-gui (each task document names its repo).

### Wave 1
- [x] [Index model, schema 3](01-index-model.md)
- [x] [Process timeout](07-process-timeout.md)

### Wave 2
- [ ] [Index discovery: marketplace clones, merge, owner, skill files](02-index-discovery.md) — after 01
- [x] [Index load rules for skill files](03-index-load-rules.md) — after 01
- [x] [Session loaded plugins](04-session-loaded-plugins.md) — after 01
- [ ] [Docs contract and index parse, schema 3](06-docs-contract.md) — after 07 (both edit
  `index-sources.test.ts` and `start.test.ts`)

### Wave 3
- [ ] [Marketplace version bump and Done checks](05-marketplace-bump.md) — after 02, 03, 04
- [ ] [Plugin status in main](08-plugin-status.md) — after 06, 07
- [ ] [Write guard and create places by owner](09-guard-by-owner.md) — after 06
- [ ] [Tree by owner](10-tree-by-owner.md) — after 06

### Wave 4
- [ ] [Docs page: read-only, statuses, rollups](11-docs-page.md) — after 08, 09, 10

### Wave 5
- [ ] [Self-test steps](12-selftest.md) — after 11

### Wave 6
- [ ] [Doc re-read](13-doc-re-read.md) — after 05, 12

### Wave 7
- [ ] [Final verification](14-final-verification.md) — after 13

## Run log

Review base: 9d343328c9cc19209b8fe375398e619c8268df71

### Groups
- 01 · marketplace 74c824a6 · diff read: every Produces present in model.py; py_compile clean · concerns: full docs-index suite fails on this machine before and after (Windows: symlink privilege WinError 1314 and / separators, 15F/26E at HEAD; WSL: Python 3.8 has no tomllib)
- 07 · gui d4ad2fae · diff read: timeoutMs and timedOut present in contracts/processes.ts, adapter and fake; tsc clean · concerns: none
- 03 · marketplace 689b9c5f · diff read: skill-file not-loaded in both rule sets, installed locations judged; py_compile clean · concerns: a disabled installed copy (Codex [[skills.config]], disabled Claude plugin) reports 'no load rule reaches this file' because the clone path is judged first and best_state keeps the first of equal states; the Codex merged-skill test checks the state only; fixes proposed: best_state prefers a specific reason, installed-first locations, or skipping the clone path
- 04 · marketplace d602e09f · diff read: loaded_plugins filled in read_session and passed to Context; py_compile clean · concerns: cache-path match is case-sensitive (a differently cased Windows realpath misses); a \/-escaped path misses; regex speed on megabyte lines unmeasured
### Contract changes
### Rulings
- Two repos, two review bases: wigley-ai-gui 9d343328c9cc19209b8fe375398e619c8268df71 (the Review base line), wigley-ai-marketplace 37925feee7539acde5790672bcf9a3f9eb781a60; peer session ai-dev-9e on the same trees, so every commit is pathspec-scoped and each review range is an explicit commit list — lead
- Stale precondition refreshed: the installed Claude copy is now wigley 1.10.0 (gitCommitSha 37925fee), not 1.9.1; the plugin.json version is 1.10.0, so task 05 bumps from 1.10.0 — lead
- Installed's harness error reads 'installed <path>: harness <h> is not one of HARNESSES', matching Entry's checks — no task named it — a wording change only · group 01 · group 01
- The timeout test uses timeoutMs 3000 (the lead's cap) rather than the Tests line's 500, asserting under 5000 ms; the child stays alive on setTimeout since stdin is 'ignore' — a slower test only · group 07 · group 07
### Review rounds
### Test gate
