# 07 — Doc re-read

Status: done
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05, 06
Plan: [plan.md](plan.md)

Files:     modify `DESIGN.md` · modify `AGENTS.md` · modify `docs/features/ui-design/design.md`
Consumes:  the landed code of tasks 01–06 (read it; this task's Produces are doc lines, not code)
Produces:  `DESIGN.md` § Primitives listing every primitive as landed; every line of the three docs
           true of the code after 01–06
Decisions: lines describing plan C's work stay as written — the surfaces rebuilt on the primitives,
           the key changes, the forms and chat layout kits handing primitives to user layouts, the
           legacy list emptying (plan.md) · a doc line is corrected to the code, never the code to
           the doc, unless the code breaks a rule `DESIGN.md` states on purpose — that goes in the
           report as a defect instead (DESIGN.md: "fix the code, or change this file on purpose") ·
           every edit follows `wigley:writing-for-agents` (AGENTS.md is read by agents)
Done when: each row below is checked against the code and each mismatch corrected; `DESIGN.md`
           § Primitives lists every landed primitive and the class and state convention; `AGENTS.md`
           names `.selftest/screenshots/` and names check-styles in its `npm run lint` line; `npm run lint` passes; the report
           lists each line changed and each line left for plan C
Commit:    one commit for the group: `Docs match plan B's primitives, gallery, screenshots and style check`

## What to check, line by line

Read each doc whole; the rows below are where plan B's code lands, not the limit of the read.

| Doc · section | Claim to check against the code |
|---|---|
| `DESIGN.md` § Layers | `backdrop-filter` appears only in `src/shared/page/ui/materials.css`; the helper class names (`material-chrome`, `material-chrome--dense`, `material-floating`) as 01 landed them; reduced transparency makes them opaque through the theme's `reduced` block |
| `DESIGN.md` § Tokens and themes | the raw values CSS may still write match what `scripts/check-styles.mts` (03) allows — `0`, `1px`, percentages, `fr` tracks, `@media` breakpoints — and the unitless custom properties 05 writes from code (`--ui-row-depth`, `--ui-split-start`), if 03 allows them; add that allowance to the list as landed |
| `DESIGN.md` § Type | `font-mono` is JetBrains Mono through `@fontsource/jetbrains-mono`, weights 400, 500 and 600 as 01 imports them; Kbd draws key chords in `font-mono`, the label beside it in the UI font |
| `DESIGN.md` § Motion | reduced motion: name `duration-instant` (01), the token every duration takes under `prefers-reduced-motion`, in place of "near zero"; FloatingPanel's fade on open (05) |
| `DESIGN.md` § Keys and focus | Kbd prints chords through `formatChord`; the focus ring is `inset 0 0 0 1px var(--wg-focus-border)` as 04 and 05 draw it |
| `DESIGN.md` § Primitives | home `src/shared/page/ui/`; **add** the list below; the gallery on `Space z g`, raw `t` switching transparency in place without writing `settings.json` (06); a new primitive joins `src/shared/page/ui/`, the gallery and this section |
| `DESIGN.md` § Checks | check-styles' rules as 03 landed them, the legacy list a plain run skips, `--no-legacy` checking every file, and that plan C's final task deletes the list; the screenshot step field as 02 named it, the folder the PNGs land in, and the screenshot names 06 takes (`gallery-<n>-full` and `-reduced` for each page, `sessions-*`, `docs-*`) |
| `AGENTS.md` § Architecture tree | `ui/` line under `src/shared/page/`; `gallery/` line ("manifest.ts, page/ … no main part") |
| `AGENTS.md` § Architecture, debug keys | the gallery's `Space z g` |
| `AGENTS.md` § Architecture, lint bullet | the `npm run lint` line names `scripts/check-styles.mts` beside `check-layers.mts` (03), with one line on what it fails and on `--no-legacy` |
| `AGENTS.md` § Running and testing | the `screenshot` step sentence matches 02's field and names the folder the PNGs land in, `.selftest/screenshots/` (git-ignored, `<plugin>-<name>.png`, recreated each run); **add** that the gallery has no main part, so its steps live in forms' and docs' scripts, beside the sentence on the keys plugin's steps |
| `design.md` § Primitives and the gallery | home, "only what the existing surfaces use", Kbd through `formatChord`, the gallery's key and raw key, the screenshots — each as landed |
| `design.md` § Packages | `@fontsource/jetbrains-mono`, weights 400, 500 and 600 only, bundled by Vite |
| `design.md` § Plans | plan B's line names what landed: the primitives, the gallery, the screenshots, the style check, the font |

## DESIGN.md § Primitives — the list to add

One line per primitive, in this order, each naming its builder and its use, as landed by 04 and 05
(re-read the files; a signature that changed in the run is written as it landed):

Kbd (`kbd`), Button (`textButton`: primary, secondary, ghost, danger), IconButton (`iconButton`),
Chip (`chip`), Tag (`tag`), StatusDot (`statusDot`), InputFrame (`inputFrame`), Row (`row`: list and
tree), Tabs (`tabStrip`, `tab`), Sheet (`sheet`), Split (`createSplit`, widths in `uiState`), Card
(`card`, edges) and the collapsible card (`createCollapsibleCard`), FloatingPanel
(`floatingPanel`), Dialog (`createDialog`, over `scrim`), EmptyState (`emptyState`), SectionHeader
(`sectionHeader`). Icon stays as plan A wrote it.

Then the class and state convention (04 § Decisions), as one short list: a builder returning an
element is a noun, one returning a handle `create<Name>`; root class `ui-<name>`, parts
`ui-<name>-<part>`, variants `ui-<name>--<variant>`; `is-selected`, `is-active`, `is-cursor`,
`is-disabled` (a button's `disabled`), `data-<name>` for an enumerated value, `is-hover` /
`is-pressed` only for the gallery; buttons never take focus; a hint is a Kbd element handed in.

## Proof

Commit `833cf9e` · diff read: § Primitives lists all sixteen and the convention; AGENTS.md names
`.selftest/screenshots/` and check-styles in its lint lines · lint passes. Concerns: the global
`:focus-visible` box-shadow (`focus-ring`) is a second ring form beside the inset `focus-border`
ones; a few AGENTS.md lines run past the file's wrap width.
