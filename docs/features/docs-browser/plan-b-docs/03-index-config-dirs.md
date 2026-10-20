# 03 — Docs index: claudeConfigDirs

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: wigley-ai-marketplace, `main` (its `AGENTS.md`: commit straight to `main`). Folder `D` below is
`~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/scripts/docs-index/`.

The docs index reads Claude Code's user files from more than one config folder. The config file
gets the `claudeConfigDirs` key. Each listed folder's files are part of the global layer. `build`
and `context` judge Claude Code load states against the first folder. `session <id>` finds its
transcript in any folder and judges against the folder that holds it. The README text is already
committed (`44bf63a`, § Commands `session`, § Config `claudeConfigDirs`). Make the code agree with it.

Files:     modify `D/config.py` · `D/environment.py` · `D/discover.py` · `D/claude_rules.py` ·
           `D/codex_rules.py` · `D/session.py` · `D/docs_index.py` ·
           `plugins/wigley/.claude-plugin/plugin.json` · `plugins/wigley/.codex-plugin/plugin.json`
           test `D/tests/test_config.py` · `D/tests/test_environment.py` · `D/tests/test_discover.py` ·
           `D/tests/test_claude_rules.py` · `D/tests/test_codex_rules.py` · `D/tests/test_session.py` ·
           `D/tests/test_docs_index.py`
Consumes:  none from other tasks. Members already in the tree: `string_list_setting`, `setting_of_type`,
           `expand_home`, `Environment`, `_Scan`, `ClaudeRules`, `CodexRules`, `read_session`,
           `SessionTranscript`, `main`.
Produces:  in `D/config.py`:
           `DEFAULT_CONFIG["claudeConfigDirs"] == ["~/.claude"]`
           `Config.claude_config_dirs: tuple[Path, ...]` (a required field; never empty from `load_config`)
           `def home_relative(path: Path, home: Path) -> str`
           in `D/environment.py`, on `Environment`:
           `claude_config_dirs: tuple[Path, ...] = ()` (field; `__post_init__` sets `(home / ".claude",)` when empty)
           `def judged_by(self, config_dir: Path) -> Environment`
           `def locate_in_claude_config_dirs(self, path: Path | str) -> tuple[Path, Path] | None`
           `def claude_plugin_installs(self, config_dir: Path) -> list[PluginInstall]` (it takes a parameter now)
           module function `def walked_path(folder: Path) -> Path`
           in `D/session.py`: `SessionTranscript.config_dir: Path`
           both plugin manifests: one `"version"`, the one the Version rule gives

## Decisions

Each decision comes from `../design.md` § Docs browser ("Second Claude config folder") and the
committed README § Config, unless marked **(drafter)**: the drafter settled it from the code.

**Config** (`config.py`)

- `DEFAULT_CONFIG` gets `"claudeConfigDirs": ["~/.claude"]` as its last key. A new config file
  written by `_write_defaults` then holds the key. An existing file without the key takes the default
  and prints nothing. This Mac's file does not have the key now.
- Read the key with `string_list_setting(raw, "claudeConfigDirs", DEFAULT_CONFIG["claudeConfigDirs"], path)`.
  A value that is not a list, or is a list that holds a non-string, prints the one stderr line that
  `string_list_setting` already prints, then takes the default.
- An empty list prints exactly this one stderr line, then takes the default (**drafter**: the README
  says "is empty, takes the default", and the brief says one stderr line, as other bad keys do):
  `docs index: ignoring claudeConfigDirs in {path}: an empty list`
- Expand each item with `expand_home(item, env.home)` into a `Path`. Keep the order. Drop a duplicate
  after expansion and keep its first position (**drafter**: two equal folders would walk the same
  files twice). `Config.claude_config_dirs` is a tuple, so it can go straight into the frozen
  `Environment`.
- `home_relative(path, home)` gives `path` as a string, with a leading `home` written as `~`
  (`home/.claude-personal` → `~/.claude-personal`). A path that is not below `home` stays as written.
  It is the inverse of `expand_home` and sits beside it. It compares `path` with `home` as written,
  and does not resolve either one.

**Environment** (`environment.py`): how the folders travel (**drafter**)

