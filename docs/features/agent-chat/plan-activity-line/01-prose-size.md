# 01 — Prose size token and setting

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/config/theme-tokens.ts` · modify `src/config/themes/catppuccin-mocha.json` · modify `src/contracts/settings.ts` · modify `src/shared/theme-variables.ts` · modify `src/renderer/theme.ts` · modify `src/config/settings.ts` · modify `src/shared/page/markdown.css` · test `src/renderer/theme.test.ts`
Consumes:  none
Produces:  token `'text-prose': 'length'` in `src/config/theme-tokens.ts`, beside `text-ui` and `text-mono`
           `"text-prose": "14px"` in `src/config/themes/catppuccin-mocha.json`, beside `text-ui` and `text-mono`
           `Settings['fonts']` gains `proseSize?: number` in `src/contracts/settings.ts` (CSS pixels, as the comment above it says for the other two sizes)
           `FONT_TOKENS.proseSize: 'text-prose'` in `src/shared/theme-variables.ts`
           `'fonts.proseSize': 'number'` in `optionalSettings`, and its info row, in `src/config/settings.ts`
Decisions: the setting follows `fonts.uiSize` → `text-ui` on every step (the user's answer) · `applyFonts` in `src/renderer/theme.ts` writes `--wg-text-prose` as `${proseSize}px` when set, as it does `uiSize` · both `var(--wg-text-14)` uses in `src/shared/page/markdown.css` (the body rule at line 3 and `.md-h3` at line 42) become `var(--wg-text-prose)`; `h1`/`h2` keep `text-16` (design review) · the info row sits right after `fonts.monoSize` in the infos object, so Settings mode shows it beside the other two sizes (the user's answer) · `src/shared/page/ui/dialog.css`'s `text-14` title is not prose and stays
Pinned:    info row label `Prose font size`; description `The size of rendered markdown text, in pixels.`
GIVEN the font settings set `proseSize: 18` WHEN the theme applies THEN `--wg-text-prose` is `18px`, and with no font settings it is back to the theme's `14px`
Tests:     extend `overrides the font tokens with the font settings and restores them` in `src/renderer/theme.test.ts`: apply with `proseSize: 18` and assert `--wg-text-prose` is `18px`; apply without and assert `14px` (the test's own theme fixture gains `text-prose: '14px'` if it lists the font tokens)
Done when: compiles; `npm run lint` passes; the test gate runs the test above
Commit:    one commit for the group

## Proof

