# 03 — Style check in lint

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `scripts/style-rules.mts` · test `scripts/style-rules.test.mts` · create `scripts/check-styles.mts` · modify `package.json` · modify `vitest.config.mts` · modify `tsconfig.json` · modify `src/renderer/shell/shell.css` (and every other file under `src/renderer/shell/` or `src/shared/page/ui/` the script fails when this task starts — plan A's files, never 04's or 05's)
Consumes:  `.material-chrome`, `.material-chrome--dense`, `.material-floating` in `src/shared/page/ui/materials.css` ← 01 · the tokens `space-*`, `radius-*`, `statusbar-height`, `activitybar-width`, `sidebar-width`, `indicator-width`, `z-floating`, `z-toast` ← plan A task 01
Produces:  `export type StyleRule = 'raw-colour' | 'raw-length' | 'raw-duration' | 'font-stack' | 'backdrop-filter'` · `export interface StyleViolation { line: number; rule: StyleRule; text: string }` · `export function cssViolations(css: string, allowsBackdropFilter: boolean): StyleViolation[]` · `export function inlineStyleViolations(fileName: string, source: string): StyleViolation[]` · `export function legacyListProblems(list: readonly string[], filesInSrc: ReadonlySet<string>, filesWithViolations: ReadonlySet<string>): { failures: string[]; notes: string[] }` · `export function parseStyleArguments(args: readonly string[], filesInSrc: ReadonlySet<string>): { ignoreLegacy: boolean; paths: string[]; failures: string[] }` in `scripts/style-rules.mts` · `const LEGACY_FILES: string[]` and the `--no-legacy [<path>…]` flag in `scripts/check-styles.mts`
Decisions: the rules live in a pure module `scripts/style-rules.mts` and `check-styles.mts` only walks files, hands the results to `legacyListProblems` and `parseStyleArguments` and prints their output, so the rules, the legacy judgement and the argument reading are tested without running the walk (drafter) · vitest's `include` gains `'scripts/**/*.test.mts'` (today it holds only `src/**/*.test.ts`, so nothing in `scripts/` is tested) · `tsconfig.json` gains `"noEmit": true` and `"allowImportingTsExtensions": true`, since Node's type stripping needs the `./style-rules.mts` extension and `tsc` rejects it without the flag (drafter; `tsc` is only ever run with `--noEmit`) · both scripts use only erasable TypeScript (no `enum`, no parameter properties), as Node 24 strips types without transforming · inline styles are found with the TypeScript AST, as `check-layers.mts` uses `typescript` · viewport units (`vh`, `vw`, `dvh`, `svh`, `lvh`, `vmin`, `vmax`) pass like percentages (drafter: they name no design value, and `height: 100vh` has no token) · a `calc()` or `min()` mixing tokens with unitless numbers passes, since only a number with a unit is judged (`calc(var(--wg-space-8) * 8)` passes) · a font stack is a comma in a `font-family` or `font` value, so a single family (`codicon`) passes (drafter) · `setProperty` is judged only when its first argument is a string literal not starting with `--`: a custom property written from code is a published runtime value (`--wg-status-bar-height`) or the theme being applied, never an authored one (drafter) · the theme JSON is never read: the script reads `*.css`, `*.ts` and `*.js` under `src/` only, skipping `*.test.ts` · `src/renderer/shell/` and `src/shared/page/ui/` are fixed in this task, never listed (plan.md); 04 and 05 create files in `src/shared/page/ui/` in this wave, so this task fixes only the files there when it starts · plan C rebuilds the listed files in parallel tasks, so none of them edits the list: `--no-legacy` ignores `LEGACY_FILES` and, given paths, judges only those files (none: every file), a listed file that passes prints a note rather than failing, and plan C's final task deletes the list (plan.md) · `CodeMirror`'s `EditorView.theme({…})` objects are not inline style writes and are not checked (drafter: out of `DESIGN.md` § Checks' scope)
GIVEN a CSS declaration `padding: 0.5rem 0.9rem` on line 3 WHEN `cssViolations` runs THEN it reports `raw-length` twice, on line 3
GIVEN `0`, `1px`, `-1px`, `50%`, `1fr`, `100vh` and `calc(var(--wg-space-2) * 2)` WHEN judged THEN nothing is reported
GIVEN `@media (max-width: 800px) { .a { color: var(--wg-fg); } }` WHEN judged THEN nothing is reported
GIVEN `backdrop-filter` outside materials WHEN judged THEN `backdrop-filter` is reported
GIVEN a legacy file that passes every rule WHEN the script runs THEN it prints a note naming the file and still exits 0
GIVEN `--no-legacy` and a legacy file with a violation WHEN the script runs THEN it prints the violation and exits 1
GIVEN `--no-legacy src/plugins/docs/page/docs.css` WHEN the script runs THEN it judges only that file, ignores the list, and exits 1 only on that file's violations
GIVEN `--no-legacy src/nope.css` or `--no-legacy README.md` WHEN the script runs THEN it prints the path's pinned message and exits 1
Tests:     see the table under **Tests**
Done when: compiles; `npm run typecheck` passes; `npm test` passes, the tests below among them; `npm run lint` runs `node scripts/check-styles.mts` and passes, printing `styles: <n> files clean, <m> on the legacy list`; `node scripts/check-styles.mts --no-legacy` prints the legacy files' violations and exits 1 while the list's files still hold raw values, and `node scripts/check-styles.mts --no-legacy src/plugins/docs/page/docs.css` prints only that file's violations and exits 1; no `LEGACY_FILES` entry starts with `src/shared/page/ui/`, `src/plugins/gallery/` or `src/renderer/shell/`
Commit:    one commit for the group

## The rules — `scripts/style-rules.mts`

**CSS reading.** Before matching: replace every comment `/* … */` with spaces, keeping its
newlines, so line numbers hold; empty every quoted string (`"…"`, `'…'`) and every `url(…)`
argument. A declaration is a match of `/([-\w]+)\s*:\s*([^;{}]+?)\s*(?=[;}])/g`: a selector or an
`@media` prelude ends in `{`, so it never matches, and lengths in a media query are never judged.
A declaration's line is 1 + the newlines before its value. Inside a value, every custom property
name (`--[\w-]+`) is replaced with `--x` before the number rules run, so `var(--wg-text-13)` holds
no number.

| Rule | Reported when | Allowed |
|---|---|---|
| `raw-colour` | `#[0-9a-fA-F]{3,8}\b`; a call `\b(rgba?\|hsla?\|hwb\|lab\|lch\|oklab\|oklch\|color)\(` (case-insensitive; `color-mix(` is not one); a CSS named colour (the 148 names of CSS Color 4, case-insensitive, as a whole word) in a property matching `^(color\|background(-color)?\|border(-(top\|right\|bottom\|left\|block\|inline)(-(start\|end))?)?(-color)?\|outline(-color)?\|(box\|text)-shadow\|text-decoration(-color)?\|caret-color\|accent-color\|fill\|stroke\|column-rule(-color)?\|scrollbar-color\|--.*)$` | `transparent`, `currentColor`, `inherit` (none is a named colour) |
| `raw-length` | `(?<![\w.#-])-?(\d*\.)?\d+(px\|rem\|em\|ex\|ch\|ic\|lh\|rlh\|cap\|pt\|pc\|cm\|mm\|q\|in)\b` (case-insensitive), hex colours removed first | a zero (`0`, `0px`, `0.0rem`), `1px`, `-1px`; `%`, `fr` and viewport units are not in the unit list |
| `raw-duration` | `(?<![\w.#-])-?(\d*\.)?\d+(ms\|s)\b` | a zero |
| `font-stack` | property `font-family` or `font` whose value holds a `,` | one family, `var(--wg-…)`, `inherit` |
| `backdrop-filter` | property `backdrop-filter` or `-webkit-backdrop-filter`, unless `allowsBackdropFilter` | — |

A violation's `text` is `` `${match} in ${property}: ${value}` `` (the value trimmed, as written
after comment removal), and for `font-stack` and `backdrop-filter` `match` is the property.
Violations are listed in source order.

**Inline styles** (`inlineStyleViolations`): `ts.createSourceFile(fileName, source, …, true)` and
a walk of every node. Judged writes:

| Write | Judged as |
|---|---|
| `<x>.style.<prop> = <value>` | the declaration `<prop in kebab-case>: <value>` (`paddingLeft` → `padding-left`); `<x>.style.cssText = <value>` is a declaration list, as below |
| `<x>.style.setProperty(<name>, <value>)` | the declaration `<name>: <value>`, only when `<name>` is a string literal not starting with `--` |
| `<x>.setAttribute('style', <value>)`, `<x>.style = <value>` | a declaration list (`a: b; c: d`), read with `;` appended so its last declaration matches |

`<value>`'s text: a string literal or a template with no substitutions gives its text; a template
with substitutions gives its literal parts joined by `9` (`` `${depth}rem` `` → `9rem`, reported;
`` `${n}px` `` → `9px`, reported; `` `${n}%` `` → `9%`, passes); any other expression is not
judged. Inline `backdrop-filter` is always reported. The line is the value node's line, 1-based.

## The script — `scripts/check-styles.mts`

Shaped like `check-layers.mts`: top-level code over
`readdirSync('src', { recursive: true, encoding: 'utf8' })`, `.css` files through `cssViolations`
(`allowsBackdropFilter` only for `src/shared/page/ui/materials.css`), `.ts` and `.js` files but
`*.test.ts` through `inlineStyleViolations`. It imports `./style-rules.mts`.

- A violation prints `` `${file}:${line} ${rule}: ${text}` `` to stderr, `file` repo-relative
  (`src/plugins/docs/page/docs.css:12 raw-length: 0.5rem in padding: 0.5rem 0.9rem`).
- `LEGACY_FILES` is skipped for violations in a plain run, but each entry is checked by the pure
  `legacyListProblems(list, filesInSrc, filesWithViolations)` in `style-rules.mts` (the script passes
  the repo-relative files it found under `src/` and the files that hold a violation, and prints
  `failures` to stderr and `notes` to stdout). Each entry yields at most one message, the first of:
  - one under `src/shared/page/ui/`, `src/plugins/gallery/` or `src/renderer/shell/` gives the failure
    `` `${file}: may not be on the legacy list; fix it instead` ``
  - one not in `filesInSrc` gives the failure `` `${file}: on the legacy list but not in src; remove it from the legacy list` ``
  - one in `filesInSrc` and not in `filesWithViolations` gives the note
    `` `${file}: on the legacy list but passes every rule` `` — not a failure (plan C's parallel
    tasks rebuild listed files without editing the list)
- `--no-legacy [<path>…]` (read from `process.argv.slice(2)` by the pure `parseStyleArguments(args,
  filesInSrc)`, which returns the flag, the paths and the failure lines): `LEGACY_FILES` is ignored
  and no list entry is checked or noted. With no paths every file is judged. With paths only those
  files are judged, repo-relative (`src/plugins/docs/page/docs.css`), and the exit is 1 only on their
  violations. A path not starting `src/` gives the failure `` `check-styles: ${arg} is not under src/` ``;
  one under `src/` that the walk did not find (missing, or not a `.css`, `.ts` or `.js` file, or a
  `*.test.ts`) gives `` `check-styles: ${arg} is not a checked file in src` ``; any other argument —
  an unknown flag, or a path with no `--no-legacy` — gives `` `check-styles: unknown argument ${arg}` ``;
  each failure exits 1. Plan C's surface tasks run it with their own rebuilt files' paths to prove
  them clean.
- Any violation or failure line (stderr) exits 1; otherwise it prints
  `` `styles: ${clean} files clean, ${LEGACY_FILES.length} on the legacy list` ``, or under
  `--no-legacy` `` `styles: ${clean} files clean, legacy list ignored` `` (`clean` counts the files judged).
- A comment above `LEGACY_FILES` says: files plan C rebuilds; plan C's surface tasks leave the list
  alone and prove their files with `--no-legacy`; a listed file that passes prints a note; plan C's
  final task deletes the list.

`package.json`: `lint` becomes `node scripts/check-layers.mts && node scripts/check-styles.mts &&
oxlint && oxfmt --check`; `lint:fix` gains ` && node scripts/check-styles.mts` at its end.

## The legacy list

Measured at plan time by reasoning over today's files, re-verify: run the script with an empty
list and put every failing file on it, except the three folders above, which are fixed instead.
Expected after plan A and task 01 (each holds raw `rem`/`em` lengths today, and plan A's token
rename leaves lengths alone):

`src/plugins/chat/page/chat.css` · `src/plugins/docs/page/docs.css` ·
`src/plugins/forms/page/forms.css` · `src/plugins/keys/page/keys.css` ·
`src/plugins/sessions/page/sessions.css` · `src/shared/page/dialog.css` ·
`src/shared/page/markdown.css` · `src/plugins/docs/page/tree-view.ts`
(`` item.style.paddingLeft = `${row.depth}rem` ``)

`src/renderer/index.css` passes after task 01; `src/renderer/codemirror-vim/syntax.css` is gone
(plan A). A file plan A added outside the three folders that fails goes on the list too, and the
report names it.

## Fixing `src/renderer/shell/` and `src/shared/page/ui/`

Each raw value becomes the token of its role. Today's `shell.css` values (re-read after plan A,
whose tasks 04 and 06 rewrite this file; a value plan A already replaced needs nothing):

