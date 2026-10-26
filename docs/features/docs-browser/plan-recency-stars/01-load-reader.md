# 01 — Listing names and the transcript load reader

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)
Repo: wigley-ai-marketplace

All paths below are under `plugins/wigley/scripts/docs-index/` in wigley-ai-marketplace.

Files:     create `listing.py` · create `loads.py` · modify `session.py` · test `tests/test_loads.py` (new)
Consumes:  `Environment.locate_in_claude_config_dirs`, `Environment.claude_config_dirs`, `Entry`, `Location`, `session._listing_name`, `session._is_synced_skill`, `session.SYNCED_SKILLS_PREFIX` — already in the tree
Produces:  `def listing_name(env: Environment, entry: Entry, location: Location) -> str:` in `listing.py`
Produces:  `def is_synced_skill(env: Environment, path: str) -> bool:` in `listing.py`
Produces:  `SYNCED_SKILLS_PREFIX = "anthropic-skills"` in `listing.py`
Produces:  `@dataclass class LoadTimes` with fields `paths: dict[str, str]` and `names: dict[str, str]` (each `field(default_factory=dict)`), in `loads.py`
Produces:  `def merge(self, other: LoadTimes) -> None:` (a `LoadTimes` method) in `loads.py`
Produces:  `def read_loads(transcript: Path, offset: int = 0) -> tuple[LoadTimes, int]:` in `loads.py`

Decisions:
- Move `_listing_name` (`session.py:148`), `_is_synced_skill` (`session.py:162`) and `SYNCED_SKILLS_PREFIX` (`session.py:30`) to the new `listing.py`. Their bodies and docstrings do not change. The public names are `listing_name` and `is_synced_skill`. `session.py` imports `listing_name` from `listing` and calls it in `_entry_state` (`session.py:140`). `session.py` keeps no copy and no alias. (plan.md Decisions: design review, widen a helper, never copy it)
- `listing.py` gets a module docstring: the names a session's listings and load rows use for an entry, shared by `session.py` and `loads.py`. (Decided)
- `discover.py`'s `_is_synced_skill_file` (`discover.py:672`) stays. It tests every config folder, not the judged one, so it is a different rule, not a copy. (Decided)
- No `tests/test_listing.py`. The moved code keeps its tests in `tests/test_session.py`: `test_command_matches_the_listing_by_its_file_name`, `test_a_synced_skill_matches_its_listing_in_the_judged_config_dir`, `test_a_clone_plugin_skill_matches_only_its_plugin_listing_name`. (plan.md File Structure: only if the move needs one)
- `LoadTimes.paths` maps the `os.path.realpath` of each loaded path to an ISO time. `LoadTimes.names` maps `"subagent:<name>"` or `"command:<name>"` to an ISO time. The stored value is the row's own `timestamp` string, unchanged. (lead; plan.md Decisions)
- Times compare as parsed datetimes (`datetime.fromisoformat`), never as strings. `merge` keeps, per key, the later of the two times. On equal times it keeps the time already held. `read_loads` adds each load by the same rule. (lead)
- A row loads only when its top-level `timestamp` is a string that `datetime.fromisoformat` parses and that has a UTC offset (`tzinfo` is not `None`). Every other row is skipped. A row with no `timestamp` is skipped: `api-request-blob` rows repeat tool calls without one. (README § Last loaded; Decided: an offset-less time cannot compare with a `Z` time)
- The load rows, each matched by the row's top-level `type` (README § Last loaded table; the row types measured on 150 transcripts on 2026-10-26):

  | Row `type` | Match | Key added |
  |---|---|---|
  | `attachment` | `attachment.type == "instructions"` | each `attachment.files[].path` (a path) |
  | `attachment` | `attachment.type == "nested_memory"` | `attachment.path` (a path) |
  | `attachment` | `attachment.type` is `file` or `compact_file_reference` | `attachment.filename` (a path) |
  | `attachment` | `attachment.type == "invoked_skills"` | for each `attachment.skills[]` whose `content` starts with `Base directory for this skill: `: `<dir>/SKILL.md` (a path), `<dir>` the rest of the first line of `content` |
  | `user` | `message.content` is a list; an item with `type == "text"` whose `text` starts with `Base directory for this skill: ` | `<dir>/SKILL.md` (a path), `<dir>` the rest of the first line of `text` |
  | `user` | `message.content` is a string | `"command:" + <name>` for each match of `<command-name>/([^<]+)</command-name>`, `<name>` the group, stripped |
  | `assistant` | each `message.content[]` item with `type == "tool_use"` and `name == "Read"` | `input.file_path` (a path) |
  | `assistant` | each `message.content[]` item with `type == "tool_use"` and `name` `Agent` or `Task` | `"subagent:" + input.subagent_type` |

  `<dir>/SKILL.md` is `os.path.join(<dir>, "SKILL.md")`. (lead)
