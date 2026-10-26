# 12 — Marketplace version bump

Status: not started
Type: Task
Wave: 3 · Depends on: 09, 10, 11
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

Repo: `~/Documents/ai-dev/wigley-ai-marketplace`.

Files:     modify `plugins/wigley/.claude-plugin/plugin.json`, `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  the landed commits of 09, 10 and 11 · the `version` field both manifests hold (`1.10.2` at plan time)
Produces:  `"version": "<next minor>"` in both manifests, the same string in each
Decisions: see below.

## Decisions

- **The rule.** `AGENTS.md` § Changing a plugin: every change to a plugin bumps `version` in both manifests, in the
  same commit; a series that lands together bumps once, in its last commit that changes the plugin. This run's
  marketplace series is the docs commit `804cf0e` and tasks 09, 10, 11 (and task 13's doc fixes, if any). Task 13 may
  commit doc fixes after this bump; the pre-push check compares the version with the remote tip only, so that commit
  still passes. Report it when task 13 is known to change the plugin, so the lead can decide whether to move the bump
  after it.
- **Which version.** Read `version` from both manifests at the time this task runs:
  `grep -n '"version"' plugins/wigley/.claude-plugin/plugin.json plugins/wigley/.codex-plugin/plugin.json`.
  - Both read `1.10.2` (the plan-time value): write `1.11.0` in both.
  - Both read a higher version, equal in both: a peer plan (`plan-recency-stars` in wigley-ai-gui
    `docs/features/docs-browser/`) or another commit bumped first. Bump once past it, to its next minor
    (`X.Y.Z` → `X.(Y+1).0`), and name the peer's commit (`git log --oneline -3 --
    plugins/wigley/.claude-plugin/plugin.json`) and its version in the report.
  - The two manifests disagree: stop and report; `check_manifests.py` fails on that and it is not this task's to
    settle.
- **The next minor** resets the patch to 0. A minor bump fits: the run removes an MCP server and adds two relay tools.
- **Only `version` changes** in each file. Keep the field order and the formatting.

## Behaviour

GIVEN both manifests at `1.10.2` and `origin/main` at `1.10.2` WHEN the task runs THEN both manifests read `1.11.0` and
`python3 scripts/check_manifests.py --against origin/main` passes.

## Tests

No unit test: the repo's own check carries the claim (`scripts/check_manifests.py`, tested in `scripts/tests/`).

Done when: from the repo root, `python3 scripts/check_manifests.py` and `python3 scripts/check_manifests.py --against
origin/main` pass, and `claude plugin validate .` passes. The report names the version written and any peer bump it
went past.
Commit:    one commit for the group in wigley-ai-marketplace, for example "wigley plugin 1.11.0: the feature primer
           moves into wigley-ai-gui; the primer server and dashboard retire" (the form the last bump commit uses:
           `f0475a0 wigley plugin 1.10.2: …`).

## Proof
