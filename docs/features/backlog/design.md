# Backlog mode — settled design

**Contents**

- **Scope** — what Backlog covers, what counts as wigley-written, and what stays out.
- **The mode** — the plugin, its layout, its keys.
- **Follow-ups** — reading, the structured editor, create, delete, tags, done items.
- **Tags** — where a tag lives, the settings list, and who applies `agent-ready`.
- **Plans and features** — the read-only views.
- **Git** — the uncommitted chip, the Commit command, the Git adapter.
- **Seams** — docs' exports, the shared follow-up module, the two parsers.

The decisions the user settled in the 2026-10-26 interview (two rounds and the agent's Decided notices), kept so the
plan is written from them. A decision here stands unless the user changes it.

## Scope

- Backlog shows the future work the user's wigley workflows wrote, grouped by repo: every follow-up (full create,
  read, edit, delete and tagging), every plan and every primed feature (read-only).
- Wigley-written means a features home's files (`~/wigley-agents/AGENTS.md` § Features): `<home>/followups.md`,
  `<home>/followups/*.md`, `<home>/<slug>/plan-*/` and `<home>/<slug>/checklist.md`. A repo's own
  `docs/followups/*.md` is team-repo content and stays out, though the docs index lists it.
- Old files whose shape hid their items (the gui and harness follow-up files) were converted to the list shape. Backlog
  and the docs index read each file in its own shape.

## The mode

- The `backlog` plugin, with a main part and a page part, depends on `docs` and adds Backlog mode.
- The side bar lists repos, each with its features homes. A repo normally has one home; a stray second home (an
  in-repo `docs/features/` and a `~/wigley-features/<repo>/`) shows as its own group and edits, but is never a
  create target while the repo has a home in git. A home that is a linked git worktree's (`git worktree add`)
  own `docs/features/` is not listed: it is a second checkout of a clone's own home. Its plans' progress still counts
  (§ Plans and features).
- The content sheet shows the selected home's follow-up list, plans and features, with a detail pane on the right.
- Keys, all checked against Docs mode's keys and `docs/keymap.md`:

  | Key | Action |
  |---|---|
  | `Space k b` | show Backlog; again: toggle the side bar |
  | `j` `k` `gg` `G` `l` `h` `Enter` | move, open, back, as the Docs tree |
  | `/` | filter: fuzzy on a follow-up's title and tag and on plan and feature rows, plain substring on a follow-up's one line |
  | `a` | new follow-up in the selected repo's home |
  | `i` | edit the selected follow-up |
  | `d` | delete the selected follow-up, after y/n |
  | `t` | toggle `agent-ready` |
  | `T` | pick any tag from the settings list |
  | `C` | commit the home's follow-up files |
  | `R` | rescan |
  | `Space v d` | show or hide done follow-ups |
  | `Space v a` | show only agent-ready follow-ups |
  | `o` | open the selected row's file in Docs mode |
  | `Ctrl+j` / `Ctrl+k` | scroll the detail a line (with `Shift`, half a page) |
  | `Alt+h` / `Alt+l` | list ↔ detail pane |
  | `Cmd+Enter` | save the editor |
  | `Esc` | in a box's normal mode, leave the box; on the editor page, cancel (a changed draft asks to discard first) |
  | `Ctrl+n` / `Ctrl+p` | next / previous editor field |
  | `T` | in the editor, pick a tag for the draft's Tags field |

  `C` is uppercase so the one outward step is never a single lowercase slip. The editor's `Cmd+Enter`, `Ctrl+n`
  and `Ctrl+p` carry no `where`, so they fire inside a box as well as on the page; `Esc` and `T` carry one.

## Follow-ups

- Backlog parses each follow-up file itself through the shared module, so a save shows at once without waiting on an
  index rebuild. The index supplies which files exist and their repo and home.
- The structured editor has four vim boxes: title, one line, tags (comma-separated) and body. A line break typed
  in the first three joins the lines with a space. Saving rewrites the `##`
  section and its Contents line together (or the list item, in a list-shaped file), which hand edits let drift.
- Create writes to the repo's one features home. A home with no `followups.md` gets one in the canonical `##` +
  Contents shape. A file of `##` sections with no Contents list gains one, built from its headings, on its first
  write.
- Delete removes the section, or list item, and its Contents line, after the shared y/n confirm prompt (`createConfirmPrompt`).
- Done items (struck through, or one line starting `shipped`) are hidden until `Space v d` shows them. Delete is the
  removal; there is no separate mark-done command. An empty list says when a toggle hid every row: "Every follow-up
  here is done." or "No agent-ready follow-ups here."
- A create, or an edit that renames, whose title would not read back from the file is refused with the reason, and
  a write names one of the home's own follow-up files or none. An item whose title already in the file would not
  read back (written by hand) cannot be rewritten: an edit or a tag change to it is refused, pointing to Docs.
