# 10 — Retro reads primer files in the saved-round format

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

Repo: `~/Documents/ai-dev/wigley-ai-marketplace`. Every path below is under `plugins/wigley/scripts/retro/`.

Files:     modify `answers.py`, `owners.py`, `digest.py` · test `tests/test_answers.py`, `tests/test_owners.py`,
           `tests/test_digest.py`, `tests/test_record_fields.py` · delete `tests/test_retention.py`
Consumes:  the saved-primer format in `scripts/forms/README.md` § The feature primer and § Saved rounds (docs commit
           `804cf0e`) · `PrimerBody`, `PrimerFeature`, `PrimerEntry`, `PrimerItem` ← 05 (`src/plugins/primer/contract.ts`,
           the shape of `body`) · `answers.primer_lines(record: dict) -> list`, `owners._record_key(kind: str, record:
           dict) -> str`, `digest._unplaced_section(unasked: list) -> list` (all in the tree today)
Produces:  `answers.primer_lines(record: dict) -> list` in `answers.py` — same signature, reads `args` and `body`
           `owners._record_key(kind, record)` in `owners.py` — a primer's key is `args.feature.slug`
           `digest._unplaced_section(unasked)` in `digest.py` — a primer's heading is `args.feature.name`
           `PRIMER_KEYS` in `tests/test_record_fields.py` — the saved-round keys retro reads from a primer
Decisions: see below.

Read `plugins/wigley/skills/retro/criteria.md` § Evidence that counts first: the `[PRIMER…]` markers and what each
means do not change.

## The new primer file

A saved primer now has the saved-round keys: `id`, `fingerprint`, `args`, `body`, `outcome`, `returned`,
`session_id`, `project_dir`, `tool_use_id`, `created`, `updated`. The old keys `heading`, `sent`, `data` are gone.

- `args` — the `open_primer` arguments as sent: `feature` (`name`, `slug`, optional `spec`, `summary`; no `notes`) and
  `entries`. Each args entry has `id`, `task`, `need`, `items` and optional `group`, `number`, `area`, `question`,
  `evidence`, `probes`, `pointer`. Its `items` are **strings**, not objects. An args entry has no `comment`.
- `body` — `{feature, entries}` in the payload shape: `feature` has `name`, `slug`, `spec`, `summary`, `notes`; each
  entry has every field plus `group` (`primer`, `standing`, `extra`), `comment` and `items` as objects
  `{text, include, comment, added}`. `body` can be `null` or missing on a file the app could not save fully.

Old files (`sent`/`data`) are not read. They have no `args` and no `body`, so they give the header line only; that is
accepted (`plan.md` § Design Overview: old files are not migrated). The app prunes them after 90 days.

## Decisions

- **`primer_lines`.** The sent triage is `args`; the edited triage is `body`. Every rule of the lines stays: the header,
  each changed feature field, then each entry's changes in `body` entry order, entries matched by `id`, items matched
  by text within their entry. The changes:
  - The slug in the header is `body.feature.slug`, else `args.feature.slug`, else `unknown`.
  - Feature fields: compare each key of `body.feature` with the same key of `args.feature`, both through `_clip`. A key
    missing from `args.feature` (`notes`, an unsent `spec` or `summary`) compares as `""`, so an empty `notes` gives
    no line.
  - Sent items are the strings in the args entry's `items`. A sent item is included (`include` true) with no comment.
  - The app trims ids and item text before it saves `body`, so the sent-entry map keys on `id.strip()` and the sent-item
    set holds `item.strip()`.
    Skip a non-string sent item. Build the sent map as `text → True` (or any marker) from those strings; the
    `_item_lines` rule "cut when it was sent and is now `include: false`" then reads `sent is not None and
    item.include is False`.
  - An item whose text is not among the sent strings, or whose `added` is `true`, is an addition (unchanged rule).
  - An entry whose `id` is not in `args.entries` is a task the user added: `[PRIMER-TASK]` (unchanged rule).
  - `need` change: `body` entry `need` against the args entry `need` (unchanged rule).
