# 16 — Doc re-read

Status: not started
Type: Task
Wave: 5 · Depends on: 01–15
Plan: [plan.md](plan.md)

The docs written ahead of this plan describe code that did not exist yet. Read each one, line by line, against the
landed code. Fix every line that the code makes untrue. Commit the fixes together.

Files (each one is read in full against the tree):

- `docs/features/layouts/design.md`
- `AGENTS.md`
- `docs/features/primer/design.md`
- `DESIGN.md`, the whole file
- `docs/features/followups.md`
- `docs/features/master-plan.md`
- `docs/features/ui-design/design.md`
- `docs/keymap.md` (the `zl` row: `zlo` forms, `zlp` primer, `zls` sessions, `zlc` chat, group "layout previews")
- `docs/features/agent-chat/design.md` § Layouts (task 04 edits it; check it again here)
- wigley-ai-marketplace `plugins/wigley/scripts/forms/README.md` § Layouts

Consumes: the landed code of tasks 01–15.

## Known stale lines

Fix these. Then read the rest of each file for lines the run made untrue.

- `AGENTS.md`, the dependency example "`keys` in main": keys now has a main part (task 02). Use another example
  or drop it.
- `AGENTS.md`, the source tree: `keys/` and `gallery/` say "no main part"; both now have one that registers the
  layout contract. Add `layouts/` to the tree entries of every adopter that gained one (docs, backlog, settings,
  notes, sessions, gallery, keys, and `src/renderer/shell/layouts/`). `src/main/layouts/` is new.
- `AGENTS.md`, § Running and testing: "the keys plugin has no main part, so its steps live in forms' script" and
  the same line for the gallery. Check where those steps live after the run and say so.
- `AGENTS.md`, § A layout and § A chat layout: the kit names (`BaseKit` additions, chat's parent-first parts), the
  revision and folder lines, `data-layout-owner` on part roots.
- `AGENTS.md`, plugin data: `wigley-data:` now serves plugin data only.
- `docs/features/layouts/design.md`: the Adopters table against each owner's `layout.d.ts`; § Previews against the
  binds in `src/plugins/keymap.ts`.
- `docs/features/primer/design.md` § Keys against the primer binds in `keymap.ts`, and the item card header text
  against the default primer layout.
- `DESIGN.md` § Surfaces against each owner's parts. § Primitives: "forms and chat layout kits hand the same
  primitives to user layouts" — every owner's kit now does, through `BaseKit`. § Checks: the screenshot list and
  where the gallery's and keys' screenshots come from after the run.
- `docs/features/followups.md`: the agent-ready entry "Layouts as a core service" (`api.layouts.define`, …) is the
  work this run did. Remove it, or narrow it to what the run left undone. Check the entry "Layout hot reload keeps the
  user's place" against what tasks 03 and 14 landed, and remove or narrow it the same way.
- `docs/features/master-plan.md` item 15, "Layouts as a core service" (`api.layouts.define`, "replacing the wiring
  copied in forms and chat", the hot reload line): mark what the run landed, in the file's own way of marking a done
  item, and name the API the run built (`api.layouts.register` and `api.layouts.show`).
- `docs/features/ui-design/design.md`: "a `gallery` plugin (page only, no main part)" — gallery now has a main part.
  "Forms and chat layout kits gain the primitives" — every owner's kit has them through `BaseKit`. "Layouts as a core
  service" in the out-of-scope list — this run built it; say where.

## Decisions

- A line that names a file, a symbol or a key is checked against the tree, not against a task document.
- A fix to a marketplace file is a separate commit in that repo. It does not bump the plugin version again unless
  the run already pushed 1.12.1.

## Tests

None. This task changes docs only.

## Proof

- `git diff` shows only doc files.
- Each file in the list above was read in full. The report names each file and the lines it fixed, or "no change".
