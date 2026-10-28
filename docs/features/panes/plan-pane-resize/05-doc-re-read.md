# 05 — Doc re-read against the landed code

Status: in progress
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04
Plan: [plan.md](plan.md)

Files:     modify (only where a line is stale) `docs/keymap.md` · `DESIGN.md` · `docs/features/primer/design.md` ·
           `docs/features/layouts/design.md` · `AGENTS.md` · modify `docs/features/followups.md`
Consumes:  the landed code of 01–04; no new names
Produces:  no code
Decisions: the docs written ahead are hypotheses until this re-read (`wigley:writing-for-agents` § Doctrine before
           code) · remove the follow-up "Split has no dispose" (round 4)

## The docs to re-read

1. The five docs in commit `72cee4c` (plan.md § Docs written ahead): `docs/keymap.md`, `DESIGN.md`,
   `docs/features/primer/design.md`, `docs/features/layouts/design.md`, `AGENTS.md`.
2. The two doc commits made after `72cee4c` for the round-4 decisions (the resize key prompt, narrow-window
   stacking, `dispose`): `e52d697` (`docs/features/primer/design.md`, `docs/features/layouts/design.md`) and
   `6899a12` (`AGENTS.md`, `DESIGN.md`, `docs/keymap.md`). They touch only the five docs above.

Read the diff of each commit (`git show <sha> -- <path>`) to find the lines it wrote. Re-read each of those lines,
and the paragraph around it, against the code on `HEAD`.

## What to check

For each line, find the code that makes it true. Open the file and the member. Do not trust plan.md. Check these
facts with most care, because the plan settled them before the code existed:

- The command ids `panes.resizePaneLeft`, `panes.resizePaneRight`, `panes.resizePaneUp`, `panes.resizePaneDown`,
  their labels, and the default binds `<A-S-h>` / `<A-S-l>` in scope `any` (`src/config/keymap.ts`,
  `src/plugins/keymap.ts`).
- The step of 24px (`SPLIT_NUDGE_STEP`), the least widths of each split and of the side bar, and that no split has
  a most width (`src/shared/page/ui/split-width.ts` and the five callers).
- The uiState keys `shell.side-bar-width`, `primer.tasks-width`, `primer.items-width`, and the move of
  `primer.primer-rail-width` to `primer.tasks-width`.
- The side bar opens at the `sidebar-width` token and then keeps the stored width; a narrowing window narrows the
  drawn side bar so the main area keeps 320px, without writing uiState (`src/renderer/shell/shell.ts`).
- The resize target rule each view applies (task 04's Decisions), the fallback to the side bar, and that each base
  scope change drops the target (`src/renderer/pane-resize.ts`, `src/renderer/key-scope.ts`).
- The resize key prompt: its text, where it draws, and when it shows (hover, drag, after a nudge).
- The primer scopes `primer.tasks`, `primer.items`, `primer.card`; the commands `focusTasks`, `focusItems`,
  `focusCard`; each key in the primer key table; the card choice; the empty state copy; the headers; the layout
  parts `tasks` and `items` and their input types (`src/plugins/primer/`).
- `Split.dispose()` and `SplitDivider.dispose()`, and which views call them.

## How to fix

- A line the code contradicts: change the doc to say what the code does. If the code looks wrong and the doc
  states a plan.md decision, do not change the doc or the code. Record it in the group's report as a concern.
- A line about a thing the code does not have: remove it, or change it to what the code has.
- Write each fix to the same standard as the doc around it. Run `wigley:writing-for-agents` on each edit to
  `AGENTS.md`.
- Do not add new content beyond what the landed code makes necessary.

## The follow-up

Remove the bullet "**Split has no dispose** — *agent-ready*: …" from `docs/features/followups.md`. Task 01 added
`Split.dispose()` and calls it where the gallery's redraw drops the `Split` sample. Before you remove it,
open `src/shared/page/ui/split.ts` and `src/plugins/gallery/page/gallery-view.ts` and confirm both. If either is
missing, keep the bullet and record a concern.

Also re-read the bullet "**Split subscribes to its width key**" next to it. It names docs' session tree and forms'
rail as owners that call `reloadWidth()`, and already leaves out the primer, which calls it too. Update the bullet
to list every owner that calls `reloadWidth()` on `HEAD`: `grep -rn "reloadWidth()" src --include='*.ts'`, leaving
out tests and `split.ts`. After 03 the primer calls it on two splits. Do not remove the bullet.

## Done when

Each line the re-read docs wrote matches the landed code, and the follow-up is removed. `git diff` shows only
doc fixes and the follow-up removal.

## Commit

One commit: the doc fixes and the follow-up removal. If no doc line was stale, the commit holds only the follow-up
removal, and the report says that no line was stale.

## Proof

