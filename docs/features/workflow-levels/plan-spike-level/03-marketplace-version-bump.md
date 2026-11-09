# 03 — Marketplace version bump

Status: done
Type: Task
Wave: 3 · Depends on: 04
Plan: [plan.md](plan.md)

Repo:      wigley-ai-marketplace, worktree `~/Documents/ai-dev/.worktrees/wigley-ai-marketplace-spike-level`
Files:     modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  none
Produces:  one new version in both manifests, `"version": "2.2.0"` unless origin is ahead
Decisions: a minor bump, since the series adds a skill (`decisions.md` § Asking › The agent decides: the version of the user's own tools). First run `git -C ~/Documents/ai-dev/.worktrees/wigley-ai-marketplace-spike-level fetch origin` and read the version in `origin/main:plugins/wigley/.claude-plugin/plugin.json`. Take the higher of that version and `2.1.2`, and bump its minor with patch 0: `2.1.2` gives `2.2.0`, `2.2.1` gives `2.3.0`.
Done when: `python3 scripts/check_manifests.py` and `python3 scripts/check_manifests.py --against origin/main` pass
Commit:    one commit for the group. This task runs after task 04, so the bump is the series' last marketplace commit with no reorder.

## Proof

Commit wigley-ai-marketplace 3ea99a0 · proof: diff read: both manifests 2.3.0; check_manifests and --against origin/main pass · concerns: origin/main moved to 2.2.0 mid-run; marketplace branch rebased onto origin/main (8a981dd docs-ahead) before the bump
