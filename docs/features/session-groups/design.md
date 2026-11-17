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

Built, in `src/plugins/sessions/` (the project name in `main/`; the order, recency and favorites modules, the side
bar view and the layout parts in `page/`; the layout contract in `layouts/`), `src/main/git/` and
`src/contracts/git.ts` (`originRepoName`), `src/shared/page/ui/drag-reorder.ts` and `src/plugins/keymap.ts`.

## Projects

A session's project is first the name a registered namer gives its folder: chat registers one for the projects in its
settings (`addProjectNamer`, `docs/features/projects/design.md` § Membership), so a folder a project covers takes
that project's name, read again at each change to the setting (the handle's `changed()`).
Otherwise it is the repo name its folder's git
`origin` URL ends in, with `.git` dropped
(`git@github-personal:JonathonWigley/ai.git` → `ai`), read through `Git.originRepoName`.
A folder in no clone or with no origin takes its folder name, and a session with no folder takes its row's
no-folder label: `<harness label> session` (`Claude Code session`, `Codex session`), or `session` for a session that
names no harness. Main resolves the name once per folder for the app's life and sets
it on the session's row as `project`; until the lookup lands the row carries the folder-name fallback, so a
clone's first session can move groups once.

The row's `label` (`new-games-prototypes-3 2`) stays per folder: it names the clone, which the user needs to tell
the Unity editors apart, and other plugins and log lines use it.

## Order

The side bar holds **Favorites** then **Recent**, each a list of project groups, each group a header over its rows,
then each section a plugin registers (`addSection`) that claims a row, its claimed rows flat with no groups. The
default layout draws the Favorites and Recent labels only while a favorite project has an open session or a group is
dragged; otherwise the groups sit directly under the Sessions header. A plugin section draws only while it claims a
row, and always with its label.

- **Plugin sections** come after Recent, by their `order`, a tie in registration order. A claimed row leaves its
  project group and sits in its section, newest arrival first; a row two sections claim goes to the lower `order`.
  A claimed row is not a drop target and has no project group, so it takes no part in favorites.

- **Favorites** are in the user's own order, set by drag and by `<Leader>pk` / `<Leader>pj`.
- **Recent** groups sort by the time each project's group arrived, most recent first, and the rows inside every group,
  favorites included, sort by the time each row arrived. A new session enters at the top of its group, and its group
  holds its place; a session in a project with no open group enters in a new group at the top of Recent. Picking a
  row, sending a message and any activity, needs you included, leave every row in place, so the list holds still
  while the user reads it and steps through it. Ties keep main's row order.
- A group's stamp sits in the sessions page's `uiState` (`projectRecency`). A project with no stamp takes its newest
  row's, and the stamp goes when a state ends the project's last row, so the project comes back at the top.
- A row's stamp sits in `uiState` too
  (`recency`), under its row's host session id, else its app session id, so a page reload and a relaunch both
  keep the order. A stamp follows its row's host id change and goes when the row leaves. A row merely absent keeps
  its stamp, since main resumes rows one at a time after a relaunch; a stamp whose session never comes back goes
  once 200 newer ones push it out.
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
  drag, and the side bar holds its redraws until the drag ends.
- The layout preview (`Space z l s`) draws with its own sample favorites and never changes the user's favorites, by
  star, drop or key: while it shows, the star and drops do nothing, and the `<Leader>p` keys log that the preview
  shows and do nothing.

## Drawing

The sessions layout gains two parts: `section` (a Favorites or Recent label over the box the app fills with
groups, both always asked for, though the default layout hides an empty one outside a drag; or a plugin section's
label and header part over its rows, asked for only while it claims a row) and `group` (a project header over the box
the app fills with rows), with a `GroupKit` that draws the star (`favoriteToggle`) and the grip (`dragHandle`, a
visual cue: the whole header drags). The app keeps the star's click and the drag on each header, through the
DragReorder primitive (`DESIGN.md` § Primitives).

## Decisions

- **Origin name over folder name**: the clones' folders are named by hand (`new-games-prototypes-2`); the origin
  is the one name every clone shares, and the features home rule and the docs index already name a repo by it.
- **Projects favorited, not sessions**: a session lasts one agent run; a project comes back daily.
- **Recency from arrival only**: a row moving on the user's pick would move under the step keys, and one moving on
  its activity would shift the list while the user reads it. A group has its own stamp for the same reason: a group
  following its newest row would move every time a session opened in it.
- **Hand order only in Favorites**: one rule — favorites are what the user orders, the rest orders itself — over
  pinned groups that silently stop following recency.

## Out of scope

- Folding a group: the header can take a chevron later without moving anything else.
- Dragging rows: a row's hand order would last only as long as its session.
