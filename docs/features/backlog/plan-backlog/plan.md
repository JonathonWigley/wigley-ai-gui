# Backlog mode — plan

Feature: Backlog mode · Implements: none · Ticket: none
Target: wigley-ai-gui `main`, wigley-ai-marketplace `main` · Written: 2026-10-26

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Add Backlog mode to wigley-ai-gui. It lists the future work that the user's wigley workflows wrote in every features
home, grouped by repo. Follow-ups get create, read, edit, delete and tags. Plans and primed features are read-only.
A follow-up can carry the `agent-ready` tag. Skills write that tag, a one-time backfill tags the existing
follow-ups, and the user toggles it in Backlog.

## Architecture

Systems touched:

- wigley-ai-gui: a new `backlog` plugin (main and page parts), a new pure module `src/shared/followups/`, a new
  `Git` contract with its adapter `src/main/git/`, new main exports on the `docs` plugin, and Docs' create dialog.
- wigley-ai-marketplace: `docs_index.py` reads follow-up tags into `meta.tags`; the plugin version bump.
- Features homes: the backfill writes tags into every existing follow-ups file.

## Preconditions

Re-run each before the first dispatch:

- Both repos are on `main`, not behind origin: `git -C ~/Documents/ai-dev/wigley-ai-gui fetch -q && git -C
  ~/Documents/ai-dev/wigley-ai-gui status -sb` and the same for `wigley-ai-marketplace` (2026-10-26: gui ahead 2,
  marketplace ahead 2, neither behind).
- The docs below are committed: `git -C ~/Documents/ai-dev/wigley-ai-gui log --oneline -1 d8f04e9`, the same for `e56077f`, and `git -C
  ~/Documents/ai-dev/wigley-ai-marketplace log --oneline -1 9b8dbe1`, the same for `a139b88`.
- The marketplace plugin version equals origin's, so this run bumps it: `grep '"version"'
  plugins/wigley/.claude-plugin/plugin.json` against `git show origin/main:plugins/wigley/.claude-plugin/plugin.json`
  (2026-10-26: both `1.11.0`).
- The features homes the backfill covers (measured at plan time, re-verify):
  `~/Documents/ai-dev/{wigley-agents,wigley-ai-gui,wigley-ai-marketplace,wigley-harness}/docs/features/` and
  `~/wigley-features/new-games-prototypes/`. Re-list with `ls -d ~/Documents/ai-dev/*/docs/features
  ~/wigley-features/*/`.
- The docs write guard allows a new file inside a `features` entry's root (`src/plugins/docs/path-guard.ts`
  `changeRefusal`), so Backlog can create a `followups.md` in a home that has none.

## Docs written ahead

- wigley-ai-marketplace `9b8dbe1`: `plugins/wigley/skills/review/triage.md` § The project's follow-ups (shape, tags,
  agent-ready criteria), `skills/feature-primer/close.md` and `skills/feature/plan-folder.md` (point at it),
  `scripts/docs-index/README.md` (how tags are read, `meta.tags`).
- wigley-ai-gui `d8f04e9`: `docs/features/backlog/design.md` (the settled design), `AGENTS.md` (the `backlog`
  plugin, `src/shared/followups/`, `src/main/git/`, git as a main service), `docs/keymap.md` (`kb`, `vd`, `va`),
  `docs/features/docs-browser/design.md` (create through the shared module).
- wigley-ai-marketplace `a139b88`: `scripts/docs-index/README.md` (follow-up titles from the first line, a trailing
  `.` dropped, backticks ignored in the Contents match).
- wigley-ai-gui `e56077f`: `AGENTS.md` (the `git/` line names the Backlog self-test fixture repo as its one exception).

## Mandatory Reads

- `~/Documents/ai-dev/wigley-ai-gui/AGENTS.md` and `DESIGN.md` (every gui task; `DESIGN.md` for page work)
- `~/Documents/ai-dev/wigley-ai-gui/docs/keymap.md` (task 09)
- `~/Documents/ai-dev/wigley-ai-gui/docs/features/backlog/design.md` (every gui task)
- `~/Documents/ai-dev/wigley-ai-marketplace/AGENTS.md` (tasks 03, 07)
- `~/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/scripts/docs-index/README.md` (task 03)
- `~/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/skills/review/triage.md` § The project's follow-ups
  (tasks 01, 03, 05)
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in either repo (`find . -name 'CLAUDE*.md' -o -path
  '*/.claude/rules/*'`, measured at plan time).

## Design Overview

```
                 features homes (followups.md, plan-*/plan.md, checklist.md)
                        │                         ▲
     docs_index.py ─────┘ index.json              │ guarded write
                        ▼                         │
  docs main ── exports: machineIndex · rebuildMachineIndex · readDoc · writeDoc · watchDoc
                        │
  backlog main ── homes (repo → home → follow-up files, plans, features)
     │   ├─ src/shared/followups  parseFollowups · applyFollowupEdit · newFollowupsFile
     │   ├─ Git (src/main/git)    topLevel · changedPaths · fileAtHead · commitPaths
     │   └─ watches the follow-up files → `changed` message
     │  channel
  backlog page ── Backlog mode: side bar (repos, homes) · list · detail · editor
                        └─ docs page export openDoc (open a file in Docs mode)
  docs page ── create dialog's follow-up ── src/shared/followups
