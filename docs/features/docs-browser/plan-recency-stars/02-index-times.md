# 02 — Last-loaded times in the index

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)
Repo: wigley-ai-marketplace

All paths below are under `plugins/wigley/scripts/docs-index/` in wigley-ai-marketplace.

Files:     modify `loads.py` · modify `model.py` · modify `session.py` · modify `docs_index.py` · test `tests/test_loads.py` · test `tests/test_model.py` · test `tests/test_session.py` · test `tests/test_docs_index.py`
Consumes:  `@dataclass class LoadTimes` with fields `paths: dict[str, str]` and `names: dict[str, str]`, `def merge(self, other: LoadTimes) -> None:`, `def read_loads(transcript: Path, offset: int = 0) -> tuple[LoadTimes, int]:`, `SUBAGENT_KEY_PREFIX = "subagent:"`, `COMMAND_KEY_PREFIX = "command:"` ← 01
Consumes:  `def listing_name(env: Environment, entry: Entry, location: Location) -> str:` ← 01
Consumes:  `Entry.locations`, `Environment.claude_config_dirs`, `Environment.home`, `read_session`, `session_context`, `_loaded_file_entry`, `_configured`, `_write_index` — already in the tree
Produces:  `LOADS_PATH_PARTS = (".agents", "wigley-docs", "loads.json")` in `loads.py`
Produces:  `def machine_load_times(env: Environment) -> LoadTimes:` in `loads.py`
Produces:  `def session_load_times(transcript: Path) -> LoadTimes:` in `loads.py`
Produces:  `def last_loaded(env: Environment, entry: Entry, times: LoadTimes) -> str | None:` in `loads.py`
Produces:  `SCHEMA_VERSION = 4` in `model.py`
Produces:  `last_loaded: str | None = None` (an `Entry` field, emitted as `"lastLoaded"`) in `model.py`
Produces:  `transcript: Path` (a `SessionTranscript` field) in `session.py`
Produces:  `def _with_last_loaded(env: Environment, entries: list[Entry], times: LoadTimes) -> list[Entry]:` in `docs_index.py`

Decisions:
- `build` and `context` give machine-wide times from `machine_load_times`. `session` gives the session's own times from `session_load_times`. (plan.md Decisions: round 2, Decided)
- Load states do not change. No rule module and no `session_context` state logic changes. (plan.md Out of scope)

**Machine scan** (`machine_load_times`; README § Last loaded, Transcripts and Cache)
- Transcripts: for each folder in `env.claude_config_dirs`, in order, `sorted(folder.glob("projects/*/*.jsonl"))` then `sorted(folder.glob("projects/*/*/subagents/**/*.jsonl"))`. A file named `journal.jsonl` is skipped: it has another row shape. A file is keyed by `str(path)` as the glob gives it. (lead)
- The cache is `env.home.joinpath(*LOADS_PATH_PARTS)`. Its JSON is `{"version": 1, "transcripts": {"<abs path>": <offset>}, "paths": {...}, "names": {...}}`. (lead)
- The cache is valid only when all of these hold: it reads and parses as a JSON object; `version` is `1`; `transcripts` is an object of string to non-negative `int` (not `bool`); `paths` and `names` are objects of string to string, each string parsed by `datetime.fromisoformat` with a UTC offset. Any other cache — absent, unreadable (`OSError`), not JSON (`ValueError`), another shape, another `version` — reads as empty: every transcript is read from offset 0, and the cache is written. No stderr line. (lead; Decided: the cache is regenerable, so its loss is silent)
- Per transcript, with `size = path.stat().st_size` and the cached offset (0 when absent): `size == offset` reads nothing; `size > offset` calls `read_loads(path, offset)`; `size < offset` calls `read_loads(path, 0)`, since the file was replaced or truncated. An `OSError` on `stat` or on the read skips that transcript for this run and leaves it out of the written `transcripts`. (lead; Decided: skip an equal size, so a run with no new rows opens no transcript)
- The cached `paths` and `names` times are the start, and each read's `LoadTimes` is merged in with `merge`. The written `transcripts` holds only the transcripts this run found, each with its new offset. Times of a transcript gone from disk stay in `paths` and `names`. (Decided: times are history; README: "Times only grow")
- `machine_load_times` calls `read_loads` through the module global, so a test can wrap it with `mock.patch("loads.read_loads", wraps=loads.read_loads)`. (Decided)
- The cache is written as compact JSON (`json.dumps(cache)`) to a temp file in the same folder, then `os.replace` onto `loads.json`. The temp file name is `loads.json.<os.getpid()>.tmp`. The folder is made with `mkdir(parents=True, exist_ok=True)`. A write error is not caught, as `_write_index` (`docs_index.py:167`) does not catch one. `loads.py` keeps its own small writer: it cannot import the composition root `docs_index.py`. (Decided: the pid suffix differs from `_write_index`'s fixed `.json.tmp`, because two runs writing at once with one temp name can lose the file before the second `os.replace`, and README § Last loaded says two runs at once leave correct times)
- `machine_load_times` is the only reader and writer of the cache. `session` neither reads nor writes it. (lead)

**Session scan** (`session_load_times`)
- It reads `transcript`, then `sorted(transcript.with_suffix("").glob("subagents/**/*.jsonl"))`, `journal.jsonl` skipped. Each file is read with `read_loads(file, 0)`, and the results are merged. No cache. (lead; README: `<id>.jsonl` and `<id>/subagents/**/*.jsonl` beside it)

**Matching** (`last_loaded`; README § Last loaded, matching)
- For each location in `entry.locations` (the real path, each walked path, each installed copy), it looks up `times.paths.get(os.path.realpath(location.path))`. For kind `subagent` it also looks up `times.names.get(SUBAGENT_KEY_PREFIX + listing_name(env, entry, location))`, and for kind `command`, `times.names.get(COMMAND_KEY_PREFIX + listing_name(env, entry, location))`, at each location. It returns the latest time found by parsed datetime (`datetime.fromisoformat`), as its stored string. It returns `None` when it finds none. (lead)
- An item entry (a follow-up, `#L<line>`) uses its `path` like any entry, so it takes its file's time. (lead; README: an item takes its file's time)
- No kind is special-cased beyond `subagent` and `command`. A `hook` entry's path is its settings file and a `plugin` entry's path is its install folder; whatever time matches them is their time. (lead)
- A skill matches by path only: its load rows name `<dir>/SKILL.md`. A skill invoked by slash command also writes a `<command-name>` row, which reads `command:<name>` and matches no skill. (Decided: the base-directory row of the same invocation already gives the skill its time)

