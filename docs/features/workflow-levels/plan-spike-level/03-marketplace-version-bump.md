# 03 — Marketplace version bump

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo:      wigley-ai-marketplace, worktree `~/Documents/ai-dev/.worktrees/wigley-ai-marketplace-spike-level`
Files:     modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  none
Produces:  `"version": "2.2.0"` in both manifests
Decisions: a minor bump, since the series adds a skill (`decisions.md` § Asking › The agent decides: the version of the user's own tools). Measure against origin first: when `origin/main` already holds a higher version than `2.1.2`, bump the minor of that version instead.
Done when: `python3 scripts/check_manifests.py` and `python3 scripts/check_manifests.py --against origin/main` pass
Commit:    one commit for the group. When task 04 edits a marketplace file after this commit, the bump stays in this series' last plugin commit by moving this commit after it (an unpushed reorder).

## Proof
