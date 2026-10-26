# Docs recency order, last-loaded times and starred docs — plan

Feature: docs-browser plan D · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui and `main` in wigley-ai-marketplace · Written: 2026-10-26

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The docs tree orders the docs in each group by when an agent session last loaded them, newest first. Each doc row
shows that time, short and relative, and the doc view shows `Loaded <time> ago`. The user stars a doc with `s`, and a
Starred group above Mine lists every starred doc. Docs mode uses machine-wide times; a session's Docs tab uses that
session's own times.

## Architecture

Two repos, one schema between them (no fallback: wigley-ai-gui `AGENTS.md` § Intent, one user):

- **wigley-ai-marketplace** — `plugins/wigley/scripts/docs-index/`: reads load events from Claude Code transcripts,
  keeps an incremental cache, and writes each entry's `lastLoaded`. Schema 3 → 4. The README already states the
  result (Docs written ahead).
- **wigley-ai-gui** — `src/plugins/docs/`: reads schema 4, sorts each group's docs by `lastLoaded`, draws the time on
  rows and in the doc view, and keeps one star set in the plugin's `uiState`, shared by every docs view.

The index owns "when was it loaded". The app owns the order, the drawing and the stars.

## Preconditions

Each was verified at plan time (2026-10-26). `wigley:make` re-runs each before the first dispatch.

- Both repos are on `main`, level with `origin/main` except unpushed docs commits:
  `git -C <repo> log --oneline origin/main..main`, after a `git fetch`, prints this plan's `86be58f`, `0285c19`
  (marketplace) and `169da18` plus the plan folder's commit (gui), and the peer primer-port plan's `804cf0e`
  (marketplace) and `1722d1e` (gui). A peer session holds uncommitted edits under `docs/features/primer/` in the
  gui (measured at plan time): they are not this plan's, so every commit goes by path only.
- The peer plan `docs/features/primer/plan-primer-port/` overlaps this one in two places: it bumps the marketplace
  version (task 03 handles a bump already made), and it deletes `plugins/wigley/scripts/primer/` and
  `plugins/wigley/scripts/dashboard/` (task 03 runs only the suites whose folders exist).
- The marketplace plugin version is `1.10.2` locally and on origin:
  `grep '"version"' plugins/wigley/.claude-plugin/plugin.json` and
  `git show origin/main:plugins/wigley/.claude-plugin/plugin.json | grep '"version"'`.
- `python3 --version` is 3.11 or later (3.15.2 at plan time; the index needs `tomllib` and `datetime.fromisoformat`
  with a `Z` suffix).
- The gui reads schema 3 only: `INDEX_SCHEMA_VERSION = 3` in `src/plugins/docs/index-document.ts:14`, and
  `schemaVersion: 3` in `src/plugins/docs/contract.ts:94` and `src/plugins/docs/main/selftest-fixture.ts:349`.
- The machine index config lists both Claude config folders: `~/.agents/wigley-docs/config.json` `claudeConfigDirs`
  is `["~/.claude", "~/.claude-personal"]`.
- Transcript row shapes (measured at plan time, re-verify): every real row has a top-level `timestamp`;
  `api-request-blob` rows have none and repeat tool calls; transcripts are compact JSON (`"type":"attachment"` with
  no space). Check on the newest transcript:
  `command grep -a -c '"type":"api-request-blob"' <newest ~/.claude-personal/projects/*/*.jsonl>` is above 0, and
  `command grep -a -c '"type":"attachment"' <same file>` is above 0.
- Subagent transcripts sit at `projects/<project>/<session>/subagents/agent-*.jsonl` and
  `…/subagents/workflows/wf_*/agent-*.jsonl`, with `journal.jsonl` files of another shape beside some:
  `find ~/.claude-personal/projects -path '*/subagents/*' -name '*.jsonl' | head -3`.
- The app runs the installed `docs_index.py` (`src/plugins/docs/main/script-locator.ts`) unless the `docs.scriptPath`
  setting names another. The installed plugin stays at schema 3 until the user updates it, so the final
  verification points `docs.scriptPath` at the clone.

## Docs written ahead

- wigley-ai-marketplace `86be58f`, `0285c19` — `plugins/wigley/scripts/docs-index/README.md`: schema 4, `lastLoaded`, § Last
  loaded (transcripts read, the load table, matching, the `loads.json` cache), the Commands table.