- A file changed on disk while the user edits an item: the edit is one item operation, so it re-applies to the new
  text by the item's title, rather than a whole-file conflict prompt. The save carries the item as the editor opened
  it; when the item on disk no longer matches (an outside edit while the editor was open), nothing is written, the
  editor stays open with the user's draft and takes the item as it now reads on disk as its new starting point, and
  the toast says "<title> changed on disk; save again to overwrite it". A second save then overwrites the outside
  edit, unless the item changed on disk again in between. When the item is gone from the
  new text, the editor says so and keeps the user's draft. A second change on disk during that one retry refuses the
  write.
- Backlog watches the follow-up files it lists, so an agent's append mid-session shows live, and each linked
  worktree's `docs/features` and the worktree list of an in-git home's clone, so a plan run in a worktree shows live.
- An item's images live in the home's `followups-images/<folder>/`, linked from its body
  as `![<n>](<path>)` (`docs/features/notes/design.md`). Only a link that resolves to a direct subfolder of
  `<home>/followups-images/` counts. Delete trashes each image folder the deleted item's body links and no other
  item in the file still links.

## Tags

- A tag lives in the follow-up's own line: one italic span after the dash, comma-separated, closed by a colon
  (`- **Title** — *agent-ready*: gist`). A single tag reads exactly like the older `*needs a feature plan*:` marker,
  so existing files parse unchanged. The shape and the criteria for `agent-ready` live in wigley-ai-marketplace's
  `skills/review/triage.md` § The project's follow-ups; the docs index parses tags into `meta.tags`. In a file of
  `##` sections the span is read from the item's Contents line only, and `_a, b_:` reads like `*a, b*:`.
- The tag list is a Backlog setting, defaulting to `agent-ready` and `needs a feature plan`. `T` picks from it, and a
  tag found in a file but missing from the list still shows.
- Skills tag each follow-up they write. A one-time agent pass tagged the follow-ups written before this feature. The
  user overrides either in Backlog.

## Plans and features

- A plan shows its name, feature, progress (checked of total), target and written date; a primed feature shows its
  slug and progress.
- A plan's progress and its tasks' statuses come from the shared plan reader (`src/shared/plan-progress.ts`) over the
  plan's newest copy across the clone and its git worktrees (`src/shared/plan-copies.ts`), as Heavy's checklist reads
  them, so a run in a worktree shows in Backlog too. Each load lists a clone's worktrees once, for all its plans. The
  count is the boxes under `## Tasks`, not the docs index's count of every checkbox in the file. Opening one renders
  `plan.md` (or `checklist.md`) and its task documents inside Backlog, with a key to open the file in Docs mode for hand
  edits.
- A row and its detail read one copy: a plan, and each task its newest copy's `plan.md` links, open that copy's file;
  a task it does not link keeps the index's file and status. A worktree copy's `Status:` value outside the three task
  statuses shows no status, never another copy's. The title, target and written date stay the index copy's, and the
  selection and expansion stay keyed on the index's path, so they hold when the newest copy moves.

## Git

- An edit to an in-repo home stays uncommitted, and the home shows an uncommitted chip. `C` commits that home's
  follow-up files and the changed files inside a folder of its `followups-images/` (`followups-images/<folder>/…`; a
  file directly in `followups-images/` is left out), never anything else in the clone, with the message `Follow-ups edited in Backlog: added …;
  edited …; removed …; tagged …; images <folders>` (an empty part left out; the folders are the changed
  image folders), built by matching each file's items by title between its
  parse at HEAD and its parse on disk. A file that differs from HEAD with no item changed (a header edit, a reorder,
  line endings) commits with the plain subject `Follow-ups edited in Backlog`; a change to images alone
  gives `Follow-ups edited in Backlog: images <folders>`; `C` with no follow-up file and no image changed commits
  nothing. The user's press decides when a shared file is committed, so a peer agent's half-written entry is never
  swept in by an automatic commit.
- A home is in git only when it is its clone's `docs/features` folder, compared on real paths. Every other home
  (`~/wigley-features/` homes, even under an enclosing repo) is not in git and shows no chip.
- Git runs behind a `Git` contract with one adapter over ProcessRunner (`src/main/git/`); `src/contracts/git.ts`
  lists its methods, `worktrees` among them. Docs' plugin statuses move onto it, so the app runs `git` in one place, except the Backlog
  self-test's fixture repo, which runs git through `services.processes`.

## Seams

- Docs owns the index and the write guard. It exports the machine index read and rebuild, the doc read, the guarded
  write and the file watch from its main part, and Backlog goes through them, so the changed-on-disk check stays in
  one place.
- `src/shared/followups/` is the one writer of the follow-up shape in the app, and is pure (text in, text out, no
  I/O): Backlog and Docs' create dialog both call it.
- Backlog's main part exports `load` (the homes), `tags` and `fileNote` (the follow-up write with the note's images)
  to the `notes` plugin, so every follow-up and image write in the app other than Docs' create dialog goes through
  Backlog.
- `src/shared/plan-progress.ts` and `src/shared/plan-copies.ts` are the plan reader Backlog and `workflow-heavy`
  share, since neither plugin may import the other.
- The follow-up format has two readers in two languages: the shared module here, and `docs_index.py`'s parser for
  agents and other index readers. Each is tested against the format triage.md gives; a change to the format changes
  both in the same piece of work.
