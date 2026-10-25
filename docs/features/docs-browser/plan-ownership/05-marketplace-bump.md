# 05 — Marketplace version bump and Done checks

Status: not started
Type: Task
Wave: 3 · Depends on: 02, 03, 04
Plan: [plan.md](plan.md)
Repo: wigley-ai-marketplace

Files:     modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  the committed changes of 01, 02, 03 and 04 under `plugins/wigley/scripts/docs-index/`
Produces:  `"version": "<next patch>"` in `plugins/wigley/.claude-plugin/plugin.json`
Produces:  `"version": "<next patch>"` in `plugins/wigley/.codex-plugin/plugin.json`

Decisions:
- One version bump per pushed series (marketplace AGENTS.md § Changing a plugin). Compare the Claude manifest's `version` with `git show origin/main:plugins/wigley/.claude-plugin/plugin.json`. When they are equal, bump both manifests to the next patch (`X.Y.Z` → `X.Y.(Z+1)`) in this task's commit. When local is already ahead of origin (at plan time local `1.10.0`, origin `1.9.1`), the unpushed bump already covers this series: change no manifest, make no commit, and run the Done commands. (lead)
- If the two manifests hold different versions when this task runs, stop and report both values. Do not pick one. (Decided: `check_manifests.py` fails on a mismatch, and the cause is a peer's edit.)
- The bump check runs against `origin/main`. At plan time `origin/main` holds `1.9.1` and local `main` holds unpushed commits already at `1.10.0`. (measured 2026-10-24)
- This is its own commit, the last of the series that changes the plugin. It holds the two manifests only. (pinned by lead)
- Change no other field in either manifest. Keep each file's formatting. (Decided)
- No push. Pushing is the user's call. (user AGENTS.md § Git)

GIVEN the manifests hold `X.Y.Z` WHEN this task runs THEN both hold `X.Y.(Z+1)`.
GIVEN the bump is committed WHEN `python3 scripts/check_manifests.py --against origin/main` runs THEN it passes.
GIVEN the bump is committed WHEN every command in marketplace AGENTS.md § Done runs from the repo root THEN each one exits 0.

Tests: none added. The Done commands are the check:
- `python3 scripts/check_manifests.py`
- `python3 scripts/check_manifests.py --against origin/main`
- `python3 scripts/check_pointers.py`
- `(cd scripts && python3 -m unittest discover -s tests)`
- `claude plugin validate .`
- `(cd plugins/wigley/scripts/dashboard && python3 -m unittest discover)`
- `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)`
- `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)`
- `(cd plugins/wigley/scripts/plan && python3 -m unittest discover)`
- `(cd plugins/wigley/scripts/primer && python3 -m unittest discover)`
- `(cd plugins/wigley/scripts/retro && python3 -m unittest discover)`
- `(cd plugins/wigley/skills/unity-playtest && python3 -m unittest discover -s tests)`
- `(cd plugins/wigley/skills/unity-ux-flow && python3 -m unittest discover -s tests)`

Approach: run the Done commands after the commit, since `--against` reads git objects, not the working tree. A failure in a suite this plan did not touch (dashboard, forms, plan, primer, retro, unity skills, `check_pointers.py`) is reported with its output, not fixed here: peer sessions hold uncommitted edits in this repo.

Done when: both manifests hold the same version, ahead of origin/main's; when this task bumped, `git show --stat HEAD` lists only the two manifests; every Done command above exits 0.
Commit:    one commit holding the two manifests when a bump was needed, else none; in wigley-ai-marketplace, by path only (peer sessions have uncommitted edits)

## Proof