- wigley-ai-gui `169da18` — `docs/features/docs-browser/design.md` (§ Recency and stars (plan D), the Plans list, the
  `s` key, Out of scope), `docs/features/followups.md` (Codex last-loaded times), `AGENTS.md` (the Starred root in the
  docs plugin line).

## Mandatory Reads

- wigley-ai-gui `AGENTS.md`, `DESIGN.md` (every page task), `docs/keymap.md` (task 07),
  `docs/features/docs-browser/design.md`
- wigley-ai-marketplace `AGENTS.md`, `plugins/wigley/scripts/docs-index/README.md`
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in either repo (globbed at plan time).

## Design Overview

```
            wigley-ai-marketplace: docs_index.py (schema 4)

 build / context ──► machine_load_times(env)
                       read ~/.agents/wigley-docs/loads.json
                       for each transcript under each claudeConfigDirs/projects:
                         read_loads(file, offset) ──► LoadTimes + new offset
                       write loads.json (temp file, then rename)
 session <id> ─────► session_load_times(transcript)   <id>.jsonl + <id>/subagents/**
                       read_loads(file, 0) per file, no cache
                              │
                              ▼
            last_loaded(env, entry, times) per entry
            (real path of each location; listing name for subagent, command)
                              │
                              ▼
            Entry.last_loaded ──► to_json "lastLoaded"

            wigley-ai-gui: docs plugin page

 index document (schema 4) ──► buildTree(entries, homeDir, paths, starred)
                                 Starred group (when any) above Mine
                                 every group: docs newest-loaded first
                                 ▲
 StarredDocs (uiState "starred") ─┘  one per page, shared by every view
   toggle ◄── `s` on a doc row (docs.toggleStar)
   applyChange ◄── start.ts changedIn (rename moves, trash drops)
   onChanged ──► each view rebuilds its tree

 tree row: title · status · loadedAgo(lastLoaded, now) dimmed, loadedAt on hover
 doc view: load chips · "Loaded <loadedAgo> ago"
```

**Out of scope**

- Codex last-loaded times (`docs/features/followups.md`).
- Load states stay as they are; a `Read` or skill call does not change a session's load state.
- No timer redraws the times; a redraw of the tree draws them fresh.

**Decisions** (settled in the 2026-10-26 interview; design doc § Recency and stars has the user-facing rules)

- `lastLoaded` is an entry field, ISO 8601 string or null. `build` and `context` give machine-wide times; `session`
  gives the session's own. (round 2, Decided)
- One reader of transcript load events (`loads.py`), used by the machine scan and the session scan. (design review:
  locality)
- `_listing_name` and `_is_synced_skill` move from `session.py` to a new `listing.py`, unchanged, so `session.py` and
  `loads.py` share them. (design review: widen a helper, never copy it)
- Times compare as parsed datetimes; the stored string is the row's own `timestamp` text. (lead)
- The tree module stays pure: the star set and the load times enter `buildTree` as data. (design review)
- The star set is one page module over `uiState`, created once in `page/start.ts` and handed to every view. (round 1,
  Decided: one star set)
- The relative time takes `now` from a new page `services.clock` (`PageServices` has none today; main's
  `MainServices.clock` is the pattern). (design review: ambient service injected, AGENTS.md § Ambient service)
- Opening a doc from elsewhere selects its usual place, not its Starred row. (design review)
- The Starred group carries no status rollup. (design review: counts are not doubled)

## File Structure

**wigley-ai-marketplace** `plugins/wigley/scripts/docs-index/`

- create `listing.py` — `listing_name(env, entry, location) -> str` and `is_synced_skill(env, path) -> bool`, moved
  from `session.py` (`_listing_name`, `_is_synced_skill`, with `SYNCED_SKILLS_PREFIX`).
- create `loads.py` — the transcript load reader, the machine scan with its cache, the session scan, and
  `last_loaded`. Public surface, shared by tasks 01 and 02:
  - `@dataclass class LoadTimes` with `paths: dict[str, str]` (real path → ISO time) and
    `names: dict[str, str]` (`"subagent:<name>"` or `"command:<name>"` → ISO time), and
    `def merge(self, other: LoadTimes) -> None` (keeps the later time per key).
  - `def read_loads(transcript: Path, offset: int = 0) -> tuple[LoadTimes, int]`
  - `def machine_load_times(env: Environment) -> LoadTimes`
  - `def session_load_times(transcript: Path) -> LoadTimes`
  - `def last_loaded(env: Environment, entry: Entry, times: LoadTimes) -> str | None`
  - `LOADS_PATH_PARTS = (".agents", "wigley-docs", "loads.json")`
