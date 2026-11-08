# 08 — Marketplace version bump

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: the marketplace worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-forms-rundown`,
branch `forms-rundown`. Read its `AGENTS.md` § Changing a plugin and § Done first.

Files:     modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  the docs written ahead in commit `3689c72` (`plugins/wigley/skills/feature/SKILL.md`,
           `plugins/wigley/skills/review/triage.md`, `plugins/wigley/scripts/forms/README.md`)
Produces:  `"version": "1.20.2"` in both manifests
Decisions: one bump for the series (marketplace `AGENTS.md` § Changing a plugin) · patch level, below

## Pinned values

- Now: `"version": "1.20.1"` in both manifests (plan Preconditions).
- After: `"version": "1.20.2"` in both. Change no other field.
- Why a patch: the marketplace `AGENTS.md` requires a bump on every plugin change but names no level. The repo's
  history bumps the patch for wording edits to existing skills (`12f2291` 1.20.1, `4636c38` 1.16.1) and the minor for
  a new skill, a new format or a new tool (`4d06a23` 1.17.0, `d71970c` 1.19.0). This series only rewords the feature
  skill's Question format, the review triage and the forms README to point at `~/wigley-agents/forms.md`. The
  `ask_round` contract change (the `summary` field) ships in the app, not in the plugin.

## Steps

1. Edit the two `version` values.
2. Commit in the marketplace worktree, by pathspec, both files in one commit. Message:
   `Bump wigley to 1.20.2: forms wording points at ~/wigley-agents/forms.md`, with a body saying the series rewords
   the feature skill's Question format, the review triage and the forms README, and that the summary field ships in
   the app. No co-author trailer.
3. Run the Done commands, each from the marketplace worktree root (one Bash call may `cd` there first):

   ```
   python3 scripts/check_manifests.py
   python3 scripts/check_manifests.py --against origin/main
   python3 scripts/check_pointers.py --agents-root /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-agents-forms-rundown
   (cd scripts && python3 -m unittest discover -s tests)
   claude plugin validate .
   (cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)
   (cd plugins/wigley/scripts/forms && python3 -m unittest discover)
   (cd plugins/wigley/scripts/plan && python3 -m unittest discover)
   (cd plugins/wigley/scripts/retro && python3 -m unittest discover)
   (cd plugins/wigley/skills/unity-playtest && python3 -m unittest discover -s tests)
   (cd plugins/wigley/skills/unity-ux-flow && python3 -m unittest discover -s tests)
   ```

   `check_pointers.py` takes `--agents-root` here, so it reads the agents worktree's `forms.md` and `AGENTS.md`,
   which the docs written ahead point at, and not `~/wigley-agents` on `main`.

This bump departs on purpose from the "last commit that changes the plugin" wording: the pre-push hook checks only
the pushed head's version against the remote, so one bump early in the series passes.

Interaction with task 09: task 09 may commit fixes to the marketplace docs after this commit. The series still
carries one bump: the pre-push check compares the version with the remote's, and 1.20.2 differs from it. Task 09
adds no second bump.

Done when: both manifests read `1.20.2`; every Done command above passes.
Commit:    one commit, in the marketplace worktree. Do not push: task 10 pushes.

## Proof