- **`owners._record_key`.** The primer key path becomes `("args", "feature", "slug")`. The round path stays
  `("args", "heading")`.
- **`digest._unplaced_section`.** A primer's `### ` heading becomes `_nested_text(record, "args", "feature", "name")`,
  falling back to `untitled` as today. This is the heading the app's primer type reads from saved args (task 05,
  `AgentFormType.savedHeading`) and the one `wait_guard.py` names (task 11).
- **`digest.py` `--primers` help** becomes `"the wigley-ai-gui app's saved primers folder"`. `answers.PRIMERS_DIR`
  stays `~/.agents/wigley-primer/primers`.
- **Docstrings** that name the `wigley-primer` server or `scripts/primer/README.md` now name the wigley-ai-gui app and
  `scripts/forms/README.md` § The feature primer: `answers.py` (lines 3–6 at plan time), `owners.py` (lines 4–7 and
  12: "the forms and primer servers" and "the server" become "the wigley-ai-gui app"), `digest.py` (lines 11–17, and
  the `--primers` help at line 417). Keep each sentence's meaning otherwise. "Imports nothing from forms or primer"
  stays true and stays.
- **`tests/test_retention.py` is deleted.** Its only subject is `scripts/primer/store.py`'s `RETENTION_SECONDS`, which
  task 09 deletes. The app now prunes primers and rounds alike at 90 days (`RETENTION_SECONDS` in
  `src/shared/agent-forms/form-store.ts`, task 02), and the app's tests pin it, as the file's docstring already says
  for rounds.
- **`tests/test_record_fields.py` keeps its guard against a silent rename, read from the contract instead of a store.**
  The store it read is gone; the saved-round format's contract is `scripts/forms/README.md` § Saved rounds ("The file
  is the contract with retro's readers"). Pinned:
  - `PRIMER_KEYS = frozenset({"outcome", "args", "body", "session_id", "tool_use_id", "created"})` — every top-level
    key a retro reader looks up on a saved primer (`primer_lines`: `outcome`, `args`, `body`; `owners`: `session_id`,
    `tool_use_id`, `created`, `args`; `digest._unplaced_section`: `args`). A key a reader starts to use is added here.
  - Replace `record_fields(source, class_name)` with `saved_round_fields(readme: Path) -> set`: the names in single
    backticks in the paragraph of `README.md` that starts with "The file is the contract with retro's readers",
    up to the next blank line. Use `re.findall(r"`([a-z_]+)`", paragraph)`.
  - `test_every_key_retro_reads_from_a_primer_is_a_saved_round_field` — `PRIMER_KEYS - saved_round_fields(SCRIPTS /
    "forms" / "README.md")` is empty, with a message naming the missing keys.
  - `test_the_fields_are_read_from_the_contract_paragraph` — a temp README with a paragraph before, the contract
    paragraph holding `` `id` `` and `` `body` ``, and a later paragraph holding `` `other` ``; the result is
    `{"id", "body"}`.
  - Rewrite the module docstring: retro reads the saved primer and round files as plain JSON by top-level key; the
    app writes them and its tests pin the names; this test checks the keys retro reads against the contract paragraph
    in `scripts/forms/README.md`, read as text.

## Behaviour

GIVEN a submitted primer whose `args` entry `1` sends items `"Add a popup"` and `"Show a toast"` and whose `body` entry
`1` has `"Add a popup"` with `include: false` and comment `"the dialog exists"` WHEN `primer_lines` runs THEN it gives
`[PRIMER-CUT] UI screens | Add a popup | the dialog exists` and no line for `"Show a toast"`.

GIVEN a primer record with `args.feature.slug` `no-ads` and no `tool_use_id` WHEN `owners.assign` runs with an
`open_primer` call keyed `no-ads` inside the window THEN that call owns it.

