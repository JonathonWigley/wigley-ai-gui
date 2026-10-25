# 01 — Index model, schema 3

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)
Repo: wigley-ai-marketplace

Files:     modify `plugins/wigley/scripts/docs-index/model.py` · test `plugins/wigley/scripts/docs-index/tests/test_model.py` · test `plugins/wigley/scripts/docs-index/tests/test_docs_index.py`
Consumes:  `Location(path: str, owner: Owner)`, `Owner(source, repo, root, plugin)`, `Entry`, `Context`, `best_state`, `document` — already in `model.py`
Produces:  `SCHEMA_VERSION = 3` in `plugins/wigley/scripts/docs-index/model.py`
Produces:  `"skill", "skill-file", "subagent"` (the `KINDS` order) in `plugins/wigley/scripts/docs-index/model.py`
Produces:  `OWNERS = ("mine", "third-party")` in `plugins/wigley/scripts/docs-index/model.py`
Produces:  `class Installed:` with fields `location: Location`, `harness: str`, `version: str` in `plugins/wigley/scripts/docs-index/model.py`
Produces:  `ownership: str = "mine"` (an `Entry` field) in `plugins/wigley/scripts/docs-index/model.py`
Produces:  `installed: tuple[Installed, ...] = ()` (an `Entry` field) in `plugins/wigley/scripts/docs-index/model.py`
Produces:  `loaded_plugins: dict[str, str] = field(default_factory=dict)` (a `Context` field) in `plugins/wigley/scripts/docs-index/model.py`
Produces:  `"loadedPlugins"` in `plugins/wigley/scripts/docs-index/model.py`

