# 03 — Index reads follow-up tags

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo:      `~/Documents/ai-dev/wigley-ai-marketplace`, folder `plugins/wigley/scripts/docs-index/`
Files:     modify `markdown.py` · modify `discover.py` · test `tests/test_markdown.py` · test `tests/test_discover.py`
Consumes:  none
Produces:  `FollowupItem.tags: list[str]` in `markdown.py` (field after `section`)
           `meta["tags"]` on every `followup` entry in `discover.py` (`add_repo_followup` writes `[]`)
Decisions: the README (committed in `9b8dbe1`) is the spec: § What is indexed, the follow-up bullets, and the `meta`
           table · no `schemaVersion` bump: `meta` is a per-kind record and wigley-ai-gui reads `meta` as
           `Record<string, unknown>` (`src/plugins/docs/contract.ts`)

## What changes

- A tag span is an italic span, `*…*` or `_…_`, that opens the text after the title and ends in a colon. Its words,
  split on commas and stripped, are the tags in written order. The span and its colon are left out of `gist`.
- List items (`_list_item`): read the span from `rest`, before `gist` is taken.
- Section items (`_section_items`): read `tags` from the Contents line whose bold title equals the heading title,
  struck-through or not, with backticks removed from both titles for the match only. `gist` keeps its current source
  (the first body line).
- List items: title, tags and gist come from the item's first line only; continuation lines no longer join in. A
  first line with no bold lead takes its first sentence (up to the first `. `, else the whole line) as title, a
  trailing `.` dropped. This makes the index read exactly as wigley-ai-gui's follow-up module (task 01) reads.
- `done`: the `shipped` test runs on the text after the tags.

GIVEN a list file line `- **Fruit Blast coins** — *needs a feature plan*: replace the sink` WHEN indexed THEN `tags` is
`["needs a feature plan"]` and `gist` is `replace the sink`.
GIVEN a sectioned file whose Contents line is `- **Pluggable queue** — *agent-ready, needs review*: a queue` WHEN
indexed THEN the `## Pluggable queue` item has `tags` `["agent-ready", "needs review"]`.
GIVEN an item with no span WHEN indexed THEN `tags` is `[]` and `gist` is unchanged from today.

GIVEN `- Command palette.` followed by an indented line `  More text. Here.` WHEN indexed THEN the title is
`Command palette` and the gist is empty.

Tests:     `test_markdown.py` — the four GIVENs above, `_…_` spans, a `shipped` item behind a tag span reads `done`, a
           Contents line and heading both holding backticks match. Update any existing test whose expected title or
           gist came from joined continuation lines, naming each in the report.
           `test_discover.py` — a follow-up entry's `meta` holds `tags`; a repo `docs/followups/<topic>.md` entry
           holds `tags: []`. Each test writes its own files.
Done when: `(cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)` passes.
Commit:    one commit for the group, in wigley-ai-marketplace, no version bump (task 07 bumps)

## Proof