**Schema and model** (`model.py`; README § The index file)
- `SCHEMA_VERSION = 3` (`model.py:12`) becomes `4`. (lead)
- `Entry` (frozen, `model.py:58`) gains `last_loaded: str | None = None` as its last field, after `installed`. `to_json` (`model.py:104`) emits `"lastLoaded": self.last_loaded` after `"walked"`, as the README example orders it. (lead)
- Update the `Entry` docstring: `last_loaded` is the latest transcript time that loaded the entry, or `None`. (Decided)

**Session transcript** (`session.py`)
- `SessionTranscript` (`session.py:74`) gains `transcript: Path`, the transcript file `_transcript_path` found, after `config_dir`. `read_session` (`session.py:88`) sets it from the `transcript` it already holds at `session.py:93`. Update the class docstring. `_transcript_path` still runs once per `session` command. (lead)

**Commands** (`docs_index.py`)
- `_with_last_loaded` returns each entry as `replace(entry, last_loaded=last_loaded(env, entry, times))`, in order. `replace` is imported already (`docs_index.py:19`). (Decided: one helper for three commands)
- `_build` (`docs_index.py:78`): after `discover`, `times = machine_load_times(env)`; the document takes `_with_last_loaded(env, discovery.entries, times)`. The contexts are built from `discovery` as now. (lead)
- `_context` (`docs_index.py:90`): the same, after `discover_folder`. (lead)
- `_session` (`docs_index.py:102`): `times = session_load_times(session.transcript)`; the document takes `_with_last_loaded(env, [*discovery.entries, *new_entries], times)`. So the entries `_loaded_file_entry` makes for loaded files the scan did not find get their time too. `env` here is the one `judged_by` the session's config folder. (lead)
- Update the module docstring of `docs_index.py`: `build` and `context` also read every transcript for load times and write the loads cache; `session` reads its own transcripts' times. Extend the `loads.py` module docstring: the machine scan with its cache, the session scan, and `last_loaded`. (Decided)
- `test_session_finds_and_reads_the_transcript_once` (`tests/test_docs_index.py:361`) asserts the transcript opens once. The `session` command now opens it twice: once in `read_session` for states, once in `session_load_times` for times. Rename it `test_session_finds_the_transcript_once_and_reads_it_for_states_and_times`. Keep `lookup.call_count == 1`. Change the open assertion to `[transcript, transcript]`. (Decided: plan.md's design gives the session scan its own reader; flagged to the lead)

GIVEN transcripts in two config folders, a subagent file, a workflow agent file and a `journal.jsonl` WHEN `machine_load_times` runs THEN every file but `journal.jsonl` gives its loads.
GIVEN a cache from an earlier run and one row appended WHEN `machine_load_times` runs THEN `read_loads` reads that transcript from its cached offset only.
GIVEN a transcript shorter than its cached offset WHEN `machine_load_times` runs THEN it is read from 0.
GIVEN an absent, non-JSON, `version` 2 or wrongly typed cache WHEN `machine_load_times` runs THEN every transcript is read from 0 and a `version` 1 cache is written.
GIVEN a session transcript, its subagent file, its `journal.jsonl` and another session WHEN `session_load_times` runs THEN only the first two give loads.
GIVEN a load through a symlink or of an installed copy WHEN `last_loaded` runs THEN the entry takes the latest of its locations' times.
GIVEN a subagent or command load by listing name WHEN `last_loaded` runs THEN the plugin-prefixed or plain listing name matches.
GIVEN a transcript row that loads a repo file WHEN `build` runs THEN that entry's `lastLoaded` is the row's `timestamp` and `loads.json` exists.
GIVEN two sessions that load one file at two times WHEN `session` runs for the first THEN `lastLoaded` is the first session's time, and no `loads.json` is written.

Tests: transcripts are written with `json.dumps(row, separators=(",", ":"))`, one row per line, each line ending `"\n"`, as in task 01. Every time asserted is an exact string the test wrote.

Tests (`tests/test_loads.py`, class `MachineLoadTimesTests`, a temp home with `Environment(home=..., now=..., claude_config_dirs=(<home>/.claude, <home>/.claude-personal))`):
- `test_reads_main_and_subagent_transcripts_and_skips_journal` — `Read` rows in `.claude/projects/-dev-a/s1.jsonl` (`a.md`), `.claude-personal/projects/-dev-b/s2/subagents/agent-x.jsonl` (`b.md`), `.claude-personal/projects/-dev-b/s2/subagents/workflows/wf_1/agent-y.jsonl` (`c.md`), `.claude-personal/projects/-dev-b/s2/subagents/workflows/wf_1/journal.jsonl` (`d.md`): `paths` equals `a.md`, `b.md`, `c.md` to their times exactly.
- `test_writes_the_cache_with_offsets_and_times` — after one run on `s1.jsonl` holding a `Read` of `a.md` and an `Agent` row: the parsed `loads.json` equals `{"version": 1, "transcripts": {str(s1): s1.stat().st_size}, "paths": {<a.md>: <time>}, "names": {"subagent:<type>": <time>}}`.
- `test_a_second_run_reads_only_appended_rows` — run once; record `size1`; append a `Read` row of `b.md`; run again with `read_loads` wrapped: it was called once, with `(s1, size1)`; the result holds `a.md` (from the cache) and `b.md`.
- `test_a_transcript_shorter_than_its_offset_is_read_from_the_start` — run once on two rows; overwrite `s1.jsonl` with one shorter `Read` row of `z.md`; run again with `read_loads` wrapped: called with `(s1, 0)`; `paths` holds `z.md`; the cache offset is the new size.
- `test_an_absent_or_corrupt_cache_is_rebuilt` — a `subTest` per cache: none; text `not json`; `{"version": 2, "transcripts": {str(s1): <size>}, "paths": {}, "names": {}}`; `{"version": 1, "transcripts": {str(s1): "12"}, "paths": {}, "names": {}}`. Each: `paths` holds the transcript's load, and `loads.json` is rewritten with `"version": 1`.
- `test_times_of_a_transcript_gone_from_disk_are_kept` — a valid cache `{"version": 1, "transcripts": {"<home>/.claude/projects/-dev-a/gone.jsonl": 10}, "paths": {"/x": "2026-10-01T00:00:00Z"}, "names": {}}` and no transcripts: the result's `paths == {"/x": "2026-10-01T00:00:00Z"}`; the written `transcripts == {}`.

Tests (`tests/test_loads.py`, class `SessionLoadTimesTests`):
- `test_reads_its_transcript_and_its_subagents_only` — `projects/-dev-a/s1.jsonl` (`a.md`), `projects/-dev-a/s1/subagents/agent-x.jsonl` (`b.md`), `projects/-dev-a/s1/subagents/workflows/wf_1/journal.jsonl` (`c.md`), `projects/-dev-a/s2.jsonl` (`d.md`): `session_load_times(s1).paths` equals `a.md` and `b.md` only; `env.home.joinpath(*LOADS_PATH_PARTS)` does not exist.

Tests (`tests/test_loads.py`, class `LastLoadedTests`; entries built by a local `_entry` helper in `test_loads.py`, shaped like `tests/test_claude_rules.py`'s `_entry` (`path, kind, source, root, plugin, meta, walked, installed`), since `tests/test_session.py`'s helper takes neither `walked` nor `installed`):
- `test_a_load_through_a_symlink_matches_the_real_path` — `dev/app/AGENTS.md` real; `.claude/CLAUDE.md` a symlink to it; `LoadTimes` from `read_loads` of a transcript with a `Read` of the symlink path at `T`; the entry at the real path with `walked=(Location(<symlink>, Owner("global")),)`: `last_loaded == T`.
- `test_an_installed_copy_gives_its_time_when_it_is_later` — clone skill `dev/m/plugins/p/skills/k/SKILL.md`, `plugin "p@m"`, installed `Installed(Location(<home>/.claude/plugins/cache/m/p/1.0.0/skills/k/SKILL.md, Owner("plugin", root=<install>, plugin="p@m")), "claude", "1.0.0")`; both files exist; `times.paths` holds the clone path at `2026-10-01T00:00:00Z` and the install path at `2026-10-02T00:00:00Z`: `last_loaded == "2026-10-02T00:00:00Z"`.
- `test_a_subagent_and_a_command_match_by_listing_name` — subagent `cache/wigley/agents/haiku.md`, `source "plugin"`, `plugin "wigley@m"`, `meta {"name": "haiku"}`; command `.claude/commands/sub/make.md`, `source "global"`; plugin command `cache/wigley/commands/ship.md`, `plugin "wigley@m"`; `names == {"subagent:wigley:haiku": T1, "command:make": T2, "command:wigley:ship": T3}`: each entry's `last_loaded` is its time; a subagent with `meta {"name": "haiku"}` and no plugin gives `None`.
- `test_an_entry_with_no_load_is_none` — an empty `LoadTimes()`: `None`.
- `test_an_item_takes_its_files_time` — a `followup` entry with `id` `<f.md>#L10`, `path` `<f.md>`, `line 10`; `paths == {<f.md>: T}`: `T`.

Tests (`tests/test_model.py`):
- `test_document_sorts_entries_by_id_and_carries_the_schema_version` (`tests/test_model.py:19`) asserts `4`.
- `test_to_json_emits_owner_after_source_defaulting_to_mine` (`tests/test_model.py:46`) expects the key list to end `"walked", "lastLoaded"`.
- `test_to_json_emits_last_loaded_defaulting_to_null` — `_entry("/r/a.md").to_json()["lastLoaded"] is None`; `_entry("/r/a.md", last_loaded="2026-10-26T21:01:32.174Z").to_json()["lastLoaded"] == "2026-10-26T21:01:32.174Z"`.

Tests (`tests/test_session.py`):
- `test_read_session_names_its_transcript` — `read_session(...).transcript == self.home / ".claude" / "projects" / "-dev-app" / f"{SESSION_ID}.jsonl"`.

Tests (`tests/test_docs_index.py`):
- `test_build_writes_index_with_repo_context` (`tests/test_docs_index.py:70`) asserts `schemaVersion` `4`.
- `test_build_writes_last_loaded_and_the_loads_cache` — repo `a` with `AGENTS.md`; `.claude/projects/-dev-a/s1.jsonl` with a `Read` of `<repo>/AGENTS.md` at `2026-10-26T21:01:32.174Z`: after `build`, the index entry's `lastLoaded == "2026-10-26T21:01:32.174Z"`; the test also writes `<repo>/CLAUDE.md`, which no row loads, and its entry's `lastLoaded` is `None`; `loads.json` parses with `"version": 1`.
- `test_context_prints_last_loaded_and_writes_the_loads_cache` — the same transcript; `context <repo>`: the printed entry's `lastLoaded` is that time; `loads.json` exists.
- `test_session_uses_only_its_own_transcripts_times` — `s1.jsonl` (`cwd` the repo, a `Read` of `AGENTS.md` at `2026-10-01T00:00:00Z`, and an `instructions` attachment at `2026-10-01T00:00:01Z` naming `<home>/notes/extra.md`, a file the scan does not find) and `s2.jsonl` (a `Read` of `AGENTS.md` at `2026-10-05T00:00:00Z`): `session s1` prints `AGENTS.md` with `lastLoaded "2026-10-01T00:00:00Z"`, the new `extra.md` entry with `lastLoaded "2026-10-01T00:00:01Z"`; `loads.json` does not exist.
- Rename and change `test_session_finds_and_reads_the_transcript_once` as the Decisions say.

Done when: `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)` passes; the tests above exist; `git status --short -- plugins/wigley/scripts/docs-index` lists only the eight files above.
Commit:    one commit for the group, in wigley-ai-marketplace, committed by path only (peer sessions may hold uncommitted edits)

## Proof
