# 03 — Marketplace version bump and Done checks

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)
Repo: wigley-ai-marketplace

Files:     modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  the committed changes of 01 and 02 under `plugins/wigley/scripts/docs-index/`
Produces:  `"version": "1.10.3"` in `plugins/wigley/.claude-plugin/plugin.json`
Produces:  `"version": "1.10.3"` in `plugins/wigley/.codex-plugin/plugin.json`

Decisions:
- One version bump per pushed series (marketplace AGENTS.md § Changing a plugin). At plan time both manifests hold `1.10.2` (line 3 of each), and `git show origin/main:plugins/wigley/.claude-plugin/plugin.json` holds `1.10.2`. Bump both manifests to `1.10.3` in this task's commit. (measured 2026-10-26)
- Before the bump, compare the Claude manifest's `version` with `git show origin/main:plugins/wigley/.claude-plugin/plugin.json`, after a `git fetch`. When local is already ahead of origin, an unpushed bump already covers this series: change no manifest, make no commit, and run the Done commands. (lead, as plan-ownership task 05)
- If the two manifests hold different versions when this task runs, stop and report both values. Do not pick one. (Decided: `check_manifests.py` fails on a mismatch, and the cause is a peer's edit.)
- This is its own commit, the last of the series that changes the plugin. It holds the two manifests only. (lead)
- Change no other field in either manifest. Keep each file's formatting. (Decided)
- No push. Pushing is the user's call. (user AGENTS.md § Git)

GIVEN both manifests hold `1.10.2` and origin holds `1.10.2` WHEN this task runs THEN both hold `1.10.3`.
GIVEN the peer primer-port plan already bumped both manifests ahead of origin WHEN this task runs THEN no manifest changes and no commit is made.
GIVEN the bump is committed WHEN `python3 scripts/check_manifests.py --against origin/main` runs THEN it passes.
GIVEN the bump is committed WHEN every command in marketplace AGENTS.md § Done runs from the repo root THEN each one exits 0.

Tests: none added. The Done commands are the check. Run marketplace AGENTS.md § Done as it stands when this task runs, plus `(cd plugins/wigley/scripts/<folder> && python3 -m unittest discover)` for each folder under `plugins/wigley/scripts/` that holds tests and that § Done lacks. At plan time § Done lacked `dashboard` and `primer`, so the list was the one below. The peer plan `docs/features/primer/plan-primer-port/` deletes both folders: run a suite only when its folder exists. Task 09 fixes § Done.
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

Name in the proof each command run and each one skipped because its folder is gone.

Approach: run the Done commands after the commit, since `--against` reads git objects, not the working tree. A failure in a suite this plan did not touch (dashboard, forms, plan, primer, retro, unity skills, `scripts/tests`, `check_pointers.py`) is reported with its output, not fixed here: peer sessions may hold uncommitted edits in this repo.

Done when: both manifests hold the same version, ahead of origin/main's; when this task bumped, `git show --stat HEAD` lists only the two manifests; every Done command above exits 0.
Commit:    one commit holding the two manifests when a bump was needed, else none; in wigley-ai-marketplace, by path only (peer sessions may hold uncommitted edits)

## Proof
