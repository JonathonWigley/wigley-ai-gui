# 11 — Doc re-read

Status: done
Type: Task
Wave: 6 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
Plan: [plan.md](plan.md)

Files:     each doc written ahead, re-read line by line against the landed code:
           - wigley-ai-gui `docs/features/backlog/design.md`
           - wigley-ai-gui `AGENTS.md` (the `followups/`, `git/` (with its self-test exception) and `backlog/` lines, and "git (main only)" in the
             ambient service line)
           - wigley-ai-gui `docs/keymap.md` (the `k` and `v` rows)
           - wigley-ai-gui `docs/features/docs-browser/design.md` (the Create bullet)
           - wigley-ai-marketplace `plugins/wigley/skills/review/triage.md` § The project's follow-ups
           - wigley-ai-marketplace `plugins/wigley/skills/feature-primer/close.md` step 2 and
             `plugins/wigley/skills/feature/plan-folder.md` § Close step 1
           - wigley-ai-marketplace `plugins/wigley/scripts/docs-index/README.md` (follow-up bullets, `meta` table)
Consumes:  every landed commit of this plan
Produces:  each stale line fixed
Decisions: a doc written before its code is a hypothesis (decisions.md § Docs; writing-for-agents § Doctrine before
           code) · fix in place; personal repos, so each fix goes in as Decided

Check in particular: the Commit message text, the key table, the editor's fields, the `Git` method names, the
`docs_index.py` tag rule (italic span forms, Contents-line match), and that `src/shared/followups/` is described as
pure.

Tests:     none: docs only.
Done when: every line in every listed doc matches the code; the report names each line changed or says none.
Commit:    one commit per repo that changed, `Backlog docs trued to the landed code`. A marketplace doc change is a plugin
           change: when task 07's bump is already committed and unpushed, fold this commit into the same unpushed
           series (no second bump).

## Proof

Commit gui bfd22bf, marketplace 6e444db · proof: diff read; oxfmt check passes on the gui docs · concerns: the TS Contents reader stops at the first non-list line after **Contents** while the Python one reads to the first ##, so odd files can disagree
