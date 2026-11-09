# 12 — Settings shows a plugin's origin and problem

Status: done
Type: Task
Wave: 4 · Depends on: 10
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/settings/page/plugin-rows.ts` · test `src/plugins/settings/page/plugin-rows.test.ts`
- modify `src/plugins/settings/page/plugin-rows-view.ts` · test `src/plugins/settings/page/settings-view.test.ts`
- modify `src/plugins/settings/layouts/layout.d.ts` (`PluginRowInput`)
- modify `src/plugins/settings/layouts/default/layout.js`, `src/plugins/settings/layouts/default/layout.css`

Consumes: `PluginStatus.origin: PluginOrigin` and `PluginStatus.problem: string | null` ← 10. `on` says whether a
version runs, not whether the plugin failed (task 10, Status rows).

Produces:
- `plugin-rows.ts`: `export function originText(origin: PluginOrigin): string | null` — `'user'` → `'user'`,
  `'replaces-built-in'` → `'replaces built-in'`, `'built-in'` → null.
- `layout.d.ts`: `PluginRowInput` gains `originText: string | null;` (comment: "`user` or `replaces built-in`; null
  for a built-in") and `problem: string | null;` (comment: "Why the plugin failed to load or start; null when it did
  not fail").

Decisions:
- **Look** (DESIGN.md § Surfaces › Settings and § Primitives › Tag). The default layout draws, in the row's end and
  before the value, in this order: the error Tag `failed` when the row has a problem
  (`kit.tag(end, 'failed', 'error')`, class `settings-row-failed`), then the origin as a neutral Tag
  (`kit.tag(end, originText)`, class `settings-row-origin`), then the lock Tag as today, then the value.
- **The problem line.** `settingsRow`'s `lines` argument in `layout.js` gains an optional `problem: string | null`
  (add it to the JSDoc type). When it is a non-empty string, `settingsRow` draws it after the description line as
  `kit.el(row, 'div', 'settings-row-problem', problem)`, before `kit.box(row)`. The other rows pass no `problem`.
  In `layout.css`, `.settings-row-problem` has `color: var(--wg-status-error)` (the token
  `src/plugins/settings/page/settings.css` already uses), the description's font size, and wraps whole
  (`overflow-wrap: anywhere`).
- **Which Tag ellipsizes.** On a locked row the end stays `nowrap`, as today. Only the lock Tag ellipsizes:
  `.settings-row-failed` and `.settings-row-origin` get `flex: none`, beside the existing
  `.settings-row-end--locked > .settings-row-value { flex: none; }`.
- The value text stays `true`/`false`. It shows whether a version of the plugin runs (task 10's `on`), never the
  problem. A plugin whose last good version runs after a failed reload shows `true` with the `failed` Tag and the
  problem line. A plugin that runs no version shows `false` with both.
- The filter (`matchesPlugin`) is unchanged: it matches the label and the id only.
- **Copy, verbatim:** `user`, `replaces built-in`, `failed`. The problem text is the status's, unchanged.
- Task 15 writes this look into `DESIGN.md` (the Settings line for Plugins rows) and into
  `docs/features/settings/design.md` § Plugins section (origin Tags, the `failed` Tag, the problem line, and the rows
  of failed first loads with no manifest). This task edits neither doc.

GIVEN a status with origin `user` and no problem WHEN the Plugins section draws THEN the row's end holds a neutral Tag
`user` before the value, and no `failed` Tag
GIVEN origin `replaces-built-in` THEN the Tag reads `replaces built-in`
GIVEN origin `built-in` THEN the row draws no origin Tag
GIVEN a status with problem `Did not start: boom` THEN the row draws an error Tag `failed` and a `settings-row-problem`
line reading `Did not start: boom`
GIVEN a status with origin `user`, `on: true` and problem `Did not start: boom` (its last good version runs) THEN the
value reads `true`, and the row draws the `failed` Tag and the problem line
GIVEN a status with origin `built-in` and problem `needs plugin "z", which is not loaded` (a held-back replacement
gave way to the built-in, task 08) THEN the row draws the `failed` Tag and the problem line, and no origin Tag
GIVEN a locked row with origin `replaces-built-in` and a problem THEN the end holds, in order, `failed`,
`replaces built-in`, the lock Tag, the value

Tests:
- `plugin-rows.test.ts`, new table test `originText_EachOrigin` — rows: `built-in` → null, `user` → `user`,
  `replaces-built-in` → `replaces built-in`. Breaks if a built-in row gains a tag or the copy drifts.
- `settings-view.test.ts`, new `pluginRow_OriginAndProblem_DrawsTagsAndLine` — rows: built-in with no problem (no
  `settings-row-origin`, no `settings-row-failed`, no `settings-row-problem`); user (origin Tag `user`); replaced
  built-in with a problem (Tags `failed`, `replaces built-in` in that order, and the problem line text); user with
  `on: true` and no problem (no `settings-row-problem` element); locked replaced built-in with a problem (the end's
  children in order: `failed`, `replaces built-in`, the lock Tag, the value); user with `on: true` and a problem
  (value `true`, the problem line drawn); built-in with a held-back problem (`failed` Tag and problem line, no
  `settings-row-origin`). Breaks if the input fields do not reach the layout, or the Tag order
  drifts.

Done when: compiles; the tests above pass; `npm run selftest -- --plugin settings` passes. The look is checked live in
check 2, 6 and 7 of [16-final-verification.md](16-final-verification.md).
Commit:    one commit for the group.

## Proof

Commit 211756ee · proof: diff read; originText, PluginRowInput originText+problem, layout parts present; settings tests 155 pass; settings self-test deferred to the test gate (main.ts waits on 13) · concerns: settings self-test not yet run; a whitespace-only problem still draws a line
