# 01 — Renderer block marks

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/renderer/markdown-it/markdown-it-renderer.ts` · modify `src/contracts/markdown.ts` · test `src/renderer/markdown-it/markdown-it-renderer.test.ts`
Consumes:  none
Produces:  `MarkdownRenderer.block` output that holds `data-md-lines="<start>,<end>"` on each cursor block

Decisions:

- Mark in `block` only. `document` and `inline` output do not change.
- A cursor block is a token with a `map` that is one of these:
  - a token at `level` 0 with `nesting` not -1, except `bullet_list_open` and `ordered_list_open`
  - a `list_item_open` token at `level` 1
- Values come from `token.map`: zero-based, `end` exclusive.
- `rules.heading_open` in `installBlockRules` ignores attributes today. It must print the attribute.
- The contributed fence placeholder prints `self.renderAttrs(token)` today, so it needs no change. Confirm
  this with a test row.
- Every other custom open rule in `installSharedRules` that returns a fixed string (`md_changes_open`,
  `md_tree_open`, `md_details_open`) must print the attribute when its token holds one. A `:::` block is
  one stop.
- Fix the doc comment of `block` in `src/contracts/markdown.ts`.

GIVEN `# Title\n\nFirst para\nsecond line\n\n\`\`\`ts\ncode\n\`\`\`\n\n- one\n  - nested\n- two` WHEN `block` runs THEN the heading is `0,1`, the paragraph is `2,4`, the fence is `5,8`, item `one` is `9,11`, item `two` is `11,12`, and `nested` has no mark
GIVEN a table and a quote that holds two paragraphs WHEN `block` runs THEN the table has one mark, the quote has one mark, and the inner paragraphs have none
GIVEN a contributed fence WHEN `block` runs THEN its `.md-fence` placeholder holds the mark
GIVEN any text WHEN `document` runs THEN the output holds no `data-md-lines`

Tests:     a new `it.each` `block_marksCursorBlocks` in `markdown-it-renderer.test.ts` with the first three GIVEN rows, each asserting the attribute values; one row in the same file for `document`.
Done when: compiles; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

