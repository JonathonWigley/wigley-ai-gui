# 01 — Retro scripts: lock, runs, drafts, short sessions

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: the marketplace worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-auto-retro`.
Every path below is relative to it. The scripts must do what `plugins/wigley/skills/retro/SKILL.md` steps 1, 2, 7,
8, 9 and 10 and `criteria.md` § Candidate file say (docs written ahead, commit `e7fdbfd`).

Files:     modify `plugins/wigley/scripts/retro/ledger.py` · modify `plugins/wigley/scripts/retro/digest.py` ·
           test `plugins/wigley/scripts/retro/tests/test_ledger.py` · test `plugins/wigley/scripts/retro/tests/test_digest.py`

Consumes:  none

Produces:  in `plugins/wigley/scripts/retro/ledger.py`:
           ```
           ledger.py lock acquire --owner <id> [--lock-file <path>]   exit 0 taken (or already this owner's); 1 and prints
                                                                      `held by <owner> since <iso time>`; a lock older than
                                                                      3 hours is taken over and prints `took over <owner>`
           ledger.py lock release --owner <id> [--lock-file <path>]   exit 0; releasing another owner's lock exits 1
                                                                      default lock file: ~/.local/state/wigley-retro/ledger.lock
           ledger.py runs add --session <id> --analyzed <id>... --note "<line>"   appends to <root>/runs.md
           ledger.py runs                                                         prints each run line, oldest first
           ledger.py runs --clear                                                 empties runs.md to its header
           ledger.py draft <slug> --file <path> [--target <path>]   writes `## Draft` and frontmatter `draft_hash`
           ledger.py ripe                                           each item gains "draft": "missing" | "fresh" | "stale"
           ```
           in `plugins/wigley/scripts/retro/digest.py`:
           ```
           digest.py session <id>                                   prints `short` (exit 0, no digest) under MIN_PROMPTS
                                                                    with no answer line, as backfill counts short
           digest.py --projects                                     default $CLAUDE_CONFIG_DIR/projects, else ~/.claude/projects
           ```

## Decisions

### Lock (`ledger.py lock`)

- The lock file is separate from the ledger. `--root` and `$WIGLEY_LEDGER` do not move it. Only `--lock-file`
  moves it. The default is `Path.home() / ".local" / "state" / "wigley-retro" / "ledger.lock"`. Compute the default
  when `main` runs, not at import, so a test that patches `HOME` changes it. Create the parent folders on acquire.
- The lock file holds two lines, then a newline:
  ```
  owner: <id>
  since: <YYYY-MM-DDTHH:MM:SSZ>
  ```
  `since` is the UTC time of the acquire, to the second, with a literal `Z`. This is the `<iso time>` in every
  message.
- The takeover age is a named constant `LOCK_STALE_HOURS = 3`. A lock is stale when now minus `since` is more than 3
  hours. At exactly 3 hours it is not stale.
- A lock file whose `owner:` or `since:` line does not parse is held by owner `unknown`, since the file's mtime
  (formatted the same way). The takeover rule then applies to that time.
- `lock acquire`, by case:
  - no lock file: create it with `os.open` and `O_CREAT | O_EXCL`, so two runs that start at once cannot both
    take it. Print `acquired`. Exit 0. When `O_EXCL` fails because a peer created the file first, continue as for
    an existing file.
  - the file names this owner: rewrite it with the current time. Print `acquired`. Exit 0.
  - the file names another owner and is not stale: change nothing. Print `held by <owner> since <iso time>` to
    stderr. Exit 1.
  - the file names another owner and is stale: write a temp file beside it and `os.replace` it over the lock, with
    this owner and the current time. Print `took over <old owner>`. Exit 0.
- `lock release`, by case:
  - the file names this owner: delete it. Print `released`. Exit 0.
  - no lock file: print `not held`. Exit 0. (SKILL.md releases on an early stop too, and the lock may be gone.)
  - the file names another owner: change nothing. Print `held by <owner> since <iso time>` to stderr. Exit 1.
- `--owner` is required. An owner that is empty or holds whitespace is refused with exit 1 and nothing written, as
  `add` refuses a `--session`.

### Runs (`ledger.py runs`)

- `runs` has an optional positional action, `add`. `runs` with no action prints. `runs --clear` clears. `add`
  together with `--clear` is a usage error (argparse exit 2).
- `runs add` needs `--session` (one id), `--analyzed` (one or more ids, `nargs="+"`) and `--note`. It takes
  `--today` with default `date.today().isoformat()`, as `seen` does.
- `<root>/runs.md` header is `# Background runs\n\n`. `runs add` creates the root and the file with that header when
  the file is missing, then appends one line:
  ```
  - <YYYY-MM-DD> · <session id> · <analyzed id>, <analyzed id> · <note>
  ```
  The analyzed ids are joined with `", "` in the order given. The note's whitespace collapses to single spaces, as
  `add` writes a note. `runs add` prints `added`. Exit 0.
- `runs add` refuses, with exit 1, a message on stderr and nothing written:
  - a `--session` or an `--analyzed` id that is empty or holds whitespace
  - a `--note` that is empty after strip
  - a `--note` that `str.splitlines()` splits into more than one line
- `runs` prints every line of `runs.md` that starts with `- `, in file order, which is oldest first. A missing file
  or a file with only the header prints nothing. Exit 0.
- `runs --clear` writes `runs.md` as only the header, and creates it when missing. It prints `cleared <n>`, where
  `<n>` is the count of run lines it removed. Exit 0.
- `runs` does not check the lock. The run that calls it holds the lock (SKILL.md step 1).

### Draft (`ledger.py draft`)

- `draft` refuses, with exit 1, a message on stderr and the candidate file unchanged, in this order:
  - every case `keep` refuses: no `candidates/<slug>.md`, a held candidate, a malformed candidate. Move the body of
    `keep_refusal` into one shared helper that `keep` and `draft` both call; keep its messages as they are.
  - `--file` that is not a file: `no draft file <path>`
  - a draft file that is empty after strip: `draft file <path> is empty`
  - a draft line that would read as ledger structure: a line `is_occurrences_heading` matches, a line `_OCCURRENCE`
    matches, or a line whose strip is `## Draft`. The message quotes the line with `repr`.
  - `--target` that is not absolute after `expanduser`: `--target <path> is not an absolute path`
  - `--target` that is not a file: `no target file <path>`
  - a `## Draft` heading in the candidate that comes before its `## Occurrences` heading:
    `candidates/<slug>.md has ## Draft above ## Occurrences; move it below`
- The draft section is the first line whose strip is `## Draft`, through the end of the file. `draft` always
  writes it as the last section of the file. This keeps every check that reads `## Occurrences` correct: the
  occurrences section ends at the next `## ` heading, so draft lines are never inside it, and the refusals above
  keep any occurrence-shaped line out of the draft.
- Write order: remove the old draft section when there is one. Remove trailing blank lines. Append `""`,
  `## Draft`, `""`, the draft file's text with trailing whitespace removed, and end the file with one newline.
  Every line of the draft text stays as written.
- Frontmatter, written with `set_field`:
  - with `--target`: `draft_target: <the --target value as passed, stripped>` and `draft_hash: <sha256 hex of the
    target file's bytes>`, 64 lowercase hex characters. The path is stored as passed so `~/…` stays portable across
    machines; `ripe` expands `~` when it reads it.
  - without `--target`: `draft_target: none` and `draft_hash: none`.
- `draft` prints `drafted`. Exit 0.
- `ripe` adds a `"draft"` key to each item, after `"new_sessions"`:
  - `"missing"`: the file has no `## Draft` line, or only blank lines below it
  - `"fresh"`: `draft_hash` is `none`; or the expanded `draft_target` is a file whose sha256 equals `draft_hash`
  - `"stale"`: every other case — the target's bytes changed, the target is gone, or a `## Draft` section has no
    `draft_hash` or no `draft_target` field
- `draft` does not change `add`, `archive`, `index`, `keep`, `seen` or `reopen`. Each one works on a file with a
  `## Draft` section as it does on one without. An `add` after a draft inserts its line at the end of
  `## Occurrences`, above `## Draft`. An archived candidate keeps its draft.
- Update the module docstring's layout block: add `runs.md` (the background runs since the last manual report,
  written by `runs`) and a line that the lock file lives outside the root, at the default above.