- `Environment` gets the field `claude_config_dirs: tuple[Path, ...] = ()`. The first folder is the
  *judged* folder. Claude Code's user-level settings, plugin enablement, the AGENTS.md mode and the
  user-file load rules all come from it. When the field is empty, `__post_init__` sets it to
  `(self.home / ".claude",)` (use `object.__setattr__`, because the dataclass is frozen). Then every
  existing `Environment(home=..., now=...)` in the tests behaves as it does today.
- Config is read after the `Environment` is built, so the folders reach the `Environment` through
  `dataclasses.replace`. Use `replace` and never construct a new `Environment`: `test_docs_index.py`'s
  `_OriginCountingEnvironment` subclass must keep its type and its shared `origin_calls` counter.
- `judged_by(config_dir)` returns
  `replace(self, claude_config_dirs=(config_dir, *(d for d in self.claude_config_dirs if d != config_dir)))`.
- `walked_path(folder)` returns `Path(os.path.realpath(folder.parent)) / folder.name`. This is the
  form in which a walk sees a config folder: the parent's real path, with a link at the folder itself
  kept. For `~/.claude` it is the same path `discover._walk_global` walks today (`scan.home / ".claude"`).
- `locate_in_claude_config_dirs(path)` returns `(config_dir, relative)` for the first configured
  folder that holds `path`, else `None`. `config_dir` is the folder as configured, an item of
  `claude_config_dirs`. `relative` is `path` relative to the form that matched. For each folder,
  try three forms in this order: the folder as written, `walked_path(folder)`, then
  `Path(os.path.realpath(folder))`. Each test is lexical (`Path(path).is_relative_to(form)`), and
  `path` is never resolved: a location's path is already a real path or a walked path.
- These methods switch from `self.home / ".claude"` to the judged folder
  (`self.claude_config_dirs[0]`): the user candidate of `claude_settings_files`, and the settings file
  of `instruction_files_mode`. `enabled_claude_plugins` follows, because it reads `claude_settings_files`.
- `claude_plugin_installs(config_dir)` reads `config_dir / "plugins" / "installed_plugins.json"`.
  Everything else in it stays the same. The callers pass the folder explicitly: discovery passes each
  folder, and `ClaudeRules` passes the judged folder.
- Update the module docstring: the Claude Code settings and install records come from the configured
  Claude config folders, and the first folder is judged.

**Discovery** (`discover.py`)

- `_walk_global` runs its current `~/.claude` block once for each folder in `env.claude_config_dirs`,
  in order, walked at `walked_path(folder)`. The block covers `CLAUDE.md`, `rules`, `skills/*/SKILL.md`,
  the synced buckets, `agents/*.md`, `commands`, and the hooks of `settings.json` /
  `settings.local.json`. Every file is owned by `GLOBAL`. The `.codex`, `.agents/skills` and
  `wigley-agents` parts then run once, after all the folders, as they do now. A folder that does not
  exist adds nothing; the current globs and walks already handle a missing folder.
- `_walk_plugins` collects `env.claude_plugin_installs(folder)` for each folder in order, then the
  Codex installs, and groups them by real install folder as it does now. On this Mac, both
  `~/.claude` and `~/.claude-personal` list the same install folders under `~/.claude/plugins/cache/`
  (measured at plan time, re-verify). So one plugin entry stays one entry.
- `_plugin_meta`'s `installs` keeps each distinct `(scope, projectPath)` pair once, at its first
  position (**drafter**: without this, every plugin on this Mac would list `user` twice).
- Ids are real paths, so two folders that hold files with the same name give two entries:
  `~/.claude/CLAUDE.md` and `~/.claude-personal/CLAUDE.md` have different ids. Nothing else is needed
  to tell them apart. An entry's `path` shows which folder holds it.
- The module docstring says "the global layer under the home folder". Add "and each Claude config
  folder".

**Claude Code rules** (`claude_rules.py`)

- `_Scope` gets two fields. `config_dir: Path` is the judged folder (`env.claude_config_dirs[0]`).
  `locate_config_file: Callable[[Path], tuple[Path, Path] | None]` is the bound
  `env.locate_in_claude_config_dirs`. The module-level helpers stay static and read only `scope`.
