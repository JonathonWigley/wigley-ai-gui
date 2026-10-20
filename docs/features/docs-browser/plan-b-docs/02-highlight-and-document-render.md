# 02 — Code highlighter and markdown document render

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Three items share one spec: the `CodeHighlighter` seam and its CodeMirror adapter, the `syntax.*` theme tokens, and
`MarkdownRenderer.document`.

Files:
- create `src/contracts/highlight.ts`
- modify `src/contracts/markdown.ts`
- create `src/renderer/codemirror-vim/languages.ts` · test `src/renderer/codemirror-vim/languages.test.ts`
- create `src/renderer/codemirror-vim/codemirror-highlighter.ts` · test
  `src/renderer/codemirror-vim/codemirror-highlighter.test.ts`
- create `src/renderer/codemirror-vim/syntax.css`
- modify `src/renderer/markdown-it/markdown-it-renderer.ts` · test `src/renderer/markdown-it/markdown-it-renderer.test.ts`
- modify `src/contracts/theme.ts`, `src/config/themes/catppuccin-mocha.json`
- modify `src/renderer/renderer.ts`
- modify `docs/features/followups.md`

Consumes:
- `MarkdownRenderer` in `src/contracts/markdown.ts`, `createMarkdownItRenderer` in
  `src/renderer/markdown-it/markdown-it-renderer.ts`, `THEME_TOKENS` in `src/contracts/theme.ts`, `themeVariable` in
  `src/shared/theme-variables.ts` (tree)
- `LAYERS` entries for `src/renderer/codemirror-vim` packages ← 01 (`npm run lint` passes once 01 has landed)
- packages `@codemirror/language-data`, `@codemirror/lang-markdown`, `@codemirror/language`, `@lezer/highlight`
  (Preconditions)

Produces:

```ts
// src/contracts/highlight.ts — exactly as plan.md's File Structure
export interface CodeHighlighter {
  // HTML of `code` with tok-* spans, or null when `language` is unknown.
  highlight(code: string, language: string): Promise<string | null>;
}

// src/contracts/markdown.ts — MarkdownRenderer gains
document(text: string): Promise<string>;

// src/renderer/codemirror-vim/languages.ts (task 05 consumes these)
export function findLanguageByName(name: string): LanguageDescription | null;
export function findLanguageByFile(fileNameOrPath: string): LanguageDescription | null;
export function loadLanguage(language: LanguageDescription): Promise<LanguageSupport>;

// src/renderer/codemirror-vim/codemirror-highlighter.ts
export function createCodeMirrorHighlighter(): CodeHighlighter;

// src/renderer/markdown-it/markdown-it-renderer.ts — signature changes
export function createMarkdownItRenderer(highlighter: CodeHighlighter): MarkdownRenderer;

// src/contracts/theme.ts — THEME_TOKENS gains, in this order, after 'severity.minor'
'syntax.keyword', 'syntax.atom', 'syntax.number', 'syntax.string', 'syntax.string2', 'syntax.comment',
'syntax.variable', 'syntax.variable2', 'syntax.definition', 'syntax.property', 'syntax.type',
'syntax.operator', 'syntax.punctuation', 'syntax.meta', 'syntax.heading', 'syntax.link'
```

The rendered document's markup the docs view (task 07) reads:

- a link: `<a class="md-link" href="#" data-href="<href>" title="<link title, or href>">…</a>`
- a heading: `<hN data-anchor="<slug>">…</hN>` (N = 1–6)
- an image: `<span class="md-image"><alt text></span>`
- every block element with a source map, list items included: `data-source-line="<n>"` (below)

Decisions:

- **Language lookup** (plan.md: "`@codemirror/language-data` finds a language by name or file name"):
  `findLanguageByName` is `LanguageDescription.matchLanguageName(languages, name, false)` — exact, case-insensitive,
  over each language's `alias` list (which holds its lowercased name), no fuzzy match; an empty name is `null`.
  `findLanguageByFile` is `LanguageDescription.matchFilename(languages, <last path segment>)` — the language's
  `filename` pattern first, then the extension. Both return `null` on no match. (Verified against
  `@codemirror/language` 6.x `src/language.ts` and `@codemirror/language-data` `src/language-data.ts` on GitHub
  main: Markdown is `md, markdown, mkd`; JSON `json, map`; TOML `toml` (a legacy stream mode); YAML `yaml, yml`.)