- modify `session.py` — imports `listing_name` from `listing.py`; `SessionTranscript` gains
  `transcript: Path`.
- modify `model.py` — `SCHEMA_VERSION = 4`; `Entry.last_loaded: str | None = None`; `to_json` adds `"lastLoaded"`.
- modify `docs_index.py` — `_build`, `_context` and `_session` set each entry's `last_loaded`.
- tests `tests/test_listing.py` (only if the move needs one; the existing session tests cover it),
  `tests/test_loads.py`, `tests/test_model.py`, `tests/test_docs_index.py`, `tests/test_session.py`.
- modify `plugins/wigley/.claude-plugin/plugin.json`, `plugins/wigley/.codex-plugin/plugin.json` — version.

**wigley-ai-gui** `src/plugins/docs/`

- modify `src/contracts/plugin.ts` (`PageServices.clock: Clock`) and `src/renderer/renderer.ts` (fills it) — task 07.
- modify `contract.ts` — `IndexEntry.lastLoaded: string | null`; `IndexDocument.schemaVersion: 4`.
- modify `index-document.ts` — `INDEX_SCHEMA_VERSION = 4`; parsing reads `lastLoaded`.
- modify `main/selftest-fixture.ts` — schema 4 and `lastLoaded` on its entries.
- modify `page/docs-state.ts` — entries the page makes before a build (`provisionalEntry`) carry `lastLoaded`
  (task 04); `movedEntryId` and `isEntryIdInside`, the entry id rewrite `renamedDocument` uses, exported for the
  star set (task 06); `expandNewStarred` (task 07).
- modify `tree.ts` — `buildTree(entries, homeDir, paths, starred: ReadonlySet<string>)`; `STARRED_ROOT_ID =
  'owner:starred'`; Starred leaf ids `owner:starred/entry:<entryId>`; docs newest-loaded first in every group.
- create `loaded-time.ts` — `loadedAgo(iso: string, now: number): string`, `loadedAt(iso: string): string` and
  `loadedLine` (the doc view's sentence; signature in task 06).
  Shared code both processes may use; the page alone calls it today.
- create `page/starred-docs.ts` — `createStarredDocs(uiState: UiState, paths: Paths): StarredDocs`, with
  `interface StarredDocs { ids(): ReadonlySet<string>; has(entryId: string): boolean; toggle(entryId: string): void;
  applyChange(change: DocChangeRecord): void; onChanged(listener: () => void): Disposable }`.
- modify `manifest.ts`, `src/plugins/keymap.ts` — command `toggleStar` in scope `docs.tree`, key `s`.
- modify `page/tree-view.ts` (`LeafMarks`), `page/docs-view.ts`, `page/doc-view.ts`, `page/start.ts`, `page/docs.css`
  — page wiring.
- modify `main/selftest-script.ts` — self-test steps for the star and the order.
- tests beside each module: `tree.test.ts`, `index-document.test.ts`, `loaded-time.test.ts` (new),
  `page/starred-docs.test.ts` (new), `page/docs-state.test.ts`, `main/selftest-fixture.test.ts`, and every test
  that builds an `IndexEntry` or a stand-in index (task 04 lists them).

**Boundary rules**

- The schema changes in both repos in this run; neither keeps a schema 3 path.
- `loaded-time.ts` sits beside `tree.ts` (plugin root, no DOM, no clock read). `starred-docs.ts` sits in `page/`
  (it holds page state). `npm run lint`'s layer check must pass with no new `LAYERS` entry; if it needs one, the
  task adds it.
- The app reads no transcript; the index draws nothing.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Listing names and the transcript load reader](01-load-reader.md)
- [x] [Schema 4 in the app](04-app-schema.md)

### Wave 2
- [x] [Last-loaded times in the index](02-index-times.md) — after 01
- [x] [Tree order and the Starred group](05-tree-order.md) — after 04
- [x] [Loaded-time text and the star set](06-time-and-stars.md) — after 04 (shares `page/docs-state.ts`)

### Wave 3
- [x] [Marketplace version bump](03-marketplace-bump.md) — after 02
- [x] [Page wiring: star key, row times, doc view line](07-page-wiring.md) — after 05, 06

### Wave 4
- [x] [Self-test steps](08-selftest.md) — after 07

### Wave 5
- [x] [Doc re-read](09-doc-re-read.md) — after 03, 08

### Wave 6
- [x] [Final verification](10-final-verification.md) — after 09

## Run log

Review base: db28609cefd0114b348eff18e3ba9cb8baf5ca66