- `_location_state` order (the new step is 4):
  1. the Codex check (unchanged)
  2. `POINTER_KINDS` (unchanged)
  3. a plugin location → `_plugin_file_state` (unchanged). This step comes before step 4 because
     plugin caches sit inside a config folder (`~/.claude/plugins/cache/...`). A plugin's files are
     judged as the plugin's, whatever folder holds the cache.
  4. `located = scope.locate_config_file(path)`:
     - located in a folder that is not `scope.config_dir` → `State("not-loaded", f"in Claude config folder {home_relative(folder, home)}; states are judged against {home_relative(scope.config_dir, home)}")`,
       with `home` the unresolved `env.home`. Verbatim for this Mac's case:
       `in Claude config folder ~/.claude; states are judged against ~/.claude-personal`
     - located in `scope.config_dir`, with `relative` and `T = home_relative(scope.config_dir, home)`:
       - kind `instructions` and `relative == Path("CLAUDE.md")` → `launch`, `user instructions file {T}/CLAUDE.md`
       - kind `rule` and `relative.parts[0] == "rules"` → with `paths:`, `on-demand`, `rule in {T}/rules scoped by paths:`;
         without it, `launch`, `rule in {T}/rules without paths:`
       - kind `skill` and `relative.parts[0] == "skills"` (the synced buckets included) → `listed`,
         `user skill in {path.parent}`; with `userInvokedOnly`, `on-demand`,
         `user skill in {path.parent}, with disable-model-invocation`
       - kind `subagent` and `relative.parts[0] == "agents"` → `listed`, `user file in {T}/agents`
       - kind `command` and `relative.parts[0] == "commands"` → `listed`, `user file in {T}/commands`
       - any other file in the judged folder (a hook, a file only an `@import` reaches) falls through
         to the kind dispatch, as today
  5. the kind dispatch (unchanged in order)

  For the default folder `~/.claude`, every reason above is the string the code emits today. The
  existing tests keep their asserted reasons.
- The user branches that step 4 replaces are deleted: the `path == scope.home / ".claude" / "CLAUDE.md"`
  line in `_instructions_state`, and the `owner == scope.home` branches in `_rule_state`,
  `_skill_state` and `_listed_in_claude_folder_state`. Those helpers now judge project `.claude`
  folders only. `_rule_state`'s condition becomes `owner is None or owner not in scope.ancestors`,
  and its `where` is always `f"{owner}/.claude/rules"`.
- `_first_claude_md_above` (the AGENTS.md shadowing search) skips a candidate that
  `locate_config_file` places in any configured folder, judged or not. This replaces its
  `home / ".claude" / "CLAUDE.md"` exclusion. Without it, `~/.claude/CLAUDE.md` would shadow every
  AGENTS.md under the home folder when `~/.claude-personal` is the judged folder.
- `_enabled_plugin_roots` reads `self._env.claude_plugin_installs(self._env.claude_config_dirs[0])`.
- Update the module docstring: user-level files come from the judged config folder, and another
  configured folder's files are not-loaded.

**Codex rules** (`codex_rules.py`) (**drafter**, see README fix 2 in the report)

- `_is_claude_file` also returns true for a path that `env.locate_in_claude_config_dirs` places in
  any configured folder. The reason stays `Claude Code file`. Today `~/.claude-personal/rules/r.md`
  reads `no load rule reaches this file`, because `.claude-personal` is not `.claude`. `_Scan` gets
  `locate_config_file`, as `_Scope` does.

**Session** (`session.py`)

- `_transcript_path(env, session_id)` returns `(config_dir, transcript)`. It searches
  `config_dir / "projects" / <child> / f"{session_id}.jsonl"` for each `config_dir` in
  `env.claude_config_dirs`, in order. Inside one folder it searches the project children in sorted
  order, as now. The first file it finds wins. It keeps its name, and `read_session` calls it exactly
  once (`test_session_finds_and_reads_the_transcript_once` patches it by name and counts the calls).
- No transcript raises `SessionNotFound` with exactly
  `no transcript for session {session_id} under {", ".join(str(d / "projects") for d in env.claude_config_dirs)}`.
- `SessionTranscript` gets `config_dir: Path`, the configured folder that holds the transcript.
- `_is_synced_skill(env, path)` is true when `env.locate_in_claude_config_dirs(path)` returns
  `(env.claude_config_dirs[0], relative)` with `relative.parts[:2] == ("skills", "synced")`. The
  session's `env` is already judged by the transcript's folder (see `docs_index.py`).
- In a session context, a file from another folder reads `not in this session's transcript`, as every
  file the transcript did not load does. No new reason.

**Command line** (`docs_index.py`)

- New private helper `_configured(env) -> tuple[Environment, Config]`: `config = load_config(env)`,
  then return `(replace(env, claude_config_dirs=config.claude_config_dirs), config)`.