### Digest (`digest.py`)

- Move the short rule into one function in `digest.py`, `is_short(prompts: int, answered: bool, min_prompts: int) ->
  bool`, true when `prompts < min_prompts and not answered`. `backfill` and `session` both call it. `session` passes
  `MIN_PROMPTS`; it gets no `--min-prompts` option.
- `session <id>` on a short session prints `short`, writes no file under `--out`, and exits 0. A session that is not
  short keeps today's output and file: `<path> (<n> prompts, <m> chars)`.
- `--projects` default: `Path(os.environ["CLAUDE_CONFIG_DIR"]).expanduser() / "projects"` when that variable is set
  and not empty, else `Path.home() / ".claude" / "projects"`. Compute it when `main` runs, not at import. Replace
  the `PROJECTS` constant with a function `default_projects() -> Path`. The `--projects` help names both defaults.
- Update the module docstring's `session <id>` sentence to say a short session prints `short` and gets no digest.

### Version

- Leave `version` unchanged in both plugin manifests. Task 05 makes the series' last marketplace commit, so it carries
  the one bump (marketplace `AGENTS.md` § Changing a plugin: a series bumps once, in its last commit that changes the
  plugin).

### Tests

- Update the opening docstring of `test_ledger.py` and of `test_digest.py` to name the new behaviours.
- Tests that write a lock file compute `since` from the real current time minus an offset, in the pinned format.
  Every lock test passes `--lock-file` into the temp folder, except the default-path test.

