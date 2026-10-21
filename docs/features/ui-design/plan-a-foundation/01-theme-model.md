# 01 — Theme model and token registry

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/theme.ts` · modify `src/contracts/settings.ts` · modify `src/contracts/plugin.ts` ·
           modify `src/contracts/highlight.ts` · create `src/config/theme-tokens.ts` · modify `src/config/settings.ts` ·
           modify `src/config/themes/catppuccin-mocha.json` · modify `src/main/themes/theme-loader.ts` ·
           test `src/main/themes/theme-loader.test.ts` · modify `src/main/main.ts` · modify `src/shared/define-plugin.ts` ·
           modify `src/shared/plugin-manifests.ts` · test `src/shared/plugin-manifests.test.ts` ·
           modify `src/shared/theme-variables.ts` · test `src/shared/theme-variables.test.ts` ·
           modify `src/renderer/theme.ts` · test `src/renderer/theme.test.ts` · modify `src/renderer/renderer.ts` ·
           create `src/renderer/codemirror-vim/code-colours.ts` · modify `src/renderer/codemirror-vim/codemirror-highlighter.ts` ·
           test `src/renderer/codemirror-vim/codemirror-highlighter.test.ts` · modify `src/renderer/codemirror-vim/codemirror-vim-host.ts` ·
           modify `src/renderer/codemirror-vim/editor-theme.ts` · delete `src/renderer/codemirror-vim/syntax.css` ·
           modify `src/plugins/{forms,keys,sessions,docs,chat}/manifest.ts` ·
           modify (manifest literals) `src/shared/define-plugin.test.ts`, `src/shared/plugin-host.test.ts`,
           `src/renderer/plugins/page-api.test.ts`, `src/main/plugins/main-api.test.ts`
Consumes:  `qualify(pluginId: string, short: string): string` ← tree (`src/shared/plugin-manifests.ts`) ·
           `errorText(error: unknown): string` ← tree (`src/shared/error-text.ts`) ·
           `builtInThemes: unknown[]` ← tree (`src/config/themes/index.ts`, unchanged) ·
           `HighlightStyle`, `syntaxHighlighting` ← `@codemirror/language`; `highlightCode`, `tags` ← `@lezer/highlight`
Produces:  in `src/contracts/theme.ts` (replacing the whole file; `THEME_TOKENS`, `ThemeToken`, `ThemeChoice` go):
           `export type TokenKind = 'color' | 'length' | 'duration' | 'number' | 'shadow' | 'filter' | 'raw';`
           `export interface TokenDecl { kind: TokenKind; default: string }`
           `export type ColorScheme = 'dark' | 'light';`
           `export interface Theme { name: string; colorScheme: ColorScheme; tokens: Record<string, string>; reduced: Record<string, string> }`
           in `src/contracts/settings.ts`:
           `export type Transparency = 'system' | 'full' | 'reduced';`
           `Settings.transparency: Transparency` · `Settings.fonts: { ui?: string; mono?: string; uiSize?: number; monoSize?: number }`
           `export interface ConfigProblem { file: string; message: string }`
           `AppConfig.theme: Theme` · `AppConfig.problems: ConfigProblem[]`
           in `src/contracts/plugin.ts`: `PluginManifest.themeTokens: Readonly<Record<string, TokenDecl>>`
           in `src/config/theme-tokens.ts`: `export const coreThemeTokens: Readonly<Record<string, TokenKind>>`
           in `src/main/themes/theme-loader.ts`:
           `export interface ThemeFileText { file: string; text: string }`
           `export interface ThemeTokenRegistry { core: Readonly<Record<string, TokenKind>>; plugins: Readonly<Record<string, TokenDecl>> }`
           `export class ThemeError extends Error { readonly file: string; readonly problem: string; constructor(file: string, problem: string) }`
           `export function resolveTheme(name: string, builtIns: readonly unknown[], userThemes: readonly ThemeFileText[], tokens: ThemeTokenRegistry): Theme`
           in `src/shared/plugin-manifests.ts`: `export function pluginThemeTokens(manifests: readonly PluginManifest[]): Record<string, TokenDecl>`
           in `src/shared/theme-variables.ts`: `export function themeVariable(token: string): string` ·
           `export const FONT_TOKENS = { ui: 'font-ui', mono: 'font-mono', uiSize: 'text-ui', monoSize: 'text-mono' } as const satisfies Record<keyof Settings['fonts'], string>`
           in `src/renderer/theme.ts`:
           `export interface ThemeApplier { apply(theme: Theme, settings: Pick<Settings, 'transparency' | 'fonts'>): void }`
           `export function createThemeApplier(root: HTMLElement, reducedTransparency: Pick<MediaQueryList, 'matches' | 'addEventListener'>): ThemeApplier`
           in `src/renderer/codemirror-vim/code-colours.ts`: `export const codeColours: HighlightStyle` ·
           `export function mountCodeColours(doc: Document): void`
Decisions: see **Decisions** below.

## Decisions

- The registry declares kinds only; a theme with no `extends` sets every core token (plan.md).
- `ThemeChoice` goes; a theme failure is a `ThemeError` the caller turns into a `ConfigProblem` (plan.md). In this task
  `main.ts` resolves the built-ins only, with no user themes, and serves `problems: []`; a `ThemeError` from the
  built-ins fails the start through `failStart`, as a broken built-in does today. Task 02's ConfigStore reads the user
  `themes/` folder through `Files`, hands their texts to `resolveTheme`, and fills `problems` (drafter: the loader
  goes pure here, the folder move is 02's; preconditions show no user themes exist, so nothing is lost between 01 and 02).
- The renderer reads `config.problems` in place of `theme.error`: the status item is hidden when the list is empty, else
  shows `Config: <file>: <message>` of the first problem with every problem on its own line in `title`; one toast
  `Config error: <file>: <message>` per problem at start. Task 03 makes it live (drafter).
- `focus-ring` is an inset ring, `inset 0 0 0 1px var(--wg-focus-border)`: DESIGN.md draws focus as 1px inside the
  element (lead), where tokens.css draws it outside.
- Core token list: every semantic custom property in `reference/tokens.css`, the z-index ones kept as `number` tokens
  (drafter: plan B's floating layers stack by them), plus `text-ui`, `text-mono`, plus `sidebar-width` and `traffic-light-inset` (lead: task 04's side bar and the room
  `hiddenInset`'s window buttons take), plus `diff-changed-mark` (drafter:
  markdown's changed-section marks need a third diff colour, and no tokens.css role fits; task 07 adds it to
  `DESIGN.md` § Colour). Today's `editor.activeLine` goes with no successor (no view reads it). The `--ctp-*` palette
  and `-rgb` helpers become the theme's `palette`.
- `recommend` goes: the recommended choice uses `accent` (interview, `design.md` § Surfaces).
- `whichKey.*` move to the keys manifest, `origin.*` and `severity.*` to the forms manifest, each default an alias to a
  core role where one holds today's Mocha colour, else today's hex (drafter: an alias keeps a plugin token working under
  any theme, and keeps today's colours under Mocha). Table below.
- Token values in `Theme.tokens` are CSS text: a colour resolves to lower-case hex or `transparent`, an alias stays
  `var(--wg-<name>)` so the browser follows it live (a `reduced` override of the aliased token reaches every alias).
- `window-background` must resolve to an opaque `#rrggbb` (a palette name holding one, or the hex), no alias and no
  alpha: `main.ts` hands it to `BrowserWindow`'s `backgroundColor` (drafter).