- `_build`: call `_configured` first. Discovery, rules and the write all use the returned `env`.
- `_context`: keep the `not a folder` check first, so that a bad folder still exits 1 before the
  config is read. Then call `_configured`.
- `_session`: call `_configured` first; `read_session` must search every folder. Then
  `env = env.judged_by(session.config_dir)` before `discover_folder`, `_reaching_entries` and
  `session_context`.
- `main` does not change.

**Version**: one bump per pushed series (marketplace `AGENTS.md`, Changing a plugin). Read
`git show origin/main:plugins/wigley/.claude-plugin/plugin.json` after a `git fetch`: when the local
manifests already carry a version above origin's (an unpushed bump, such as plan A's), leave them as they
are and write that in the run log; otherwise bump both to the next minor in this task's commit.

## Behaviour

GIVEN `claudeConfigDirs: ["~/.claude-personal", "~/.claude"]` WHEN `build` runs THEN both folders'
`CLAUDE.md`, rules, skills, synced skills, subagents, commands and settings hooks are `source: global`
entries, and in every context Claude Code judges `~/.claude-personal`'s files as user files, and
`~/.claude`'s files as `not-loaded`, `in Claude config folder ~/.claude; states are judged against ~/.claude-personal`
GIVEN that config WHEN `context <repo>` runs THEN the user settings, the AGENTS.md mode and the plugin
enablement come from `~/.claude-personal/settings.json`, and the plugins come from
`~/.claude-personal/plugins/installed_plugins.json`
GIVEN `claudeConfigDirs: ["~/.claude", "~/.claude-personal"]` and a transcript only under
`~/.claude-personal/projects/` WHEN `session <id>` runs THEN it exits 0 and the states are those that
transcript shows, judged with `~/.claude-personal` first
GIVEN an id with no transcript in any folder WHEN `session <id>` runs THEN it exits 1 and stderr names
each folder's `projects` folder
GIVEN `claudeConfigDirs` set to `"~/.claude"`, `[1]` or `[]` WHEN any command runs THEN it runs on
`["~/.claude"]` after one stderr line that names `claudeConfigDirs`
GIVEN a config file with no `claudeConfigDirs` WHEN any command runs THEN it runs on `["~/.claude"]`
with no stderr line, and every existing test passes unchanged except the call-site edits named below

## Tests

Use the existing fixture pattern: a temp home per test, `FIXED_NOW`, files written by the test.
"Two folders" means `Environment(home=self.home, now=lambda: FIXED_NOW, claude_config_dirs=(…))`.
`P = self.home / ".claude-personal"` and `C = self.home / ".claude"`.

Call-site edits to existing tests, with no other change:

- `test_environment.py`: the two `self.env.claude_plugin_installs()` calls (measured at plan time, re-verify) become
  `self.env.claude_plugin_installs(self.home / ".claude")`.
- `test_discover.py`: `_config` passes `claude_config_dirs=(self.home / ".claude",)`.

`test_config.py`

- `test_absent_config_is_written_with_the_claude_config_dirs_default` — `written["claudeConfigDirs"] == ["~/.claude"]`;
  `config.claude_config_dirs == (self.home / ".claude",)`.
- `test_claude_config_dirs_expand_their_tilde_in_order_once_each` — the file holds
  `{"claudeConfigDirs": ["~/.claude-personal", "~/.claude", "~/.claude-personal"]}`;
  `config.claude_config_dirs == (P, C)`.
- `test_claude_config_dirs_of_the_wrong_shape_or_empty_take_the_default_with_one_line` — a `subTest`
  for each of `"~/.claude"`, `[1]` and `[]`: `config.claude_config_dirs == (C,)`; `"claudeConfigDirs"`
  is in stderr; `err.getvalue().count("\n") == 1`.
- `test_home_relative_writes_the_home_as_a_tilde` — `home_relative(P, self.home) == "~/.claude-personal"`;
  `home_relative(Path("/etc/claude"), self.home) == "/etc/claude"`.

`test_environment.py`