- **Markdown loads with its fenced languages**: `loadLanguage` returns, for the description named `Markdown`,
  `markdown({ base: markdownLanguage, codeLanguages: languages })` from `@codemirror/lang-markdown` (GFM base, so
  tables and task lists parse; fenced code inside markdown highlights by its info string), built once and reused.
  Any other description returns `description.load()` (which caches its own promise).
- **Highlighting** (plan.md: "`@lezer/highlight`'s `classHighlighter` emits `tok-*` classes"): `highlight(code,
  language)` finds the language by name, loads it, parses with `support.language.parser.parse(code)`, and walks the
  tree with `highlightCode(code, tree, classHighlighter, putText, putBreak)` (`@lezer/highlight` 1.2.x
  `src/highlight.ts`). `putText` with empty classes appends the escaped text; with classes it appends
  `<span class="<classes>"><escaped text></span>`; `putBreak` appends `\n`. Escaping replaces `&`, `<`, `>` with
  `&amp;`, `&lt;`, `&gt;`. A stream (legacy) language such as TOML parses the whole text when no editor is running
  (`@codemirror/language` `src/stream-parser.ts`: with no `ParseContext`, `advance()` runs to the input's end).
  An unknown language returns `null`. A language whose load rejects makes `highlight` reject (fail loud).
- **Syntax colours** (this lands the follow-up 'Syntax-highlighting theme tokens'; strike that line from
  `docs/features/followups.md`). `syntax.css` beside the adapter maps each class to a token
  variable (`themeVariable` names: `syntax.keyword` → `--wg-syntax-keyword`), in this order, so a later rule wins
  where a span holds two classes (`tok-variableName tok-definition`):

  | Selector | Token | Catppuccin Mocha | Extra |
  |---|---|---|---|
  | `.tok-keyword`, `.tok-macroName` | `syntax.keyword` | `mauve` | |
  | `.tok-atom`, `.tok-bool`, `.tok-literal` | `syntax.atom` | `peach` | |
  | `.tok-number` | `syntax.number` | `peach` | |
  | `.tok-string` | `syntax.string` | `green` | |
  | `.tok-string2` | `syntax.string2` | `pink` | |
  | `.tok-comment` | `syntax.comment` | `overlay2` | `font-style: italic` |
  | `.tok-variableName` | `syntax.variable` | `text` | |
  | `.tok-variableName2` | `syntax.variable2` | `red` | |
  | `.tok-propertyName` | `syntax.property` | `lavender` | |
  | `.tok-definition` | `syntax.definition` | `blue` | |
  | `.tok-typeName`, `.tok-className`, `.tok-namespace` | `syntax.type` | `yellow` | |
  | `.tok-operator` | `syntax.operator` | `sky` | |
  | `.tok-punctuation` | `syntax.punctuation` | `overlay2` | |
  | `.tok-meta` | `syntax.meta` | `overlay1` | |
  | `.tok-heading` | `syntax.heading` | `blue` | `font-weight: bold` |
  | `.tok-link`, `.tok-url` | `syntax.link` | `rosewater` | `.tok-link` underlined |
  | `.tok-emphasis` | — | — | `font-style: italic` |
  | `.tok-strong` | — | — | `font-weight: bold` |
  | `.tok-inserted` | `change.added` (existing) | | |
  | `.tok-deleted` | `change.removed` (existing) | | |
  | `.tok-invalid` | `error` (existing) | | |

  `tok-labelName` and `tok-local` stay unstyled (they take the text colour). `codemirror-highlighter.ts` imports
  `./syntax.css`, so the rules load with the adapter and apply to the document editor (task 05) and rendered code
  alike. A user theme without the new tokens fails to load with `token "syntax.keyword" is missing` and falls back to
  Catppuccin Mocha, as any theme missing a token does today (`theme-loader.ts`); no loader change.
- **Document render** (design.md § Docs browser, Links; plan.md Decisions, Rendered doc). A second `MarkdownIt`
  instance, built beside the block one with the same wigley blocks (`:::changes`, `:::tree`, `:::details`), table
  alignment classes and `diff` fence, differs only here:
  - Options `{ html: false, linkify: false }`; `link`, `image`, `autolink` and `reference` stay enabled. Raw HTML
    stays escaped; a bare URL stays text.
  - **Links**: every link renders `<a class="md-link" href="#" data-href="…" title="…">`. `data-href` holds
    markdown-it's normalized href (percent-encoded: `<my doc.md>` → `my%20doc.md`), HTML-escaped; the docs view
    decodes it with `decodeURI`. `title` is the link's own title when it has one, else the same href. `href="#"`
    keeps the anchor focusable for Tab and Enter (design.md: "Links are real anchors") while a click the view does
    not intercept moves only the page's hash, never the window off the app. markdown-it's own `validateLink` stays:
    a `javascript:`, `vbscript:`, `file:` or `data:` link (other than `data:image/gif|png|jpeg|webp`) renders as its
    source text.
  - **Headings** render as real heading elements, `<h1>`–`<h6>`, carrying `data-anchor="<slug>"` and no `id`:
    Docs mode and every session's Docs tab render documents into one page, so an `id` would repeat; the view looks
    a fragment up with `[data-anchor="…"]` inside its own pane (task 07). Slug rule (GitHub's, which agent docs'
    `#heading` links are written for): the heading's plain text (the `text` and `code_inline` contents of its inline
    children, joined), lowercased, every character that is not a Unicode letter, mark, number, space, `_` or `-`
    removed (`/[^\p{L}\p{M}\p{N}\s_-]/gu`), then each whitespace character replaced by `-` (no collapsing:
    `Plan A — layout` → `plan-a--layout`). A slug already used earlier in the same document gets `-1`, then `-2`, … .
    Lookups compare the fragment, percent-decoded, to `data-anchor` exactly.
  - **Images** render their alt text as plain text, escaped: `<span class="md-image">alt</span>`
    (design.md: "Images show their alt text").
  - **Fenced code**: a fence whose info string's first word is `diff` keeps the existing `md-diff` rendering. Any
    other fence with a language word renders `<pre><code class="language-<word>"><highlighted HTML></code></pre>\n`
    when the highlighter knows the word, else markdown-it's plain escaped fence (unchanged from `block`). A fence
    with no language renders plain and calls no highlighter.
  - **Source lines** (plan.md: "`i` … swaps to the document editor at the top visible line"): every block token
    whose `map` is set and whose `nesting` is 1 or 0 (an open tag, a fence, an `hr`), at any depth, renders
    `data-source-line="<map[0] + 1>"` on its tag: 1-based, counted in the text passed to `document`. List items
    carry their own line, so a follow-up item opens at its own line (plan.md: "Follow-up items open at their
    `line`"). The docs view adds the frontmatter's line count and takes the last element carrying
    the attribute whose top is at or above the scroll position (task 07's `topVisibleLine`). The wigley blocks' tokens have no `map` and carry none. A fence's attribute sits on its `<pre>`, so the document instance's `fence` rule writes the
    `<pre>` itself for every fence, `diff` included.
  - `block` and `inline` are unchanged: forms keep literal links (design.md § Core services and seams, Markdown).
- **Approach** (the highlighter is async, markdown-it's `highlight` option is not): `document` parses with
  `md.parse(text, env)`, awaits the highlighter once for each `fence` token that needs it (fences inside
  `:::details` are in the same flat token list), keeps each result with its token, then renders the tokens with
  `md.renderer.render`; the document instance's `fence` rule reads the kept result. The slug counter lives in the
  per-render `env`.
- **Wiring**: `renderer.ts` builds `createCodeMirrorHighlighter()` once and passes it to
  `createMarkdownItRenderer`. `PageServices` is unchanged here.
- `markdown.ts`'s comment becomes: block and inline show raw HTML and links as literal text; `document` renders a
  whole doc with links as anchors, heading anchors and highlighted fences, raw HTML still escaped.

GIVEN `[guide](docs/a.md#L3)` WHEN `document` renders it THEN the anchor carries `data-href="docs/a.md#L3"` and
`href="#"`
GIVEN `## Plan A — layout` WHEN `document` renders it THEN the heading is
`<h2 data-anchor="plan-a--layout" data-source-line="1">`
GIVEN a `ts` fence WHEN `document` renders it THEN its code is the highlighter's HTML inside
`<pre><code class="language-ts">`
GIVEN a `zzz` fence WHEN `document` renders it THEN its code is plain escaped text
GIVEN a link WHEN `block` renders it THEN it stays literal text (existing tests)
GIVEN the TypeScript `const a = 1;` WHEN `highlight` runs with `typescript` THEN `const` sits in a `tok-keyword` span

Tests:

`src/renderer/codemirror-vim/languages.test.ts`:
- `finds a language by file name` — `SKILL.md` → `Markdown`; `/x/settings.local.json` → `JSON`; `config.toml` →
  `TOML`; `a.yml` → `YAML`; `notes.xyz` → `null` (assert `?.name`).
- `finds a language by name or alias, ignoring case` — `TS` → `TypeScript`; `bash` → `Shell`; `nosuchlang` → `null`;
  `''` → `null`.

`src/renderer/codemirror-vim/codemirror-highlighter.test.ts` (runs the real parsers; Vitest's node environment):
- `marks keywords and numbers` — `highlight('const a = 1;', 'typescript')` contains
  `<span class="tok-keyword">const</span>` and `<span class="tok-number">1</span>`; `ts` gives the same string.
- `escapes the code` — `highlight('a < b && "<x>"', 'js')` contains `&lt;` and `&amp;&amp;` and not `<x>`.
- `keeps line breaks` — `highlight('a\nb', 'js')` contains `\n`.
- `returns null for an unknown language` — `highlight('x', 'nosuchlang')` is `null`.
- `highlights a stream language` — `highlight('key = "v"', 'toml')` contains `tok-string`.
- `highlights a markdown heading` — `highlight('# Title', 'markdown')` contains `tok-heading` and `Title`.

`src/renderer/markdown-it/markdown-it-renderer.test.ts` — the module's renderer is now
`createMarkdownItRenderer(stub)`, where the stub records each `(code, language)` call and returns
`<span class="tok-keyword">${code}</span>` for `ts`, `null` otherwise. New `describe('document()')` cases, each the
exact output:
- `renders a link as an anchor the view intercepts` — `[guide](docs/a.md#L3)` →
  `<p data-source-line="1"><a class="md-link" href="#" data-href="docs/a.md#L3" title="docs/a.md#L3">guide</a></p>\n`.
- `uses the link's own title` — `[x](https://e.com "Home")` contains `title="Home"`.
- `percent-encodes a spaced path` — `[a](<my doc.md>)` contains `data-href="my%20doc.md"`.
- `renders an autolink` — `<https://example.com>` contains `data-href="https://example.com"`.
- `keeps a javascript link and a bare URL as text` — `[x](javascript:alert(1))` and `see https://e.com` contain no
  `<a`.
- `renders an image as its alt text` — `![a diagram](pic.png)` →
  `<p data-source-line="1"><span class="md-image">a diagram</span></p>\n`.
- `gives headings anchors by the slug rule` — `## Core services & seams` →
  `<h2 data-anchor="core-services--seams" data-source-line="1">Core services &amp; seams</h2>\n`; `# Use \`npm test\`` has
  `data-anchor="use-npm-test"`; `## Plan A — layout` has `data-anchor="plan-a--layout"`; `## Café` has
  `data-anchor="café"`.
- `numbers a repeated slug` — `# A\n\n# A` holds `data-anchor="a"` then `data-anchor="a-1"`.
- `highlights a known fence` — ```` ```ts\nconst\n``` ```` →
  `<pre data-source-line="1"><code class="language-ts"><span class="tok-keyword">const\n</span></code></pre>\n`.
- `renders an unknown fence plain` — ```` ```zzz\nx < y\n``` ```` →
  `<pre data-source-line="1"><code class="language-zzz">x &lt; y\n</code></pre>\n`.
- `skips the highlighter for a fence with no language` — ```` ```\na\n``` ```` → `<pre data-source-line="1"><code>a\n</code></pre>\n`;
  the stub recorded no call.
- `keeps the diff fence` — the existing diff case's input gives the same output through `document`, with
  `data-source-line="1"` on its `<pre class="md-diff">`.
- `escapes raw HTML` — `<script>alert(1)</script>` contains `&lt;script&gt;` and not `<script>`.
- `renders a table` — a two-column table contains `<table>` and `<td>one</td>`.
- `marks blocks and list items with their source line` — `# T\n\npara\n\n- a\n- b` contains
  `<h1 data-anchor="t" data-source-line="1">`, `<p data-source-line="3">`, `<ul data-source-line="5">`,
  `<li data-source-line="5">` and `<li data-source-line="6">`.
Every existing `block` and `inline` test stays as it is and passes.

The theme gate: `theme-loader.test.ts` already loads the shipped `catppuccin-mocha.json` through the loader, which
fails on a missing token, so the JSON's sixteen new entries are proved there with no new test.

Done when: `npm run typecheck` and `npm test` pass; `npm run lint` passes with 01's `LAYERS` entries in the tree; the
existing self-test passes (forms render through `block` and `inline` unchanged). How highlighted code and links look
in the docs view is checked in [11-final-verification.md](11-final-verification.md).

Commit: one commit for the group — `Markdown document render with anchored links, heading anchors and highlighted
fences; CodeMirror code highlighter and syntax theme tokens`

## Proof

