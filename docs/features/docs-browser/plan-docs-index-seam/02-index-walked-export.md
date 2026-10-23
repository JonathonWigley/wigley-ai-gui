# 02 — Index export: schema 2 with each entry's walked paths

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo:      wigley-ai-marketplace (`/Users/jonathonwigley/Documents/dev/personal/wigley-ai-marketplace`), its current
           branch; leave every file a peer has modified there alone
Files:     modify `plugins/wigley/scripts/docs-index/model.py`
           test `plugins/wigley/scripts/docs-index/tests/test_model.py` · `plugins/wigley/scripts/docs-index/tests/test_discover.py` ·
           `plugins/wigley/scripts/docs-index/tests/test_docs_index.py`
           modify, only if the version rule below asks: `plugins/wigley/.claude-plugin/plugin.json` ·
           `plugins/wigley/.codex-plugin/plugin.json`
Consumes:  none
Produces:  `SCHEMA_VERSION = 2` and `Entry.to_json()` emitting `"walked": [location.path for location in self.walked]`
           in `model.py`
Decisions: schema 2 with `walked` required (round 2, Schema version) · the README was written ahead in `6a1a551`

## Behaviour

- `to_json` adds `walked` after `meta`, in walk order: the `Location.path` of each entry in `self.walked`, `[]` when
  it is empty. The `Entry` docstring's "to_json leaves walked out" becomes "to_json exports the walked paths, not
  their owners".
- `SCHEMA_VERSION` becomes 2.
- Version rule (marketplace `AGENTS.md` § Changing a plugin): read wigley's `version` in `.claude-plugin/plugin.json`
  and in `git show origin/main:plugins/wigley/.claude-plugin/plugin.json`. If they differ, an unpushed bump already
  covers this change; change neither manifest. If they match, bump the patch number in both manifests in this
  commit.

GIVEN an entry with two walked locations WHEN `to_json` runs THEN `walked` lists their two paths in order
GIVEN an entry with none WHEN `to_json` runs THEN `walked` is `[]`
GIVEN a whole document WHEN `document` runs THEN `schemaVersion` is 2

Tests:     `test_model.py`: `test_to_json_lists_walked_paths_in_order`, `test_to_json_walked_empty_without_links`;
           `test_document_sorts_entries_by_id_and_carries_schema_version_1` becomes
           `test_document_sorts_entries_by_id_and_carries_the_schema_version`, asserting 2 · `test_docs_index.py`:
           the `schemaVersion` assertion near line 78 asserts 2 · `test_discover.py`: the test
           `test_a_per_skill_link_is_kept_as_a_walked_path_outside_the_json` becomes
           `test_a_per_skill_link_is_exported_as_a_walked_path`, asserting
           `entry.to_json()["walked"] == [str(repo / ".claude" / "skills" / "s" / "SKILL.md")]`
Done when: `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)` passes
Commit:    one commit for the group, in wigley-ai-marketplace

## Proof
