# 01 — Markdown block contributions

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/markdown.ts`
- modify `src/renderer/markdown-it/markdown-it-renderer.ts`
- test `src/renderer/markdown-it/markdown-it-renderer.test.ts`
- modify `src/shared/plugin-service-views.ts`
- modify `src/shared/page/markdown.css`
- modify `src/shared/page/markdown-mount.test-support.ts`
- modify `src/shared/plugin-part-harness.test-support.ts`
- test `src/shared/plugin-part-harness.test.ts`
- test `src/renderer/plugins/page-api.test.ts`
- test `src/plugins/forms/page/round-view.test.ts`, `src/plugins/docs/page/doc-view.test.ts`,
  `src/shared/page/layout-host/base-kit.test.ts` (their `MarkdownRenderer` literals only)
- create `src/plugins/markdown-blocks/manifest.ts`
- create `src/plugins/markdown-blocks/page/start.ts`
- create `src/plugins/markdown-blocks/page/change-blocks.ts`
- create `src/plugins/markdown-blocks/page/details-block.ts`
- create `src/plugins/markdown-blocks/page/markdown-blocks.css`
- test (create) `src/plugins/markdown-blocks/page/markdown-blocks.test.ts`
- test (create) `src/plugins/markdown-blocks/page/start.test.ts`
- modify `src/plugins/manifests.ts`, `src/plugins/page.ts`
- modify `src/plugins/forms/manifest.ts`, `src/plugins/chat/manifest.ts` (page `dependsOn` only)
- modify `scripts/check-layers.mts` (one `PLUGIN_EXTRAS` entry)

Consumes: nothing from another task. The tree holds `MarkdownRenderer.addFence`, `trackedMarkdown`,
`NO_FENCES`, `fakeMarkdown` and `PagePartHarness.fences`.

Produces:
- In `src/contracts/markdown.ts`:
  - `MarkdownRenderer.addBlock(block: BlockContribution): Disposable` — throws on a name already registered.
  - `export interface BlockContribution { name: string; render(block: MarkdownBlock, helpers: BlockHelpers): string }`
  - `export interface MarkdownBlock { header: string; body: readonly string[] }`
  - `export interface BlockHelpers { block(text: string): string; inline(text: string): string; escape(text: string): string }`
- In `src/shared/plugin-service-views.ts`: `trackedMarkdown` returns a view whose `addBlock` files each block with
  `registrations.track`.
- In `src/shared/plugin-part-harness.test-support.ts`: `PagePartHarness.blocks: readonly BlockContribution[]`.
- In `src/plugins/markdown-blocks/manifest.ts`: `export const markdownBlocksManifest` (id `markdown-blocks`).
- In `src/plugins/markdown-blocks/page/start.ts`:
  `export const markdownBlocksPagePart: PagePart<typeof markdownBlocksManifest>`.
- In `src/plugins/markdown-blocks/page/change-blocks.ts`: `export const changesBlock: BlockContribution` and
  `export const treeBlock: BlockContribution`.
- In `src/plugins/markdown-blocks/page/details-block.ts`: `export const detailsBlock: BlockContribution`.

## Decisions

Settled in the interview (`docs/features/plugin-framework/design.md` § Extension points (Lane E)):

- The adapter owns the `:::name` opener, the close line and nesting. A block registers a name only.
- `render` gets the header text, the body lines and the helpers, and returns HTML. The adapter trusts that HTML.
- `:::changes`, `:::tree` and `:::details` move to the new built-in page-only plugin `markdown-blocks`.
- Forms and chat list `markdown-blocks` in their page `dependsOn`. Thus the plugin switch locks it on while either runs.
- The agent-facing text that names the blocks does not change: `src/plugins/forms/main/kinds/notice/notice-format.ts`,
  `src/plugins/forms/main/kinds/question/question-format.ts`, `src/plugins/forms/main/preview/preview-round.ts` and
  `src/shared/fake-agent-harness.ts` stay as they are.

Settled in this plan:

- **What a page `dependsOn` entry needs (checked at plan time).** The id must be in `src/plugins/manifests.ts`
  (`requireDependenciesListed` in `src/shared/plugin-host.ts`), and `src/plugins/<id>/` must exist
  (`requireKnownNames` in `scripts/layer-rules.mts`). A provider with no `exports` gives `undefined` to
  `api.dependency`, and the layer rules skip a provider with no `contract.ts` (`contractsOf`). Thus
  `markdown-blocks` has no `contract.ts`, no `exports` and no dependency key. Forms and chat never call
  `api.dependency` for it. The entry only orders the start and locks the switch.
  - `src/plugins/forms/manifest.ts`: `dependsOn: { main: ['sessions', 'chat'], page: ['sessions', 'markdown-blocks'] }`.
  - `src/plugins/chat/manifest.ts`: `dependsOn: { main: ['sessions'], page: ['sessions', 'markdown-blocks'] }`.
- **The block styles move to the plugin.** Move every rule from `.md-changes, .md-tree` through `.md-details > summary`
  in `src/shared/page/markdown.css` into `src/plugins/markdown-blocks/page/markdown-blocks.css`, unchanged. `start.ts`
  imports it as its first line (`import './markdown-blocks.css';`). Reason: the visual plugin keeps its fence's styles
  in `src/plugins/visual/page/visual.css`, imported by its `start.ts`. A contribution's look lives with the
  contribution. The cursor-mark rules in `src/plugins/chat/page/chat.css` that name `.md-changes` stay in chat: they
  style chat's own cursor, and chat depends on the plugin.
- **Manifest.** `id: 'markdown-blocks'`, `label: 'Markdown blocks'`,
  `description: 'Draws the :::changes, :::tree and :::details blocks agents write in markdown.'`,
  `dependsOn: { main: [], page: [] }`, `reads: { main: [], page: [] }`, and empty `commands`, `scopes`, `settings`,
  `settingInfo` and `themeTokens`. A comment above it says what the plugin does, as `usage-tab-line/manifest.ts` does.
  It does not join the `plugins.disabled` default in `src/config/settings.ts`.
- **List order.** `markdownBlocksManifest` goes after `visualManifest` in `builtInManifests`.
  `markdownBlocksPagePart` goes second in `pageParts`, after `keysPagePart`. Reason: it then registers its blocks
  before every markdown owner that does not depend on it (docs, primer, backlog, practice) draws.
- **Page part.** `start` calls `api.services.markdown.addBlock` for `changesBlock`, `treeBlock` and `detailsBlock`, in
  that order, and returns `{ commands: {} }`. It needs no `dispose`: the per-plugin view files each block.
- **Opener.** A line opens a block when it is not indented code (`sCount - blkIndent >= 4` stays code, as today), its
  trimmed text matches `/^:::([a-z][a-z0-9-]*)(?:\s+(.*))?$/`, and the name in group 1 is registered. The header is
  group 2 trimmed, or `''` when there is none. An opener with an unregistered name is plain text. The rule stays where
  `wigleyBlock` is today (`before('fence')` with `alt: FENCE_ALT`), so an opener still ends a paragraph. In silent
  mode the rule returns true for an opener and pushes nothing.
- **One close rule for every block.** This replaces `listCloseLine` and `detailsCloseLine`. From the line after the
  opener, scan with depth 1. A fence mark opens a fence, and the line that `closesFence` accepts ends it; lines inside
  a fence count for nothing. Outside a fence, an opener (as above) adds 1, and a line whose trimmed text is `:::`
  takes 1 away. The line where depth reaches 0 is the close line. When no line reaches 0, the close line is `endLine`.
  The token map is `[startLine, Math.min(closeLine + 1, endLine)]`, and `state.line` moves to its end, as today.
  This changes one behaviour: a fence mark or an opener inside a `:::changes` or `:::tree` body now counts, where
  today the first `:::` closes those blocks.
- **An unclosed block draws as if closed.** Today an unclosed `:::changes`, `:::tree` or `:::details` runs to the end
  of the source and draws its body (the rows `skips blank lines and runs to the end when unclosed` and
  `runs to the end when unclosed`). This keeps a streaming chat reply drawing its open block. Keep it:
  `MarkdownBlock` carries no closed flag.
- **Body lines.** `body` holds one string for each source line between the opener and the close line. Each string is
  the line's trimmed text (`lineText`), with `Math.max(0, state.sCount[line] - state.blkIndent)` spaces in front.
  A blank line is `''`. Thus the tree block still measures indent in columns, as `sCount` counts them today.
- **Render runs at parse time, and the helpers return markers.** The block rule calls `render` once, when it is not
  silent. `helpers.escape` returns `md.utils.escapeHtml(text)`. `helpers.block` and `helpers.inline` record a request
  and return a marker, `\u0000<n>\u0000`, where `<n>` counts the requests of this one render from 0. A source text
  cannot hold a marker: markdown-it's normalize step replaces each NUL with U+FFFD. The rule then splits the returned
  HTML at its markers and pushes tokens in this order:
  1. `md_block_open` (nesting 1), holding the HTML before the first marker, with the token map. `markCursorBlocks` and
     `markSourceLines` mark this token, as they mark `md_details_open` today.
  2. For each marker, in the order the markers appear in the HTML: the tokens of its request. A marker that appears
     twice pushes its tokens twice. A request whose marker the HTML does not hold pushes nothing.
  3. Between two markers, an `md_block_html` token (nesting 0) that holds the HTML between them.
  4. `md_block_close` (nesting -1), holding the HTML after the last marker.
  The nesting values keep every token inside the block at a level above 0. Thus the block's inner paragraphs get no
  `data-md-lines` mark of their own, as today.
- **What a request pushes.**
  - `inline(text)`: one `inline` token whose content is `text`, as `pushInline` does today. markdown-it's core inline
    rule parses it later, so inline markdown renders and HTML is escaped.
  - `block(text)` where `text` equals `body.slice(i, j).join('\n')` for some `i < j` (take the smallest `i`, then the
    smallest `j`): tokenize those source lines in place, with `state.lineMax` held at the end of that run, as
    `pushDetails` does today. Thus a fence in the body is highlighted in `document()`, and each inner token keeps its
    true source line.
  - `block(text)` for any other non-empty text: parse `text` on its own with the same markdown-it instance and the
    same env, set each token's `map` to null, and raise each token's `level` to sit inside the block. These tokens get
    no line marks.
  - `block('')`: nothing.
  Read markdown-it's `ParserBlock` source in the installed version for the in-place and the separate parse calls. Do not
  assume an API from memory. Name the version you read in a comment.
- **Render rules.** `md_block_html` and `md_block_close` return their content. `md_block_open` returns its content with
  `self.renderAttrs(token)` put in front of the first `>` of the first tag, when the content starts with `<` and a
  letter. Otherwise it returns the content unchanged. Thus `<details class="md-details">` becomes
  `<details class="md-details" data-md-lines="0,5">`, as the pinned rows show today.
- **The registry.** One `Map<string, BlockContribution>` keyed by the exact name, shared by the `block` and the
  `document` instances (`createWigleyMarkdown` takes it), and read at parse time. Thus a block added after the
  renderer is made draws on the next render. `addBlock` throws `block <name> is already registered` on a name in the
  map. It throws `block name "<name>" must match [a-z][a-z0-9-]*` on a name the opener cannot match. Its `Disposable`
  removes the block only while the map still holds that same contribution, as `addFence` does.
- **Removed from the adapter.** `LIST_OPENER`, `DETAILS_OPENER`, `CHANGE_MARK`, `CHANGE_BULLET`, `CHANGE_KINDS`,
  `ChangeKind`, `ChangeLine`, `listCloseLine`, `detailsCloseLine`, `changeLines`, `parseChangeLine`,
  `pushChangeBlock`, `pushTreeItems`, `closeTreeItem`, `pushChangeItem`, `pushDetails`, `changeItemOpen`, and the
  `md_changes_*`, `md_tree_*`, `md_list_close`, `md_branch_*`, `md_change_*`, `md_summary_*` and `md_details_*` render
  rules. `wigleyBlock` becomes the generic rule. Keep `FENCE_MARK`, `closesFence` and `lineText`: the close rule
  and `closesAt` use them.
- **The three blocks give today's HTML, byte for byte.** Move the line parsing (`+`, `~`, `x` marks; `-` and `*`
  bullets) and the tree nesting (two columns for each level from the first line's indent, at most one level below the
  line before) from the adapter into `change-blocks.ts` as they are. Each change or tree line's text goes through
  `helpers.inline`. Blank body lines are skipped. `detailsBlock` returns
  `<details class="md-details"><summary>` + `helpers.inline(header === '' ? 'Details' : header)` + `</summary>\n` +
  `helpers.block(body.join('\n'))` + `</details>\n`.
- **Test fakes.** `NO_FENCES` in `src/shared/page/markdown-mount.test-support.ts` keeps its name. It gains
  `addBlock: () => ({ dispose: () => undefined })`, its type becomes
  `Pick<MarkdownRenderer, 'addFence' | 'fence' | 'addBlock'>`, and its comment says it registers no fence and no
  block. Every literal the compiler types as `MarkdownRenderer` that lacks `addBlock` gets the same no-op. At plan time
  these were `src/plugins/forms/page/round-view.test.ts` (near line 280), `src/plugins/docs/page/doc-view.test.ts`
  (`docViewOver`'s default and near line 3390) and `src/shared/page/layout-host/base-kit.test.ts` (near line 668)
  (measured at plan time, re-verify with `npm run typecheck`). In the part harness, `fakeMarkdown` fakes `addBlock` as
  it fakes `addFence`: it pushes onto a new `world.blocks`, throws `block <name> is already registered` on a name it
  holds, and returns a counted handle. The harness exposes the list as `blocks`, beside `fences`, and the comment above
  `PagePartHarness` names it.
- **The plugin's test runs the real adapter.** `markdown-blocks.test.ts` imports `createMarkdownItRenderer` and adds
  the three blocks through `addBlock`. Reason: the bytes each block gives depend on the helpers' markers and on the
  in-place body tokenizing, so only the real adapter pins them. Add this entry to `PLUGIN_EXTRAS` in
  `scripts/check-layers.mts`, with a one-line comment saying why:

  ```ts
  'markdown-blocks': {
    sublayers: {
      'src/plugins/markdown-blocks/page/markdown-blocks.test.ts': {
        layers: [
          'src/contracts',
          'src/plugins/markdown-blocks/page',
          'src/renderer/markdown-it',
        ],
        packages: [],
      },
    },
  },
  ```

- Update the comment above `MarkdownRenderer` in `src/contracts/markdown.ts`: `block` and `document` draw each
  registered `:::name` block. Update the comment on `createWigleyMarkdown` and on `trackedMarkdown` ("removes every
  fence and block the plugin added").

**Rulings from the plan's cold read:**

- **"Parse `text` on its own"** means `md.block.parse(text, md, env, tokens)`: block rules only, so each `inline`
  token's `children` stay empty and the outer core `inline` pass parses them once (the full `md.parse` would fill
  them and the outer pass would append again, doubling the text). The tokens are appended to the state's
  `tokens`, each `level` raised by `state.level`.
- **A `render` that throws** draws that block's opener line and body as plain text (one paragraph per line, escaped),
  and the rest of the document renders as before: a plugin's bug must not blank a chat reply. The adapter has no
  log; the comment on `BlockContribution.render` states the fallback. One `block contributions` row pins it.
- **A header on `:::changes` or `:::tree`** (`:::changes foo`) now opens the block, where the old `LIST_OPENER`
  left it as text; `changesBlock` and `treeBlock` ignore the header. One row pins it.
- **Expected outputs are written by hand.** Every `block contributions` row states its exact expected string,
  derived from the rules above before the test first runs, never pasted from the adapter's output (a pasted
  expectation cannot fail).

## Behaviour

GIVEN the `markdown-blocks` plugin runs WHEN chat draws `:::changes\n+ a\n:::` THEN the HTML is the same as before
this task.
GIVEN no block named `changes` is registered WHEN `block(':::changes\n+ a\n:::')` runs THEN the output is
`<p>:::changes\n+ a\n:::</p>\n`.
GIVEN a registered block WHEN its opener has no close line THEN its body runs to the end of the source and it draws.
GIVEN `:::details S` holding a fenced `:::` WHEN it renders THEN the fenced `:::` stays code and the next bare `:::`
closes the details.
GIVEN a `:::details` body holding a `ts` fence WHEN `document()` renders it THEN the fence is highlighted and carries
`data-source-line="2"`.
GIVEN forms or chat runs WHEN the user adds `markdown-blocks` to `plugins.disabled` THEN the switch refuses, and
Settings shows the row as locked by those plugins.
GIVEN a plugin added a block WHEN the plugin stops THEN the block is gone and its opener renders as text.

## Tests

`src/renderer/markdown-it/markdown-it-renderer.test.ts`:
- Remove the `:::changes`, `:::tree` and `:::details` describes. Their rows move unchanged to
  `markdown-blocks.test.ts`, except `leaves a bare closer with no open block as text`, which moves to the new
  `block contributions` describe below.
- Add two test-local contributions at the top of the file:
  - `note`: returns `<div class="note" data-header="${escape(header)}">${block(body.join('\n'))}</div>\n`.
  - `lines`: returns `<ol class="lines">` + one `<li>${inline(line)}</li>` for each body line + `</ol>\n`.
  Register both on the shared `markdown` instance.
- `cursor block marks`: replace the row `wigley blocks once each, from opener to the line after the closer` with
  `a contributed block once, from opener to the line after the closer`. Its text is
  `':::note S\nbody\n\n- item\n:::\n\n:::lines\na\n:::'`, and its tags are
  `['<div class="note" data-header="S" data-md-lines="0,5">', '<ol class="lines" data-md-lines="6,9">']`.
- `document()`:
  - Rename `highlights a fence inside details` to `highlights a fence inside a block`. Its text is
    `':::note S\n```ts\nx\n```\n:::'`. Keep its expected `<pre data-source-line="2">…` string.
  - In `holds no cursor block mark`, use `:::note S` for `:::details S`.
  - In `marks blocks, list items and tables with their source line`, use `:::note S` for `:::details S`. Use
    `:::lines` for each of `:::changes` and `:::tree`. Change the last three tags to
    `<div class="note" data-header="S" data-source-line="12">`, `<ol class="lines" data-source-line="16">` and
    `<ol class="lines" data-source-line="20">`.
- New describe `block contributions`, one `it.each` table `block_drawsContributedBlocks: $name`, each row with a text and
  its exact `block()` output (marks stripped):
  - the header and the body lines reach render, with the indent rebuilt from columns and a blank line as `''`
    (`':::lines\na\n  b\n\nc\n:::'`; a blank line gives `<li></li>`)
  - an empty header is `''` (`':::note\nx\n:::'` gives `data-header=""`)
  - the header is escaped through `escape` (`':::note <b>\nx\n:::'` gives `data-header="&lt;b&gt;"`)
  - inline markdown renders and HTML escapes in an `inline` request (`':::lines\n**b** <i>\n:::'`)
  - an unregistered name is text (`':::other\nx\n:::'` gives `<p>:::other\nx\n:::</p>\n`)
  - an opener ends the paragraph before it (`'Intro\n:::note\nx\n:::'`)
  - an opener indented four spaces is code
  - nested blocks close innermost first (`':::note A\n:::note B\nin\n:::\nmid\n:::\nout'`)
  - a fenced `:::` or opener inside a body stays code, with rows for ```` ``` ```` and `~~~`
  - an unclosed block runs to the end (`':::note S\nbody'`)
  - a nested opener inside a `lines` body moves only the close line, by the one close rule
    (`':::lines\n:::note\nx\n:::\ny\n:::\nafter'`): the outer `lines` closes at the last `:::`, its body is
    `[':::note', 'x', ':::', 'y']`, drawn as four `<li>` rows holding that literal text, then `<p>after</p>`;
    the inner `:::note` is never parsed, since `lines` only calls `inline`
  - a bare `:::` with no open block stays text (move the row `leaves a bare closer with no open block as text` here)
