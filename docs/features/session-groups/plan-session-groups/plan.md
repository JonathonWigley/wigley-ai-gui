# Session groups — plan

Feature: Session groups · Implements: none · Ticket: none
Target: main · Written: 2026-11-03

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The Sessions side bar groups its rows by project — the repo name of the session folder's git `origin` — so every
clone of one repo (`new-games-prototypes`, `-2`, `-3`, `-4`) reads as one project. Groups sit in a hand-ordered
**Favorites** section over a **Recent** section ordered by recency; favorites toggle by a header star or
`<Leader>pf`, reorder by drag or `<Leader>pk` / `<Leader>pj`, and last across restarts.

## Architecture

- **Core contract** `src/contracts/git.ts` and its adapter `src/main/git/process-git.ts`: one new read,
  `originRepoName`.
- **sessions main** (`src/plugins/sessions/main/`): resolves each session folder's project once per folder and
  carries it on `SessionRow.project`.
- **sessions page** (`src/plugins/sessions/page/`): three pure modules — the side bar order, recency stamps,
  favorites — feeding the side bar view and the session step keys.
- **sessions layout** (`src/plugins/sessions/layouts/`): new `section` and `group` parts.
- **Shared UI**: a new DragReorder primitive in `src/shared/page/ui/`, shown in the gallery.
- **Keys**: a new `<Leader>p` projects group in `src/plugins/keymap.ts`.

## Preconditions

