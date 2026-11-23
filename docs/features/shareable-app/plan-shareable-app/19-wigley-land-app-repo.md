# 19 — wigley-land lands the app repo

Status: not started
Type: Task
Rung: hard · adds a second repo mode and a new stage to a tool whose steps stop before anything they cannot undo; 17 relies on its behaviour
Wave: 2 · Depends on: 01 (the app repo is recognised by the `auri` manifests 01 creates, and the update step installs `auri@auri`)
Plan: [plan.md](plan.md)

Read first: `~/wigley-agents/tools/wigley-land/README.md` in full, the tool `wigley-agents/tools/wigley-land/wigley-land`
(30k bytes measured at plan time) and its tests, `~/wigley-agents/WigleyRepos.md` § Landing.

## Files

Files (ai):
- modify `wigley-agents/tools/wigley-land/wigley-land`
- modify `wigley-agents/tools/wigley-land/README.md` — What it does, Input, Steps, Output and exit codes
- test `wigley-agents/tools/wigley-land/tests/test_wigley_land.py`

## Consumes

- `AGENT_PLUGIN_FOLDER = 'agent-plugin'` and the auri manifest `agent-plugin/.claude-plugin/plugin.json` ← 01.
- `.claude-plugin/marketplace.json` with marketplace name `auri`, so the plugin key is `auri@auri` ← 01.

## Produces

- `wigley-land <worktree>` and `wigley-land --resume <clone>` accept the app repo as well as `ai`.
- A `secrets` stage in the app repo's landing.
- The auri plugin update after an app-repo push that touched `agent-plugin/`.

## Decisions

- **Which repo.** A clone is the `ai` repo when it holds `wigley-ai-marketplace/scripts/check_manifests.py`, which is
  today's rule. It is the app repo when its root holds `agent-plugin/.claude-plugin/plugin.json` and `package.json`.
  Anything else is still an input error, exit 2. Its reason changes from naming only `ai` to
  `not the ai repo or the wigley-ai-gui repo`. The repo kind is found once, in preflight, before any git command
  that changes state.
- **Unchanged in `ai` mode.** Every step, line and exit stays as the README states it today, including the
  `wigley-ai-gui/node_modules` link. Task 17 drops that link after the move.
- **App mode, step by step** (numbers from README § Steps):
  - 0 Preflight: the ignored link is `node_modules` at the root.
  - 1, 2 and 5: unchanged.
  - 3 and 4 (version settle and check): skipped.
    - The app's version rule is that `package.json` and `agent-plugin/.claude-plugin/plugin.json` share one version with `agent-plugin/.codex-plugin/plugin.json` (both auri manifests). The landing session runs `npm run changelog:release` and commits before calling `wigley-land` (task 15, the app's `AGENTS.md`); the changelog lint checks the three agree.
      That version bumps with each landing's `CHANGELOG.md` heading. Task 15 owns the rule and its lint, so
      `wigley-land` neither settles nor checks it.
    - A rebase conflict in those files is an ordinary conflict: it stops at `merge`.
  - New **secrets** stage, after step 2 and before step 5:
    - It runs `betterleaks git <worktree> --revision=main..<branch> --include=merges --redact`.
    - The flags come from the Betterleaks README and `docs/scanning.md`: `git <path>`, `--revision=A..B` and
      `--include=merges`. `--redact` appears in the docs' examples but is never defined, so the worker reads
      `betterleaks git --help` when the tool is installed. If `--redact` is not a flag, drop it.
    - A non-zero exit stops at stage `secrets`, exit 1, with `main` untouched.
    - Betterleaks missing from `PATH` does not stop the landing (coordinator ruling). The stage is skipped, and
      stdout carries the reason.
  - 6 Clean up: removes the root `node_modules` link (the link only), then the worktree and branch as today.
  - 7 Push:
    - unchanged, pushing `origin main` of the app repo;
    - after a pull, the `secrets` stage runs again over `<pre-pull main>..main`, the commits the pull brought in
      excluded;
    - `--resume` runs the `secrets` stage over `origin/main..main` before its push.
  - 8 Update the plugin:
    - only when the pushed range touched `agent-plugin/`;
    - for each profile as today: `claude plugin marketplace update auri`, then `claude plugin update auri@auri`;
    - then `codex plugin add auri@auri` when `codex` is on `PATH`.
  - 9 Report: the `/clear` reminder names auri's version from `agent-plugin/.claude-plugin/plugin.json` at `main`.