- New `it` `blocks_BlockTextNotInBody_RendersWithoutMarks`: a test-local `fixed` block whose render returns
  `block('para')`, inside `document()`. The output is `<p>para</p>\n` with no `data-source-line` inside the block.
- New `it` `addBlock_SecondOfAName_Throws_DisposeUnregisters`, modelled on `registers, refuses a second and
  unregisters a fence`. A second `addBlock` of one name throws `block x is already registered`. A bad name throws
  `block name "X" must match [a-z][a-z0-9-]*`. After `dispose`, `:::x` renders as text. A stale dispose after a new
  registration of that name leaves the new one.

`src/plugins/markdown-blocks/page/markdown-blocks.test.ts` (new):
- The moved `:::changes`, `:::tree` and `:::details` describes, every row and expected string unchanged.
- The moved cursor-marks row: text
  `':::details S\nbody\n\n- item\n:::\n\n:::changes\n+ a\n:::\n\n:::tree\nroot\n  child\n:::'`, tags
  `['<details class="md-details" data-md-lines="0,5">', '<ul class="md-changes" data-md-lines="6,9">',
  '<ul class="md-tree" data-md-lines="10,14">']`.
- The moved `document()` row `highlights a fence inside details`, with its `ts` highlighter fake copied from the adapter
  test.
