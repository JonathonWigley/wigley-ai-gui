# 13 — Doc re-read

Status: done
Type: Task
Wave: 9 · Depends on: 12
Plan: [plan.md](plan.md)

Files: modify each doc below that the code contradicts. No code changes.

- wigley-ai-gui: `AGENTS.md`, `DESIGN.md`, `docs/keymap.md`, `docs/features/docs-wiki/design.md`, `docs/features/docs-browser/design.md`, `docs/features/layouts/design.md`
- wigley-ai-marketplace: `plugins/wigley/scripts/docs-index/README.md`
- wigley-agents: `wiki/Main.md`. This file is the user's own page. Change it only when a link in it does not open or its format does not parse. Method in § Decisions.

Consumes: every task's landed code, 01 to 12. Read the Run log's Contract changes and Rulings first: they name what moved from the plan.

Produces: docs true to the tree. A line that the code contradicts is a doc fix when the code matches `plan.md` or a Run log entry. When the code departs from `plan.md` with no Run log entry, stop and report it.

Decisions:

Load `wigley:writing-for-agents` for the edits: an agent reads each of these files. Read each passage whole, once, and check each claim against the code.

| Doc | Passage |
|---|---|
| `AGENTS.md` | § Architecture: the `docs/` entry of the tree, the `main/git/` entry (it must name the log call), and "A docs index source". The opening paragraph on the docs index |
| `docs/features/docs-wiki/design.md` | The whole file. Each statement must now describe the tree. It stays as the feature's doc |
| `docs/features/docs-browser/design.md` | The pointer to the wiki, and each passage on the sidebar, the page and keys that the wiki changed |
| `docs/features/layouts/design.md` | The `docs` row of the owner table: it must name the new surfaces |
| `docs/keymap.md` | The `v` group and every key this plan added: `e`, `Ctrl+h`, `Ctrl+l`, `Ctrl+o`, `Ctrl+i`, `gh`, `Space v w`, `l`, `<CR>` |
| `DESIGN.md` | The lines task 05 added |
| docs index `README.md` | The schema: version 5, `headings`, `links`, and what a follow-up entry holds |

**Check these claims first, since drafts moved them:**

- design.md § Links says "Linked from is a reverse lookup over the loaded entries". A link in a follow-up file has no entry (`plan.md` § File Structure). If the design doc implies otherwise, state the limit.
- design.md § Main page says a link the index does not list "refuses with a toast". Check the toast text against task 08.
- `AGENTS.md` says docs' `page/` holds the "wiki sidebar built from `~/wigley-agents/wiki/Main.md`". Check that the machine view alone takes it.
- Follow-ups: this plan closes none. `docs/features/followups.md` holds Docs items (the newest-wins open rule, the selection lost on an outside rename or trash, the first show's missing test, link hints in rendered docs), and no task here does their work. Remove no item unless the Run log's Rulings name one this plan closed. The Run log holds no open gap to file: the history pair's hide at the history's ends is built in task 10. A Ruling that leaves a gap open becomes a `docs/features/followups.md` item in the section that matches it, or a `DESIGN.md` exception when the user's ruling says so.

**`wiki/Main.md`, the check.** Read-only: the user's index, and no write to it.

1. Read `~/wigley-agents/wiki/Main.md`. Find each link in it as `parseWikiMain` does (task 03). A heading structure the parser drops (a link before the first `##`, a malformed shelf) is a format fault.
2. Read `~/.agents/wigley-docs/index.json` with `python3`. Resolve each link as `buildWikiTree` does (task 06): a `path` target against the file's folder, then the index entry with that `path`; a `skill` target through `findSkillEntry`'s rule; `kind`, `owner` and `all` need no entry.
3. List each link that resolves to no entry (a dangling row). Fix only those, and only a format fault the parser reports. Say in the Proof that the index read was the user's own, read-only.
4. A dangling link whose page the index has not rebuilt yet is no fault: name it in the Proof and leave it.

The edit goes in a wigley-agents commit, apart from the other repos' commits.

GIVEN the landed code WHEN each passage is re-read THEN no line states what the code does not do.

Tests: none. A doc holds no behaviour.

Done when: each passage is re-read, and the Proof names each doc changed, or says no change was needed. `python3 scripts/check_pointers.py` in wigley-ai-marketplace passes.

Commit: one commit per repo that changed.

## Proof

Commit 38d42a0e · proof: Diff read. Changed: AGENTS.md, docs-wiki/design.md, docs-browser/design.md. No change needed: docs/keymap.md, DESIGN.md (950), layouts/design.md, marketplace docs-index README (schema 5), wiki/Main.md. Main.md check on the user's own index, read-only (schema 4 until the plugin lands): no format fault, no dangling link across 10 path and 12 wigley: links. check_pointers.py and lint pass. · concerns: e above the first heading and gh from a session tab are written from the user's decisions, not traced to the end of the code path. The top-row placement of the history arrows comes from CSS selectors, not a screenshot.