## Behaviour

GIVEN no lock file WHEN `lock acquire --owner a` runs THEN it exits 0, prints `acquired`, and the file holds
`owner: a`
GIVEN a lock `a` took 2 hours ago WHEN `lock acquire --owner b` runs THEN it exits 1, stderr is
`held by a since <that time>`, and the file is unchanged
GIVEN a lock `a` took 4 hours ago WHEN `lock acquire --owner b` runs THEN it exits 0, prints `took over a`, and the
file holds `owner: b`
GIVEN a lock `a` holds WHEN `lock release --owner b` runs THEN it exits 1 and the file stays
GIVEN two `runs add` calls WHEN `runs` runs THEN it prints both lines, the first call's first
GIVEN two runs WHEN `runs --clear` runs THEN it prints `cleared 2` and `runs.md` is `# Background runs\n\n`
GIVEN a ripe candidate and a target file WHEN `draft <slug> --file d --target t` runs THEN the file ends with
`## Draft` and the draft text, and `draft_hash` is the sha256 of `t`
GIVEN a drafted candidate WHEN its target changes and `ripe` runs THEN its `draft` is `stale`
GIVEN a drafted candidate WHEN `add` writes a new session THEN the line lands above `## Draft` and the candidate is
not malformed
GIVEN a session with 2 prompts and no answer line WHEN `digest.py session <id>` runs THEN it prints `short`, exits 0
and writes no digest
GIVEN `CLAUDE_CONFIG_DIR=<dir>` and no `--projects` WHEN `digest.py session <id>` runs THEN it finds the transcript
under `<dir>/projects`

## Tests

Add to `test_ledger.py`. Use the existing `write_candidate` and `run_main` helpers. Add `lock_file` as
`self.root.parent / "lock" / "ledger.lock"` or a second temp folder, outside `self.root`.

- `test_the_lock_admits_one_owner_until_it_releases` — one sequence, asserting `(code, stdout, stderr)` at each step:
  `acquire a` → `(0, "acquired\n", "")`; `acquire a` again → `(0, "acquired\n", "")`; `acquire b` → exit 1, stderr
  starts `held by a since `; `release b` → exit 1, lock file exists; `release a` → `(0, "released\n", "")`, lock file
  gone; `release a` → `(0, "not held\n", "")`; `acquire b` → `(0, "acquired\n", "")`. After the first acquire the
  lock file's first line is `owner: a` and its second matches `^since: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`.