Decisions:
- The Python field is `Entry.ownership`, emitted as JSON `owner`. `Entry.owner` stays the existing `Owner` property. Default `"mine"`. (pinned by lead)
- `Entry.installed` is separate from `Entry.walked`. `to_json` exports `walked` from walked locations only: the GUI trashes each walked link with the file, and it must never trash an installed copy. (pinned by lead)
- `Entry.locations` returns the real path with the entry's owner, then each walked location, then each installed location's `location`. The load rules and the reach rule read `locations`, so they judge each installed copy by its own plugin owner, and `best_state` picks the soonest state. No rule module changes for this. (pinned by lead)
- `Installed` is a frozen dataclass. Its `location.owner` is the install's plugin `Owner` (`source "plugin"`, `root` the install folder, `plugin` the install key). `Installed.__post_init__` raises `ValueError` when `harness` is not one of `HARNESSES`, naming the value. (Decided: matches how `Entry` and `State` check their values.)
- `Entry.__post_init__` raises `ValueError` when `ownership` is not one of `OWNERS`. The message names the entry id and the value, in the same form as the kind check: `entry {id!r}: owner {ownership!r} is not one of {OWNERS}`. (Decided)
- A marketplace clone plugin file is an entry with `source == "repo"` and `plugin is not None`. Only such an entry gets `meta.installed`. No other entry has `source "repo"` with a `plugin` set. (Decided: README § Entry, `plugin` is set for `source: plugin` and for a marketplace clone's plugin files.)
- `to_json` does not change `self.meta`. It emits a new dict: for a clone plugin file, `{**self.meta, "installed": [...]}`; for every other entry, `self.meta` as now. Each `installed` item is `{"harness": i.harness, "version": i.version, "path": i.location.path}`, in `Entry.installed` order. An empty tuple emits `[]`. (README § Entry, `meta` table)
- JSON key order of an entry: `id`, `kind`, `source`, `owner`, `repo`, `root`, `plugin`, `path`, `line`, `title`, `meta`, `walked`. (README example)
- JSON key order of a context: `folder`, `sessionId`, `loadedPlugins`, `states`. `loadedPlugins` is `dict(self.loaded_plugins)`. (README § Context)
- The new `Entry` fields go after `walked` and the new `Context` field after `states`, each with a default, so every existing constructor call keeps working. (Decided)
- `test_docs_index.py` asserts `schemaVersion == 2` today; this task changes that assertion to `3`. It is the only edit to that file here. Task 02 adds tests to it in wave 2. (Decided: no two wave-2 tasks touch it.)
- Update the `Entry` docstring: it names `ownership` and `installed`. It says why installed locations stay out of `walked`. (Decided)

GIVEN an entry built with no `ownership` WHEN `to_json` runs THEN `"owner"` is `"mine"`.
GIVEN `ownership="third-party"` WHEN `to_json` runs THEN `"owner"` is `"third-party"`.
GIVEN `ownership="theirs"` WHEN the entry is built THEN `ValueError` names `'theirs'`.
GIVEN `kind="skill-file"` WHEN the entry is built THEN no error is raised.
GIVEN an entry with one walked and one installed location WHEN `locations` is read THEN it holds the real path, then the walked location, then the installed location.
GIVEN that entry WHEN `to_json` runs THEN `walked` lists only the walked path.
GIVEN a clone plugin file with one installed copy WHEN `to_json` runs THEN `meta.installed` holds one `{harness, version, path}` item and the other meta keys stay.
GIVEN a clone plugin file with no installed copy WHEN `to_json` runs THEN `meta.installed` is `[]`.
GIVEN an entry with `source "repo"` and `plugin None` WHEN `to_json` runs THEN `meta` has no `installed` key.
GIVEN a `Context` built with no `loaded_plugins` WHEN `to_json` runs THEN `loadedPlugins` is `{}`.

Tests:
- `test_document_sorts_entries_by_id_and_carries_the_schema_version` (existing, test_model.py) — change the asserted `schemaVersion` from `2` to `3`.
- `test_build_writes_index_with_repo_context` (existing, test_docs_index.py) — change the asserted `doc["schemaVersion"]` from `2` to `3`.
- `test_to_json_emits_owner_after_source_defaulting_to_mine` — `list(_entry("/r/a.md").to_json())` equals `["id", "kind", "source", "owner", "repo", "root", "plugin", "path", "line", "title", "meta", "walked"]`; its `"owner"` is `"mine"`.
- `test_to_json_emits_a_third_party_owner` — an entry with `ownership="third-party"` emits `"owner": "third-party"`.
- `test_unknown_ownership_raises_naming_the_value` — `ownership="theirs"` raises `ValueError` matching `'theirs'`.
- `test_skill_file_is_a_kind` — `_entry("/r/s/ref.md", kind="skill-file")` builds; `KINDS.index("skill-file") == KINDS.index("skill") + 1`.
- `test_locations_hold_the_real_path_then_walked_then_installed` — entry `/r/a.md` (owner `Owner("repo", "r", "/r")`), walked `Location("/w/a.md", Owner("repo", "w", "/w"))`, installed `Installed(Location("/c/p/1.0.0/a.md", Owner("plugin", root="/c/p/1.0.0", plugin="p@m")), "claude", "1.0.0")`: `[l.path for l in entry.locations] == ["/r/a.md", "/w/a.md", "/c/p/1.0.0/a.md"]`, and the third location's owner is the plugin `Owner`.
- `test_to_json_keeps_installed_paths_out_of_walked` — the same entry: `to_json()["walked"] == ["/w/a.md"]`.
- `test_a_clone_plugin_file_emits_meta_installed_in_install_order` — entry `source="repo"`, `plugin="p@m"`, `meta={"name": "k"}`, installed claude `1.0.0` at `/c/claude/k/SKILL.md` then codex `0.9.0` at `/c/codex/k/SKILL.md`: `to_json()["meta"] == {"name": "k", "installed": [{"harness": "claude", "version": "1.0.0", "path": "/c/claude/k/SKILL.md"}, {"harness": "codex", "version": "0.9.0", "path": "/c/codex/k/SKILL.md"}]}`; `entry.meta == {"name": "k"}` after the call.
- `test_a_clone_plugin_file_not_installed_emits_an_empty_installed_list` — `source="repo"`, `plugin="p@m"`, no installed: `to_json()["meta"]["installed"] == []`.
- `test_a_repo_file_outside_a_plugin_has_no_installed_meta` — `source="repo"`, `plugin=None`: `"installed" not in to_json()["meta"]`.
- `test_installed_with_an_unknown_harness_raises` — `Installed(Location("/x", Owner("plugin")), "cursor", "1")` raises `ValueError` matching `'cursor'`.
- `test_context_emits_loaded_plugins_before_states` — `Context("/r", "s", {}, {"p@m": "1.9.1"}).to_json()`: key list is `["folder", "sessionId", "loadedPlugins", "states"]`, `loadedPlugins == {"p@m": "1.9.1"}`; `Context("/r", None, {}).to_json()["loadedPlugins"] == {}`.

Done when: `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)` passes; `git diff` shows `SCHEMA_VERSION = 3` and no change outside the three files above.
Commit:    one commit for the group, in wigley-ai-marketplace, committed by path only (peer sessions have uncommitted edits)

## Proof