- **Pinned lines.** Each is added to README § Output and exit codes.
  - stdout:
    - `scanned <branch> for secrets: none found`
    - `skipped the secrets scan: betterleaks is not on PATH`
    - `/clear open sessions to load auri <version>`
  - stderr:
    - `wigley-land: secrets: betterleaks found secrets in main..<branch>`
    - then `wigley-land: stopped at secrets; waiting: <branch> in <worktree>; remove the secret from the branch's history and run wigley-land again`
    - for `--resume`: `waiting: main holds the landed work unpushed; remove the secret from main's history and run wigley-land --resume <clone>`
  - A new refusal-table row for `secrets`, exit 1.
- **Standard library only**, as the tool is today.

## GIVEN / WHEN / THEN

- GIVEN an app-repo worktree whose branch Betterleaks flags WHEN `wigley-land <worktree>` runs THEN it stops at
  `secrets`, exit 1. `main` and origin are untouched, and the worktree and branch stay.
- GIVEN an app-repo worktree with a clean branch that changes `agent-plugin/` WHEN it runs THEN it fast-forwards
  `main`, removes the root `node_modules` link and the worktree, pushes, and runs both `claude` commands for
  `auri@auri`. It runs no `check_manifests.py` and no `wigley` update.
- GIVEN the same with a branch that touches only `src/` WHEN it runs THEN it runs no plugin update.
- GIVEN `betterleaks` not on `PATH` WHEN an app-repo landing runs THEN it prints the skip line and lands.
- GIVEN an `ai` worktree WHEN it runs THEN every existing test passes unchanged and no `betterleaks` call is made.
- GIVEN a folder that is neither repo WHEN it runs THEN it exits 2 with the new reason.

## Tests

The suite builds a bare origin, a clone and worktrees with real `git`, and puts `claude` and `codex` stubs on
`PATH`. Add an app-repo fixture with `package.json` and `agent-plugin/.claude-plugin/plugin.json` at its root. Add
a `betterleaks` stub the same way: it records its arguments, and exits 1 when the range holds a file named
`leak.txt`.

- `test_app_repo_secret_found_stops_at_secrets` catches a landing that merges or pushes a branch Betterleaks
  flagged.
- `test_app_repo_lands_and_updates_auri` catches the app landing running the version check or the `wigley`
  update, leaving the root link, or calling the stubs with anything but `auri` / `auri@auri`.
- `test_app_repo_without_agent_plugin_change_skips_update` catches a plugin update after a push that did not touch
  `agent-plugin/`.
- `test_app_repo_without_betterleaks_skips_scan` catches a landing that stops, or skips silently, when the tool is
  missing. It asserts the skip line is printed.
- `test_resume_app_repo_scans_before_push` catches `--resume` pushing an unscanned range.
- `test_ai_repo_never_calls_betterleaks` catches the new stage leaking into `ai` landings.
- The existing input-error test gains a row for a folder that is neither repo.

## Verification

```
cd ~/wigley-agents/tools/wigley-land && python3 -m unittest discover -s tests
```

## Done when

- The suite passes, and every existing test passes unchanged.
- The README states both modes, the `secrets` stage, the skip line and the auri update.
- No live landing of the app repo runs here: the first is task 17's step 11.

Commit: one commit for the group, landed in `ai` with `wigley-land` itself (an `ai` landing).

## Proof

