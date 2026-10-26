# 11 — Wait guard covers primers

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

Repo: `~/Documents/ai-dev/wigley-ai-marketplace`. Every path below is under `plugins/wigley/`.

Files:     modify `scripts/forms/wait_guard.py`, `hooks/hooks.json` · test `scripts/forms/tests/test_wait_guard.py`
Consumes:  `wait_guard.decide(hook_input: dict, rounds_dir: Path) -> dict | None`, `wait_guard.main(stdin, stdout,
           rounds_dir)`, `ROUNDS_DIR`, `FORMS_CALL_SUFFIXES`, `STAND_DOWN_OUTCOMES`, `OPEN_REASON`,
           `SUBMITTED_REASON`, `_Transcript` (all in the tree today) · the primer file format and Stop-hook rule in
           `scripts/forms/README.md` § The feature primer (docs commit `804cf0e`)
Produces:  in `scripts/forms/wait_guard.py`:
           `PRIMERS_DIR = Path.home() / ".agents" / "wigley-primer" / "primers"`
           `PRIMER_CALL_SUFFIXES = ("__open_primer", "__collect_last_primer")`
           `PRIMER_STAND_DOWN_OUTCOMES = ("needs_manual_open", "no_primer")`
           `OPEN_PRIMER_REASON: str`, `SUBMITTED_PRIMER_REASON: str` (pinned below)
           `def decide(hook_input: dict, rounds_dir: Path, primers_dir: Path) -> dict | None`
           `def main(stdin: TextIO = sys.stdin, stdout: TextIO = sys.stdout, rounds_dir: Path = ROUNDS_DIR,
                     primers_dir: Path = PRIMERS_DIR) -> int`
Decisions: see below.

## Decisions

- **One rule, two kinds.** A primer is waited on exactly as a round is (README § Outcomes, § The feature primer): this
  session's newest primer blocks while it is `open` and not stood down, or `submitted` and not `returned`. Session
  matching (`session_id`, or `tool_use_id` of a `tool_use` call in the transcript), the newest-by-`created` choice,
  the `created` fallback to 0 and the stand-down rule are the round's, unchanged. Rounds and primers never mix: the
  newest round is chosen among rounds, the newest primer among primers.
- **Per-kind settings.** Hold each kind's settings in one private table, for example a `NamedTuple`
  `_Kind(call_suffixes, stand_down_outcomes, heading, open_reason, submitted_reason)` with a round entry and a primer
  entry. `heading` reads the file's `args`:
  - round: `args.heading` (today's rule)
  - primer: `args.feature.name`. This is the heading the app's primer type reads from saved args (task 05,
    `AgentFormType.savedHeading`) and the one retro's digest uses (task 10).
  - Either falls back to `UNTITLED` (`"untitled"`) when the value is missing, empty or not a string.
- **The stand-down is per kind.** The newest call *of the same kind* at or after the file's own call decides:
  a round stands down on a `needs_manual_open` or `no_round` reply to the newest `ask_round`/`collect_last_round`
  call; a primer stands down on a `needs_manual_open` or `no_primer` reply to the newest
  `open_primer`/`collect_last_primer` call. A primer call never stands a round down, and a round call never stands a
  primer down. `_Transcript` keeps the call ids per kind and the outcome of each `tool_result` by `tool_use_id`
  (in place of the one `stand_down_reply_ids` set), so each kind checks its own outcomes. The tool-name match stays a
  suffix match (`str.endswith`), so both hosts' prefixes match.
- **Both kinds waiting at once.** A session may hold an open round and an open primer together. When both block, the
  round's decision wins; the primer blocks on the next Stop after the round no longer does. One decision per Stop
  keeps the hook's output one block with one tool to call.
- **The transcript stays unread** unless some round or some primer file awaits the agent (`open`, or `submitted` and
  not `returned`).
- **`decide` takes `primers_dir` as a required third argument.** A default would make every test read the real
  `~/.agents/wigley-primer/primers/`. `main` defaults both folders.
- **Pinned texts.** The round texts do not change. The primer texts are the round texts with the subject read as "The
  feature primer", `collect_last_round` as `collect_last_primer`, `no_round` as `no_primer`, `ask_round` as
  `open_primer`, and "answers" as "edits":

  ```python
  OPEN_PRIMER_REASON = ("The feature primer \"{heading}\" is still open: the user has not submitted it. Call the "
                        "wigley-forms server's collect_last_primer tool now and keep waiting on it. Send no message "
                        "saying the wait goes on: the user submits or cancels in the form. If collect_last_primer "
                        "returns no_primer, send the same primer again with open_primer.")
  SUBMITTED_PRIMER_REASON = ("The feature primer \"{heading}\" was submitted and its edits have not been returned "
                             "yet. Call the wigley-forms server's collect_last_primer tool now to read them.")
  ```