- `extends` equal to the theme's own name resolves to the built-in of that name, so a user `catppuccin-mocha.json` can
  extend the built-in Mocha and change one token (drafter). Any other `extends` looks in user themes first, then
  built-ins.
- Only the selected theme and its `extends` chain are checked; a broken unrelated user theme is skipped, except a file
  whose JSON does not parse or whose `name` is not a non-empty string, which is an error since it could be any theme in
  the chain (today's rule, kept).
- `resolveTheme` for a name no theme has throws `ThemeError('settings.json', …)`: the name came from the settings
  (drafter; task 02 may map `file` to the full path).
- Reduced motion is not part of the theme model in this plan; durations stay full under `prefers-reduced-motion` until
  plan B (drafter: flagged to the lead).
- Code colours: `codeColours` is a `HighlightStyle.define` of `@catppuccin/codemirror` 1.0.3's Mocha tag map, copied
  into the app (interview, follow-up round: the package exports only whole editor extensions, so no package is
  installed). The file opens with a one-line credit: the map is from `@catppuccin/codemirror` (MIT, Catppuccin).
- The package's editor theme (background, gutter, cursor, selection) is not copied: editor surfaces stay on our
  tokens through `editor-theme.ts`.

## Core token registry

`src/config/theme-tokens.ts` holds `coreThemeTokens`, one entry per line in the form `  'fg-secondary': 'color',`
(every key quoted, so task 06's check can read the keys with grep), in the order below. 124 tokens, measured at plan
time, re-verify against `tokens.css`. The Mocha column is the value `catppuccin-mocha.json`'s `tokens` holds, verbatim.

| Group | Token | Kind | Mocha |
|---|---|---|---|
| Text | `fg` | color | `text` |
| | `fg-secondary` | color | `subtext0` |
| | `fg-tertiary` | color | `overlay1` |
| | `fg-disabled` | color | `overlay0` |
| | `fg-on-accent` | color | `crust` |
| | `fg-link` | color | `blue` |
| Accent | `accent` | color | `mauve` |
| | `accent-hover` | color | `#d6b9fa` |
| | `accent-tint` | color | `mauve / 0.16` |
| | `accent-tint-strong` | color | `mauve / 0.24` |
| | `focus-border` | color | `var(--wg-accent)` |
| Status | `status-running` | color | `sapphire` |
| | `status-success` | color | `green` |
| | `status-warning` | color | `yellow` |
| | `status-attention` | color | `peach` |
| | `status-error` | color | `red` |
| | `status-info` | color | `blue` |
| | `status-running-tint` | color | `sapphire / 0.12` |
| | `status-success-tint` | color | `green / 0.12` |
| | `status-warning-tint` | color | `yellow / 0.12` |
| | `status-attention-tint` | color | `peach / 0.12` |
| | `status-error-tint` | color | `red / 0.12` |
| Surfaces | `window-background` | color | `crust` |
| | `window-ambient` | raw | `radial-gradient(1200px 800px at 0% 0%, #cba6f712, transparent 60%), radial-gradient(1000px 700px at 100% 100%, #89b4fa0f, transparent 60%)` |
| | `editor-background` | color | `base` |
| | `transcript-background` | color | `base` |
| | `terminal-background` | color | `base` |
| | `sheet-background` | color | `base` |
| | `sheet-gutter` | length | `6px` |
| | `block-background` | color | `mantle` |
| | `card-background` | color | `surface0 / 0.45` |
| | `card-border` | color | `surface0` |
| | `input-background` | color | `surface0 / 0.55` |
| | `input-border` | color | `surface1` |
| | `input-placeholder` | color | `var(--wg-fg-disabled)` |
| Lists | `list-hover-background` | color | `#ffffff0d` |
| | `list-active-background` | color | `var(--wg-accent-tint)` |
| | `list-active-foreground` | color | `var(--wg-fg)` |
| | `list-inactive-selection-background` | color | `#ffffff12` |
| | `tree-indent-guide` | color | `surface1 / 0.4` |
| Tabs | `tab-active-background` | color | `var(--wg-sheet-background)` |
| | `tab-inactive-background` | color | `transparent` |
| | `tab-active-foreground` | color | `var(--wg-fg)` |
| | `tab-inactive-foreground` | color | `var(--wg-fg-secondary)` |
| | `tab-active-indicator` | color | `var(--wg-accent)` |
| Buttons | `button-primary-background` | color | `var(--wg-accent)` |
| | `button-primary-foreground` | color | `var(--wg-fg-on-accent)` |
| | `button-primary-hover` | color | `var(--wg-accent-hover)` |
| | `button-secondary-background` | color | `surface0 / 0.8` |
| | `button-secondary-hover` | color | `surface1` |
| | `button-ghost-hover` | color | `#ffffff0f` |
| Diffs | `diff-inserted-background` | color | `green / 0.12` |
| | `diff-removed-background` | color | `red / 0.12` |
| | `diff-inserted-mark` | color | `green` |
| | `diff-removed-mark` | color | `red` |
| | `diff-changed-mark` | color | `peach` |
| Editor | `selection-background` | color | `overlay2 / 0.25` |
| | `cursor` | color | `rosewater` |
| | `line-number` | color | `overlay0` |
| | `line-number-active` | color | `lavender` |
| Borders | `border-subtle` | color | `#ffffff0f` |
| | `border-default` | color | `surface0` |
| | `border-strong` | color | `surface1` |
| Materials | `material-chrome-bg` | color | `mantle / 0.72` |
| | `material-chrome-bg-dense` | color | `mantle / 0.82` |
| | `material-chrome-filter` | filter | `blur(24px) saturate(160%)` |
| | `material-chrome-edge` | color | `var(--wg-border-subtle)` |
| | `material-floating-bg` | color | `base / 0.8` |
| | `material-floating-filter` | filter | `blur(32px) saturate(180%)` |
| | `material-floating-edge` | color | `#ffffff14` |
| | `material-floating-highlight` | shadow | `inset 0 1px 0 rgb(255 255 255 / 0.06)` |
| | `material-floating-shadow` | shadow | `0 1px 2px rgb(0 0 0 / 0.30), 0 8px 24px rgb(0 0 0 / 0.35), 0 24px 64px rgb(0 0 0 / 0.25)` |
| | `scrim` | color | `mantle / 0.55` |
| Type | `font-ui` | raw | `-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI Variable Text", "Segoe UI", Ubuntu, Cantarell, sans-serif` |
| | `font-mono` | raw | `"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace` |
| | `text-11` `text-12` `text-13` `text-14` `text-16` `text-20` | length | `11px` `12px` `13px` `14px` `16px` `20px` |
| | `text-ui` | length | `13px` |
| | `text-mono` | length | `13px` |
| | `leading-tight` `leading-ui` `leading-prose` | number | `1.25` `1.4` `1.55` |
| | `prose-measure` | length | `76ch` |
| | `weight-regular` `weight-medium` `weight-semibold` | number | `400` `500` `600` |
| Space | `space-0_5` `space-1` `space-1_5` `space-2` `space-3` `space-4` `space-6` `space-8` | length | `2px` `4px` `6px` `8px` `12px` `16px` `24px` `32px` |
| Size | `row-tree` `row-list` `tab-height` `toolbar-height` `statusbar-height` `activitybar-width` `icon-button-sm` `icon-button` `icon-size` | length | `24px` `28px` `32px` `40px` `24px` `40px` `24px` `28px` `16px` |
| | `sidebar-width` | length | `256px` |
| | `traffic-light-inset` | length | `78px` |
| Shape | `radius-sm` `radius-md` `radius-lg` `radius-xl` | length | `4px` `6px` `10px` `14px` |
| | `indicator-width` | length | `2px` |
| | `focus-ring` | shadow | `inset 0 0 0 1px var(--wg-focus-border)` |
| Motion | `duration-fast` `duration-base` `duration-slow` | duration | `90ms` `140ms` `220ms` |
| | `ease-out` | raw | `cubic-bezier(0.2, 0, 0, 1)` |
| | `ease-in` | raw | `cubic-bezier(0.4, 0, 1, 1)` |
| Layering | `z-chrome` `z-floating` `z-dialog` `z-toast` | number | `10` `100` `200` `300` |

## Mocha theme file

`catppuccin-mocha.json` becomes `{ "name": "catppuccin-mocha", "colorScheme": "dark", "palette": {…}, "tokens": {…},
"reduced": {…} }`: `palette` keeps today's 26 entries unchanged; `tokens` holds every row above; `reduced` holds
tokens.css's reduced-transparency overrides (both of its blocks hold the same six):

| Token | Reduced |
|---|---|
| `window-ambient` | `none` |
| `material-chrome-bg` | `mantle` |
| `material-chrome-bg-dense` | `mantle` |
| `material-chrome-filter` | `none` |
| `material-floating-bg` | `base` |
| `material-floating-filter` | `none` |

tokens.css's `color-scheme: dark` is the `colorScheme`. Its `@media (prefers-reduced-transparency)` block and its
`[data-transparency]` selectors become `ThemeApplier`'s rule (below), not CSS.

## Plugin tokens

`themeTokens` is required on `PluginManifest` and on `definePlugin`'s parameter; `{}` when a plugin declares none
(sessions, docs, chat, and every manifest literal in the tests listed in Files). A key is unqualified in the manifest:

| Manifest | Key | Kind | Default | Today's Mocha colour it keeps |
|---|---|---|---|---|
| keys | `which-key-command` | color | `var(--wg-status-success)` | green |
| keys | `which-key-prefix` | color | `var(--wg-accent)` | mauve |
| forms | `origin-caused` | color | `var(--wg-status-error)` | red |
| forms | `origin-pre-existing` | color | `#eba0ac` | maroon |
| forms | `origin-design` | color | `var(--wg-accent)` | mauve |
| forms | `origin-nit` | color | `#9399b2` | overlay2 |
| forms | `severity-critical` | color | `var(--wg-status-error)` | red |
| forms | `severity-important` | color | `var(--wg-status-attention)` | peach |
| forms | `severity-minor` | color | `var(--wg-fg-tertiary)` | overlay1 |

`pluginThemeTokens(manifests)` returns every plugin's tokens keyed `qualify(id, key)` (`forms.origin-caused`), and
throws `Plugin "<id>" theme token "<key>" must be lowercase letters and digits joined by - or _` for a key that
fails `^[a-z0-9]+(?:[-_][a-z0-9]+)*$`. Mocha sets none of them.

## Theme loader

`theme-loader.ts` drops `node:fs` and `chooseTheme`: `resolveTheme` is a pure function over the built-in JSON objects
and the user theme texts handed to it. Every failure throws `ThemeError(file, problem)`, whose `message` is
`<file>: <problem>`. A built-in's `file` is `built-in theme "<name>"`, or `built-in theme <n>` (1-based) when its
name is unreadable; a user theme's is the `file` it came with.

**Theme file keys**: `name` (non-empty string, required), `extends` (string, optional), `colorScheme` (`"dark"` or
`"light"`; required without `extends`, inherited with it), `palette` (object of `#rrggbb` / `#rrggbbaa`, any case,
stored lower case; optional, default `{}`), `tokens` (object, optional with `extends`, required without), `reduced`
(object, optional, default `{}`). Any other key: `unknown key "<key>"; a theme has only name, extends, colorScheme,
palette, tokens and reduced`.

Loader messages for these keys, pinned: `"extends" must be a string`; `"colorScheme" is missing; a theme with no "extends" sets it`;
`"tokens" is missing; a theme with no "extends" sets every core token`; `"<key>" must be a JSON object` (`palette`, `tokens` or
`reduced` that is not an object); `palette "<name>": <JSON> is not a #rrggbb or #rrggbbaa colour`.

**Resolution**, in order:

1. Index themes by name: built-ins, then user themes over them. A user text whose JSON does not parse throws with the
   parse error's `errorText`; one with no readable `name` throws `"name" must be a non-empty string`. Two user themes
   with one name throw `two theme files are named "<name>": <first file> and <second file>` (file: the second) only when
   that name is in the chain.
2. Walk `extends` from `name` to the root (the theme with no `extends`). An unknown base: `"extends" names "<base>",
   which no theme has`. A cycle: `"extends" cycle: a → b → a` (file: the theme that closes it). `name` itself unknown:
   `ThemeError('settings.json', '"theme" names "<name>", which no theme has')`.
3. Check each theme in the chain: every key of `tokens` and `reduced` is a core token or a qualified plugin token, else
   `unknown token "<key>"` (`unknown token "<key>" in reduced`); each value is a string, else
   `token "<key>": <JSON value> is not a <kind> value`. The root sets every core token, else
   `token "<key>" is missing; a theme with no "extends" sets every core token` (the first missing in registry order).
4. Merge root first, child last: `palette`, `tokens` and `reduced` each child-over-base by key; `colorScheme` the
   nearest set; `name` the selected theme's. Plugin tokens the merged `tokens` lacks take their `default`.
5. Resolve every merged value by its kind against the merged palette (so a child's palette entry recolours the base's
   tokens that name it). A plugin default that fails names `plugin <id>` as the file.
6. Check references: every `var(--wg-<v>)` in any value names a declared token's variable, else
   `token "<key>": var(--wg-<v>) names no token`; a colour whose whole value is an alias names a colour token, else
   `token "<key>": var(--wg-<v>) is a <kind> token, not a color token`; no cycle among references, else
   `alias cycle: fg → accent → fg`, found by walking tokens in registry order (core, then plugins) and printed from the
   first token met (file: the selected theme's).
7. `window-background` (when the registry declares it) resolves to `#rrggbb`, else `token "window-background": must
   be an opaque #rrggbb colour or a palette name holding one, since the native window paints it`.

In an `extends` chain, a value that fails step 3, 5 or 6 (a bad value by kind, a palette alpha, an alias to no token, an alias of
the wrong kind) names the theme file that set the merged value, not the selected theme's file.

**Value grammar by kind** (any value of the form `var(--wg-<v>)` inside is checked by step 6):

| Kind | Accepts | Resolves to |
|---|---|---|
| color | a palette name; `#rrggbb` / `#rrggbbaa` (any case); `"<palette name> / <alpha>"` with spaces optional around `/` and alpha matching `0`, `1`, `1.0…`, or `0?.<digits>` in [0, 1]; `transparent`; `var(--wg-<v>)` | lower-case hex; alpha form → the palette entry's `#rrggbb` + `Math.round(alpha × 255)` as two lower-case hex digits (`mauve / 0.16` with `#cba6f7` → `#cba6f729`); an alpha form on an 8-digit palette entry throws `token "<key>": palette "<p>" already has an alpha`; `transparent` and the alias verbatim |
| length | `0`, or `-?<number><unit>` with unit `px` `rem` `em` `ch` `%` `vh` `vw` | verbatim |
| duration | `<number>ms` or `<number>s` | verbatim |
| number | `-?<number>` | verbatim |
| shadow, filter, raw | a non-empty string with no `;`, `{` or `}` and balanced parentheses; `filter` also only `none` or a run of `<name>(…)` functions | verbatim |

`<number>` is `\d+(\.\d+)?` or `\.\d+`. Every variable name is `--wg-` + the token name with `.` replaced by `-`.

## Main

- `readStartInputs`: `theme: resolveTheme(defaultSettings.theme, builtInThemes, [], { core: coreThemeTokens,
  plugins: pluginThemeTokens(manifests) })` in place of `chooseTheme(…)`; `StartInputs.theme` is a `Theme`.
- `buildConfig` serves `theme: inputs.theme` and `problems: []`.
- `createWindow` hands `inputs.theme.tokens['window-background']` to `createMainWindow` in place of
  `tokens['bg.base']`.

## Renderer

`createThemeApplier(root, reducedTransparency)` subscribes once to `reducedTransparency`'s `change` event, which
re-runs the last `apply` when the last settings' transparency is `system`; before the first `apply` the event does
nothing. `apply(theme, settings)`:

- writes every `theme.tokens` entry with `root.style.setProperty(themeVariable(key), value)`, every apply, so a
  removed font override or a switch back from reduced restores the theme's value
- then, while transparency is reduced (`reduced`, or `system` with `reducedTransparency.matches`), writes every
  `theme.reduced` entry over them
- then writes each set `fonts` member over its `FONT_TOKENS` token: `ui` and `mono` verbatim, `uiSize` and `monoSize`
  as `<n>px`
- sets `root.dataset.transparency` to `reduced` or `full` (the state in effect, never `system`) and
  `root.style.setProperty('color-scheme', theme.colorScheme)`

`renderer.ts` builds it with `document.documentElement` and
`window.matchMedia('(prefers-reduced-transparency: reduce)')` and calls `apply(config.theme, config.settings)` where
it calls `applyTheme` today; task 03 calls `apply` again on each served config.

`editor-theme.ts` writes each variable as a literal `'var(--wg-<name>)'` string (task 06's check greps them):
`editor.bg` → `editor-background`, `editor.fg` → `fg`, `border.focus` → `focus-border`, `editor.gutter` →
`line-number`, `editor.cursor` → `cursor`, `editor.selection` → `selection-background`, `text.onAccent` →
`fg-on-accent`, `border` → `border-default`, `bg.pane` (autocomplete) → `material-floating-bg`, `surface.selected` →
`list-active-background`, the mono family → `font-mono`, the mono size → `text-mono`. Every CSS file stays on the old
names until task 06.

## Settings

`defaultSettings` gains `transparency: 'system'`; `fonts` becomes `{}` (today's families and `15` / `14` go: Mocha's
`font-*` and `text-ui` / `text-mono` hold the brief's values, UI and mono text at 13px in the brief's font families; the user chose 13 / 13 in the interview, so the fonts change on screen). The `Settings` comment on `fonts` says each member, when set,
overrides the theme token `FONT_TOKENS` names.

## Code colours

- No install. The tag map, verbatim from the package's Mocha flavour (colours are the Catppuccin Mocha palette):

  | Tags (`@lezer/highlight` `tags`) | Style |
  |---|---|
  | `keyword` | `#cba6f7` (mauve) |
  | `name`, `deleted`, `character`, `macroName`, `definition(name)` | `#cdd6f4` (text) |
  | `function(variableName)`, `function(propertyName)`, `propertyName`, `labelName` | `#89b4fa` (blue) |
  | `color`, `constant(name)`, `standard(name)`, `bool`, `number` | `#fab387` (peach) |
  | `self`, `atom`, `invalid` | `#f38ba8` (red) |
  | `typeName`, `className`, `changed`, `annotation`, `namespace` | `#f9e2af` (yellow) |
  | `operator` | `#89dceb` (sky) |
  | `url` | `#94e2d5` (teal) |
  | `link` | `#89b4fa` (blue), underline |
  | `escape`, `regexp` | `#f5c2e7` (pink) |
  | `meta`, `punctuation`, `separator`, `comment` | `#9399b2` (overlay2) |
  | `special(variableName)` | `#b4befe` (lavender) |
  | `processingInstruction`, `string`, `inserted` | `#a6e3a1` (green) |
  | `strong` | bold · `emphasis` italic · `strikethrough` line-through |
  | `heading` | bold, `#89b4fa` (blue) |

  Before writing it, the implementer reads the package's `dist/index.js` 1.0.3 on jsDelivr
  (`https://cdn.jsdelivr.net/npm/@catppuccin/codemirror@1.0.3/dist/index.js`, a read, not an install) and corrects any
  row that differs. The hex values are code colours, fixed under any theme (accepted in the interview); check-styles
  (plan B) reads CSS and inline style writes, not a `HighlightStyle` object.
- `code-colours.ts` holds `codeColours` (the Decision above) and `mountCodeColours(doc)`,
  which appends to `doc.head` one `<style>` holding `codeColours.module.getRules()` (throws
  `The code colour style has no style rules` when `module` is null). `renderer.ts` calls it once before building the
  markdown service: highlighted markdown has no editor to mount the style.
- `codemirror-vim-host.ts`: `syntaxHighlighting(classHighlighter)` → `syntaxHighlighting(codeColours)`; drop the
  `./syntax.css` import; the comment on `documentExtensions` says highlighted through the Catppuccin Mocha style.
- `codemirror-highlighter.ts`: `highlightCode(…, codeColours, …)` in place of `classHighlighter`; drop the
  `./syntax.css` import. `highlight.ts`'s comments say the spans carry the code colour style's classes.

## Tests

The loader tests build a small registry and their own theme JSON; no test reads Mocha or a shipped manifest. Registry
used below: core `{ fg: color, accent: color, 'focus-border': color, 'window-background': color, 'space-2': length,
'duration-fast': duration, 'leading-ui': number, 'focus-ring': shadow, 'material-chrome-filter': filter, 'font-ui':
raw }`, plugins `{ 'forms.origin-caused': { kind: 'color', default: 'var(--wg-accent)' } }`; palette
`{ mauve: '#cba6f7', base: '#1e1e2e', crust: '#11111b', glass: '#11111b80' }`; a complete root theme `mine` sets every
core token valid.

GIVEN a theme with no `extends` setting every core token WHEN resolved THEN palette names and hex resolve to lower-case hex and aliases stay verbatim
GIVEN a value `"mauve / <a>"` WHEN resolved THEN it is mauve's hex with `round(a × 255)` as two hex digits
GIVEN a child theme with `extends` WHEN resolved THEN base tokens resolve through the child's palette and the child's tokens and reduced win
GIVEN a plugin token no theme sets WHEN resolved THEN it holds its resolved default
GIVEN a theme `extends` cycle, an unknown base, a missing core token, an unknown token, a bad value by kind, an alias to no token, or an alias cycle WHEN resolved THEN `ThemeError` names the file and the problem
GIVEN transparency `system` and the OS reducing transparency WHEN applied THEN the reduced overrides win, and an OS change re-applies
GIVEN font settings WHEN applied THEN they override `font-ui`, `font-mono`, `text-ui`, `text-mono`, and removing them restores the theme's

Tests:
- `theme-loader.test.ts`, rewritten (the `chooseTheme` tests go with it):
  - `resolves palette names, hex in any case, transparent and aliases` — `fg: 'mauve'` → `#cba6f7`;
    `accent: '#CBA6F7'` → `#cba6f7`; `focus-border: 'transparent'` → `transparent`; `focus-ring:
    '0 0 0 1px var(--wg-focus-border)'` verbatim; `name` `mine`, `colorScheme` `dark`
  - `resolves a palette name with alpha` (it.each) — `mauve / 0.16` → `#cba6f729`; `mauve/0.5` → `#cba6f780`;
    `mauve / 1` → `#cba6f7ff`; `mauve / 0` → `#cba6f700`
  - `rejects alpha on a palette entry that has one` — `fg: 'glass / 0.5'` throws
    `mine.json: token "fg": palette "glass" already has an alpha`
  - `accepts and rejects values by kind` (it.each over `[token, value, ok]`) — `space-2`: `8px` ok, `0` ok, `76ch`
    ok, `8` rejected; `duration-fast`: `90ms` ok, `0.2s` ok, `90` rejected; `leading-ui`: `1.4` ok, `1.4px`
    rejected; `material-chrome-filter`: `blur(24px) saturate(160%)` ok, `none` ok, `blur(24px` rejected;
    `focus-ring`: `0 1px 2px rgb(0 0 0 / 0.30)` ok, `a; b` rejected; `fg`: `mauve / 1.5` rejected, `Mauve`
    rejected; a rejection throws `mine.json: token "<token>": "<value>" is not a <kind> value`
  - `names a missing core token` — `mine` without `accent` throws
    `mine.json: token "accent" is missing; a theme with no "extends" sets every core token`
  - `names an unknown token in tokens and in reduced` — `accent-glow` throws `mine.json: unknown token "accent-glow"`
    and `mine.json: unknown token "accent-glow" in reduced`
  - `names an alias to no token and an alias of the wrong kind` — `focus-border: 'var(--wg-nope)'` throws
    `mine.json: token "focus-border": var(--wg-nope) names no token`; `focus-border: 'var(--wg-space-2)'` throws
    `mine.json: token "focus-border": var(--wg-space-2) is a length token, not a color token`
  - `names the base's file for a bad value set in the base` — user `base` complete with `space-2: '8'`, user `child` `{ extends: 'base' }`,
    resolving `child` throws `base.json: token "space-2": "8" is not a length value`
  - `names an alias cycle` — `fg: 'var(--wg-accent)'`, `accent: 'var(--wg-fg)'` throws `mine.json: alias cycle: fg → accent → fg`
  - `merges an extended theme over its base` — user `child` `{ extends: 'mine', palette: { mauve: '#ff0000' },
    tokens: { 'space-2': '10px' }, reduced: { 'material-chrome-filter': 'none' } }`, `mine.fg: 'mauve'` →
    `child.tokens.fg` `#ff0000`, `space-2` `10px`, `colorScheme` `dark`, `name` `child`, `reduced`
    `{ 'material-chrome-filter': 'none' }`
  - `extends the built-in of its own name` — built-in `mine`, user text `{ name: 'mine', extends: 'mine', tokens:
    { 'space-2': '12px' } }` → `space-2` `12px`, `fg` from the built-in
  - `lets a user theme replace a built-in of the same name` — user `mine` complete with `fg: 'base'` → `#1e1e2e`
  - `names an extends cycle and an unknown base` — `a` extends `b`, `b` extends `a`, resolving `a` throws
    `b.json: "extends" cycle: a → b → a`; `a` extends `nope` throws `a.json: "extends" names "nope", which no theme has`
  - `names a theme nothing provides` — throws `settings.json: "theme" names "nope", which no theme has`
  - `gives an unset plugin token its default and lets a theme set it` — unset → `var(--wg-accent)`;
    `'forms.origin-caused': 'base'` → `#1e1e2e`
  - `names a user file whose JSON does not parse` — `{ file: 'bad.json', text: '{' }` throws starting `bad.json: `
  - `skips a broken user theme outside the chain` — user `other` with an unknown token, resolving `mine` succeeds
  - `names two user files with the selected name` — throws
    `b.json: two theme files are named "mine": a.json and b.json`
  - `rejects a window background that is not opaque hex` — `window-background: 'glass'` and `'var(--wg-fg)'` each
    throw `mine.json: token "window-background": must be an opaque #rrggbb colour or a palette name holding one, since the native window paints it`
  - `names an unknown key and a bad colorScheme` — `{ …, foo: 1 }` throws `mine.json: unknown key "foo"; a theme has only name, extends, colorScheme, palette, tokens and reduced`;
    `colorScheme: 'dim'` throws `mine.json: "colorScheme" must be "dark" or "light"`
- `plugin-manifests.test.ts`:
  - `pluginThemeTokens qualifies each plugin's tokens` — manifest `forms` with `{ 'origin-caused': { kind: 'color',
    default: '#ff0000' } }` → `{ 'forms.origin-caused': { kind: 'color', default: '#ff0000' } }`
  - `pluginThemeTokens rejects a key that is not a token name` — key `originCaused` throws
    `Plugin "forms" theme token "originCaused" must be lowercase letters and digits joined by - or _`
- `theme-variables.test.ts` — `fg-secondary` → `--wg-fg-secondary`; `space-0_5` → `--wg-space-0_5`;
  `forms.origin-caused` → `--wg-forms-origin-caused`
- `theme.test.ts` (fake root: `style.setProperty` into a map, a plain `dataset` object; fake query `{ matches,
  addEventListener }` that keeps the listener). Theme `{ name: 't', colorScheme: 'dark', tokens: { fg: '#111111',
  'material-chrome-bg': '#22222280', 'forms.origin-caused': 'var(--wg-fg)', 'font-ui': 'System', 'font-mono':
  'Mono', 'text-ui': '13px', 'text-mono': '13px' }, reduced: { 'material-chrome-bg': '#222222' } }`:
  - `writes every token as its variable` — `--wg-fg` `#111111`, `--wg-forms-origin-caused` `var(--wg-fg)`,
    `color-scheme` `dark`
  - `writes the reduced overrides when transparency is reduced` — `reduced` → `--wg-material-chrome-bg` `#222222`,
    `dataset.transparency` `reduced`; `full` with `matches: true` → `#22222280`, `full`
  - `follows the OS under system` — `matches: true` → `#222222`; set `matches: false` and fire the listener →
    `#22222280`, `full`
  - `overrides the font tokens with the font settings and restores them` — `{ ui: 'Inter', uiSize: 15 }` →
    `--wg-font-ui` `Inter`, `--wg-text-ui` `15px`, `--wg-font-mono` `Mono`; apply again with `{}` → `System`, `13px`
- `codemirror-highlighter.test.ts` — each `tok-*` assertion becomes the class `codeColours.style([tag])` returns for the
  tag the parser gives that text: `1` in `const a = 1;` (ts) → `tags.number`; `const` and python's `def` →
  `tags.definitionKeyword` (if the parser tags them otherwise, the tag it gives); toml `"v"` → `tags.string`; markdown
  `# Title` → contains `codeColours.style([tags.heading1])`; and `const a = 1;` holds no `tok-` text. The escaping,
  line break and unknown-language tests stay.

No self-test step: no key behaviour changes. The self-test start resolves Mocha against the full registry, so a Mocha
or registry mistake fails `npm run selftest`.

Done when: `npm run typecheck`, `npm run lint` and `npm test` pass; `npm run selftest` passes; `syntax.css` is gone and
`grep -rn "THEME_TOKENS\|ThemeChoice\|classHighlighter\|syntax\.css" src` prints nothing;
`grep -c "^  '" src/config/theme-tokens.ts` prints `124`; `code-colours.ts` holds the credit line and imports no
`@catppuccin` package. The app's views read old variable names until task 06, so they show unstyled until then; the
look is checked in task 08.
Commit:    one commit for the group

## Proof

