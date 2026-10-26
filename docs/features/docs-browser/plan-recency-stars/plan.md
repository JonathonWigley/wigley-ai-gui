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
- [ ] [Listing names and the transcript load reader](01-load-reader.md)
- [ ] [Schema 4 in the app](04-app-schema.md)

### Wave 2
- [ ] [Last-loaded times in the index](02-index-times.md) — after 01
- [ ] [Tree order and the Starred group](05-tree-order.md) — after 04
- [ ] [Loaded-time text and the star set](06-time-and-stars.md) — after 04 (shares `page/docs-state.ts`)

### Wave 3
- [ ] [Marketplace version bump](03-marketplace-bump.md) — after 02
- [ ] [Page wiring: star key, row times, doc view line](07-page-wiring.md) — after 05, 06

### Wave 4
- [ ] [Self-test steps](08-selftest.md) — after 07

### Wave 5
- [ ] [Doc re-read](09-doc-re-read.md) — after 03, 08

### Wave 6
- [ ] [Final verification](10-final-verification.md) — after 09

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