- The moved source-line tags for the three blocks: `<details class="md-details" data-source-line="12">`,
  `<ul class="md-changes" data-source-line="16">` and `<ul class="md-tree" data-source-line="20">`, from the same text
  as the adapter row.

`src/plugins/markdown-blocks/page/start.test.ts` (new): `start_AddsTheThreeBlocks_StopRemovesThem` —
`startPagePart(markdownBlocksPagePart)`. `harness.blocks.map((block) => block.name)` equals
`['changes', 'tree', 'details']`. After `await harness.stop()`, `harness.blocks` is empty.

`src/shared/plugin-part-harness.test.ts`:
- New `it` `counts the markdown block a page part adds`, beside `counts the markdown fence a page part adds`: the block
  and the command make 2 registrations, and `harness.blocks` holds the block.
- A row `markdown.addBlock` in the misuse `it.each` table. It adds `{ name: 'sample', render: () => '' }` twice, and the
  message is `block sample is already registered`.
- In `ends what a part left of a replaced editor and markdown at its stop`, the replaced markdown also fakes `addBlock`,
  and the part adds one block. Its dispose runs once at the stop.

`src/renderer/plugins/page-api.test.ts`: a row `services.markdown.addBlock` in the registration table, beside
`services.markdown.addFence`, in the same shape.

## Done when

`npm run typecheck` passes. `npm run lint` passes, with the new folder listed in `manifests.ts` and `page.ts`. The test
gate runs `src/renderer/markdown-it/markdown-it-renderer.test.ts`,
`src/plugins/markdown-blocks/page/markdown-blocks.test.ts`, `src/plugins/markdown-blocks/page/start.test.ts`,
`src/shared/plugin-part-harness.test.ts`, `src/renderer/plugins/page-api.test.ts`,
`src/plugins/forms/page/round-view.test.ts`, `src/plugins/docs/page/doc-view.test.ts` and
`src/shared/page/layout-host/base-kit.test.ts`. The live checks (blocks in chat and forms, the switch lock) are in
task 12, Final verification.

Commit: one commit for the group. Message:
`Markdown blocks register through addBlock; changes, tree and details move to the markdown-blocks plugin`

## Proof