| Rule · property | Today | After |
|---|---|---|
| `.shell-activity-bar` · `width` | `3rem` | `var(--wg-activitybar-width)` |
| `.shell-side-bar` · `width` | `16rem` | `var(--wg-sidebar-width)` |
| `.status-error` · `padding` | `0.2rem 0.25rem 0.2rem 0.75rem` | `var(--wg-space-0_5) var(--wg-space-1) var(--wg-space-0_5) var(--wg-space-3)` |
| `.shell-overlay` · `z-index` | `10` | `var(--wg-z-floating)` |
| `.toasts` · `bottom` | `2.5rem` | `calc(var(--wg-statusbar-height) + var(--wg-space-4))` |
| `.toasts` · `gap` / `right` | `0.5rem` / `1rem` | `var(--wg-space-2)` / `var(--wg-space-4)` |
| `.toasts` · `z-index` | `20` | `var(--wg-z-toast)` |
| `.toast` · `border-left` width | `3px` | `var(--wg-indicator-width)` |
| `.toast` · `border-radius` | `0.5rem` | `var(--wg-radius-lg)` (L3 floating) |
| `.toast` · `max-width` | `min(24rem, calc(100vw - 2rem))` | `min(calc(var(--wg-space-8) * 12), calc(100vw - var(--wg-space-8)))` |
| `.toast` · `padding` | `0.5rem 0.9rem` | `var(--wg-space-2) var(--wg-space-3)` |

