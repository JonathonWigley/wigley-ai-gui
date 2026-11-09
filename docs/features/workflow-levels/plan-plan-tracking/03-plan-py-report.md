# 03 — plan.py reports its folder

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo:      wigley-ai-marketplace, its worktree `../.worktrees/wigley-ai-marketplace-plan-tracking` (branch
           `plan-tracking`)
Files:     modify `plugins/wigley/scripts/plan/plan.py` · test `plugins/wigley/scripts/plan/tests/test_plan.py` ·
           modify `plugins/wigley/.claude-plugin/plugin.json` and `plugins/wigley/.codex-plugin/plugin.json` (version)
Consumes:  none
Produces:  `def report_plan_folder(folder: Path, env: Mapping[str, str]) -> str | None` in `plan.py`
           `def main(argv: list | None = None, env: Mapping[str, str] | None = None) -> int` in `plan.py`
           The report file: `<WIGLEY_AI_GUI_ENDPOINT_DIR>/plan-runs/<WIGLEY_SESSION_ROW>.json`, text
           `{"planDir": "<absolute folder>"}` plus a trailing newline. The app's task 05 reads this shape.
Decisions: plan.py reports on every write (round 3) · a failed write warns and never fails the command (Decided
           notice) · `close` reports nothing (Decided notice) · the file holds the folder alone (plan.md Design
           Overview)

## What changes

- `main` takes `env`, default `os.environ`. After a command other than `close` returns without a `Refusal`, and after
  its edits are written, `main` calls `report_plan_folder(plan_folder(args.folder), env)`. It prints the returned
  warning to stderr when there is one. The exit code stays 0.
- `report_plan_folder`:
  - Returns None and writes nothing when `WIGLEY_AI_GUI_ENDPOINT_DIR` or `WIGLEY_SESSION_ROW` is unset or empty.
  - Returns a warning, and writes nothing, when the row id holds a character outside `[A-Za-z0-9_-]`, so a row id
    can never name a path outside `plan-runs/`.
  - Writes `{"planDir": os.path.abspath(folder)}` as JSON plus a trailing newline through the existing
    `write_atomic`, after it makes `plan-runs/` with `mkdir(parents=True, exist_ok=True)`. `abspath` normalizes the
    path and keeps symlinks, so the folder string matches the path the agent writes and the app compares (a
    `resolve()` turns `/tmp` into `/private/tmp` on macOS and clears the app's reported mark on the next edit).
  - Catches `OSError` and returns `f"plan folder not reported to the app: {error}"`.
- The command reports even when it made no edit (`base` with the same sha), since a resumed run reports that way.
- Add the report to the module docstring: one sentence that names the file, the two variables and that `close`
  writes none, as its own paragraph after the first. The first paragraph is argparse's description and stays as it
  is. `Mapping` comes from `collections.abc`.
- Bump `version` from `2.0.2` to `2.0.3` in both plugin manifests.

GIVEN both variables set WHEN `plan.py start <folder> 01` runs THEN `plan-runs/<row>.json` reads
`{"planDir": "<os.path.abspath(folder)>"}` and a newline (compare with `abspath`, never `resolve()`: the temp folder
sits under `/var`, a symlink to `/private/var`).
GIVEN one variable unset WHEN `start` runs THEN no `plan-runs` folder exists.
GIVEN `WIGLEY_SESSION_ROW` set to the empty string WHEN `start` runs THEN no `plan-runs` folder exists.
GIVEN the row id `../x` WHEN `start` runs THEN the exit code is 0, stderr holds a warning and no `plan-runs` folder
exists.
GIVEN a plan whose base is already the given sha WHEN `base` runs with that sha THEN the report file exists.
GIVEN an endpoint folder that is a file WHEN `start` runs THEN the exit code is 0, stderr holds the warning, and the
task document reads `Status: in progress`.
GIVEN both variables set WHEN `close` runs THEN no report file exists.
GIVEN a refused command WHEN it runs THEN no report file exists.

Tests:     one table-driven test `test_report_after_each_command` in `test_plan.py` (subTest rows) over the eight
           rows above. The rows call `plan.main(args, env=...)` with a temporary endpoint folder.
Done when: every command in the marketplace `AGENTS.md` § Done passes from the worktree root, except
           `check_manifests.py --against origin/main`, which the landing runs.
Commit:    one commit for the group, in the marketplace worktree

## Proof