- `test_a_lock_older_than_three_hours_is_taken_over` — table, each row writes the lock file, then runs
  `acquire b`:
  | lock file content | expected |
  |---|---|
  | `owner: a` / `since: <now − 4 h>` | `(0, "took over a\n", "")`; file first line `owner: b` |
  | `owner: a` / `since: <now − 2 h>` | exit 1; stderr `held by a since <now − 2 h>\n`; file unchanged |
  | `garbage`, mtime set to now − 4 h with `os.utime` | `(0, "took over unknown\n", "")` |
- `test_the_lock_file_defaults_outside_the_ledger` — patch `HOME` to a temp folder with `unittest.mock.patch.dict`;
  `acquire a` with no `--lock-file` → exit 0; `<HOME>/.local/state/wigley-retro/ledger.lock` exists; `self.root`
  holds no file.
- `test_runs_lists_each_run_oldest_first_until_cleared` — `runs add --session r1 --analyzed s1 s2 --note "first
  run" --today 2026-11-01` and `runs add --session r2 --analyzed s3 --note "second  run" --today 2026-11-02`, each
  → `(0, "added\n", "")`; `runs` stdout is exactly
  `"- 2026-11-01 · r1 · s1, s2 · first run\n- 2026-11-02 · r2 · s3 · second run\n"`; `runs --clear` →
  `(0, "cleared 2\n", "")`; `runs` stdout is `""`; `runs.md` text is `"# Background runs\n\n"`.
- `test_runs_add_refuses_a_spaced_id_an_empty_note_and_a_line_break` — table of `runs add` calls, each → exit 1 and
  `runs.md` does not exist: `--session "r 1"`; `--analyzed "s 1"`; `--note "   "`; `--note "one\ntwo"`.
- `test_draft_writes_the_section_after_occurrences_and_the_target_hash` — candidate `ripe-a`, kind `rule`, sessions
  s1 and s2; target file bytes `b"rule text\n"`; draft file text `"Add the line.\n\n"`. `draft ripe-a --file <d>
  --target <t>` → `(0, "drafted\n", "")`. The file text ends with
  `"- 2026-10-02 · s2 · evidence\n\n## Draft\n\nAdd the line.\n"`. Fields: `draft_hash` is
  `a89ed85763689bf99e5728fa9211c6ae4f5ec90e39846eafecf4bbe53ae04419`; `draft_target` is the target path as passed.
- `test_a_redraft_replaces_the_draft_section` — draft `"First.\n"` with target `t`, then write `t` as
  `b"rule text, edited\n"` and draft `"Second.\n"` with target `t`. The file holds `## Draft` once, holds no
  `First.`, ends with `"## Draft\n\nSecond.\n"`, and `draft_hash` is
  `be2e579664d5da9425f50d92ec623c7f0e3d6858f40690b1f292f84da5b6975b`.
- `test_ripe_reports_each_drafts_status` — table, one ripe candidate per row, `ripe`'s `"draft"` for that slug:
  | setup | `"draft"` |
  |---|---|
  | no draft | `missing` |
  | drafted with target `t`, `t` unchanged | `fresh` |
  | drafted with target `t`, then `t` rewritten | `stale` |
  | drafted with target `t`, then `t` deleted | `stale` |
  | drafted with no `--target` | `fresh` |
  | `\n## Draft\n\nHand text.\n` appended by hand, no `draft_hash` | `stale` |
  | `\n## Draft\n\n` appended by hand, nothing below | `missing` |
