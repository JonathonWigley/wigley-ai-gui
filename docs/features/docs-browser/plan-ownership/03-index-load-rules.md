# 03 — Index load rules for skill files

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)
Repo: wigley-ai-marketplace

Files:     modify `plugins/wigley/scripts/docs-index/claude_rules.py` · modify `plugins/wigley/scripts/docs-index/codex_rules.py` · test `plugins/wigley/scripts/docs-index/tests/test_claude_rules.py` · test `plugins/wigley/scripts/docs-index/tests/test_codex_rules.py`
Consumes:  `"skill-file"` in `KINDS`, `Installed(location: Location, harness: str, version: str)`, `Entry.installed`, `Entry.locations` (real, walked, then installed) ← 01
Consumes:  `ClaudeRules.states`, `CodexRules.states`, `best_state`, `_apply_imports` — already in the tree
Produces:  `SKILL_FILE_REASON = "agents read skill files on a pointer"` in `plugins/wigley/scripts/docs-index/claude_rules.py`
Produces:  `SKILL_FILE = State("not-loaded", "agents read skill files on a pointer")` in `plugins/wigley/scripts/docs-index/codex_rules.py`

Decisions:
- A `skill-file` entry is `not-loaded` for both harnesses, reason `agents read skill files on a pointer`. (pinned by lead; README § Load states)
- The check sits in each module's `_entry_state`, before the per-location loop: `if entry.kind == "skill-file": return <the not-loaded state>`. So one reason holds at every location, a Codex plugin's skill file and a file in another Claude config folder included. (Decided: the `POINTER_KINDS` f-string would read `agents read skill-file files on a pointer`, and a per-location check would let `Codex file` or `Claude Code file` win as the first of equal states.)
- Claude's `_apply_imports` still raises a `skill-file` that an `@import` reaches to its importer's state, as it does for the pointer kinds. Codex has no imports. (README § Load states: "unless an `@import` reaches them; so are `skill-file` entries")
- No new merge logic. Installed copies reach the rules through `Entry.locations`, each judged by its own plugin owner, and `best_state` keeps the soonest. (pinned by lead)
- Codex `_skill_state` checks `[[skills.config]]` against `entry.path` and its parent only. For a merged entry that is the clone path, so a table that disables the installed copy's path stops matching. `_skill_state` gains the location's path: `_skill_state(entry, path, scan, listed)`, and a skill is disabled when `entry.path`, `path`, or either one's parent is in `scan.disabled_skill_paths`. Both callers pass the location path they judge. (Decided: keeps today's result for a skill whose install path the user disabled; not pinned, flagged to the lead)
- Update each module docstring: a `skill-file` is `not-loaded`. (Decided)

GIVEN a `skill-file` entry in a folder's repo WHEN `ClaudeRules.states` runs THEN its state is `not-loaded`, reason `agents read skill files on a pointer`.
GIVEN a `skill-file` entry under the judged `~/.claude/skills` WHEN `ClaudeRules.states` runs THEN its state is the same.
GIVEN the user `CLAUDE.md` imports a skill file WHEN `ClaudeRules.states` runs THEN the skill file is `launch`, reason `imported by <CLAUDE.md path>`.
GIVEN a `skill-file` entry of a Codex plugin WHEN `CodexRules.states` runs THEN its state is `not-loaded`, reason `agents read skill files on a pointer`.
GIVEN a clone skill with an installed copy in an enabled Claude plugin WHEN `ClaudeRules.states` runs THEN it is `listed`, reason `skill of enabled plugin p@m`.
GIVEN a clone skill with an installed copy in an enabled Codex plugin WHEN `CodexRules.states` runs THEN it is `listed`, reason `skill of enabled plugin p@m`.
GIVEN `[[skills.config]]` disables the Codex installed copy's `SKILL.md` path WHEN `CodexRules.states` runs THEN the clone skill is `not-loaded`, reason `disabled by [[skills.config]] in ~/.codex/config.toml`.

Tests (test_claude_rules.py):
- `test_a_skill_file_is_not_loaded_on_a_pointer` — `repo/.claude/skills/s/ref.md`, kind `skill-file`, folder `repo`: `{"state": "not-loaded", "reason": "agents read skill files on a pointer"}`; the same for `~/.claude/skills/s/ref.md` with `source "global"`.
- `test_a_skill_file_an_import_reaches_takes_its_importers_state` — `~/.claude/CLAUDE.md` entry with `meta {"imports": [<~/.claude/skills/s/ref.md>]}`: the skill file is `launch`, reason `imported by <~/.claude/CLAUDE.md>`.
- `test_a_merged_clone_skill_is_listed_through_its_enabled_install` — install `cache/m/p/1.0.0` recorded as `p@m` scope `user`, `settings.json` `{"enabledPlugins": {"p@m": true}}`; entry `clone/plugins/p/skills/k/SKILL.md` kind `skill`, `source "repo"`, `plugin "p@m"`, installed `Installed(Location(<install>/skills/k/SKILL.md, Owner("plugin", root=<install>, plugin="p@m")), "claude", "1.0.0")`: `{"state": "listed", "reason": "skill of enabled plugin p@m"}`.
- `test_a_merged_clone_skill_of_a_disabled_install_is_not_loaded` — the same with `{"p@m": false}`: state `not-loaded`.

Tests (test_codex_rules.py):
- `test_a_codex_plugin_skill_file_is_not_loaded_on_a_pointer` — Codex cache `.codex/plugins/cache/m/p/1.0.0/skills/k/ref.md`, kind `skill-file`, `source "plugin"`, `root` the install: `{"state": "not-loaded", "reason": "agents read skill files on a pointer"}`.
- `test_a_merged_clone_skill_is_listed_through_its_enabled_codex_install` — Codex cache `m/p/1.0.0/skills/k/SKILL.md`, config.toml `[plugins."p@m"]` `enabled = true`; clone entry with that installed copy (harness `codex`): `{"state": "listed", "reason": "skill of enabled plugin p@m"}`.
- `test_skills_config_disables_a_merged_skill_by_its_installed_path` — the same, plus `[[skills.config]]` `path = "<install>/skills/k/SKILL.md"`, `enabled = false`: `{"state": "not-loaded", "reason": "disabled by [[skills.config]] in ~/.codex/config.toml"}`.

Done when: `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)` passes; the tests above exist; `git diff` touches only the four files above.
Commit:    one commit for the group, in wigley-ai-marketplace, committed by path only (peer sessions have uncommitted edits)

## Proof

Commit marketplace 689b9c5f · proof: diff read: skill-file not-loaded in both rule sets, installed locations judged; py_compile clean · concerns: a disabled installed copy (Codex [[skills.config]], disabled Claude plugin) reports 'no load rule reaches this file' because the clone path is judged first and best_state keeps the first of equal states; the Codex merged-skill test checks the state only; fixes proposed: best_state prefers a specific reason, installed-first locations, or skipping the clone path