```

Decisions (all in `docs/features/backlog/design.md` unless named here):

- Backlog parses follow-up files itself; the index finds the files, their repo and home, and the plans and features.
- One writer of the follow-up shape in the app: `src/shared/followups/`.
- A tag is an italic span on the Contents line or list item; the tag list is a Backlog setting.
- An edit re-applies to fresh disk text by title when the disk changed (`changedOnDisk`).
- The Commit message is built by diffing each follow-up file's HEAD parse against its working parse (agent, plan
  time): it needs no edit log, so it survives an app restart.
- A plan's target and written date come from its `plan.md` header line `Target: … · Written: …` (agent, plan time):
  the index meta holds only feature, checked and total.
- A home is in git when `git rev-parse --show-toplevel` succeeds in it (agent, plan time).
- Git runs behind one `Git` contract; Docs' plugin statuses move onto it.

Out of scope: converting old follow-up files to the canonical shape; a repo's `docs/followups/*.md`; editing plans or
features in Backlog (Docs mode edits them).

## File Structure

Modified (gui): `src/contracts/plugin.ts` (MainServices.git), `src/main/main.ts`,
`src/plugins/docs/contract.ts`, `src/plugins/docs/main/start.ts`, `src/plugins/docs/main/plugin-status.ts`,
`src/plugins/docs/kinds.ts`, `src/plugins/docs/page/docs-dialogs.ts`, `src/plugins/manifests.ts`,
`src/plugins/main.ts`, `src/plugins/page.ts`, `src/plugins/keymap.ts`, `scripts/check-layers.mts`.

New (gui):

- `src/shared/followups/followup-file.ts` — the one parser and writer of the follow-up shape; two consumers.
- `src/contracts/git.ts`, `src/main/git/process-git.ts` — git is a third-party tool: one contract, one adapter.
- `src/plugins/backlog/` — the new plugin (`manifest.ts`, `contract.ts`, `main/`, `page/`).

Modified (marketplace): `plugins/wigley/scripts/docs-index/markdown.py`, `discover.py`, their tests, both plugin
manifests.

Boundary rules: `src/shared/followups/` imports nothing (pure). Only `src/main/git/` runs `git`. Backlog reaches
docs only through `DocsMainExports` and `DocsPageExports`, typed by `src/plugins/docs/contract.ts`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Follow-up file module](01-followup-file.md)
- [x] [Index reads follow-up tags](03-index-tags.md)
- [x] [Docs main exports](04-docs-exports.md)
- [x] [Backfill agent-ready tags](05-backfill-tags.md)

### Wave 2
- [x] [Git contract and adapter](02-git-adapter.md) — after 04 (shares `docs/main/start.ts`), 01 (shares `check-layers.mts`)
- [x] [Docs creates follow-ups through the shared module](06-docs-create.md) — after 01
- [x] [Marketplace version bump](07-version-bump.md) — after 03

### Wave 3
- [x] [Backlog main part](08-backlog-main.md) — after 01, 02, 04

### Wave 4
- [x] [Backlog page part](09-backlog-page.md) — after 08

### Wave 5
- [ ] [Backlog self-test](10-backlog-selftest.md) — after 09

### Wave 6
- [ ] [Doc re-read](11-doc-reread.md) — after every code task

### Wave 7
- [ ] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: 0f512f54537daef3d326126b6b645eb8201041d8

### Groups
- 03 · wigley-ai-marketplace 7c829f5 · diff read; docs-index unittest 249 OK · concerns: the README JSON example's followup meta lacks section and tags (task 11 re-read); one existing test's continuation-line title changed by design
- 04 · 0d13dae · diff read; typecheck clean; docs start tests 24 pass · concerns: none
- 07 · wigley-ai-marketplace db34d66 · diff read; check_manifests --against origin/main passed · concerns: none
- 05 · harness 1416e06, marketplace 87bb3a9, gui 402c262; ~/wigley-features/new-games-prototypes not in git · diff read: first-line and Contents-line swaps only; 121 items tagged · concerns: Silent reward popup tagged though its section has two open questions; harness numbered Design issues lists may index as one entry; NGP gained one untagged Contents line for an orphan section; the marketplace forms-wait-hook item says needs a feature plan in its body only
- 01 · 475e866 · diff read; followups tests 38 pass; typecheck and lint clean · concerns: no strict null checks in tsconfig; CRLF files not handled; deleting a numbered item does not renumber
- 06 · a613926 · diff read; kinds tests pass; worker ran typecheck and lint clean · concerns: an in-repo home's new file is titled 'Follow-ups — features' (folder base name, as the plan said); a list-shaped create writes '- **name**' with no trailing dash
- 02 · dc3d5e0 · diff read; typecheck clean; git and plugin-status tests pass · concerns: fileAtHead rejects on an unborn HEAD; the fake Git lives in plugin-status.test.ts
- 08 · d4855da · diff read; backlog tests 44 pass; typecheck clean · concerns: homes.ts copies docs' small metaString helper (backlog main may import only docs' contract); a symlinked clone could read as not uncommitted
- 09 · 21dce15 · diff read; backlog, keymap and manifest tests pass; typecheck clean; app started in selftest · concerns: delete prompt text fixed (createConfirmPrompt body is fixed at creation); discard prompt reuses the delete confirm labels; one-line boxes accept line breaks; view/editor/keys paths need the live run
### Contract changes
- KindRule.contents (module-private): (name, existing) → (name, existing, place, paths) · why: the new-file title needs the place's folder · consumers: none · group 06
- Git doc comments: unpushedPaths is files HEAD changed since the merge base with upstream; methods but fetch/lastFetch reject when git cannot start; commitPaths rejects on empty paths · why: state the error modes · consumers: 08 · group 02
- HomeShape: a type alias over BacklogHome with PlanShape; writeFollowupEdit deps typed FollowupWriteDeps = Pick<DocsMainExports,'readDoc'|'writeDoc'>, plus readFollowupText · why: concrete types · consumers: none outside 08 · group 08
### Rulings
- Two repos: the gui review base is 0f512f5; the marketplace review base is a139b88 — the plan targets both repos' main — lead
- A peer session (ai-dev-76) is on this machine, so every commit is pathspec-scoped and the review range is an explicit commit list — lead
- Contents lines are the top-level items between **Contents** and the first ## heading; a sectioned file with no Contents line reads tags [] — keeps body bullets out — a Contents list placed elsewhere reads no tags · group 03 · group 03
- indexLoaded fires only when loadIndex or rebuildIndex resolves; a rejected call emits nothing — a failed Docs rescan does not reload Backlog · group 04 · group 04
- Formatted docs/keymap.md with the repo's oxfmt (lead tooling op; the docs-ahead commit d8f04e9 left its padding off) in 4fe32ff — lead
- Untitled gui list items took a short coined bold title with the first line kept whole as gist, not the first sentence as title — first sentences ran past a line — titles may need rewording in Backlog · group 05 · group 05
- Harness items judged on their own text, so three items the harness README settles stay untagged · group 05 · group 05
- A section item's title is its ## heading, as the index reads it; a list item's bold title keeps its backticks so edits round-trip — Backlog and the index may differ by backticks · group 01 · group 01
- An edit keeps a struck item struck (the draft has no done field) · group 01 · group 01
- check-layers: src/shared/followups is importable from every plugin main/page layer and src/plugins/docs; task 08 adds it to the backlog layers it creates · group 01 · group 01
- fileAtHead uses ls-tree then cat-file so a missing path is told apart without parsing stderr · group 02 · group 02
- process-git.test.ts has its own check-layers entry to reuse the real ProcessRunner in a temp clone with global git config disabled · group 02 · group 02
- Task 06's proof ran only kinds and page tests and missed doc-files.test.ts create_Followup_AppendsToExistingFile (expects line 2, gets 3); fixed by its own dispatch — lead
- With newFileRepo null, a create on a missing file writes the bare item with no header — a listed file deleted mid-edit comes back headerless · group 08 · group 08
- Every writeDoc rejection becomes refused with its text; applyEdit sends no changed (the watch reports it) · group 08 · group 08
- commit commits each follow-up file whose disk text differs from HEAD; fileAtHead rejection reads as empty · group 08 · group 08
- Peer ai-dev-76 (Notes) confirmed it touches no task 09/10 file until this run closes; the Backlog design lines it committed in d3b1df9 (images, notes export) describe Notes work, so task 09 ignores them and task 11 leaves them in place — lead
- Editor chords carry no where (<D-Enter>, <C-n>, <C-p>): expandBind rejects a chord with where both, and a chord's page bind fires in boxes · group 09 · group 09
- Log lines for a create's wrote, and committed/commit failed, use the ~-shown home root · group 09 · group 09
- Empty-state text is a status line atop the side bar, as the docs tree does · group 09 · group 09
### Review rounds
### Test gate
