# 07 — Marketplace version bump

Status: not started
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Repo:      `~/Documents/ai-dev/wigley-ai-marketplace`
Files:     modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  commits `9b8dbe1` (docs) and task 03's commit
Produces:  the same new `version` in both manifests
Decisions: the user's own plugin: the agent picks the bump level by semver, measured against origin (decisions.md §
           The agent decides) · a minor bump: tags are a new feature of the follow-up format · when the unpushed
           series already carries a version above origin's, fold into it and change nothing

## What changes

1. Read `git show origin/main:plugins/wigley/.claude-plugin/plugin.json` and the local `version`.
2. Equal (plan time: both `1.11.0`): set both manifests to the next minor (`1.12.0` at plan time). Above origin:
   leave them.
3. Run `python3 scripts/check_manifests.py --against origin/main` from the repo root.

Tests:     none: no logic lands. `check_manifests.py` is the check.
Done when: `check_manifests.py --against origin/main` passes.
Commit:    one commit, `wigley 1.12.0: follow-up tags in the index and the follow-up format` (use the real version).
           No push: the user pushes.

## Proof
