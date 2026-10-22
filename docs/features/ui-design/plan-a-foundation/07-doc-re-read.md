# 07 — Doc re-read

Status: done
Type: Task
Wave: 6 · Depends on: 01, 02, 03, 04, 05, 06
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` · modify `DESIGN.md` · modify `docs/features/ui-design/design.md` · modify
           `docs/features/followups.md` (only where a line is stale) · delete
           `docs/features/ui-design/reference/tokens.css` and the `reference/` folder
Consumes:  the landed code of tasks 01–06 and each task document's **Proof** ← 01–06
Produces:  no code; one commit of doc fixes
Decisions: only lines describing what plan A lands are judged; a line describing plan B or C work stays as
           written, even when today's code does not match it yet (plan.md § Docs written ahead) · a line is
           stale when the code says otherwise, and the code wins unless the line is a decision `plan.md` or
           `design.md` records, in which case stop and report the mismatch as a code defect instead of editing
           the doc (AGENTS.md: "Where code and this file disagree, fix the code, or change this file on
           purpose") · `tokens.css` goes because Mocha now holds its values, so the theme file is the one source
           of those numbers (plan.md § Mandatory Reads) · new wording follows the docs' existing voice
           (`wigley:writing-for-agents` for `AGENTS.md`)
GIVEN a doc line on plan A's code WHEN read against the code THEN it states what the code does
Tests:     none: no logic changes. `npm run lint` still passes (it reads no doc)
Done when: every line in **Scope** was read against the code; every correction in **Known corrections** is
           made or recorded in Proof as already true; `tokens.css` and `reference/` are gone; one commit lands
           whose message lists each fix, one line each (file, section, what it now says)
Commit:    one commit

## Scope

The docs commit `e1f6b73` wrote ahead. Read each section below line by line against the code it names, with
`git diff <review base>..HEAD` (the review base is in plan.md's Run log) as the map of what landed:

| Doc | Sections on plan A's code |
|---|---|
| `AGENTS.md` | § Architecture: the layer tree (`src/config`, `src/shared/page/ui`, `src/main/config`, `src/main/themes`, `src/renderer/shell`, `codemirror-vim`'s package list), and the bullets **The shell**, **A mode**, **A key** (the layering), **A theme**, **A setting**, **The user config folder**; § Running and testing (the self-test's user config folder) |
| `DESIGN.md` | § Layers (the `transparency` setting and the `reduced` block), § Tokens and themes, § Type, § Space, size and shape (token names), § Icons and copy (Codicons, `icon-size`), § Surfaces **Title bar**, **Activity bar**, **Side bar** (the slot, not the row styling) |
| `docs/features/ui-design/design.md` | § Plans, § Theme and tokens, § Config files and hot reload, § Shell, § Primitives and the gallery (**Icon**, the `formatChord` signature), § Packages |
| `docs/features/followups.md` | the opening paragraph's list of items pulled into the rework |

Lines that stay because they describe plan B or C work, measured at plan time:

- every primitive beyond Icon, Kbd included; the gallery, `Space z g`, the self-test screenshots and the
  `screenshot` step field; `scripts/check-styles.mts`; the material helpers; `@fontsource/jetbrains-mono`
- every surface rebuild (DESIGN.md § Surfaces past the three rows above; design.md § Surfaces) and every
  change in design.md § Keys
- the Docs tree in the side bar: AGENTS.md's **A mode** bullet ("pressed while its mode already shows, the
  same command toggles the side bar") and design.md § Shell ("Docs mode puts its tree there") hold for plan
  C; in plan A `Space k d` toggles Docs' own tree (task 04)
- split widths persisting through `uiState` (plan B's Split)

## Known corrections

Each is a fact plan.md § Decided at plan time settled after the docs were written:

| Doc, section | Says now | Says after |
|---|---|---|
| `AGENTS.md`, **A theme** bullet | every token "is declared with its kind and default in the core token registry, or in a plugin manifest's `themeTokens`" | a core token is declared with its kind in the core token registry, and a theme with no `extends` sets every core token (the loader rejects one that misses any); a plugin token is declared with its kind and default in its manifest's `themeTokens` |
| `DESIGN.md`, § Tokens and themes, **Adding a token** | "declare it in the core token registry (or the plugin's `themeTokens`) with its kind and default, give Mocha its value" | a core token: declare its kind in the registry and give every built-in base theme (Mocha) its value; a plugin token: declare its kind and default in the plugin's `themeTokens` |
| `DESIGN.md`, § Tokens and themes, the plugin-tokens bullet | "declared in its manifest's `themeTokens` with defaults" | unchanged (still true); confirm only |
| `DESIGN.md`, § Type | the scale lists `text-11` … `text-20`; "The user's `fonts` settings … override the theme's font families and base sizes" | adds the tokens `text-ui` (the UI base size) and `text-mono` (code size), the two tokens the base sizes read; `fonts.ui` → `font-ui`, `fonts.mono` → `font-mono`, `fonts.uiSize` → `text-ui`, `fonts.monoSize` → `text-mono`; `text-13` stays a fixed step of the scale |
| `design.md`, § Theme and tokens, **One token registry** | "Every token declares a kind and a default" | core tokens declare a kind only and a base theme sets every one; plugin tokens declare a kind and a default, so a theme written before the plugin still loads |
| `design.md`, § Theme and tokens | no word on aliases | a colour token may name another as `var(--wg-<name>)`, which the loader checks exists |
| `design.md`, § Plans | plan A: "… the chord formatter, and the token rename …. The app looks about the same as before"; plan B: "… the style check, and the three packages" | plan A also lands the Icon primitive with `@vscode/codicons`, the Catppuccin Mocha code colours, copied into `code-colours.ts` (no package), the `uiState` service, and Mocha's final values, so the structure stays and the colours change; plan B lands `@fontsource/jetbrains-mono` only |
| `design.md`, § Packages | the three packages with no plan named | `@vscode/codicons` landed in plan A; the code colours are the copied Mocha map in `code-colours.ts` (no package; already corrected in the plan commit — confirm); `@fontsource/jetbrains-mono` lands in plan B |
| `design.md`, § Shell, **A registry** | "The shell's areas are registered (`addArea`)" | the shell's areas are the fixed set `AreaName` names, placed by the `ShellLayout`; contributions carry an order and an alignment and return a `Disposable`, as does `shell.setLayout` |
| `AGENTS.md`, **The shell** bullet | "every area or contribution it registers returns a `Disposable`" | every contribution returns a `Disposable`, and so does replacing the layout |
| `DESIGN.md`, § Colour, the role table | no role for a changed section's mark | adds `diff-changed-mark` (peach in Mocha) beside `diff-inserted-mark` and `diff-removed-mark`: the mark on a changed section in rendered markdown (task 01) |
| `DESIGN.md`, § Layers | no stacking tokens | the layers stack by the `number` tokens `z-chrome` (L1), `z-floating` (L3), `z-dialog` and `z-toast`, in that order (task 01's registry: `10`, `100`, `200`, `300` in Mocha) |
| `DESIGN.md`, § Space, size and shape, **Density** | no side bar width, no room for the window buttons | adds the side bar `sidebar-width` and the title bar's `traffic-light-inset`, the room macOS's window buttons take (task 01's registry; task 04 reads them) |
| `AGENTS.md`, § Running and testing | "main parts start on their defaults" | main parts start on the user's settings, the ConfigStore's config (under the self-test, the empty config folder in its temp home, so the defaults), with no script `settings` over them |
| any doc | `ThemeChoice` | no doc names it at plan time (`grep -rn ThemeChoice AGENTS.md DESIGN.md docs` printed nothing); re-run the grep and drop any hit, since `AppConfig.problems` replaced it |

Already corrected in commit c551ea8: `design.md` § Theme and tokens, `design.md` § Packages and `AGENTS.md`'s codemirror-vim line. Confirm them against the code; do not redo them.

Corrections that follow from the other tasks' Proof (a renamed member, a `(drafter)` decision the lead
confirmed differently, a token added beyond the rows above) are made the same way; a token added in plan A joins `DESIGN.md`'s matching section with its role, per its own **Adding a
token** rule.

## Deleting the reference

`docs/features/ui-design/reference/` holds only `tokens.css`. Remove it with `git rm -r` when it is tracked
(`git ls-files docs/features/ui-design/reference` prints it), else with `rm -r`. Then
`grep -rn 'reference/tokens.css' AGENTS.md DESIGN.md docs` prints only lines in `plan-a-foundation/` (plan.md's
Mandatory Reads, which say task 07 deletes it, and this task). design.md's two mentions of the brief's
`tokens.css` (the intro and § Theme and tokens, colour values) are history and stay.

## Proof

Proof: every Known correction made or already true; corrections beyond the table listed in the commit message; `reference/` deleted; `npm run lint` passes fully (DESIGN.md formatted). No doc line contradicting a recorded decision was found. Commit sha in the Run log.