- `test_claude_config_dirs_default_to_the_home_claude_folder` — `self.env.claude_config_dirs == (C,)`.
- `test_settings_and_mode_come_from_the_judged_config_dir` — two folders `(P, C)`;
  `P/settings.json` = `{"enabledPlugins": {"a@m": true}, "pluginConfigs": {"cc-plugin-agents-md@builtin": {"options": {"instructionFiles": "claude-md"}}}}`;
  `C/settings.json` = `{"enabledPlugins": {"b@m": true}}`. Asserts:
  `env.claude_settings_files(None) == [P / "settings.json"]`; `env.enabled_claude_plugins(None) == {"a@m"}`;
  `env.instruction_files_mode() == "claude-md"`.
- `test_claude_plugin_installs_read_the_given_config_dir` — `P/plugins/installed_plugins.json` lists
  `a@m` (scope `user`, installPath an existing `self.root/"cache"/"m"/"a"/"1.0.0"`). Asserts:
  `[i.key for i in env.claude_plugin_installs(P)] == ["a@m"]`; `env.claude_plugin_installs(C) == []`.
- `test_judged_by_puts_the_folder_first_and_keeps_the_rest` — two folders `(C, P)`;
  `env.judged_by(P).claude_config_dirs == (P, C)`; `.home == self.home`.
- `test_locate_finds_a_path_as_written_walked_or_real` — the real folder is `self.root / "dotclaude"`,
  `P` is a symlink to it, and the two folders are `(C, P)`. Asserts:
  `locate(C / "rules" / "r.md") == (C, Path("rules/r.md"))`;
  `locate(Path(os.path.realpath(self.home)) / ".claude" / "CLAUDE.md") == (C, Path("CLAUDE.md"))`;
  `locate(self.root / "dotclaude" / "CLAUDE.md") == (P, Path("CLAUDE.md"))`;
  `locate(P / "CLAUDE.md") == (P, Path("CLAUDE.md"))`;
  `locate(self.home / "notes.md") is None`.

`test_discover.py`

- `test_every_claude_config_dir_is_walked_as_global` — two folders `(C, P)`. The test writes
  `C/CLAUDE.md`, and these in `P`: `CLAUDE.md`, `rules/r.md`, `skills/s/SKILL.md` (`name: s`),
  `skills/synced/b/t/SKILL.md` (`name: t`), `agents/a.md`, `commands/c.md`, and `settings.json` =
  `{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "say done"}]}]}}`. Asserts: each
  file's real path is an entry id, with kind `instructions` (both CLAUDE.md files), `rule`, `skill`
  (both skills), `subagent`, `command`; `f"{P}/settings.json#hook:Stop:0"` is an entry of kind `hook`;
  every one of these entries has `source == "global"`.
- `test_a_plugin_listed_by_two_config_dirs_is_one_entry_with_each_install_once` — install folders
  `self.root/"cache"/"m"/"p"/"1.0.0"` and `…/"q"/"1.0.0"`, each with `skills/k/SKILL.md`.
  `C`'s `installed_plugins.json` lists `p@m` (user). `P`'s lists `p@m` (user, the same installPath)
  and `q@m` (user). Asserts: `entries[str(p)].meta["installs"] == [{"scope": "user", "projectPath": None}]`;
  `entries[str(q)].kind == "plugin"`; `entries[str(q)].plugin == "q@m"`.

`test_claude_rules.py`. The new tests build
`ClaudeRules(Environment(home=self.home, now=lambda: FIXED_NOW, claude_config_dirs=(P, C)))`, so `P` is judged.

- `test_files_of_the_judged_config_dir_load_as_user_files` — `P/CLAUDE.md`, `P/rules/r.md`,
  `P/skills/s/SKILL.md`, `P/agents/a.md`, `P/commands/c.md`, all `source="global"`, judged for repo
  `self._repo("r")`. Expected `(state, reason)`:
  `("launch", "user instructions file ~/.claude-personal/CLAUDE.md")`,
  `("launch", "rule in ~/.claude-personal/rules without paths:")`,
  `("listed", f"user skill in {P / 'skills' / 's'}")`,
  `("listed", "user file in ~/.claude-personal/agents")`,
  `("listed", "user file in ~/.claude-personal/commands")`.
- `test_files_of_another_config_dir_are_not_loaded` — `C/CLAUDE.md`, `C/rules/r.md` and
  `C/skills/s/SKILL.md` (`source="global"`), judged for repo `r`: each is `("not-loaded",
  "in Claude config folder ~/.claude; states are judged against ~/.claude-personal")`.
- `test_another_config_dirs_claude_md_shadows_no_agents_md` — `C/CLAUDE.md` exists; a repo under the
  home folder (`self.home / "dev" / "r"`, holding `.git` and `AGENTS.md`). The repo's `AGENTS.md` is
  `launch` for that repo.
