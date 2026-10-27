# 01 — Follow-up file module

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/shared/followups/followup-file.ts` · test `src/shared/followups/followup-file.test.ts` ·
           modify `scripts/check-layers.mts` (a `src/shared/followups` entry that may import nothing, and its place in
           the lists that may import it: `src/shared` users in main and page, every plugin's `main/` and `page/`,
           and the `src/plugins/docs` layer, which holds `kinds.ts`)
Consumes:  none
Produces:  in `src/shared/followups/followup-file.ts`:
           `export interface FollowupItem { title: string; oneLine: string; tags: string[]; body: string; line: number; endLine: number; done: boolean }`
           `export type FollowupShape = 'sections' | 'list'`
           `export interface FollowupFile { shape: FollowupShape; items: FollowupItem[] }`
           `export interface FollowupDraft { title: string; oneLine: string; tags: string[]; body: string }`
           `export type FollowupEdit = { type: 'create'; draft: FollowupDraft } | { type: 'edit'; title: string; draft: FollowupDraft } | { type: 'setTags'; title: string; tags: string[] } | { type: 'delete'; title: string }`
           `export type FollowupEditResult = { type: 'applied'; text: string; line: number } | { type: 'missing'; title: string } | { type: 'titleTaken'; title: string }`
           `export function parseFollowups(text: string): FollowupFile`
           `export function applyFollowupEdit(text: string, edit: FollowupEdit): FollowupEditResult`
           `export function newFollowupsFile(repo: string): string`
Decisions: the one writer of the follow-up shape in the app (design.md § Seams) · pure: no I/O, no clock, no
           imports · reads exactly what `docs_index.py` reads (README § What is indexed, follow-up bullets) so the two
           readers agree · writes a file in its own shape (design.md § Follow-ups)

## Reading — must match the index

- Shape: `sections` when the file holds a `**Contents**` line or any `### ` heading outside fenced code, else
  `list`. Same test as `markdown.py` `followup_items`.
- `sections`: one item per `## ` heading outside fenced code. `line` is the heading line; `endLine` is the last
  non-blank line before the next `## ` heading or the file end. `body` is the text between the heading and
  `endLine`, with its leading blank lines removed. `title`, `oneLine` and `tags` come from the Contents line whose bold
  title equals the heading title; with no such line, `oneLine` is `''` and `tags` is `[]`.
- `list`: one item per top-level `- ` or `N. ` line at column 0; indented or blank lines after it are its
  continuation, as in `markdown.py` `_list_items`. `body` is the continuation lines with two spaces of indent removed.
  Title, tags and `oneLine` come from the item's first line only (task 03 makes the index do the same).
- A Contents line or list item: `- **<title>** — *<tags>*: <oneLine>`. After the bold title, strip leading `:`, `—`,
  `–` and spaces, as `_list_item` does, so the colon form `- **Title**: gist` reads too. Then tags are the
  comma-separated words of an italic span (`*…*` or `_…_`) that opens the rest and ends in a colon; the text after it
  is `oneLine`. Without a span, the rest is `oneLine`. A first line with no bold lead takes its first sentence as
  title (up to the first `. `, else the whole line), a trailing `.` dropped, and the text after it as `oneLine`.
- A Contents line matches its `## ` heading when the two titles are equal with backticks removed from both, for the
  match only; each title keeps its text as written.
- `done`: the heading or item text starts with `~~`; or, for a list item, `oneLine` (tags removed) starts with
  `shipped`; or, for a section, its first body line (non-blank, not starting with `#`) starts with `shipped`, any case,
  as the index judges it.

## Writing

- `create`: `sections` — insert the Contents line after the last Contents list line (or right after `**Contents**`
  and its blank line when the list is empty), and append `## <title>`, a blank line, and the body at the file end,
  one blank line before it. `list` — append the list item at the end of the last list run; in a numbered run, with
  the next number. An empty `body` writes `oneLine` as the section body, so the section still stands on its own.
- `edit`: rewrite the heading, the body (heading line + 1 to `endLine`) and the Contents line of the section whose
  title equals `edit.title`, or the list item and its continuation; an empty `body` writes `oneLine`, as `create`
  does. Every other line stays byte for byte.
- A rewritten list item keeps its own marker (`- ` or `N. `).
- `setTags`: rewrite only the item's Contents line or list item. An empty list removes the span and its colon.
- `delete`: remove the section (heading to `endLine` plus one following blank line) and its Contents line, or the list
  item and its continuation.
- Tags are always written as `*a, b*:`. A written line is `- **<title>** — <oneLine>` with no tags.
- Every line this module writes takes that bold-lead form, so an edit or `setTags` on a list item titled by its
  first sentence (`- Command palette.`) rewrites it as `- **Command palette** — <rest>`, and a colon-form line
  (`- **Title**: gist`) is rewritten in the dash form.
- A `sections` file with no `**Contents**` line gains one on its first edit: after the `# ` heading (or at the top),
  `**Contents**`, a blank line, then one line per existing `## ` heading in order, its `oneLine` the first sentence of
  that section's first paragraph.
- `missing` when no item has the title (edit, setTags, delete). `titleTaken` when a create, or an edit that renames,
  names a title another item already has. Title compare is exact.
- `line` in `applied`: the 1-based line of the created or edited item's heading or list item; for a delete, the line
  where the removed item started, clamped to the file's last line.
- `newFollowupsFile(repo)` returns exactly:

  ```markdown
  # Follow-ups — <repo>

  **Contents**

  Deferred work for the <repo> repo. Each entry is one `##` section and stands on its own as a task brief.
  ```

  A create into this text puts its Contents line between `**Contents**` and the paragraph, with one blank line on
  each side.

GIVEN `~/wigley-features/new-games-prototypes/followups.md`'s shape (Contents list, `##` sections with `###`
subsections) WHEN parsed THEN each `##` heading is one item and `### What` is part of its body, not an item.
GIVEN a list item `- **Fruit Blast coins** — *needs a feature plan*: replace the sink` WHEN parsed THEN tags is
`['needs a feature plan']` and oneLine is `replace the sink`.
GIVEN a section item WHEN `setTags` adds `agent-ready` THEN only its Contents line changes.

Tests:     `parseFollowups` — sectioned file: items, line spans, bodies, tags from Contents lines · list file:
           bold-lead and first-sentence titles (trailing `.` dropped), continuation as body and never in the title ·
           colon-form lines · numbered items · `*…*` and `_…_` spans · Contents-to-heading match with backticks ·
           done by `~~`, by a list item's `shipped`, and by a section's first body line · fenced code ignored.
           `applyFollowupEdit` — create into sections, list, a numbered list (next number) and `newFollowupsFile`
           text · edit renames heading and Contents line together and replaces the section body · edit and setTags
           keep a `N. ` marker · setTags add, change, clear · delete leaves the neighbours byte-identical ·
           Contents list built on first edit of a file without one · `missing` · `titleTaken`.
           Round trip: parse after each edit returns the draft's fields.
           Each test builds its own file text; none reads a real features home.
Done when: `npm test -- src/shared/followups` passes (`npx` and `node` are denied on this machine; go through npm); `npm run lint` passes.
Commit:    one commit for the group

## Proof