- Not loads: the `edited_text_file`, `skill_mention`, `dynamic_skill`, `skill_listing` and `agent_listing_delta` attachments; a `tool_use` named `Skill` (its base-directory row carries the load); a `tool_result` item that holds the base-directory text; an `api-request-shape` or `prompt_snapshot` row that holds `<command-name>`. The row-type match in the table excludes the last three. (lead; measured 2026-10-26: `api-request-shape` rows carry a `timestamp` and `<command-name>` text)
- A path value that is not a non-empty string, or that `os.path.isabs` rejects, adds nothing. A name value that is not a non-empty string adds nothing. Every other path is stored under `os.path.realpath(path)`. (Decided: a relative path would resolve against the index's own cwd)
- `read_loads` opens the transcript with `transcript.open("rb")`, seeks to `offset`, and reads one line at a time. A line that does not end in `b"\n"` is a partial last line: it is not parsed, and the returned offset stays at its start. The returned offset is `offset` plus the byte length of every complete line read. So it is the end of the last complete line. (lead; Decided: line by line, since a first read of a large transcript must not load it whole)
- Before `json.loads`, each line is checked for the byte markers below. A line that holds none of them is not parsed. Rows reach megabytes, and a byte pass over all 6.9 GB of transcripts measured 17 s. The markers match compact JSON, as Claude Code writes it (`"type":"attachment"`, no space). (lead)
  `LOAD_MARKERS = (b'"type":"attachment"', b'"name":"Read"', b'"name":"Agent"', b'"name":"Task"', b"Base directory for this skill", b"<command-name>")`
- `json.loads` takes the line's bytes. A line that raises `ValueError` (bad JSON or bad UTF-8), or that parses to a non-dict, is skipped. A field of the wrong shape (a `message` that is not a dict, a `files` item that is not a dict) is skipped, never raised. (lead)
- Module constants in `loads.py`: `LOAD_MARKERS` as above, `SKILL_BASE_PREFIX = "Base directory for this skill: "`, `COMMAND_NAME = re.compile(r"<command-name>/([^<]+)</command-name>")`, `SUBAGENT_KEY_PREFIX = "subagent:"`, `COMMAND_KEY_PREFIX = "command:"`. Task 02 reuses the two key prefixes. (Decided)
- `loads.py` gets a module docstring: it reads load events from Claude Code transcripts (README § Last loaded). Task 02 extends it. Standard library only. (marketplace README: standard library only)
- No wiring into any command in this task. `docs_index.py` does not change. (lead)

GIVEN a transcript with one row of each load shape WHEN `read_loads` runs THEN `paths` and `names` hold each key with its row's `timestamp` string.
GIVEN rows of the non-load shapes WHEN `read_loads` runs THEN `paths` and `names` are empty.
GIVEN a `Read` row with no top-level `timestamp` WHEN `read_loads` runs THEN nothing is added.
GIVEN two loads of one file WHEN `read_loads` runs THEN the later time by parsed datetime is kept, whatever the file order and string order.
GIVEN a read up to offset N and two more lines appended, the last with no newline WHEN `read_loads(transcript, N)` runs THEN only the complete line counts and the offset is the end of that line.
GIVEN a `Read` of a symlinked path WHEN `read_loads` runs THEN the key is the link target's real path.

Tests (`tests/test_loads.py`, class `ReadLoadsTests`). Module docstring: `read_loads` and `LoadTimes` on transcripts each test writes in its own temp home. `setUp` makes `self.home = Path(os.path.realpath(tmp.name))`, as `tests/test_docs_index.py` does. A helper writes rows with `json.dumps(row, separators=(",", ":"))`, one per line, each ending in `"\n"`: the markers match compact JSON only, so a test written with the default `json.dumps` separators would see no load. Paths are under `self.home`.
- `test_each_load_row_counts_at_its_timestamp` — one transcript with these rows, each at its own time `2026-10-01T00:00:0<n>.000Z`, n = 0 to 9 in the order the rows are listed: an `instructions` attachment with files `a.md` and `b.md`; `nested_memory` `c.md`; `file` `d.md`; `compact_file_reference` `e.md`; a user row with `message.content` `[{"type": "text", "text": "Base directory for this skill: <home>/skills/k\n\nbody"}]`; `invoked_skills` with `skills` `[{"name": "wigley:r", "path": "plugin:wigley:r", "content": "Base directory for this skill: <home>/skills/r\n\nbody"}]`; an assistant row with a `tool_use` `Read` of `f.md`; an assistant `tool_use` `Agent` with `subagent_type` `wigley:haiku`; an assistant `tool_use` `Task` with `subagent_type` `scout`; a user row with string content `<command-message>wigley:make</command-message>\n<command-name>/wigley:make</command-name>\n<command-args></command-args>`. Assert `paths` equals the exact dict of the six paths `a.md`–`f.md` and `<home>/skills/k/SKILL.md`, `<home>/skills/r/SKILL.md` to their time strings, and `names == {"subagent:wigley:haiku": ..., "subagent:scout": ..., "command:wigley:make": ...}` with their exact strings.
- `test_rows_that_are_not_loads_add_nothing` — rows, each with a `timestamp`: `edited_text_file` (`filename` set), `skill_mention`, `dynamic_skill`, `skill_listing`, `agent_listing_delta` attachments; an assistant `tool_use` `Skill`; a user row whose content is `[{"type": "tool_result", "content": "Base directory for this skill: <home>/skills/k"}]`; `{"type": "api-request-shape", "timestamp": ..., "shape": "<command-name>/x</command-name>"}`. Assert `paths == {}` and `names == {}`.
- `test_a_row_with_no_timestamp_is_skipped` — three rows: `{"type": "api-request-blob", "message": {"content": [<Read tool_use of f.md>]}}`; `{"type": "assistant", "message": {"content": [<Read tool_use of f.md>]}}` with no `timestamp` key; and the same assistant row with `"timestamp": "2026-10-26"` (no offset): `paths == {}`. The second row makes the test fail when the timestamp check is removed.
- `test_the_later_time_of_two_loads_is_kept` — `Read` of `f.md` at `2026-10-26T21:01:32.174Z`, then at `2026-10-26T09:00:00-13:00` (22:00 UTC, later, though its string sorts first), then at `2026-10-26T08:00:00.000Z`: `paths[<f.md>] == "2026-10-26T09:00:00-13:00"`.
- `test_merge_keeps_the_later_time_per_key` — `LoadTimes(paths={"/x": "2026-10-02T00:00:00Z", "/y": "2026-10-02T00:00:00Z"}, names={"command:a": "2026-10-01T00:00:00Z"})` merged with `LoadTimes(paths={"/x": "2026-10-03T00:00:00Z", "/y": "2026-10-01T00:00:00Z", "/z": "2026-10-01T00:00:00Z"}, names={})`: `paths == {"/x": "2026-10-03T00:00:00Z", "/y": "2026-10-02T00:00:00Z", "/z": "2026-10-01T00:00:00Z"}`, `names == {"command:a": "2026-10-01T00:00:00Z"}`.
- `test_a_line_that_is_not_json_is_skipped` — `not json "name":"Read"` between two valid `Read` rows: both valid rows count.
- `test_resume_reads_only_appended_lines_and_stops_before_a_partial_line` — write two `Read` rows (`a.md`, `b.md`); `read_loads(t)` returns offset `== t.stat().st_size`. Append a complete `Read` row of `c.md` and a partial `Read` row of `d.md` with no `"\n"`. `read_loads(t, offset)`: `paths` has `c.md` only; the new offset is the size before the partial line. Append `"\n"`; `read_loads(t, new_offset)`: `paths` has `d.md` only.
- `test_a_path_is_stored_under_its_real_path` — `real/x.md` exists; `link` is a symlink to `real`; a `Read` of `<home>/link/x.md`: the key is `str(self.home / "real" / "x.md")`.
- `test_a_relative_path_is_skipped` — a `Read` with `file_path` `x.md`: `paths == {}`.

Done when: `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)` passes; the tests above exist; `grep -n "_listing_name\|_is_synced_skill\|SYNCED_SKILLS_PREFIX" session.py` prints nothing; `git status --short -- plugins/wigley/scripts/docs-index` lists exactly the four paths above.
Commit:    one commit for the group, in wigley-ai-marketplace, committed by path only (peer sessions may hold uncommitted edits)

## Proof

Commit d73a6b1 (marketplace) · proof: diff read: all 6 Produces present; py_compile + docs-index unittest discover OK · concerns: session.py dropped the orphaned Location import
