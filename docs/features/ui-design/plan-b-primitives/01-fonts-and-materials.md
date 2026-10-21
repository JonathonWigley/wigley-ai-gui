# 01 — JetBrains Mono, backdrop, materials and reduced motion

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `package.json` · modify `package-lock.json` · modify `index.html` · modify `src/renderer/renderer.ts` · modify `src/renderer/index.css` · create `src/shared/page/ui/materials.css` · modify `src/config/theme-tokens.ts` · modify `src/config/themes/catppuccin-mocha.json` · modify `scripts/check-layers.mts` · modify `DESIGN.md`
Consumes:  `export const coreThemeTokens: Readonly<Record<string, TokenKind>>` in `src/config/theme-tokens.ts` ← plan A task 01 · Mocha's `material-*`, `window-*`, `duration-*`, `focus-ring`, `text-ui`, `leading-ui`, `fg`, `selection-background` values ← plan A task 01 · `ThemeApplier.apply(theme: Theme, settings: Pick<Settings, 'transparency' | 'fonts'>): void` in `src/renderer/theme.ts`, writing every token as `--wg-<name>` inline on `<html>`, the theme's `reduced` block over them while transparency is reduced, and `data-transparency` ← plan A task 01 · the `src/shared/page/ui` layer in `scripts/check-layers.mts` ← plan A task 04
Produces:  the CSS classes `.material-chrome`, `.material-chrome--dense`, `.material-floating` in `src/shared/page/ui/materials.css` · the core token `duration-instant` (kind `duration`) in `src/config/theme-tokens.ts`, Mocha `"duration-instant": "1ms"`
Decisions: the three font CSS files are `@fontsource/jetbrains-mono/400.css`, `500.css`, `600.css` — every subset of those weights, nothing else from the package (plan.md; interview) · fonts and `materials.css` are imported once, in `src/renderer/renderer.ts`: the three font files first, then `./index.css`, then `../shared/page/ui/materials.css`, then the rest as today (drafter: the composition root already imports the page-wide stylesheets) · the CSP gains `font-src 'self' data:` (drafter: Vite inlines an asset under 4 KiB as a `data:` URL in a build, and a small subset's woff2 can fall under it) · `backdrop-filter` is written unprefixed only: Electron's Chromium needs no `-webkit-` form (drafter) · the L0 backdrop sits on `html`, and `body` draws no background (drafter: the canvas takes `html`'s background, so nothing paints over it) · reduced motion sets the three duration tokens with `!important` (drafter: `ThemeApplier.apply` writes tokens as inline style on `<html>`, and only an important declaration beats a normal inline one) · the materials keep tokens.css's helper rules exactly: chrome is background + backdrop filter (its edge is a hairline each surface places, plan C); floating adds the 1px edge, the highlight and the shadow (tokens.css)
Tests:     none: no logic decidable from inputs and outputs; the look is a live check in task 08
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass; `npm run selftest` passes; `grep -rn 'backdrop-filter' src` prints only lines of `src/shared/page/ui/materials.css`; `npm ls @fontsource/jetbrains-mono` prints one version
Commit:    one commit for the group

## Package

- `npm install @fontsource/jetbrains-mono` — approved (plan.md § Preconditions); it lands in
  `dependencies`, beside the CodeMirror packages, since the renderer bundles it. Install nothing else.
- `scripts/check-layers.mts`: the `'src/renderer/renderer.ts'` entry's `packages` gains
  `'@fontsource/jetbrains-mono'`, and its `layers` gains `'src/shared/page/ui'` unless plan A
  task 04 added it there (the `materials.css` import crosses into that layer, which plan A task 04
  adds; `check-layers` reads CSS imports in `.ts` files too, and a listed layer admits only itself,
  so `'src/shared/page'` would not do). Add no layer.

## `index.html`

The CSP `content` gains `font-src 'self' data:` after `style-src …;`. If plan A already added a
`font-src` directive (for the Codicons font), it becomes exactly `font-src 'self' data:`. Every other
directive stays as it is.

## `materials.css` — every rule, in this order

| Selector | Declarations |
|---|---|
| `.material-chrome` | `background: var(--wg-material-chrome-bg)` · `backdrop-filter: var(--wg-material-chrome-filter)` |
| `.material-chrome--dense` | `background: var(--wg-material-chrome-bg-dense)` (after `.material-chrome`, so it wins at equal specificity) |
| `.material-floating` | `background: var(--wg-material-floating-bg)` · `backdrop-filter: var(--wg-material-floating-filter)` · `border: 1px solid var(--wg-material-floating-edge)` · `box-shadow: var(--wg-material-floating-highlight), var(--wg-material-floating-shadow)` |

A one-line comment heads the file: this is the only place `backdrop-filter` is written. No
reduced-transparency rule goes here: the theme's `reduced` block, written by `ThemeApplier.apply`
while transparency is reduced (plan A task 01), sets the filters to `none` and the backgrounds opaque.

## `index.css` after this task (after plan A's rename)

| Rule | After |
|---|---|
| `[hidden]`, `*` box-sizing, `h1, h2, h3, p`, `button` | unchanged |
| `html, body` | `height: 100%` (unchanged) |
| `html` (new) | `background: var(--wg-window-ambient), var(--wg-window-background)` |
| `body` | no `background`; `color: var(--wg-fg)`; `font-family: var(--wg-font-ui)`; `font-size: var(--wg-text-ui)`; `line-height: var(--wg-leading-ui)`; `-webkit-font-smoothing: antialiased`; `margin: 0`, `overflow: hidden` and `scrollbar-color` as plan A left them |
| `::selection` | `background: var(--wg-selection-background)` |
| `kbd` | every raw length becomes a token: `border-radius: var(--wg-radius-sm)`, `padding: 0 var(--wg-space-1)`; colours, font family and size stay on the tokens plan A gave them |
| `.start-error` | `padding: var(--wg-space-4)` |
| `:focus-visible` | `outline: none; box-shadow: var(--wg-focus-ring)` (replaces the outline and its offset) |
| `@media (prefers-reduced-motion: reduce)` (new, last) | `:root { --wg-duration-fast: var(--wg-duration-instant) !important; --wg-duration-base: var(--wg-duration-instant) !important; --wg-duration-slow: var(--wg-duration-instant) !important; }` |

`index.css` then holds no raw colour, length (other than `0`, `1px`, percentages), duration or
font stack, so task 03 does not put it on the legacy list.

## `duration-instant`

- `src/config/theme-tokens.ts`: add `'duration-instant': 'duration'` to `coreThemeTokens`, beside
  `duration-slow`.
- Mocha: `"duration-instant": "1ms"` beside `duration-slow` (tokens.css's reduced-motion value).
- A test that builds a complete theme by listing every core token by hand (plan A's theme-loader or
  ConfigStore tests) gains the token; a test that builds its theme from the registry needs nothing.
- `DESIGN.md` § Motion, the **Reduced motion** bullet: name the token — durations drop to
  `duration-instant` (near zero) and the streaming indicator is static.

## Live checks for task 08

- expected: code, paths and Kbd chords render in JetBrains Mono (the font shows its slashed zero),
  and weights 500 and 600 differ visibly from 400 where a view uses them.
- expected: the window shows crust with a faint mauve wash at the top left and a blue one at the
  bottom right through every glass surface; with transparency `reduced` the washes are gone.
- expected: a `.material-floating` element (the gallery) shows blur over what scrolls behind it,
  a 1px edge, a top highlight and a soft shadow; with transparency `reduced` it is opaque base.
- low-confidence (the inline-style cascade, untested): with the OS's Reduce motion on, hover and
  open transitions are instant; in devtools `getComputedStyle(document.documentElement)
  .getPropertyValue('--wg-duration-fast')` reads `1ms`.
- low-confidence (Vite inlines small assets only in a build, which no test runs): in a packaged
  build (`npm run package`), the console shows no CSP violation for a font, and mono text is
  still JetBrains Mono.
