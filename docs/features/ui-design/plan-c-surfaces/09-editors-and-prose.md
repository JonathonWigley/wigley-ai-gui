# 09 — Editors, markdown prose, active-line band, log view

Status: not started
Type: Task
Wave: 1 · Depends on: none (plans A and B closed)
Plan: [plan.md](plan.md)

Files:     modify `src/renderer/codemirror-vim/editor-theme.ts` · modify `src/renderer/codemirror-vim/codemirror-vim-host.ts` ·
           modify `src/shared/page/markdown.css` · modify `src/config/theme-tokens.ts` ·
           modify `src/config/themes/catppuccin-mocha.json` ·
           test: every `*.test.ts` that lists the core tokens by hand (find with `grep -rln "'line-number-active'" src --include='*.test.ts'`)
Consumes:  `editorTheme` on token names, written as literal `'var(--wg-<name>)'` strings ← plan A task 01 ·
           `coreThemeTokens: Readonly<Record<string, TokenKind>>` in `src/config/theme-tokens.ts` ← plan A ·
           `markdown.css` on the new token names ← plan A task 06 ·
           `.ui-input .cm-editor` with no outline while focused (the focused box's ring is its frame) ← plan B ·
           the tokens `text-14`, `text-mono`, `leading-prose`, `prose-measure`, `block-background`, `radius-sm`,
           `radius-md`, `fg-link`, `focus-border`, `line-number`, `line-number-active`, `material-floating-*` ← plan A ·
           `node scripts/check-styles.mts --no-legacy`: checks every file, ignoring LEGACY_FILES ← plan B task 03
Produces:  the core token `editor-active-line` (kind `color`) in `src/config/theme-tokens.ts`, Mocha `"surface0 / 0.4"`
Decisions: see **Decisions** below
GIVEN the document editor focused WHEN the cursor sits on a line THEN that line carries the band and its number `line-number-active`
GIVEN the document editor not focused THEN no band shows and every line number is `line-number`
GIVEN a text box (not the document editor) WHEN focused THEN no band shows
Tests:     none new: the band and the theme are judged on screen; the token joins the hand-written token lists so
           those tests keep building a complete theme
Done when: compiles; `npm run typecheck`, `npm run lint`, `npm test` and `npm run selftest` pass;
           `node scripts/check-styles.mts --no-legacy 2>&1 | grep 'src/shared/page/markdown.css'` prints nothing;
           `grep -nE "[0-9.]+(px|em|rem)" src/renderer/codemirror-vim/editor-theme.ts` prints only lines whose value
           is `1px`; plan A task 06's registry check prints nothing; this task's live checks are in
           [12 — Final verification](12-final-verification.md)
Commit:    one commit

## Decisions

- **The active-line band** — the follow-up "An active-line band in the editors." (`docs/features/followups.md`
  before `e1f6b73`), pulled into this plan by the user — is pinned as:
  - it shows in the document editor (`createDocument`: docs' editor) only, not in text boxes: a box is a framed
    prose input whose focused frame already marks it, and a band filling a one-line box reads as a second focus
    fill (drafter)
  - it shows only while that editor is focused, so an editor the keys are not in stays calm (DESIGN.md
    § Intent: take the quieter choice) (drafter)
  - it spans the whole line width, in every vim mode, on each line holding a cursor (CodeMirror's
    `highlightActiveLine`), and the gutter's number on that line turns `line-number-active`
    (`highlightActiveLineGutter`)
  - its colour is a new token, `editor-active-line`: today's `editor.activeLine` went with no successor (plan A
    task 01), and no role fits (DESIGN.md § Tokens: a one-off value is a token not yet named). Mocha
    `"surface0 / 0.4"`, translucent so the selection beneath it still shows (drafter)
- **Host.** `documentExtensions` in `codemirror-vim-host.ts` gains `highlightActiveLine()` and
  `highlightActiveLineGutter()` from `@codemirror/view`, after `lineNumbers()`; `boxExtensions` gains nothing.
- **Theme.** `editorTheme` keys, after plan A's renames; every length on a token, every colour already on one:

  | Selector | Now | After |
  |---|---|---|
  | `'&'` | `fontSize` the mono size | `fontSize: 'var(--wg-text-mono)'` (unchanged if plan A wrote it) |
  | `'&.cm-focused'` | `outline: 1px solid` focus border | `outline: 'none'`: a box's ring is its `inputFrame` (plan B; every box sits in one once 02 in wave 1 and 04, 06, 08 in wave 2 land, so a box not yet framed shows no ring for one wave) |
  | `'&.wg-document-editor.cm-focused::after'` | — | `content: '""'`, `position: 'absolute'`, `inset: '0'`, `pointerEvents: 'none'`, `zIndex: '300'`, `borderRadius: 'inherit'`, `outline: '1px solid var(--wg-focus-border)'`, `outlineOffset: '-1px'` (the one inset 1px focus ring, drawn on an overlay frame, matching the global `:focus-visible` outline; see below) |
  | `'.cm-lineNumbers .cm-gutterElement'` | `padding: '0 0.75em 0 0.5em'` | `padding: '0 var(--wg-space-3) 0 var(--wg-space-2)'` |
  | `'.cm-activeLine'` | — | `backgroundColor: 'transparent'` (CodeMirror's base theme gives it a tint) |
  | `'&.cm-focused .cm-activeLine'` | — | `backgroundColor: 'var(--wg-editor-active-line)'` |
  | `'.cm-activeLineGutter'` | — | `backgroundColor: 'transparent'` |
  | `'&.cm-focused .cm-activeLineGutter'` | — | `color: 'var(--wg-line-number-active)'` |
  | `'.cm-tooltip.cm-tooltip-autocomplete'` | `material-floating-bg`, a border | `backgroundColor: 'var(--wg-material-floating-bg)'`, `border: '1px solid var(--wg-material-floating-edge)'`, `borderRadius: 'var(--wg-radius-md)'`, `boxShadow: 'var(--wg-material-floating-shadow)'`, `fontSize: 'var(--wg-text-mono)'`, mono family kept |
  | `'.cm-tooltip.cm-tooltip-autocomplete > ul > li'` | CodeMirror's `1px 3px` | `padding: 'var(--wg-space-0_5) var(--wg-space-2)'` |
  | `'.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]'` | `list-active-background` | unchanged |

  **The document editor's ring is an overlay, not a shadow on `.cm-editor`** (decision): an inset shadow paints
  under child backgrounds, and the document editor's `.cm-gutters` (`lineNumbers()`, opaque `editor-background`,
  z-index 200) and the bottom `.cm-panels` of `vim({ status: true })` would hide it on the left and bottom
  edges. The `::after` above sits over both (`z-index: 300`, `pointer-events: none` so it takes no click) on
  `.cm-editor`, which CodeMirror's base theme already makes `position: relative`; the ring is the inset 1px
  `focus-border` outline and shows on all four edges. The gutter and panel backgrounds stay as they are.

  The completion list is L3 but carries no `backdrop-filter`: that stays in `materials.css`, and an
  `EditorView.theme` object cannot take a class (DESIGN.md § Layers). Under reduced transparency
  `material-floating-bg` turns opaque through the theme's `reduced` block.
- **Prose.** `.md` is prose wherever markdown renders (DESIGN.md § Type; the brief: rendered markdown as prose):
  `font-size: var(--wg-text-14)`, `line-height: var(--wg-leading-prose)`, `max-width: var(--wg-prose-measure)`
  (76ch, from today's `80ch`). Forms cards render markdown with `.md` too (`card-parts.ts`, `card-kit.ts`), so
  their context and reason text grows from 13px to 14px; task 04 keeps it (lead ruling: DESIGN.md prose is 14px).
- **Code.** Code blocks are solid `block-background` with `radius-md` and no border (content separates by tint,
  DESIGN.md § Space: hairlines are for L1); inline code is `block-background` with `radius-sm`. Mono text in
  prose takes `text-mono`, so the user's `fonts.monoSize` reaches it.
- **Links** (`a.md-link`, drawn by the markdown adapter, styled nowhere today) take `color: var(--wg-fg-link)`,
  `text-decoration: none`, underlined on `:hover`; `.md-image` (an image's alt text) takes `color:
  var(--wg-fg-tertiary)` (drafter: both read browser defaults today).
- **`log-view.ts` does not change.** It writes into `ol#log`, which `index.html` keeps `hidden`; the self-test reads
  it and nothing draws it, so no style applies (tree).
- **`index.css` does not change here.** Plan B task 01 left it on tokens; its one leftover, the global `kbd` rule,
  styles the raw `<kbd>` hints that 01, 04 and 06 replace in wave 2, so task 10 deletes it with `dialog.css`.

## `markdown.css` after this task

Each raw value becomes the token below; a rule not listed keeps its declarations.

| Selector | Property | Now | After |
|---|---|---|---|
| `.md` | `max-width` | `80ch` | `var(--wg-prose-measure)`; add `font-size: var(--wg-text-14)`, `line-height: var(--wg-leading-prose)` |
| `.md p, ul, ol, blockquote, pre, table` | `margin` | `0.5em 0` | `var(--wg-space-2) 0` |
| `.md ul, .md ol` | `padding-left` | `1.5em` | `var(--wg-space-6)` |
| `.md-h` | `font-weight` · `margin` | `600` · `0.75em 0 0.25em` | `var(--wg-weight-semibold)` · `var(--wg-space-3) 0 var(--wg-space-1)` |
| `.md-h1, .md-h2` | `font-size` | `1.1em` | `var(--wg-text-16)` |
| `.md-h3` | `font-size` | `1em` | `var(--wg-text-14)` |
| `.md-h4, .md-h5, .md-h6` | `font-size` | `0.95em` | `var(--wg-text-13)` |
| `.md code` | `border-radius` · `font-size` · `padding` | `0.25rem` · `0.9em` · `0.05em 0.3em` | `var(--wg-radius-sm)` · `var(--wg-text-mono)` · `0 var(--wg-space-1)` |
| `.md pre` | `border` · `border-radius` · `padding` | `1px solid …` · `0.4rem` · `0.6em 0.8em` | none · `var(--wg-radius-md)` · `var(--wg-space-2) var(--wg-space-3)` |
| `.md blockquote` | `border-left` · `padding-left` | `3px solid …` · `0.75em` | `var(--wg-indicator-width) solid var(--wg-border-default)` · `var(--wg-space-3)` |
| `.md th, .md td` | `padding` | `0.25em 0.6em` | `var(--wg-space-1) var(--wg-space-2)` |
| `.md th` | `font-weight` | `600` | `var(--wg-weight-semibold)` |
| `.md-change` | `border-left` · `margin` · `padding` | `3px solid …` · `0.2em 0` · `0.1em 0.6em` | `var(--wg-indicator-width) solid var(--wg-border-default)` · `var(--wg-space-0_5) 0` · `var(--wg-space-0_5) var(--wg-space-2)` |
| `.md-pill` | `border-radius` · `font-size` · `font-weight` · `margin-right` · `padding` | `999px` · `0.75em` · `600` · `0.5em` · `0 0.5em` | `var(--wg-radius-sm)` · `var(--wg-text-11)` · `var(--wg-weight-medium)` · `var(--wg-space-2)` · `0 var(--wg-space-1)` |
| `.md-tree ul` | `padding-left` | `1.25em` | `var(--wg-space-4)` |
| `.md-tree ul > li::before` | `height` · `left` · `width` | `0.9em` · `-0.9em` · `0.7em` | `var(--wg-space-3)` · `calc(var(--wg-space-3) * -1)` · `var(--wg-space-2)` |
| `.md-details` | `border-radius` · `margin` · `padding` | `0.4rem` · `0.5em 0` · `0.4em 0.75em` | `var(--wg-radius-md)` · `var(--wg-space-2) 0` · `var(--wg-space-1_5) var(--wg-space-3)` |
| `.md-details > summary` | `font-weight` | `600` | `var(--wg-weight-semibold)` |
| `.md-link` (new) | | | `color: var(--wg-fg-link)`, `text-decoration: none`; `:hover` `text-decoration: underline` |
| `.md-image` (new) | | | `color: var(--wg-fg-tertiary)` |

The tree connector keeps its geometry: the `16px` indent, a `12px` arm from `-12px` to `-4px`.

## The token

- `src/config/theme-tokens.ts`: `'editor-active-line': 'color',` beside `'line-number-active'`, in the
  registry's entry form.
- Mocha: `"editor-active-line": "surface0 / 0.4"` beside `line-number-active`.
- `DESIGN.md` gains the token in task 11 (DESIGN.md is edited only there): § Colour's **Text selection, cursor**
  row names `editor-active-line`, the band in a focused document editor.
- Every test fixture that lists the core tokens by hand gains the token (find them with the grep in **Files**); a
  fixture built from `coreThemeTokens` needs nothing.

## Live checks

Merged into [12 — Final verification](12-final-verification.md) § Editors and prose.

## Proof
