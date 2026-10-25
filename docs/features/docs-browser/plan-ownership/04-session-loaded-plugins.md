# 04 — Session loaded plugins

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)
Repo: wigley-ai-marketplace

Files:     modify `plugins/wigley/scripts/docs-index/session.py` · test `plugins/wigley/scripts/docs-index/tests/test_session.py`
Consumes:  `Context.loaded_plugins: dict[str, str]` (emitted as `loadedPlugins`), `Entry.locations` (real, walked, then installed) ← 01
Consumes:  `read_session`, `session_context`, `SessionTranscript`, `_rows`, `_listing_name`, `Environment.claude_config_dirs` — already in the tree
Produces:  `loaded_plugins: dict[str, str]` (a `SessionTranscript` field) in `plugins/wigley/scripts/docs-index/session.py`
Produces:  `def _cache_path_pattern(env: Environment) -> re.Pattern[str]:` in `plugins/wigley/scripts/docs-index/session.py`

Decisions:
- `loadedPlugins` is filled for the `session` command only. `build` and `context` keep the `Context` default `{}` (01); `docs_index.py` does not change. (pinned by lead)
- `read_session` scans the text of every transcript line, in file order, in the same single pass that reads its rows. A line that does not parse as JSON is still scanned. (pinned by lead: scan the transcript text; Decided: one pass, as `read_session` promises)
- The pattern matches `<config folder>/plugins/cache/<marketplace>/<plugin>/<version>` for every folder in `env.claude_config_dirs`, each in its written form and its real form (`os.path.realpath`). A separator is `(?:\\{1,2}|/)`: one backslash, a JSON-escaped double backslash, or a slash, each separator matched on its own, so a path that mixes them still matches. The folder form is split on `/` and `\`; each part is `re.escape`d and the parts are joined by the separator; a POSIX form keeps its leading separator. `<marketplace>` and `<plugin>` are `[A-Za-z0-9._-]+`, `<version>` is `[A-Za-z0-9._+-]+`. The match is case-sensitive. (pinned by lead; Decided: the name classes stop at the quote, backtick or backslash after a path, as measured in a transcript on 2026-10-24, which writes both `C:/Users/jonat/.claude/plugins/cache/wigley-ai-marketplace/wigley/1.9.1/...` and `C:\\Users\\jonat\\.claude\\plugins\\cache\\...`)
- The key is `<plugin>@<marketplace>`. The value is the version of the last match in the file. (pinned by lead)
- `session_context` builds its `Context` with `loaded_plugins=session.loaded_plugins`. (Decided)
- `_listing_name` names a location `<plugin>:<name>` whenever `location.owner.plugin` is set, not only when `owner.source == "plugin"`. A marketplace clone plugin file's real location then reads `p:<name>`, so a user skill of the same plain name in the listing does not mark the clone file `listed`. The installed location already reads `p:<name>`. (Decided: not pinned, flagged to the lead. Before plan C, no repo file carried `plugin`.)
- Update the module docstring: the pass also collects the plugin versions the transcript names. (Decided)

GIVEN a transcript line holding a JSON-escaped Windows cache path WHEN `read_session` runs THEN `loaded_plugins` maps `<plugin>@<marketplace>` to its version.
GIVEN two versions of one plugin in the transcript WHEN `read_session` runs THEN the value is the later line's version.
GIVEN a cache path under a second configured config folder WHEN `read_session` runs THEN it is matched.
GIVEN a cache path with no version folder WHEN `read_session` runs THEN nothing is recorded.
GIVEN a transcript with no cache path WHEN `session_context` runs THEN the context's `loaded_plugins` is `{}`.
GIVEN a clone skill entry with `plugin "wigley@m"` and the listing `["feature"]` WHEN `session_context` runs THEN the entry is `not-loaded`.
GIVEN the same entry and the listing `["wigley:feature"]` WHEN `session_context` runs THEN the entry is `listed`.

Tests (test_session.py):
- `test_loaded_plugins_read_a_json_escaped_windows_cache_path` — a row `{"type": "user", "cwd": <repo>, "message": "Base directory for this skill: <home>\\.claude\\plugins\\cache\\wigley-ai-marketplace\\wigley\\1.9.1\\skills\\feature"}` written through `json.dumps` (so each backslash is doubled in the file), with the config folder's separators written as `\`: `read_session(...).loaded_plugins == {"wigley@wigley-ai-marketplace": "1.9.1"}`. Build the path from `self.home` with `str(...).replace("/", "\\")` so the test runs on every OS.
- `test_loaded_plugins_read_a_slash_path_and_keep_the_last_version` — line 1 names `<home>/.claude/plugins/cache/m/p/1.0.0/skills/k/SKILL.md`, line 3 `<home>/.claude/plugins/cache/m/p/1.1.0/agents/a.md`, line 2 `<home>/.claude/plugins/cache/m/q/2.0.0`: `{"p@m": "1.1.0", "q@m": "2.0.0"}`.
- `test_loaded_plugins_match_a_later_config_dir` — `Environment(..., claude_config_dirs=(<home>/.claude, <home>/.claude-personal))`, transcript in `.claude`, a line naming `<home>/.claude-personal/plugins/cache/m/p/3.0.0/x`: `{"p@m": "3.0.0"}`.
- `test_loaded_plugins_skip_a_cache_path_with_no_version` — a line naming `<home>/.claude/plugins/cache/m/p"` only: `{}`.
- `test_loaded_plugins_scan_a_line_that_is_not_json` — a malformed line `not json <home>/.claude/plugins/cache/m/p/1.0.0/x` between valid rows: `{"p@m": "1.0.0"}`.
- `test_session_context_carries_loaded_plugins` — the first test's transcript: `session_context(...)[0].to_json()["loadedPlugins"] == {"wigley@wigley-ai-marketplace": "1.9.1"}`; a transcript naming no cache path gives `{}`.
- `test_a_clone_plugin_skill_matches_only_its_plugin_listing_name` — entry `<repo>/plugins/wigley/skills/feature/SKILL.md`, kind `skill`, `source "repo"`, `plugin "wigley@m"`, `meta {"name": "feature"}`, in `reaching`: listing `["feature"]` gives `not-loaded`, reason `not in this session's transcript`; listing `["wigley:feature"]` gives `listed`, reason `in the session's skill listing`.

Done when: `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)` passes; the tests above exist; `git diff` touches only the two files above.
Commit:    one commit for the group, in wigley-ai-marketplace, committed by path only (peer sessions have uncommitted edits)

## Lead rulings (cold plan reader)

- The version class must end on a letter or digit: `[A-Za-z0-9._+-]*[A-Za-z0-9]`, so `…/wigley/1.9.1.` in prose reads `1.9.1`. One test for it.

## Proof