- `test_hooks_and_plugins_come_from_the_judged_config_dir` — `P/settings.json` =
  `{"enabledPlugins": {"p@m": true}}`; `C/settings.json` = `{}`. `P`'s `installed_plugins.json` lists
  `p@m` (user) at `install = C/"plugins"/"cache"/"m"/"p"/"1.0.0"`, which holds `hooks/hooks.json` = `{}`
  and `skills/k/SKILL.md`. Entries: the two settings files as `hook`, `source="global"`; the plugin's
  hooks file as `hook` and its skill as `skill`, both `source="plugin"`, `root=install`,
  `plugin="p@m"`. Asserts: `P/settings.json` `launch`; `C/settings.json` is not-loaded with the
  other-folder reason above; plugin hooks `launch`; the plugin skill is
  `("listed", "skill of enabled plugin p@m")`. This last assertion pins step 3 before step 4: the
  cache sits inside `C`.

`test_codex_rules.py`

- `test_a_file_in_a_claude_config_dir_is_a_claude_file` — `CodexRules` over two folders `(P,)`;
  `P/rules/r.md` as a `rule` entry, `source="global"`, root `None`. Its state is
  `("not-loaded", "Claude Code file")`.

`test_session.py`. The transcript helper takes the config folder (default `C`).

- `test_finds_the_transcript_in_a_later_config_dir` — two folders `(C, P)`; the transcript is only
  under `P/projects/-dev-app/`, with `cwd` = repo. `read_session(env, SESSION_ID).config_dir == P`;
  `.folder == self.repo`.
- `test_the_first_config_dir_holding_the_transcript_wins` — the same id is under both `C` and `P`.
  `config_dir == C`.
- `test_unknown_session_names_every_projects_folder` — two folders `(C, P)`, no transcript.
  `str(C / "projects")` and `str(P / "projects")` are both in the exception text.
- `test_a_synced_skill_matches_its_listing_in_the_judged_config_dir` — two folders `(P, C)`; the skill
  entry is at `P/skills/synced/b/x/SKILL.md`, `source="global"`, `meta={"name": "x"}`; the transcript
  (under `P`) has `skill_listing` `["anthropic-skills:x"]`. The skill is `listed`.

`test_docs_index.py`. `_write_config` gets an optional `claude_config_dirs` list, written as the key
only when it is given.

- `test_build_judges_claude_states_against_the_first_config_dir` — config
  `["~/.claude-personal", "~/.claude"]`; the test writes `P/CLAUDE.md` and `C/CLAUDE.md`; repo `a`.
  After `build`, in the repo's context: `P/CLAUDE.md` claude is `launch`; `C/CLAUDE.md` claude is
  `("not-loaded", "in Claude config folder ~/.claude; states are judged against ~/.claude-personal")`.
- `test_session_reads_a_transcript_from_a_later_config_dir` — config `["~/.claude", "~/.claude-personal"]`;
  `P/CLAUDE.md` and `C/CLAUDE.md` exist; repo `a`. The transcript `P/projects/-dev-a/s1.jsonl` has a
  `cwd` row for `a` and an `instructions` attachment that loads `P/CLAUDE.md`. `session s1` exits 0;
  `P/CLAUDE.md`'s claude state is `launch`; `str(C / "CLAUDE.md")` is among the entry ids.

## Done when

- `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)` passes, with the tests
  above.
- `python3 scripts/check_manifests.py` passes from the repo root.
- Both manifests hold one version, the one the Version rule gives, and the run log names it.
- `grep -c 'home / ".claude"' D/discover.py D/claude_rules.py D/session.py` gives 0 for each file, and
  `D/environment.py` keeps one match, the `__post_init__` default.
- The README needs no change for the code, except the fixes the lead takes into task 10 (doc re-read).
- A run of `build` on this Mac's real config is not a test here: task 11 (Final verification) does it.

Commit:    one commit in wigley-ai-marketplace on `main`, for example "Docs index: index every Claude
           config folder in claudeConfigDirs, judge against the first or the session's own".
           Add no co-author trailer. Do not push.

## Proof

wigley-ai-marketplace `b13aa84` · diff read, every Produces present, 148 docs-index tests and the manifest check pass; version 1.5.0. Concerns and rulings in plan.md's Run log.
