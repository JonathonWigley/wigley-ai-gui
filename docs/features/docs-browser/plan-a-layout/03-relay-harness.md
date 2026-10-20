# 03 — Relay hello carries the harness

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repository: `~/Documents/dev/personal/wigley-ai-marketplace`, branch `main` (its `AGENTS.md`: commit straight to
`main`, no branch, no PR; push only when the user asks).

Files:
- modify `plugins/wigley/scripts/forms/relay.py`
- test `plugins/wigley/scripts/forms/tests/test_relay.py`
- modify `plugins/wigley/.claude-plugin/plugin.json`, `plugins/wigley/.codex-plugin/plugin.json` (`version`)

Consumes: `hello_from_env(env)` in `relay.py` (in the tree); the README's Hello paragraph, already written
(commit `44bf63a`): `harness`: `claude` when `CLAUDECODE` is `1`, else `codex`.

Produces: `hello_from_env(env)` returns
`{"protocol": 1, "session_id": …, "project_dir": …, "deadline_seconds": …, "harness": "claude" | "codex"}`.

Decisions:
- `harness` is `"claude"` when `env.get("CLAUDECODE") == "1"`, else `"codex"`; never `None`. Its docstring line
  names it: "`harness` is claude under Claude Code (`CLAUDECODE=1`), else codex". (design.md § Modes and layout,
  Harness; README § The relay, Hello.)
- The key order in the dict: `protocol`, `session_id`, `project_dir`, `deadline_seconds`, `harness` — the README's
  order.
- Version: both manifests carry the same `version`. Measured at plan time, re-verify: local `main` holds `1.4.0`,
  `origin/main` holds `1.3.1`, and the 1.4.0 bump (`76b8e59`) is not pushed. The marketplace `AGENTS.md` (Changing
  a plugin) bumps once per pushed series. So before editing the version, run
  `git -C ~/Documents/dev/personal/wigley-ai-marketplace show origin/main:plugins/wigley/.claude-plugin/plugin.json | grep version`:
  when origin's version equals the local one, set both manifests to the next minor (`1.4.0` → `1.5.0`); when they
  differ (an unpushed bump is already in the series), leave the version and write that in the run log. The lead's
  ruling on this is named in the drafter's report.
- `Relay` takes its hello as a constructor argument (`relay.Relay(self.dir, HELLO, …)` in `make_relay`), and only
  `main` builds it from `os.environ`, so the forwarding tests never read the process env. `HELLO` (line 22 of
  `tests/test_relay.py`) gains `"harness": "claude"` so the fixture matches the hello shape; nothing else in those
  tests changes. Each `hello_from_env` test passes its own env dict, never `os.environ` (a suite run inside Claude
  Code inherits `CLAUDECODE=1`).

GIVEN `CLAUDECODE=1` WHEN the relay builds its hello THEN `harness` is `"claude"`.
GIVEN no `CLAUDECODE` WHEN the relay builds its hello THEN `harness` is `"codex"`.

Tests (`HelloTests` in `tests/test_relay.py`):
- `test_hello_reads_session_project_and_deadline_from_the_environment` — env gains `"CLAUDECODE": "1"`; expected
  dict gains `"harness": "claude"`.
- `test_hello_is_null_for_each_unset_value` — `hello_from_env({})` expects `"harness": "codex"` beside `"protocol": 1`
  and the three nulls, as today (rename to `test_hello_is_null_for_each_unset_value_and_codex_without_claudecode`).
- `test_hello_names_codex_when_claudecode_is_not_1` — `{"CLAUDECODE": "0"}` → `"harness": "codex"`.
- `test_the_hello_is_the_first_line_the_app_receives` keeps passing with the updated `HELLO`.

Done when, from the marketplace root: `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` passes;
`python3 scripts/check_manifests.py` passes; `python3 scripts/check_manifests.py --against origin/main` passes;
`grep -c harness plugins/wigley/scripts/forms/relay.py` ≥ 1.
Commit: one commit in wigley-ai-marketplace, message naming the hello's `harness` field and the version decision.

## Proof

wigley-ai-marketplace a02ecb4 · proved: diff read (hello_from_env returns harness last; HELLO fixture, three HelloTests), forms unittest 38 OK / 2 skipped, check_manifests --against origin/main passes · version left at 1.4.0 · concerns: none
