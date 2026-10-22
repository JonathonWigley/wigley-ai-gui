# 04 — Relay endpoint folder variable (wigley-ai-marketplace)

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo:      `/Users/jonathonwigley/Documents/dev/personal/wigley-ai-marketplace`, branch `main` (its AGENTS.md: commit straight to main; every change bumps the version)
Files:     modify `plugins/wigley/scripts/forms/start_app.py` · modify `plugins/wigley/scripts/forms/relay.py` · test `plugins/wigley/scripts/forms/tests/test_start_app.py` · modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  nothing
Produces:  `def endpoint_dir(env) -> Path` in `plugins/wigley/scripts/forms/start_app.py`
Decisions: the relay reads `WIGLEY_AI_GUI_ENDPOINT_DIR` (round 3) · the README line already landed in `4a2b58f`

## What changes

- `endpoint_dir(env)`: `Path(env["WIGLEY_AI_GUI_ENDPOINT_DIR"])` when that variable is set and non-empty, else `ENDPOINT_DIR`.
- `relay.py`'s `main` builds the `Relay` with `start_app.endpoint_dir(os.environ)`; `start_app.py`'s own command-line entry uses it too, if it has one.
- Version 1.7.1 → 1.8.0 in both manifests; the commit message names both changes since 1.7.1 (the make rule in `4a2b58f` and this variable).

GIVEN env `{"WIGLEY_AI_GUI_ENDPOINT_DIR": "/tmp/x"}` WHEN `endpoint_dir` runs THEN it returns `Path("/tmp/x")`
GIVEN env `{"WIGLEY_AI_GUI_ENDPOINT_DIR": ""}` WHEN `endpoint_dir` runs THEN it returns `ENDPOINT_DIR`

Tests:     `test_start_app.py`: `test_endpoint_dir_from_variable`, `test_endpoint_dir_default_when_unset_or_empty`
Done when: `python3 -m unittest discover` passes in `plugins/wigley/scripts/forms`; `python3 scripts/check_manifests.py` passes in the repo root. The commit is not pushed: pushing waits for the user's ask
Commit:    one commit in wigley-ai-marketplace

## Proof
