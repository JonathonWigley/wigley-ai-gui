# 01 — Renderer block marks

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/renderer/markdown-it/markdown-it-renderer.ts` (the `:::` block rule included) · modify `src/contracts/markdown.ts` · test `src/renderer/markdown-it/markdown-it-renderer.test.ts`
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
- A plain fence and an indented code block carry the mark on `<pre>`. markdown-it's stock rules print
  attributes on the inner `<code>`, so the block rule removes the mark from the token, calls the stock rule,
  and inserts the mark in the `<pre` tag of its output.
- The rules `md_changes_open`, `md_tree_open` and `md_details_open` return fixed strings. Each must print its
  token's attributes through `self.renderAttrs`.
- `wigleyBlock`, `pushChangeBlock` and `pushDetails` push open tokens with a null `map`. Set `map` on each open
  token to `[startLine, Math.min(closeLine + 1, endLine)]`, the range it passes to `state.line`. A `:::` block is
  then one stop. `document` output for these blocks gains `data-source-line` as a result; this is correct.
- Fix the doc comment of `block` in `src/contracts/markdown.ts`.

GIVEN `# Title\n\nFirst para\nsecond line\n\n\`\`\`ts\ncode\n\`\`\`\n\n- one\n  - nested\n- two` WHEN `block` runs THEN the heading is `0,1`, the paragraph is `2,4`, the fence is `5,8`, item `one` is `9,11`, item `two` is `11,12`, and `nested` has no mark
GIVEN a table and a quote that holds two paragraphs WHEN `block` runs THEN the table has one mark, the quote has one mark, and the inner paragraphs have none
GIVEN a contributed fence WHEN `block` runs THEN its `.md-fence` placeholder holds the mark
GIVEN a plain fence WHEN `block` runs THEN `<pre>` holds the mark and `<code>` does not
GIVEN `:::details`, `:::changes` and `:::tree` blocks that hold paragraphs or items WHEN `block` runs THEN each open element holds one mark from its first line to the line after its closer, and no inner element holds one
GIVEN any text WHEN `document` runs THEN the output holds no `data-md-lines`

Tests:     a new `it.each` `block_marksCursorBlocks` in `markdown-it-renderer.test.ts` with the five `block` GIVEN rows, each asserting the attribute values; one row in the same file for `document`. Exact-HTML rows go red and take the mark: `keeps every level as a class`, `keeps markdown-it's language class on other fences` and `keeps a block opener inside a fence as code`. Search the suite for other exact `block` output.
Done when: compiles; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

