# 08 — Doc re-read

Status: done
Type: Task
Rung: standard · doc-only: prose checked against settled code
Wave: 5 · Depends on: 01, 02, 03, 04, 05, 06, 07
Plan: [plan.md](plan.md)

Files:
- wigley-ai-gui (worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view`): modify, when stale:
  - `docs/features/live-view/design.md`
  - `docs/features/chat-bar/design.md` § The session hub
  - `docs/features/layouts/design.md`
  - `AGENTS.md`
  - `DESIGN.md`
- wigley-ai-marketplace (worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-live-view`):
  - modify, when stale: `plugins/wigley/skills/unity-playtest/SKILL.md` and `capture.md`
  - modify: both plugin manifests' `version`

Consumes: the landed code of 01-07.

Decisions:
- Read each doc written ahead line by line against the landed code (plan.md § Docs written ahead names the lines).
  Fix every stale line, so it states what the code does now. Check these first:
  - the window order and the slack in `design.md` § Finding the window
  - the Windows DPI sentence in § The ScreenCapture service, against 04's script
  - the notice texts in § The section, against 06's constants
  - the Height bullet in `chat-bar/design.md`, against 02's CSS
  - the `AGENTS.md` lines for `src/main/screen-capture/` and `src/plugins/live-view/`, against the files that exist
  - `capture.md`'s `game_view` sentence, against 03's reply and 07's rect
- `SKILL.md` names the tools' arguments: check them against 05's `inputSchema`.
- Marketplace version: bump `version` in both plugin manifests from 2.5.0 to 2.6.0 (minor: a new reply field and a
  new tool contract), in the same commit. When origin's manifests are already past 2.5.0, take the next minor above
  them. Follow the marketplace
  `AGENTS.md` § Changing a plugin: one bump per pushed series, in its last commit that changes the plugin. Run
  `python3 scripts/check_manifests.py` and `python3 scripts/check_manifests.py --against origin/main` from the
  marketplace worktree. The second run checks the bump.
- One commit per repo.

Done when: every doc written ahead matches the code, and both `check_manifests.py` runs pass.

Commit: one commit in each repo.

## Proof

Commit gui bfea2b8c, marketplace 99bf4ec · proof: diff read of both repos' doc edits against the landed code; check_manifests.py and --against origin/main pass at 99bf4ec (2.6.0) · concerns: origin/main is the local ref (fetch fails with an SSH key error), so the version check is against a possibly stale origin; recheck at landing
