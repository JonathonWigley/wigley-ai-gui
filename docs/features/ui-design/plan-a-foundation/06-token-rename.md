# 06 — Token rename across every stylesheet

Status: not started
Type: Parallel
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/renderer/index.css` · modify `src/shared/page/dialog.css` · modify `src/shared/page/markdown.css` ·
           modify `src/plugins/keys/page/keys.css` · modify `src/plugins/sessions/page/sessions.css` ·
           modify `src/plugins/docs/page/docs.css` · modify `src/plugins/chat/page/chat.css` ·
           modify `src/plugins/forms/page/forms.css` · modify `src/renderer/shell/shell.css`
Consumes:  `coreThemeTokens: Readonly<Record<string, TokenKind>>` ← 01 (its keys are the new names) ·
           the forms and keys `themeTokens` keys ← 01 · `themeVariable(token: string): string` ← 01 (`.` → `-`) ·
           `FONT_TOKENS` ← 01 (`font-ui`, `font-mono`, `text-ui`, `text-mono`)
Produces:  no exported signature; every `var(--wg-…)` under `src/` names a token task 01 declares, or a runtime
           variable listed below
Decisions: see **Decisions** below.
Commit:    one commit for the group

## Decisions

- Only variable names change. Every raw value in CSS (px, rem, `3px` borders, `2px solid`, percentages) stays as it is;
  moving them onto tokens is plan C's (plan.md). One exception: `color-mix(in srgb, var(--wg-bg-deep) 75%,
  transparent)` becomes `var(--wg-scrim)`, since `scrim` already carries its alpha (drafter).
- A new name is picked by the role the rule plays, not one-to-one: the map gives each old name's default, and each
  file's notes name the rules that take another (DESIGN.md § Layers and § Colour; drafter where DESIGN.md is silent).
- The recommended choice moves from `recommend` (peach) to `accent` (interview, `design.md` § Surfaces).
- `shell.css` and `sessions.css`: this task (wave 2) renames every variable in both files, as in every other file;
  task 04 (wave 4) then restructures them on the new names (lead: the rename lands right after task 01, so no view
  stays unstyled across waves 2–4).
- Runtime variables the shell publishes stay: `--wg-status-bar-height` (set by `src/renderer/shell/shell.ts`, read by
  `keys.css`; check for others with `grep -rn "setProperty('--wg-" src/renderer`). They are not theme tokens. Task 04
  keeps the registry check below passing for any runtime variable it adds.
- The `syntax-*` variables went with `syntax.css` in task 01; none is left to rename.
- `editor-theme.ts` was renamed in task 01; 06 touches no TS.

## Old → new map

Old variables in use, `grep -rhoE 'var\(--wg-[A-Za-z0-9-]+' src | sort | uniq -c` before task 01, counts measured at
plan time, re-verify.

| Old | Uses | New (default) | Takes another in |
|---|---|---|---|
| `--wg-text` | 15 | `--wg-fg` | |
| `--wg-text-muted` | 32 | `--wg-fg-secondary` | |
| `--wg-text-faint` | 13 | `--wg-fg-tertiary` | |
| `--wg-text-onAccent` | 6 | `--wg-fg-on-accent` | |
| `--wg-accent` | 17 | `--wg-accent` (unchanged) | |
| `--wg-recommend` | 5 | `--wg-accent` | |
| `--wg-border` | 43 | `--wg-border-default` | |
| `--wg-border-focus` | 7 | `--wg-focus-border` | |
| `--wg-success` | 7 | `--wg-status-success` | |
| `--wg-warning` | 11 | `--wg-status-warning` | |
| `--wg-error` | 9 | `--wg-status-error` | |
| `--wg-info` | 6 | `--wg-status-info` | |
| `--wg-selection` | 1 | `--wg-selection-background` | |
| `--wg-bg-base` | 2 | `--wg-sheet-background` | index.css, sessions.css |
| `--wg-bg-pane` | 4 | `--wg-material-chrome-bg-dense` | dialog.css, forms.css |
| `--wg-bg-deep` | 14 | `--wg-block-background` | dialog.css, keys.css, sessions.css, docs.css, forms.css, shell.css |
| `--wg-surface` | 6 | `--wg-card-background` | dialog.css, shell.css |
| `--wg-surface-hover` | 11 | `--wg-list-hover-background` | index.css, dialog.css, forms.css |
| `--wg-surface-selected` | 8 | `--wg-list-active-background` | forms.css |
| `--wg-change-added` | 4 | `--wg-diff-inserted-mark` | |
| `--wg-change-changed` | 3 | `--wg-diff-changed-mark` | |
| `--wg-change-removed` | 4 | `--wg-diff-removed-mark` | |
| `--wg-font-ui` | 1 | `--wg-font-ui` (unchanged) | |
| `--wg-font-mono` | 14 | `--wg-font-mono` (unchanged) | |
| `--wg-font-ui-size` | 1 | `--wg-text-ui` | |
| `--wg-font-mono-size` | 12 | `--wg-text-mono` | |
| `--wg-whichKey-command` | 1 | `--wg-keys-which-key-command` | |
| `--wg-whichKey-prefix` | 1 | `--wg-keys-which-key-prefix` | |
| `--wg-origin-caused` | 1 | `--wg-forms-origin-caused` | |
| `--wg-origin-preExisting` | 1 | `--wg-forms-origin-pre-existing` | |
| `--wg-origin-design` | 1 | `--wg-forms-origin-design` | |
| `--wg-origin-nit` | 1 | `--wg-forms-origin-nit` | |
| `--wg-severity-critical` | 1 | `--wg-forms-severity-critical` | |
| `--wg-severity-important` | 1 | `--wg-forms-severity-important` | |
| `--wg-severity-minor` | 1 | `--wg-forms-severity-minor` | |
| `--wg-status-bar-height` | 1 | stays (runtime) | |

## Reference pattern (every file)

Replace each `var(--wg-<old>)` by the map's default, unless the file's notes name the rule (selector and property) for
another; leave everything else on the line as it is. Line numbers are at plan time; find a rule by its selector. A
file is done when `grep -nE -- '--wg-(text|text-muted|text-faint|text-onAccent|recommend|border|border-focus|success|warning|error|info|selection|bg-base|bg-pane|bg-deep|surface|surface-hover|surface-selected|change-added|change-changed|change-removed|font-ui-size|font-mono-size|whichKey-command|whichKey-prefix|origin-[a-zA-Z]+|severity-[a-z]+)\)' <file>`
prints nothing.

## Files

- **`src/renderer/index.css`** (15 uses) — `body` `background`: `--wg-bg-base` → `--wg-window-background` (L0);
  `body` `scrollbar-color`: `--wg-surface-hover` → `--wg-border-strong`. `kbd` keeps `card-background` (plan B's Kbd
  replaces it).
- **`src/shared/page/dialog.css`** (17) — `.overlay` `background`: the `color-mix(…)` → `var(--wg-scrim)`;
  `.dialog` `background`: `--wg-bg-pane` → `--wg-material-floating-bg` (L3); `.button` `background`:
  `--wg-surface` → `--wg-button-secondary-background`; `.button:hover`: `--wg-surface-hover` →
  `--wg-button-secondary-hover`; `.button-primary` and `.button-primary:hover` stay on `--wg-accent` (plan B's Button
  takes `button-primary-*`).
- **`src/shared/page/markdown.css`** (27) — `.md code` and `.md pre` `background`: default `block-background` (code
  blocks). `.md-pill`'s `background: var(--wg-border)` → `--wg-border-strong` (a filled pill, kept visible); its
  `color` → `--wg-fg-on-accent`.
- **`src/plugins/keys/page/keys.css`** (17) — `.which-key` `background`: `--wg-bg-deep` →
  `--wg-material-floating-bg` (L3); `.keys-bar` `background`: `--wg-bg-deep` → `--wg-material-chrome-bg` (status bar,
  L1); `.which-key` `bottom: var(--wg-status-bar-height)` stays.
- **`src/plugins/sessions/page/sessions.css`** (22) — rename all of it, the side bar rules task 04 later removes
  included; `.session-sidebar` `background`: default
  `material-chrome-bg-dense`; `.sessions.is-sidebar-over .session-sidebar` `box-shadow` colour: `--wg-bg-deep` →
  `--wg-window-background`; `.session-tabs` `background`: `--wg-bg-deep` → `--wg-material-chrome-bg` (tab strip, L1);
  `.session-tab.is-active` `background`: `--wg-bg-base` → `--wg-tab-active-background`, its `border-top-color`:
  `--wg-accent` → `--wg-tab-active-indicator`.
- **`src/plugins/docs/page/docs.css`** (26) — `.docs-box` `background`: `--wg-bg-deep` → `--wg-input-background`;
  `.docs-overlay` `background`: the `color-mix(…)` → `var(--wg-scrim)`.
- **`src/plugins/chat/page/chat.css`** (27) — `.chat-tool-result` `background`: default `block-background`. No other
  exception.
- **`src/plugins/forms/page/forms.css`** (97) — `.rail` `background`: `--wg-bg-pane` → `--wg-block-background` (the
  rail is a solid L2 pane; mantle keeps today's look); `.round-overview code` and `.status-line` `background`: default
  `block-background`; `.action-pick:hover`, `.verdict-button:hover`, `.toggle:hover` `background`:
  `--wg-surface-hover` → `--wg-button-secondary-hover` (buttons, not rows); `.toggle[aria-pressed='true']`
  `background`: `--wg-surface-selected` → `--wg-button-secondary-hover`. The five `--wg-recommend` uses
  (`.choice.is-recommended .choice-number` border and colour, `.action-pick.is-recommended`, `.badge-recommend`,
  `.verdict-accept`) take `--wg-accent`. `.badge`'s `color` → `--wg-fg-on-accent`; the seven `.badge-origin` /
  `.badge-severity` backgrounds take the forms plugin tokens from the map.
- **`src/renderer/shell/shell.css`** (15) — rename all of it: `.shell-activity-bar` `background`: `--wg-bg-deep` →
  `--wg-material-chrome-bg`; `.shell-side-bar` `background`: `--wg-bg-pane` → `--wg-material-chrome-bg-dense`; `.toast`
  `background`: `--wg-surface` → `--wg-material-floating-bg` (L3); `.status-error` `background`: `--wg-bg-deep` →
  `--wg-material-chrome-bg`; every other use by the default. Task 04 later restructures the file on these names.

## Tests

No unit test: a stylesheet's variable names are checked by the registry check below and the look by task 08.

## Done when

- `npm run typecheck`, `npm run lint`, `npm test` and `npm run selftest` pass.
- The registry check prints nothing — every `var(--wg-…)` under `src/` names a core token, a plugin token's variable or
  a runtime variable (the `printf` list):

  ```sh
  cd /Users/jonathonwigley/Documents/dev/wigley-ai-gui && comm -23 \
    <(grep -rhoE --exclude='*.test.ts' 'var\(--wg-[A-Za-z0-9_-]+' src | sed 's/^var(--wg-//' | sort -u) \
    <({ grep -oE "^  '[a-z0-9_-]+'" src/config/theme-tokens.ts | tr -d " '"; printf '%s\n' status-bar-height \
      keys-which-key-command keys-which-key-prefix forms-origin-caused forms-origin-pre-existing forms-origin-design \
      forms-origin-nit forms-severity-critical forms-severity-important forms-severity-minor; } | sort -u)
  ```

- `grep -rnE --exclude='*.test.ts' -- '--wg-[A-Za-z0-9_-]*[A-Z]' src` prints nothing (no camel-case name survives).
- The look — no view with unset colours, the recommended choice in the accent — is checked in task 08.

## Proof

