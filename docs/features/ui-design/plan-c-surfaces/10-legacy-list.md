# 10 — Remove the style check's legacy list

Status: not started
Type: Task
Wave: 5 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09
Plan: [plan.md](plan.md)

Files:     modify `scripts/check-styles.mts` · modify `scripts/style-rules.mts` · modify `scripts/style-rules.test.mts` · delete `src/shared/page/dialog.css` · modify `src/shared/page/dom.ts`
           (`appendKeys` leaves) · modify `src/renderer/index.css` (the global `kbd` rule leaves) · modify any file
           under `src/` the full check fails (the stragglers; see **Stragglers**)
Consumes:  `const LEGACY_FILES: string[]` and the `--no-legacy` flag in `scripts/check-styles.mts` ← plan B task 03 (after plan B) ·
           `cssViolations(css, allowsBackdropFilter)` and `inlineStyleViolations(fileName, source)` in
           `scripts/style-rules.mts` ← plan B task 03 (after plan B), unchanged here ·
           `legacyListProblems` in `scripts/style-rules.mts` and its tests in `scripts/style-rules.test.mts` ← plan B task 03 ·
           every surface stylesheet rebuilt onto tokens ← 01–09 ·
           no file under `src/` imports `dialog.css`, uses its classes or calls `appendKeys` ← 01, 04, 06, 08 (each
           drops its own; 02's table lists every user)
Produces:  `scripts/check-styles.mts` with no `LEGACY_FILES`, no `--no-legacy`, and no legacy-entry checks: every
           `*.css`, `*.ts` and `*.js` under `src/` but `*.test.ts` is judged on every run · `src/shared/page/dialog.css`,
           `appendKeys` in `src/shared/page/dom.ts` and the global `kbd` rule in `src/renderer/index.css` gone
Decisions: the list goes whole, not emptied, so no later change can park a file on it (plan.md: "task 10 deletes
           the list") · the script still reads its arguments and rejects any one with
           `check-styles: unknown argument <arg>`, exit 1, so a stale `--no-legacy` in a script or a doc fails
           loud instead of passing as a plain run (drafter) · a straggler is fixed to the token of its role, never
           exempted: a size with a role token takes it (`toolbar-height`, `statusbar-height`, `activitybar-width`,
           `icon-button`, `icon-size`, `row-*`, `tab-height`, `radius-*`, `sidebar-width`); otherwise its px value
           (1rem = 16px) as a `space-*` step, as `calc(var(--wg-space-N) * k)` when that equals it exactly, else
           the nearest step (plan B task 03's rule) · a raw colour, duration or font stack in a straggler is a
           token no task named: stop and report it with file and line, since a new token is a `DESIGN.md` change
           (DESIGN.md § Tokens and themes) · the rules in `scripts/style-rules.mts` do not change, only
           which files they reach · `legacyListProblems` in `scripts/style-rules.mts` and its three
           tests in `scripts/style-rules.test.mts` check only the list, so they go in the same change as `LEGACY_FILES`
GIVEN the list removed WHEN `npm run lint` runs THEN every file under `src/` is judged and the run prints `styles: <n> files clean`
GIVEN `node scripts/check-styles.mts --no-legacy` WHEN it runs THEN it prints `check-styles: unknown argument --no-legacy` and exits 1
Tests:     none new: the walk has no unit tests (plan B task 03 put the rules, which are tested, in
           `style-rules.mts`); the lint run is the proof
Done when: `grep -n 'LEGACY\|no-legacy\|legacy list' scripts/check-styles.mts` prints nothing;
           `test -e src/shared/page/dialog.css` fails; `grep -rn 'appendKeys\|dialog.css' src` prints nothing;
           `grep -nE '^kbd' src/renderer/index.css` prints nothing;
           `npm run lint` passes and its output holds `styles: ` followed by a count and ` files clean`;
           `node scripts/check-styles.mts --no-legacy` exits 1 with the unknown-argument line;
           `npm run typecheck`, `npm test` and `npm run selftest` pass; each straggler fixed is named in the proof with its file, line and the
           token it now reads
Commit:    one commit for the group: `Style check judges every file: the legacy list, --no-legacy and the retired dialog styles are gone`

## The script change (`scripts/check-styles.mts`)

| Part | Now (plan B task 03) | After |
|---|---|---|
| `LEGACY_FILES` and the comment above it | the files plan C rebuilds | removed |
| per-entry checks (under a fixed folder, missing from `src/`, passing every rule) | failures and a stdout note | removed |
| argument handling | `--no-legacy` accepted; any other argument fails | no argument accepted; each prints `` `check-styles: unknown argument ${arg}` `` and exits 1 |
| the walk | skips a legacy file's violations unless `--no-legacy` | judges every file, `materials.css` alone allowed `backdrop-filter` |
| the summary line | `styles: <n> files clean, <m> on the legacy list` or `…, legacy list ignored` | `` `styles: ${clean} files clean` `` |

`package.json`'s `lint` and `lint:fix` already run `node scripts/check-styles.mts` (plan B task 03) and stay.

## Retired dialog styles

Every user of `dialog.css`, `appendKeys` and raw `<kbd>` hints converted in wave 2 (01 keys, 04 forms, 06 chat, 08
docs; 02's table lists them). First re-run `grep -rn "dialog.css\|'overlay'\|'dialog \|dialog-title\|dialog-text\|dialog-actions\|button-primary\|button-danger\|key-hint\|appendKeys\|element('kbd'" src`:
a hit is a straggler in its task's file, fixed here onto the primitive that task used. Then delete
`src/shared/page/dialog.css` (and its `LEGACY_FILES` entry with the list), `appendKeys` and its doc comment in
`dom.ts`, and the `kbd { … }` rule in `index.css`. The self-test must pass after the deletion.

## Stragglers

First run `node scripts/check-styles.mts --no-legacy` before editing the script: its output is the straggler list.
Every surface task proved its own files with that flag, so a straggler is a file no task's proof covered. Where
they are likely, measured at plan time, re-verify:

- inline styles in TS or JS: a `.style.<prop> = `…`` or `setProperty('<prop>', …)` with a unit, in a builder a
  task added or moved (`src/renderer/toasts.ts`, `src/renderer/log-view.ts`, `src/shared/page/list-picker.ts`,
  a forms or chat page builder); today only `src/plugins/docs/page/tree-view.ts:77` writes one, which 08 removes
- the default layouts `src/plugins/forms/layouts/default/layout.js` and `src/plugins/chat/layouts/default/layout.js`,
  which 04 and 06 rework onto the kits; inline style writes there are judged like any `.js`
- a stylesheet no plan C task owns that plans A or B left on the list (compare the list in the script before
  deleting it with the files 01–09 own in plan.md § File ownership)

A straggler under a task's owned files is fixed here all the same, since every task has landed; the proof names
the task whose file it was.

## Live checks

None of its own; a straggler fixed in a stylesheet adds its surface to [12](12-final-verification.md)'s screenshot read as "spacing moved to a token step" (expected).

## Proof
