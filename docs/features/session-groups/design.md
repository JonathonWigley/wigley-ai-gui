# Session groups

**Contents**

- **Status** — what is built.
- **Projects** — what puts two sessions in one group.
- **Order** — the Favorites and Recent sections, recency, and the step keys.
- **Favorites** — what is favorited, how, and where it is saved.
- **Drawing** — the layout parts and what the app keeps.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope**

The Sessions side bar groups its rows by project under a header per project, so every clone of one repo — the
user keeps several clones of `new-games-prototypes`, one per Unity editor — reads as one project.

## Status

Planned: `plan-session-groups/` beside this file.

## Projects

A session's project is the repo name its folder's git `origin` URL ends in, with `.git` dropped
(`git@github-personal:JonathonWigley/wigley-ai-gui.git` → `wigley-ai-gui`), read through `Git.originRepoName`.
A folder in no clone or with no origin takes its folder name, and a session with no folder takes its row's
no-folder label (`session`, `Codex session`). Main resolves the name once per folder for the app's life and sets
it on the session's row as `project`; until the lookup lands the row carries the folder-name fallback, so a
clone's first session can move groups once.

The row's `label` (`new-games-prototypes-3 2`) stays per folder: it names the clone, which the user needs to tell
the Unity editors apart, and other plugins and log lines use it.

## Order

The side bar holds two sections, **Favorites** then **Recent**, each a list of project groups, each group a header
over its rows. The section labels draw only while a favorite project has an open session; otherwise the groups
sit directly under the Sessions header.

- **Favorites** are in the user's own order, set by drag and by `<Leader>pk` / `<Leader>pj`.
- **Recent** groups sort by recency, most recent first, and the rows inside every group, favorites included, do
  too. A session's recency is the last time its row arrived or its row's activity turned to needs you
  (`NEEDS_YOU_ACTIVITY`); a group's is its most recent row's. Picking a row never reorders, so the list holds
  still while the user steps through it. Ties keep main's row order.
- Recency is page-side, since needs you is a page-side activity; the stamps sit in the sessions page's `uiState`
  (`recency`, by app session id, pruned to the rows main holds), so a page reload keeps the order.
- The previous and next session keys, and the side bar's edge prompts, step through rows in drawn order.

## Favorites

A favorite is a project name. A favorite with no open session draws nothing, and comes back in its place when a
session in it opens. Favorites and their order sit in the sessions page's `uiState` (`favorites`, an array of
project names), so they last across restarts.

- The star on a group header toggles it; it shows lit on a favorite and on hover on any other group.
- `<Leader>pf` toggles the focused pane's session's project; `<Leader>pk` / `<Leader>pj` move it up or down among
  the favorites, and log and do nothing on a project that is not one.
- Dragging a group header reorders the favorites; dropping a Recent group into Favorites favorites it at the drop
  point, and dropping a favorite into Recent unfavorites it. Recent has no hand order, so a drop there marks the
  whole section. While a drag runs, an empty section shows as a drop box, so the first favorite can come from a
  drag, and the side bar holds its redraws until the drag ends. The layout preview (`Space z l s`) draws with its
  own sample favorites and never changes the user's.

## Drawing

The sessions layout gains two parts: `section` (a Favorites or Recent label over the box the app fills with
groups, both always drawn, an empty one hidden outside a drag) and `group` (a project header over the box the app
fills with rows), with a `GroupKit` that draws the star (`favoriteToggle`) and the grip (`dragHandle`, a visual
cue: the whole header drags). The app keeps the star's click and the drag on each header, through the
DragReorder primitive (`DESIGN.md` § Primitives).

## Decisions

- **Origin name over folder name**: the clones' folders are named by hand (`new-games-prototypes-2`); the origin
  is the one name every clone shares, and the features home rule and the docs index already name a repo by it.
- **Projects favorited, not sessions**: a session lasts one agent run; a project comes back daily.
- **Recency from arrival and needs you only**: a row moving on the user's pick would move under the step keys.
- **Hand order only in Favorites**: one rule — favorites are what the user orders, the rest orders itself — over
  pinned groups that silently stop following recency.

## Out of scope

- Folding a group: the header can take a chevron later without moving anything else.
- Dragging rows: a row's hand order would last only as long as its session.
