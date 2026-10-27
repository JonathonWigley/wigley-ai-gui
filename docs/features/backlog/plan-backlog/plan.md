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
- [ ] [Follow-up file module](01-followup-file.md)
- [x] [Index reads follow-up tags](03-index-tags.md)
- [x] [Docs main exports](04-docs-exports.md)
- [ ] [Backfill agent-ready tags](05-backfill-tags.md)

### Wave 2
- [ ] [Git contract and adapter](02-git-adapter.md) — after 04 (shares `docs/main/start.ts`), 01 (shares `check-layers.mts`)
- [ ] [Docs creates follow-ups through the shared module](06-docs-create.md) — after 01
- [x] [Marketplace version bump](07-version-bump.md) — after 03

### Wave 3
- [ ] [Backlog main part](08-backlog-main.md) — after 01, 02, 04

### Wave 4
- [ ] [Backlog page part](09-backlog-page.md) — after 08

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
### Contract changes
### Rulings
- Two repos: the gui review base is 0f512f5; the marketplace review base is a139b88 — the plan targets both repos' main — lead
- A peer session (ai-dev-76) is on this machine, so every commit is pathspec-scoped and the review range is an explicit commit list — lead
- Contents lines are the top-level items between **Contents** and the first ## heading; a sectioned file with no Contents line reads tags [] — keeps body bullets out — a Contents list placed elsewhere reads no tags · group 03 · group 03
- indexLoaded fires only when loadIndex or rebuildIndex resolves; a rejected call emits nothing — a failed Docs rescan does not reload Backlog · group 04 · group 04
- Formatted docs/keymap.md with the repo's oxfmt (lead tooling op; the docs-ahead commit d8f04e9 left its padding off) in 4fe32ff — lead
### Review rounds
### Test gate