### Groups
- 04 · c3f1719 · diff read: all 5 Produces present; typecheck pass; worker ran docs tests (442) and lint green · concerns: Done-when grep for schemaVersion: 3 still hits index-document.test.ts:98, the required parse_Schema3_Unsupported input — kept
- 01 · d73a6b1 (marketplace) · diff read: all 6 Produces present; py_compile + docs-index unittest discover OK · concerns: session.py dropped the orphaned Location import
- 05 · 7ca9a37 · diff read: STARRED_ROOT_ID and 4-arg buildTree present; typecheck pass · concerns: none
- 06 · c303a00 · diff read: loadedAgo/loadedAt/loadedLine, createStarredDocs/StarredDocs, movedEntryId/isEntryIdInside present; typecheck pass · concerns: entry ids split at first #, so a path holding # mis-matches — now reaches renamedDocument too, which used entry.path before; renamedDocument no longer checks id starts with entry.path
- 02 · adf9e75 (marketplace) · diff read: all 8 Produces present; docs-index unittest discover OK · concerns: none raised; lead note: session_load_times does not catch OSError on a subagent file vanishing mid-read
- 03 · 621ee51 (marketplace) · both manifests 1.10.3; check_manifests (+--against origin/main), check_pointers, claude plugin validate, and all 9 unittest suites (dashboard and primer still present) exit 0 · concerns: none
- 07 · 0ec60ee · diff read: PageServices.clock, toggleStar command + s bind, LeafMarks, expandNewStarred present; typecheck pass; star-full codicon exists · concerns: renderer builds the clock inline rather than as a module constant like timers; a star change redraws other views before outsideChange applies a rename, so one short-lived tree without Starred
- 08 · ce66200 · diff read: recency and stars group present; typecheck pass · concerns: row counts in steps 6 and 8 assume Instructions stays expanded after the earlier filter groups — npm run selftest at task 10 proves it
- 09 · b3daa93 (marketplace), 17de0c3 (gui) · diff read: README timestamp rule and cache paragraph, AGENTS.md Done gains dashboard+primer, design.md Starred rules — each matches landed code; followups.md, gui AGENTS.md, keymap.md not stale · concerns: none
- 10 · none (no fix needed) · all 5 checks pass: schema 4 real build (1638 entries, all lastLoaded), session times, npm run selftest 551 PASS, drive captures in .drive/v10-recency/screenshots match DESIGN.md (lead viewed starred.png, docview-loaded.png), stars survive restart · concerns: cold real build 66.7 s vs ~30 s expected (warm 15.4 s); a file read only through Bash cat is not a load, so the installed plan-folder.md had no time
### Contract changes
### Rulings
- Two repos: gui review base db28609 (above), marketplace review base 0285c19; peer session ai-dev-4e on the same trees, so every commit is pathspec-scoped and review ranges are this run's commit lists — two bases, one Review base line — wrong base would mis-scope the review · lead
- The 'no schemaVersion: 3' grep in task 04's Done when excludes the parse_Schema3_Unsupported test input, which the same task requires — the grep meant fixtures/literals, not the refusal test — none · lead · group 04
- An empty stripped command name or empty skill <dir> adds nothing — matches the non-empty-name rule — none · group 01 · group 01
- LoadTimes.merge does not validate times; a reader of cached times must reject offset-less ones or merge raises TypeError — carried to task 02 — a crash on a bad cache · group 01 · group 01
- applyChange counts a rename or trash as a change only when the resulting set differs — same result on every listed test — a spurious save/notify if wrong · group 06 · group 06
- Cache version and offsets must be exactly int (type is int), rejecting true and 1.0 too — stricter than spec's not-bool — none · group 02 · group 02
- Corrupt-cache test gains a case for a cached time with no UTC offset, the check that keeps merge from raising — none · group 02 · group 02
- toggleStar spots a Starred row by the STARRED_ROOT_ID + '/' prefix — no third copy of the leaf-id literal — none · group 07 · group 07
- expandNewStarred runs on every setTree but the first tree with rows — a Starred group appearing later starts expanded — none · group 07 · group 07
### Review rounds
### Test gate
- gui: typecheck + lint (PageServices contract change reaches every plugin stub); vitest src/plugins/docs, src/plugins/keymap, src/plugins/keys, src/renderer (changed modules, keymap bind, renderer services) — 45 files, 771 tests pass; marketplace: docs-index unittest discover (changed suite) 233 OK, all other marketplace suites ran green at task 03 and 09 touched docs only · pass