- `test_a_draft_section_leaves_add_archive_and_the_malformed_check_as_they_were` — draft candidate `ripe-a` (s1,
  s2) with no target; `add ripe-a --session s3` → `(0, "added\n", "")`; the lines from `## Occurrences` on are
  `["## Occurrences", "", "- 2026-10-01 · s1 · evidence", "- 2026-10-02 · s2 · evidence",
  "- 2026-10-08 · s3 · evidence", "", "## Draft", "", "Draft text."]`; `read_candidate`'s `rejected` is `[]` and
  `is_malformed` is false; `index` puts `| ripe-a |` in the open table; after `set_status(path, "promoted")`,
  `archive` returns `[("ripe-a", "promoted")]` and `archive/ripe-a.md` still ends with `"## Draft\n\nDraft text.\n"`.
- `test_draft_refuses_and_writes_nothing` — table, each row → exit 1 and the candidate file's bytes unchanged (no
  file for the first row):
  | case | stderr contains |
  |---|---|
  | slug with no candidate | `no open candidate` |
  | held candidate (status `promoted` in `candidates/`) | `only a watching candidate` |
  | malformed candidate (no occurrence line) | `malformed` |
  | `--file` path that does not exist | `no draft file` |
  | draft file `"  \n"` | `is empty` |
  | draft file holding a line `## Occurrences` | `'## Occurrences'` |
  | draft file holding a line `- 2026-10-01 · s9 · evidence` | `'- 2026-10-01 · s9 · evidence'` |
  | draft file holding a line `## Draft` | `'## Draft'` |
  | `--target relative.md` | `not an absolute path` |
  | `--target` absolute path that does not exist | `no target file` |
  | candidate with `## Draft` written above `## Occurrences` | `above ## Occurrences` |

Add to `test_digest.py`. Every `main` call passes `--rounds` and `--primers` at empty temp folders, so no test reads
the real app folders.

- `test_session_prints_short_for_a_short_session_unless_it_answered` — table through `digest.main([... "session",
  <id>, "--out", <out>])`, each row exit 0:
  | session | stdout | digest file `<out>/<id>.md` |
  |---|---|---|
  | `quiet`: `[human("a"), human("b")]` | `"short\n"` | absent |
  | `answered`: `[human("a"), tool_use("r1", ASK, {"heading": "Naming"}), human("b")]` with `saved_round("Naming", session_id="answered")` in the rounds folder | starts with `str(<out>/answered.md)` | present, holds `ANSWER_LINE` |
  | `long`: `SESSION` (3 prompts) | starts with `str(<out>/long.md)` | present |
- `test_projects_defaults_to_the_config_dirs_folder_then_home` — table, `main` with no `--projects`, a transcript
  `s1` written with `write_session`, `os.environ` patched with `unittest.mock.patch.dict`:
  | environment | transcript under | exit |
  |---|---|---|
  | `CLAUDE_CONFIG_DIR=<base>/cfg`, `HOME=<base>/home` | `<base>/cfg/projects/p` | 0 |
  | `CLAUDE_CONFIG_DIR` removed, `HOME=<base>/home` | `<base>/home/.claude/projects/p` | 0 |
  | `CLAUDE_CONFIG_DIR=""`, `HOME=<base>/home` | `<base>/home/.claude/projects/p` | 0 |
  | `CLAUDE_CONFIG_DIR=<base>/cfg`, transcript only under home | `<base>/home/.claude/projects/p` | 1 |

The existing `test_backfill_skips_seen_short_and_subagent_sessions` and
`test_backfill_digests_a_short_session_that_answered_a_round_and_skips_one_that_did_not` keep passing unchanged:
they prove `backfill` still calls the shared short rule.

## Done when

Every command below passes from the marketplace worktree root (marketplace `AGENTS.md` § Done, the commands this
change reaches):

```
python3 scripts/check_manifests.py
python3 scripts/check_pointers.py
(cd plugins/wigley/scripts/retro && python3 -m unittest discover)
claude plugin validate .
```

`python3 plugins/wigley/scripts/retro/ledger.py --help` lists `lock`, `runs` and `draft`, each with a help line.

## Commit

One commit in the marketplace worktree on branch `auto-retro`, holding only the four files above. The message says
what the scripts now do: the ledger lock, the background-run records, stored promotion drafts and their staleness,
`short` from `digest.py session`, and the `$CLAUDE_CONFIG_DIR` default. No push.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