- `git -C /Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui status -sb` → on `main`, ahead of `origin/main`, nothing
  modified under the paths this plan touches. Other sessions commit to `main` too, so the ahead count moves.
  `git fetch` failed at plan time (the 1Password SSH agent refused the key in the agent's shell), so whether
  `origin/main` moved is unverified: `wigley:make` re-runs the fetch at preflight.
- The four new-games clones share one origin:
  `for d in /Users/jonathonwigley/Documents/dev/peoplefun/new-games-prototypes*/; do git -C "$d" remote get-url origin; done`
  → `https://github.com/peoplefun/new-games-prototypes` four times (no `.git` suffix).
- `<Leader>p` is free: `grep -n "'<Leader>p" src/plugins/keymap.ts` → no match; `docs/keymap.md` reserves `s`, not
  `p`.
- `MainServices.git` and `PageServices.clock` / `uiState` exist: `grep -n "git: Git\|clock: Clock\|uiState: UiState" src/contracts/plugin.ts`.

## Docs written ahead

Commit `6cbd1992`:

- `docs/features/session-groups/design.md` — the feature's design
- `docs/keymap.md` — the `p` projects row in § Leader groups
- `DESIGN.md` — the DragReorder entry in § Primitives

## Mandatory Reads

- `AGENTS.md` (repo root) — every task
- `DESIGN.md` — tasks 03, 05, 06
- `docs/keymap.md` — task 06
- `docs/features/session-groups/design.md` — every task
- `docs/features/layouts/design.md` — task 05
- `.agents/skills/drive/SKILL.md` — task 08

No `.claude/rules/` and no nested `AGENTS.md` in `src/`.

## Design Overview

```
 main                                         page
 ────                                         ────
 relay hello / chat open                      stateChanged(rows with project)
        │                                            │
 SessionList.addEntry ── project = folder fallback   ├─ SessionRecency  (uiState "recency")
        │                                            │    arrived · needs you → stamp
        └─ projectName(dir) ─► ProjectNames ─► Git.originRepoName
                 (cached per folder)                 ├─ ProjectFavorites (uiState "favorites")
        resolve → row.project → sendState            │    star click · drag drop · <Leader>pf/pk/pj
                                                     ▼
                                    sidebarSections(rows, favorites, stamps)
                                                     │
                       ┌─────────────────────────────┼──────────────────────┐
                       ▼                             ▼                      ▼
              sidebar-view draws           drawnRows → stepSession   DragReorder over
              section ▸ group ▸ row         (⌥⇧O / ⌥⇧I, edge prompt)  the group headers
              through the layout
```

**Decisions** (the interview's rounds and Decided notices):

- Project = origin repo name, `.git` dropped; else folder name; else the no-folder label (round 1).
- Main resolves once per folder for the app's life; the row carries the fallback until the lookup lands (Decided).
- Row `label` and its numbering stay per folder (Decided).
- Look: mockup 4 — Favorites section then Recent section, a header per project (round 2).
- Recency: a row arriving, or its activity turning to needs you; a pick never reorders (round 2).
- Favorites are projects; a favorite with no open session draws nothing (round 2).
- Drag reorders groups only: within Favorites, Recent → Favorites favorites, Favorites → Recent unfavorites (round 2).
- Keys `<Leader>pf`, `<Leader>pk`, `<Leader>pj` in a new `p` projects group (correction round; `s` is reserved).
- Header star toggles favorite by click; section labels draw only while a favorite shows (Decided).
- Step keys follow drawn order (Decided).
- Recency stamps and favorites live in the sessions page's `uiState` (Decided): recency is page-side because
  needs you is a page-side activity (`NEEDS_YOU_ACTIVITY`, set by forms, primer and chat pages).
- Design review: `ProjectNames` is a seam with two adapters (process git, the tests' fake), injected into
  `SessionList` as a function so the list stays free of git; the order is one pure module both the view and the
  step keys read, so drawn order and step order cannot drift; the drag mechanics are a shared primitive, per
  `DESIGN.md` § Primitives, so the sessions view keeps only what a drop means.

**Out of scope**: folding groups; dragging rows; a keyboard cursor in the side bar.

## File Structure

Modified:

- `src/contracts/git.ts`, `src/main/git/process-git.ts` (+ `.test.ts`) — `originRepoName` (01)
- `src/plugins/backlog/main/start.test.ts`, `src/plugins/docs/main/plugin-status.test.ts` — Git fakes gain the member (01)
- `src/plugins/sessions/contract.ts` — `SessionRow.project` (02)
- `src/plugins/sessions/main/session-list.ts` (+ `.test.ts`), `src/plugins/sessions/main/start.ts` — project resolution (02)
- every `SessionRow` literal `npm run typecheck` flags after 02's contract change, `src/plugins/sessions/page/preview.ts` and `sessions-view-fakes.ts` among them (02)
- `src/plugins/gallery/page/gallery-view.ts` — the DragReorder entry (03)
- `src/plugins/sessions/layouts/layout.d.ts`, `layouts/default/layout.js`, `layouts/default/layout.css`,
  `page/layout/sessions-parts.ts` (+ `.test.ts`), `page/layout/read-sessions-layout.ts` — `section` and `group` parts (05)
- `src/plugins/sessions/page/sidebar-view.ts`, `sessions-view.ts`, `start.ts`, `preview.ts`, `src/plugins/sessions/manifest.ts`,
  `src/plugins/keymap.ts`, `src/plugins/sessions/main/selftest-script.ts` — wiring, commands, keys (06)

New:

- `src/plugins/sessions/main/project-names.ts` (+ `.test.ts`) — the per-folder cache over `Git.originRepoName` (02)
- `src/shared/page/ui/drag-reorder.ts`, `drag-reorder.css`, `drag-reorder.test.ts` — the primitive (03)
- `src/plugins/sessions/page/sidebar-order.ts`, `session-recency.ts`, `project-favorites.ts` (+ a `.test.ts` each) — pure page modules (04)

Boundary rules: the page modules in 04 import nothing from the DOM; `SessionList` takes `projectName` as a
function and imports no `Git`; only `main/start.ts` names `api.services.git`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Git origin repo name](01-git-origin-repo-name.md)
- [ ] [DragReorder primitive](03-drag-reorder-primitive.md)
- [x] [Side bar order, recency and favorites modules](04-order-modules.md)
- [ ] [Section and group layout parts](05-layout-parts.md)

### Wave 2
- [ ] [Project on session rows](02-project-on-rows.md) — after 01

### Wave 3
- [ ] [Grouped side bar wiring, commands and keys](06-sidebar-wiring.md) — after 02, 03, 04, 05

### Wave 4
- [ ] [Doc re-read](07-doc-re-read.md)

### Wave 5
- [ ] [Final verification](08-final-verification.md)

## Run log

Review base: 693cb8d04eb48c87e6cba0406a0e2d850f90db54

### Groups
- 01 · 7dfb580e · diff read; Produces originRepoName present on the contract; compile clean for the group's files · concerns: AGENTS.md line 155's adapter list omits the origin repo name (goes to task 07); the empty-name branch and the cannot-start rejection have no test row, per the task's row list
- 04 · 2b0be629 · diff read; every Produces signature present in the three modules; the place, move and toggle GIVENs traced by hand against the code; compile clean · concerns: keepOnly with an empty or partial list wipes saved recency, so task 06 must prune only on a real row list; AGENTS.md's sessions page tree line may want the three modules (goes to task 07); the layer check was not run by the worker
### Contract changes
### Rulings
- The user takes every review recommendation in this run, so no triage round is sent — the user's word this run — a recommendation the user would have overridden lands anyway and shows in the wrap-up · lead
- The test gate and drive checks run in the worktree rather than waiting for the main tree — this is no Unity project, so nothing needs an editor, and a worktree has its own .vite — none; merging back still waits for the user's word · lead
- Both stores read uiState once at creation, as createStarredDocs does — matches the nearest sibling — a page-side writer of these keys would go unseen; nothing writes them today · group 04 · group 04
- A name in shown that is no longer a favorite counts as absent in move and place; move of a favorite not in shown returns false — a drag holds redraws, so shown can go stale — a drop on a stale list can land off by the stale names before it · group 04 · group 04
- keepOnly and remove write nothing when nothing changes; place always writes — keepOnly runs on row updates — one redundant write per no-op drop · group 04 · group 04
### Review rounds
### Test gate