A value not in the table: a size with a role token (`toolbar-height`, `statusbar-height`,
`activitybar-width`, `sidebar-width`, `icon-button`, `icon-size`, `row-*`, `tab-height`, `radius-*`) takes it;
otherwise its px value (1rem = 16px) as a `space-*` step, or as `calc(var(--wg-space-N) * k)` when
that equals it exactly, else the nearest `space-*` step. A raw colour or font stack there is a
token plan A missed: stop and report it, since a new token is a `DESIGN.md` change.

## Tests — `scripts/style-rules.test.mts`

Each builds its own CSS or TS text.

| Test | Input | Asserts |
|---|---|---|
| `cssViolations_RemPadding_ReportsEachLength` | `.a {\n  color: var(--wg-fg);\n  padding: 0.5rem 0.9rem;\n}` | `[{ line: 3, rule: 'raw-length', text: '0.5rem in padding: 0.5rem 0.9rem' }, { line: 3, rule: 'raw-length', text: '0.9rem in padding: 0.5rem 0.9rem' }]` |
| `cssViolations_AllowedValues_ReportsNothing` | `.a { margin: 0; border: 1px solid var(--wg-border-subtle); top: -1px; width: 50%; grid-template-columns: 1fr auto; height: 100vh; gap: calc(var(--wg-space-2) * 2); }` | `[]` |
| `cssViolations_TokenNameWithDigits_ReportsNothing` | `.a { font-size: var(--wg-text-13); padding: var(--wg-space-0_5); }` | `[]` |
| `cssViolations_MediaQueryLength_ReportsNothing` | `@media (max-width: 800px) { .a { color: var(--wg-fg); } }` | `[]` |
| `cssViolations_HexInIdSelector_ReportsNothing` | `#add { color: var(--wg-fg); }` | `[]` |
| `cssViolations_RawColours_ReportsEach` | `.a { color: #fff; background: rgb(0 0 0 / 0.5); border-color: red; }` | three `raw-colour` violations whose `text` starts `#fff`, `rgb(`, `red` |
| `cssViolations_NamedColourWordOutsideColourProperty_ReportsNothing` | `.a { grid-area: tan; }` | `[]` |
| `cssViolations_ColorMixOfTokens_ReportsNothing` | `.a { color: color-mix(in srgb, var(--wg-fg) 50%, transparent); }` | `[]` |
| `cssViolations_RawDuration_Reports` | `.a { transition: opacity 120ms ease; }` | one `raw-duration`, `text` `120ms in transition: opacity 120ms ease` |
| `cssViolations_ZeroDuration_ReportsNothing` | `.a { transition-delay: 0s; }` | `[]` |
| `cssViolations_FontStack_Reports` | `.a { font-family: "Inter", sans-serif; }` | one `font-stack`, line 1 |
| `cssViolations_SingleFamilyOrToken_ReportsNothing` | `.a { font-family: codicon; } .b { font-family: var(--wg-font-mono); }` | `[]` |
| `cssViolations_BackdropFilterNotAllowed_Reports` | `.a { backdrop-filter: var(--wg-material-chrome-filter); }`, `false` | one `backdrop-filter` |
| `cssViolations_BackdropFilterAllowed_ReportsNothing` | the same, `true` | `[]` |
| `cssViolations_CommentHoldsRawValue_ReportsNothing` | `/* 12px gutters */\n.a { margin: 0; }` | `[]` |
| `cssViolations_LineAfterMultiLineComment_CountsLines` | `/* a\nb */\n.a {\n  gap: 4px;\n}` | one `raw-length` on line 4 |
| `inlineStyleViolations_TemplateRemLength_Reports` | `` el.style.paddingLeft = `${depth}rem`; `` | one `raw-length` on line 1, `text` `9rem in padding-left: 9rem` |
| `inlineStyleViolations_TemplatePercent_ReportsNothing` | `` el.style.width = `${share}%`; `` | `[]` |
| `inlineStyleViolations_CustomPropertySetProperty_ReportsNothing` | `` root.style.setProperty('--wg-status-bar-height', `${h}px`); `` | `[]` |
| `inlineStyleViolations_StandardPropertySetProperty_Reports` | `el.style.setProperty('margin-top', '4px');` | one `raw-length` |
| `inlineStyleViolations_CssText_ReportsEach` | `el.style.cssText = 'color: #000; gap: 8px';` | one `raw-colour` and one `raw-length` |
| `inlineStyleViolations_NonLiteralValue_ReportsNothing` | `el.style.width = widthOf(row);` | `[]` |
| `legacyListProblems_ForbiddenFolder_Fails` | list `['src/shared/page/ui/row.css']`, that file in `filesInSrc` | `failures` is `['src/shared/page/ui/row.css: may not be on the legacy list; fix it instead']`, `notes` `[]` |
| `legacyListProblems_MissingFile_Fails` | list `['src/plugins/gone/page/gone.css']`, `filesInSrc` empty | `failures` is `['src/plugins/gone/page/gone.css: on the legacy list but not in src; remove it from the legacy list']` |
| `legacyListProblems_ListedFileThatPasses_Notes` | list `['src/plugins/docs/page/docs.css']`, the file in `filesInSrc`, `filesWithViolations` empty | `failures` `[]`, `notes` is `['src/plugins/docs/page/docs.css: on the legacy list but passes every rule']`; with the file in `filesWithViolations` both are `[]` |
| `parseStyleArguments_NoLegacyWithPaths_KeepsThePaths` | `['--no-legacy', 'src/a.css']`, `filesInSrc` holding it | `{ ignoreLegacy: true, paths: ['src/a.css'], failures: [] }` |
| `parseStyleArguments_NoLegacyAlone_JudgesEveryFile` | `['--no-legacy']` | `{ ignoreLegacy: true, paths: [], failures: [] }` |
| `parseStyleArguments_PathOutsideSrcOrMissing_Fails` | `['--no-legacy', 'README.md', 'src/nope.css']` | `failures` is `['check-styles: README.md is not under src/', 'check-styles: src/nope.css is not a checked file in src']` |
| `parseStyleArguments_PathWithoutFlagOrUnknownFlag_Fails` | `['src/a.css']`, then `['--verbose']` | `failures` is `['check-styles: unknown argument src/a.css']`, then `['check-styles: unknown argument --verbose']` |

## Live checks for task 08

None: the script runs in `npm run lint`. The shell's look after the token swap is part of task
08's gallery and mode screenshots (expected: the status bar, side bar and toasts keep their places;
sizes move to the token steps).

## Proof

Commit `1fd6472` · diff read: every Produces present (`StyleRule`, `StyleViolation`,
`cssViolations`, `inlineStyleViolations`, `legacyListProblems`, `parseStyleArguments`,
`LEGACY_FILES`, `--no-legacy`) · lead: typecheck and `npm run lint` pass (`styles: 269 files clean,
8 on the legacy list`); `--no-legacy` over all 37 files in `src/shared/page/ui/` clean (04 and 05
proved under it) · worker: test 1868 pass (29 new). `LEGACY_FILES` is exactly the expected eight.
Concerns: none open; AGENTS.md's lint line is task 07's.