GIVEN a submitted primer no call asked WHEN the digest is built THEN it ends with `## Unplaced answers`, then
`### No Ads` (its `args.feature.name`), then its lines.

## Tests

Fixture builders change to the new format; every assertion on lines stays as it is today unless named here.

- `tests/test_answers.py`:
  - `saved_primer(sent_entries, data_entries, outcome="submitted", **feature_edits)` builds `{"id", "fingerprint",
    "outcome", "returned", "session_id", "project_dir", "tool_use_id", "created", "updated", "args": {"feature":
    sent_feature, "entries": sent_entries}, "body": {"feature": {**sent_feature, "notes": "", **feature_edits},
    "entries": data_entries}}`, with `sent_feature = {"name": "No Ads", "slug": "no-ads", "spec": "", "summary": "One
    SKU"}`.
  - Add `sent_entry(entry_id, task, need="yes", items=(), group="primer")` for an args entry: no `comment`, `items` a
    list of strings. Each `PrimerLinesTests` test passes `sent_entry(...)` lists as the first argument and the
    existing `entry(...)`/`item(...)` objects as the second. The expected lines of every existing test stay the same.
  - New `test_a_padded_sent_item_matches_its_trimmed_body_item` — args entry id `" 1"`, item `"Add a popup "`; body
    entry id `"1"`, item `"Add a popup"` included: no `[PRIMER-ADD]`, `[PRIMER-CUT]` or `[PRIMER-TASK]` line.
  - New `test_a_body_less_finished_primer_gives_its_header_from_the_sent_slug` — `body` `None`, outcome
    `submitted`; the lines are `["[PRIMER] no-ads · submitted"]`.
- `tests/test_owners.py`: `primer_record` holds `"args": {"feature": {"slug": slug}}` in place of `"sent"`. The
  existing `test_a_primer_matches_open_primer_calls_by_slug_and_never_a_round_call` then covers the new key path.
- `tests/test_digest.py`:
  - `OPEN = "mcp__plugin_wigley_wigley-forms__open_primer"` (the tool now lives on the `wigley-forms` server).
  - `saved_primer(slug, session_id="s1")` builds the new format: `args` `{"feature": {"name": "No Ads", "slug": slug},
    "entries": [{"id": "1", "group": "primer", "task": "UI screens", "need": "yes", "items": ["Add a popup"]}]}`,
    `body` with the same feature plus `notes: ""` and the entry with `comment: ""` and `items: [{"text": "Add a popup",
    "include": False, "comment": "", "added": False}]`, plus `fingerprint`, `returned`, `tool_use_id: None`.
  - New `test_an_unasked_primer_lists_under_its_feature_name` — a session with no `open_primer` call, one
    `saved_primer("no-ads")`; the digest ends with `"\n## Unplaced answers\n\n### No Ads\n\n- [PRIMER] no-ads ·
    submitted\n- [PRIMER-CUT] UI screens | Add a popup\n"`. Match the exact spacing the existing round test at
    `test_digest.py` line 360 (plan time) asserts.
- `tests/test_record_fields.py`: the two tests above.
- `tests/test_retention.py`: deleted.

Done when: `(cd plugins/wigley/scripts/retro && python3 -m unittest discover)` passes with task 09's deletion in the
tree or without it; `git grep -n '"sent"\|"data"\|primer/store' plugins/wigley/scripts/retro` prints nothing; `python3 scripts/check_pointers.py` passes from the repo root.
Commit:    one commit for the group in wigley-ai-marketplace, for example "Retro reads saved primers in the
           saved-round format the wigley-ai-gui app writes"

## Proof

Commit e623def (marketplace) · proof: diff read: primer_lines on args/body, owners key args.feature.slug, digest heading args.feature.name, PRIMER_KEYS and saved_round_fields present as planned; retro suite 166 OK; check_pointers passes · concerns: saved_round_fields returns every backticked name in the contract paragraph (tool and outcome names too), so its name promises slightly more; answers.py module docstring has one line past the wrap width
