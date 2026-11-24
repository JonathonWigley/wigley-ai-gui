# 19 — wigley-land lands the app repo

Status: done
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
  Anything else is still an input error, exit 2. Its line changes from today's
  `wigley-land: <path>: not in the ai repo; <CHECK_MANIFESTS> is missing from <clone>` to
  `wigley-land: <path>: not the ai repo or the wigley-ai-gui repo; <clone> holds neither <CHECK_MANIFESTS> nor agent-plugin/.claude-plugin/plugin.json with package.json`.
  This is a deliberate change: the two existing rows that pin the old line (`tests/test_wigley_land.py` lines 833 and
  839, measured at plan time, re-verify) are updated to the new line, and no other existing test changes. The repo
  kind is found once, in preflight, before any git command that changes state.
- **Unchanged in `ai` mode.** Every step, line and exit stays as the README states it today, including the
  `wigley-ai-gui/node_modules` link. Task 17 drops that link after the move.
- **App mode, step by step** (numbers from README § Steps):
  - 0 Preflight: the ignored link is `node_modules` at the root.
  - 1, 2 and 5: unchanged, except that step 5's plan-folder match takes the app repo's layout. `PLAN_FOLDER`
    (`^([^/]+/docs/features/[^/]+/plan-[^/]+/)` today) needs a leading folder, as in `ai`'s
    `wigley-ai-gui/docs/features/…`; the app repo holds its features home at the root, so app mode matches
    `^(docs/features/[^/]+/plan-[^/]+/)`. The `plan folder:` line `wigley:make` reads then prints in both modes.
  - 3 and 4 (version settle and check): skipped.
    - The app's version rule is that `package.json` and `agent-plugin/.claude-plugin/plugin.json` share one version with `agent-plugin/.codex-plugin/plugin.json` (both auri manifests). The landing session runs `npm run changelog:release` and commits before calling `wigley-land` (task 15, the app's `AGENTS.md`); the changelog lint checks the three agree.
      That version bumps with each landing's `CHANGELOG.md` heading. Task 15 owns the rule and its lint, so
      `wigley-land` neither settles nor checks it.
    - Superseded by review finding 16: `wigley-land` runs `npm run changelog:release` itself after the rebase, as
      the branch's last commit before the secrets scan (`tools/wigley-land/README.md` § Steps, the `release` stage).
    - A rebase conflict in those files is an ordinary conflict: it stops at `merge`.
  - New **secrets** stage, after step 2 and before step 5:
    - It runs `betterleaks git <path> --revision=<range> --include=merges --redact --no-banner --exit-code=10`,
      with `<path>` and `<range>` per scan below. The tests assert this argv in full.
    - Superseded by review finding 1: Betterleaks 1.10.1 has neither flag; the argv is
      `betterleaks git <path> "--log-opts=--diff-merges=remerge <range>" --redact --no-banner --exit-code=10`.
    - The flags, read at plan time: `git <path>`, `--revision=A..B` ("scans the commits reachable from B but not
      from A") and `--include=merges` from the Betterleaks README and `docs/scanning.md`; `--no-banner` from
      `docs/scanning.md`; `--redact` appears in those docs' examples (`--redact=100`) without a definition, and
      `--exit-code` (the code used when leaks are found; defaults 0 no leaks, 1 leaks or error, 126 unknown flag)
      comes from the README as mirrored on awesome.ecosyste.ms and from Gitleaks, which Betterleaks forked. Both are
      unchecked against the installed binary; the tool is not installed, and installing it is the user's ask in 17.
    - Exit codes: 0 → `scanned <range> for secrets: none found`. 10 → a leak: stop at `secrets`, exit 1. Any other
      code (1 for an error, 126 for an unknown flag, a crash) → stop at `secrets`, exit 1, with
      `wigley-land: secrets: betterleaks failed (exit <code>): <last non-empty stderr line>`, so a wrong flag shows
      as a tool failure, never as found secrets. Either stop leaves `main` untouched.
    - Task 17 runs this argv once by hand on the new clone (`--revision=HEAD~1..HEAD`) after the user installs
      Betterleaks and before its first app-repo `wigley-land`; a 126 there is fixed in this tool before landing.
    - The scans and their ranges, each the commits about to reach `main` or origin:
      - landing, before the fast-forward: `<worktree>`, `main..<branch>`;
      - after a pull in step 7 (`--rebase=merges` rewrites the local commits, so a pre-pull `main` is no longer an
        ancestor): `<clone>`, `origin/main..main`, after the fetch, the range `push_and_update` pushes;
      - `--resume`, before its push: `<clone>`, `origin/main..main`.
    - Betterleaks missing from `PATH` does not stop the landing (coordinator ruling). The stage is skipped, and
      stdout carries the reason.
  - 6 Clean up: removes the root `node_modules` link (the link only), then the worktree and branch as today.
  - 7 Push:
    - unchanged, pushing `origin main` of the app repo;
    - after a pull, the `secrets` stage runs again over `origin/main..main` (above);
    - `--resume` runs the `secrets` stage over `origin/main..main` before its push.
  - 8 Update the plugin:
    - only when the pushed range touched `agent-plugin/`;
    - for each profile as today (one per plugins folder): when that profile's `plugins/installed_plugins.json` lists
      no `auri@auri` key under `plugins` (or the file is absent), skip the profile and print
      `skipped auri update for claude profile <profile>: auri@auri is not installed`; otherwise
      `claude plugin marketplace update auri`, then `claude plugin update auri@auri`;
    - then `codex plugin add auri@auri` when `codex` is on `PATH`;
    - any command that runs and exits non-zero stops at `update` as today (the push already landed). A marketplace
      whose source path is gone is that stop: task 17 adds the `auri` marketplace from the new clone before its
      first app-repo landing, so the path is live.
  - 9 Report: the `/clear` reminder names auri's version from `agent-plugin/.claude-plugin/plugin.json` at `main`.
- **Pinned lines.** Each is added to README § Output and exit codes.
  - stdout:
    - `scanned <range> for secrets: none found`
    - `skipped the secrets scan: betterleaks is not on PATH`
    - `skipped auri update for claude profile <profile>: auri@auri is not installed`
    - `/clear open sessions to load auri <version>`
  - stderr:
    - `wigley-land: secrets: betterleaks found secrets in <range>`, or
      `wigley-land: secrets: betterleaks failed (exit <code>): <last stderr line>`
    - then, for the landing scan: `wigley-land: stopped at secrets; waiting: <branch> in <worktree>; remove the secret from the branch's history and run wigley-land again`
    - for the post-pull scan and for `--resume` (the branch is gone and `main` holds the work):
      `wigley-land: stopped at secrets; waiting: main holds the landed work unpushed; remove the secret from main's history and run wigley-land --resume <clone>`
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
- GIVEN an `ai` worktree WHEN it runs THEN every existing test passes (the two input-error rows updated to the new
  line) and no `betterleaks` call is made.
- GIVEN a folder that is neither repo WHEN it runs THEN it exits 2 with the new reason.

## Tests

The suite builds a bare origin, a clone and worktrees with real `git`, and puts `claude` and `codex` stubs on
`PATH`. Add an app-repo fixture with `package.json` and `agent-plugin/.claude-plugin/plugin.json` at its root. Add
a `betterleaks` stub the same way: it records its arguments, exits 10 when the range holds a file named
`leak.txt`, and exits 1 with a stderr line when the range holds a file named `crash.txt`.

- `test_app_repo_secret_found_stops_at_secrets` catches a landing that merges or pushes a branch Betterleaks
  flagged. It asserts the stub's full argv
  (`git <worktree> --revision=main..<branch> --include=merges --redact --no-banner --exit-code=10`).
- `test_app_repo_betterleaks_failure_is_not_a_leak` catches a tool error (exit 1) reported as found secrets: it
  stops at `secrets` with the `betterleaks failed (exit 1): <line>` text.
- `test_app_repo_post_pull_scan_covers_unpushed` catches the post-pull scan using a pre-pull range: origin gains a
  commit during the run, the pull rebases, and the second stub call's range is `origin/main..main`; a `leak.txt`
  there prints the `main holds the landed work unpushed` waiting line.
- `test_app_repo_plan_folder_line` catches step 5 missing a root-level `docs/features/<slug>/plan-<x>/` folder in
  app mode: the `plan folder:` line is printed.
- `test_app_repo_update_skips_profile_without_auri` catches an update that fails a profile where `auri@auri` is not
  installed: that profile's pair is not run, and the skip line is printed.
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

- The suite passes, and every existing test passes unchanged apart from the two input-error rows at lines 833 and
  839, which take the new line.
- The README states both modes, the `secrets` stage, the skip line and the auri update.
- No live landing of the app repo runs here: the first is task 17's step 11.

Commit: one commit for the group, landed in `ai` with `wigley-land` itself (an `ai` landing).

## Proof

Commit 87f2f1e05 · proof: diff read: repo_kind, APP_REPO, scan_secrets, auri update with installed-only skip, README modes present; both files parse; suite waits for the test gate · concerns: a landing with no pull scans main..branch but pushes origin/main..main, so earlier unpushed main commits go unscanned; betterleaks --redact/--exit-code unchecked against the binary (task 17); skip-betterleaks test PATH assumption