- **The module docstring** says the hook waits on the session's open round or primer, names both folders, both tool
  pairs and both stand-down outcome pairs, and keeps every other sentence.
- **`hooks/hooks.json`.** The top-level `description` becomes
  `"Keeps a session waiting on its open wigley-forms round or feature primer"`. The command and timeout stay.

## Behaviour

GIVEN this session's primer file `open` with `args.feature.name` `"No Ads"` and no round file WHEN `decide` runs THEN it
returns `{"decision": "block", "reason": OPEN_PRIMER_REASON.format(heading="No Ads")}`.

GIVEN this session's primer `submitted` and not `returned` WHEN `decide` runs THEN it blocks with
`SUBMITTED_PRIMER_REASON`.

GIVEN an open primer whose call is followed by an `open_primer` call answered `needs_manual_open` (or a
`collect_last_primer` call answered `no_primer`) WHEN `decide` runs THEN it returns `None`.

GIVEN an open primer and, after its call, an `ask_round` call answered `needs_manual_open` WHEN `decide` runs THEN the
primer still blocks.

GIVEN an open round and an open primer of this session WHEN `decide` runs THEN the round's block is returned.

## Tests

In `scripts/forms/tests/test_wait_guard.py`. `setUp` also makes `self.primers_dir = self.dir / "primers"`;
`self.decide()` and every direct `decide`/`main` call pass both folders. Add `write_primer(primer_id, outcome,
created, returned=False, session_id=SESSION, tool_use_id="toolu_p", name=FEATURE_NAME)` writing
`{"id", "outcome", "returned", "session_id", "tool_use_id", "created", "args": {"feature": {"name": name, "slug":
"no-ads"}, "entries": []}}` into `self.primers_dir`, with `FEATURE_NAME = "No Ads"`. Add `open_primer_block(heading)`
and `submitted_primer_block(heading)` with the pinned texts written out in full, and `OPEN_PRIMER =
"mcp__plugin_wigley_wigley-forms__open_primer"`, `COLLECT_LAST_PRIMER =
"mcp__plugin_wigley_wigley-forms__collect_last_primer"`, `no_primer_result_entry(tool_use_id)` giving
`{"outcome":"no_primer"}`. Every existing round test keeps its assertion.

- `test_open_primer_of_this_session_blocks_naming_the_feature`
- `test_submitted_unreturned_primer_blocks`
- `test_submitted_returned_primer_does_not_block`
- `test_primer_with_no_feature_name_is_untitled` — `args` `{"feature": {"slug": "no-ads"}}`; the reason names
  `untitled`.
- `test_open_primer_stands_down_after_open_primer_returns_needs_manual_open`
- `test_open_primer_stands_down_after_collect_last_primer_returns_no_primer`
- `test_later_collect_last_primer_after_no_primer_rearms_the_wait` — a `collect_last_primer` call with no reply yet
  after the `no_primer` reply; the primer blocks.
- `test_a_round_calls_needs_manual_open_does_not_stand_a_primer_down` — open primer, its `open_primer` call, then an
  `ask_round` call answered `needs_manual_open`; the primer blocks.
- `test_a_primer_calls_no_primer_does_not_stand_a_round_down` — open round, its `ask_round` call, then a
  `collect_last_primer` call answered `no_primer`; the round blocks.
- `test_an_open_round_wins_over_an_open_primer` — both open for this session; the round's block.
- `test_a_primer_blocks_once_the_round_is_returned` — the round `submitted` and `returned`, the primer open; the
  primer's block.
- `test_transcript_is_not_read_when_no_round_or_primer_awaits_the_agent` — extend the existing test with a
  `cancelled` primer file; `_read_transcript` is not called.
- `test_main_reads_the_primers_folder` — `main` with a primer-only fixture prints one line, the primer's open block.

Done when: `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` passes; `python3 -m json.tool
plugins/wigley/hooks/hooks.json` parses; `claude plugin validate .` passes from the repo root.
Commit:    one commit for the group in wigley-ai-marketplace, for example "Stop hook waits on an open or unreturned
           feature primer as it does on a round"

## Proof
