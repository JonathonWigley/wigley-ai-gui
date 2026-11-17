# 14 — Tag gains the info tone

Status: not started
Type: Task
Rung: standard · adds a tone the way the existing ones are added (`ui-tag--running` over `status-running-tint` in `src/shared/page/ui/tag.css`) and a core token by `DESIGN.md` § Tokens and themes › Adding a token
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md` L530, "Info tone for the on-demand tag".

Files:     modify `src/shared/page/ui/tag.ts` · modify `src/shared/page/ui/tag.css` ·
           modify `src/shared/page/layout-host/kit.d.ts` · modify `src/config/theme-tokens.ts` ·
           modify `src/config/themes/catppuccin-mocha.json` · modify `src/plugins/docs/layouts/default/layout.js` ·
           modify `src/plugins/gallery/page/gallery-view.ts` · modify `DESIGN.md`

Preconditions (checked 2026-11-17 on `main` 9b671bd16, from the `wigley-ai-gui/` folder):

| Claim | Command | Expected |
|---|---|---|
| Neither `TagTone` union has `info` | `grep -c "'info'" src/shared/page/ui/tag.ts src/shared/page/layout-host/kit.d.ts` | `0` for each |
| The on-demand chip takes the accent | `grep -n "'on-demand': 'accent'" src/plugins/docs/layouts/default/layout.js` | `10:  'on-demand': 'accent',` |
| `status-info` exists with no tint token | `grep -n "status-info" src/config/theme-tokens.ts src/config/themes/catppuccin-mocha.json` | `'status-info': 'color',` and `"status-info": "blue",` only |
| Every other status tint is `<hue> / 0.12` | `grep -n "tint\": \"" src/config/themes/catppuccin-mocha.json` | `status-*-tint` lines at `/ 0.12` |
| The gallery's Tag samples | `grep -n "function tagCells" src/plugins/gallery/page/gallery-view.ts` | one line, near 443 |

Consumes:  nothing from another task
Produces:
- `TagTone` gains `'info'` in `src/shared/page/ui/tag.ts` and in `src/shared/page/layout-host/kit.d.ts` (the kit
  copy every user layout reads), placed after `'accent'` in both.
- `.ui-tag--info { background: var(--wg-status-info-tint); color: var(--wg-status-info); }` in `tag.css`, after
  `.ui-tag--accent`.
- Core token `'status-info-tint': 'color'` in `src/config/theme-tokens.ts`, after `'status-error-tint'`; Mocha value
  `"status-info-tint": "blue / 0.12"` in `catppuccin-mocha.json`, after `"status-error-tint"`.
- `CHIP_TONES['on-demand']` becomes `'info'` in `src/plugins/docs/layouts/default/layout.js`.
- Gallery: `['On demand', 'info']` in `tagCells`, after `['Recommended', 'accent']`.

Decisions:
- A core tint token, not a `color-mix` in `tag.css`: `DESIGN.md` § Colour has "a larger area takes the `*-tint`
  token" and § Tokens and themes has "a one-off value in a stylesheet is a token not yet named"; the five status tints
  are tokens at `/ 0.12`, so the info tint matches them. A user theme lists only what it changes over `extends`, so
  the new core token needs no user edit.
- `info` sits after `accent` in the union and the gallery, the order the tones read from calm to status.
- Only the on-demand chip changes tone. `listed` stays neutral, so `on-demand` and `listed` no longer read the same;
  every other `TagTone` user keeps its tone.
- `DESIGN.md` edits, both made true by this change:
  - § Colour table, row "Links and info": tokens `fg-link`, `status-info`, `status-info-tint`; Use
    "Links; an informational Tag (the `info` tone: docs' `on-demand` load state)".
  - § Primitives, the Tag row: after "a small static label in a tone" add "(`neutral`, `accent`, `info`, `running`,
    `success`, `warning`, `attention`, `error`)".

GIVEN a docs entry whose load state is `on-demand` WHEN its chip draws THEN it is `span.ui-tag.ui-tag--info`, in
`status-info` over `status-info-tint`.

GIVEN the gallery (`Space z g`) WHEN the Tag section draws THEN it shows an `On demand` sample captioned `Info`.

GIVEN the built-in Mocha theme WHEN it resolves THEN it sets `status-info-tint` (the loader rejects a base theme
missing a core token).

Tests:     no new test: a tone name and a colour are copy and styling. The existing
           `src/main/built-in-themes.test.ts` (`'%s resolves and the title bar overlay takes it'`) fails if the token
           is registered without its Mocha value, and `src/shared/layouts/layout-contracts.test.ts`
           (`'every owner contract type-checks beside kit.d.ts'`) type-checks the docs layout's `CHIP_TONES` against
           the new union.
Done when: compiles (`npm run typecheck`); `npm test` runs `src/main/built-in-themes.test.ts` and
           `src/shared/layouts/layout-contracts.test.ts` green.
Commit:    one commit: "Tag: an info tone over a new status-info-tint token; docs' on-demand chip takes it
           (follow-up: info tone for the on-demand tag)".

## Proof

