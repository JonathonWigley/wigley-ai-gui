# 02 — Move the session Docs tab into `docs-session-tab`

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/docs-session-tab/manifest.ts` · `src/plugins/docs-session-tab/page/start.ts` · test `src/plugins/docs-session-tab/page/start.test.ts` · modify `src/plugins/docs/page/start.ts` · `src/plugins/docs/contract.ts` · `src/plugins/docs/manifest.ts` · `src/plugins/docs/page/docs-state.ts` · `src/plugins/docs/main/start.ts` (comments and drive text) · `src/plugins/docs/main/selftest-script.ts` (comment) · `src/plugins/manifests.ts` · `src/plugins/page.ts` · `src/config/settings.ts` · test `src/plugins/docs/page/start.test.ts`
Consumes:  `DocsPageExports.addView(sourceId, { isVisible })`, `docsPageKey`, `sessionSourceId`, `UNSAVED_TEXT` (move or export as needed), `SessionsPageExports.addTab`, `sessionsPageKey`, `sessionsRowsSlot`, `followRows` — all in the tree
Produces:  `DocsViewHandle.sourceReplaced(): void` in `src/plugins/docs/contract.ts` (rebuilds the view after its source was replaced, as `DocsView.sourceReplaced` does today; nothing before the view first ran)
           plugin `docs-session-tab`: manifest `dependsOn: { main: [], page: ['docs', 'sessions'] }`, `reads: { main: [], page: [] }`, no commands, scopes, settings or tokens; page part only
           default `plugins.disabled` = `['agent-lines', 'usage-tab-line', 'docs-session-tab']` in `src/config/settings.ts`
Decisions: Docs tab is its own plugin, disabled by default (interview Q5) · per-session index sources stay in docs main (data plugin; the index script runner is docs-internal) · docs page drops its `sessions` dependency

## What to build

- **Move** `addSessionDocs`, `disposeSessionDocs`, `removeSessionDocs`, the `sessionDocs` map, the `core.pageReady`
  `followRows` handler and the tab's unsaved-edits `beforeClose` out of `src/plugins/docs/page/start.ts` into
  `src/plugins/docs-session-tab/page/start.ts`, rebuilt on `addView` and `addTab`; `hostChanged` calls the handle's
  new `sourceReplaced()`. Tab view unchanged: `id: 'docs'`, `title: 'Docs'`, `icon: 'book'`, `order: 1`, the same
  toast on unsaved edits. The `Docs tab added for <folder>` log moves with it (now under `[docs-session-tab]`); grep
  every self-test or test waiting on `[docs] Docs tab added` and update it. The generic `addView` code (its
  `Docs tab shown` log, `SESSION_TREE_SPLIT`, `sessionTree`) stays in docs.
- **`UNSAVED_TEXT`** moves to `docs/contract.ts` (defined once) and `docs/page/docs-state.ts` re-exports it, so the
  doc view and the tab show one string and `docs-session-tab` imports only the two contracts.
- **Drive and self-test text** naming an always-present Docs tab gets the qualifier "with `docs-session-tab` on
  (disabled by default; the self-test starts it)": `docs/main/start.ts:159`, `:184` (the `connectSession`
  description), `:266`, and `docs/main/selftest-script.ts` ~1165.
- The part's `dispose` disposes every held tab before its view (today's order), and a throw in one does not skip the
  rest (`callEach`).
- `docs/manifest.ts`: page `dependsOn` loses `sessions`; main keeps it (session sources, self-test, drive). Fix the
  manifest's header comment, `docs/contract.ts` comments naming the per-session Docs tab, and `docs/page/start.ts`'s
  header comment.
- Register the plugin in `src/plugins/manifests.ts` and `src/plugins/page.ts`, right after `docs` (no main part, so no
  `main.ts` entry). `src/plugins/manifests.test.ts`' disabled-dependency check must stay green: nothing depends on
  `docs-session-tab`.
- Self-test needs no change for the tab's groups: `applySelfTestConfig` empties `plugins.disabled`.

GIVEN default settings WHEN the app starts THEN no session gets a Docs tab and Docs mode works as before
GIVEN `docs-session-tab` started WHEN a session row arrives THEN it gets the Docs tab over `session:<id>`; WHEN the row's host id changes THEN only that row's view rebuilds; WHEN the row leaves THEN its tab and view are disposed
GIVEN unsaved edits in a session's Docs tab WHEN the session closes THEN the close is refused with the unsaved toast
GIVEN the plugin stops THEN it leaves no live registration, even when one tab's dispose throws

Tests:     move `stop_LeavesNoLiveRegistration` (its "one Docs tab held" row), `stop_OneSessionsTeardownThrows_TearsDownEveryView` and `rows_HostChangedOrRemoved_ReachOnlyThatRowsView` with the `fakeSessions` helper from `src/plugins/docs/page/start.test.ts` to `src/plugins/docs-session-tab/page/start.test.ts`, over a fake docs `addView` dependency; docs' own `start.test.ts` keeps its `addView` tests and gains a row for `sourceReplaced` on an added view (before first run: no rebuild; after: rebuild). New in `docs-session-tab/page/start.test.ts`: the row-arrival test asserts `addView` got `sessionSourceId(id)` and `addTab` got `id 'docs'`, `title 'Docs'`, `icon 'book'`, `order 1`; one row where the fake handle's `hasUnsavedEdits` is true asserts `beforeClose()` returns false and the toast is `UNSAVED_TEXT` with tone `error`. A row in the settings defaults test (or `manifests.test.ts`) asserts the default `plugins.disabled` holds `docs-session-tab`.
Done when: `npm test` and `npm run lint` pass (`check-layers.mts` finds the new folder in all three lists it checks); the test gate runs the tests above plus `npm run selftest -- --plugin docs`
Commit:    one commit for the group

## Proof

Commit e79f0073 · proof: diff read; tsc --noEmit and npm run lint clean after wave 1; worker's targeted tests green · concerns: none beyond rulings; docs' own test no longer covers addView teardown when an anchor dispose throws (moved to docs-session-tab)
