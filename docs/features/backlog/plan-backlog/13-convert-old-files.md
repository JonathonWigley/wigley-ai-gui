# 13 — Convert old follow-up files

Status: done
Type: Batch
Wave: 7 · Depends on: 05, 11
Plan: [plan.md](plan.md)

Added in the run by the user's ask ("convert the old files for me as part of this work"). It reverses design.md's
"each file keeps its shape" line for the files below.

Files:     modify `wigley-ai-gui/docs/features/followups.md` · modify
           `wigley-harness/docs/features/followups/agent-loop.md` · modify
           `wigley-harness/docs/features/followups/transport.md` · modify
           `wigley-harness/docs/features/followups/content-parts.md` · modify `wigley-ai-gui/docs/features/backlog/design.md`
           (the § Scope line on old files)
Consumes:  the shape rule both parsers share (`src/shared/followups/followup-file.ts`, `docs_index.py`): a file is
           sectioned when it holds a `**Contents**` line or any `###` heading; sectioned means one item per `##`
           heading; otherwise one item per top-level `- ` or `N. ` item at column 0, its blank and indented lines its
           continuation, and `##` headings between items are allowed (harness `tui.md` works this way)
Produces:  each file reads as one item per follow-up it holds
Decisions: the target shape per file is the list shape, since each file's items are already list items · every item's
           text, tags and order stay as written · group headings stay as `##` headings, so the grouping survives

## Per file (measured at plan time, re-verify)

- gui `followups.md`: a list at the top, then `## Extensibility review (2026-10-20)` with eight `###` groups. The
  `###` headings make it sectioned, so it reads as one item. Turn each `### <group>` into `## Extensibility review:
  <group>`, and keep the intro prose under the first `##`. Expected after: one item per top-level list item.
- harness `agent-loop.md`: a `**Contents**` list of its sections (Status, Gaps, Design issues) makes it sectioned, so
  its nine numbered items read as two. Remove the Contents block, as its sibling area files have none.
- harness `transport.md`: the same, three numbered items read as one. Remove the Contents block.
- harness `content-parts.md`: one deferred item written as prose under the title, read as zero items. Turn it into one
  list item, `- **Content parts: images, documents, mixed content** — *agent-ready*: <one line>`, with the prose as its
  indented continuation. The Plan paragraph settles the design, so it meets the `agent-ready` rule (triage.md § The
  project's follow-ups).

Tests:     none; the check is the index count below.
Done when: `docs_index.py build` from the marketplace clone, then a count of `followup` entries per path, shows each
           file's item count; every gui item that held `*agent-ready*` before still holds it in `meta.tags`.
Commit:    one commit per repo

## Proof

Commit gui 431b668, harness 606440e · proof: diff read; docs_index.py build then per-path count: gui followups.md 1→109 items with 69 agent-ready, agent-loop 2→9, transport 1→3, content-parts 0→1; src/shared/followups tests pass · concerns: content-parts one line written by the worker and tagged agent-ready on its settled Plan; oxfmt skips docs/features (ignore rules)
