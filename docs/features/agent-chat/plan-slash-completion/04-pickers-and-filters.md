# 04 — Pickers and `/` filters on the matcher

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/list-picker-state.ts`, `src/shared/page/list-picker.ts` · modify `src/plugins/chat/page/picker.ts`, `src/plugins/settings/page/settings-view.ts`, `src/plugins/docs/page/docs-dialogs.ts` (pass the matcher) · modify `src/plugins/settings/page/row-filter.ts`, `src/plugins/settings/page/keymap-view.ts`, `src/plugins/settings/page/setting-rows-view.ts` · modify `src/plugins/docs/page/docs-state.ts`, `src/plugins/docs/page/tree-view.ts`, `src/plugins/docs/page/docs-view.ts` · modify `src/plugins/chat/page/start.ts`, `src/plugins/settings/page/start.ts`, `src/plugins/docs/page/start.ts` (the only places `api.services.fuzzy` is read) · test `src/shared/page/list-picker-state.test.ts`, `src/plugins/settings/page/row-filter.test.ts` (modify: its existing tests gain the fake matcher), `src/plugins/docs/page/docs-state.test.ts`
Consumes:  `FuzzyMatcher` (`rank`, `matches`) and `PageServices.fuzzy` ← 01
Produces:  in `src/shared/page/list-picker-state.ts`: `export function visibleIndexes(state: PickerState, matcher: FuzzyMatcher): number[]`; `movePicker` and `filterPicker` take `matcher: FuzzyMatcher` as their last parameter
           in `src/shared/page/list-picker.ts`: `ListPickerDeps.matcher: FuzzyMatcher`
           deps fields, each `matcher: FuzzyMatcher`: `PickerDeps` (`chat/page/picker.ts`), `SettingsViewDeps` and `RowContext` (`settings-view.ts`; `RowContext` filled from `SettingsViewDeps` where it is built, ~line 526), `DocsViewDeps` (`docs-view.ts`), `TreeViewDeps` (`tree-view.ts`) and `DocsDialogsDeps` (`docs-dialogs.ts`), each filled by its plugin's `start.ts` from `api.services.fuzzy` or by `docs-view.ts` (~lines 302, 383) from `DocsViewDeps`
           in `src/plugins/settings/page/row-filter.ts`: `matchesSetting(row: SettingRow, query: string, matcher: FuzzyMatcher): boolean` · `matchesCommand(row: CommandRow, query: string, matcher: FuzzyMatcher): boolean`
           in `src/plugins/docs/page/docs-state.ts`: `visibleRows(tree, state, pathOf, matcher: FuzzyMatcher): TreeRow[]`
Decisions: every list picker ranks best match first, its own order breaking ties (round 3) · Settings rows, keymap rows and the Docs tree keep their order and only hide (Decided: a form's and a tree's order carry structure) · fuzzy on names, labels, ids, keys, accelerators, paths and titles; plain substring on a setting's description (round 3) · the matcher is handed in, never imported, so `src/shared/page` stays free of the adapter (AGENTS.md layers)
Items:
           1. **List picker** — `visibleIndexes` returns the indexes of `labels` that `matcher.rank` keeps, in rank order; an empty trimmed filter returns every index in order, as today. `movePicker` and the cursor rule in `filterPicker` (cursor stays while visible, else the first visible) read that order. Each `createListPicker` caller passes `matcher: api.services.fuzzy` (through its own deps where the plugin builds the picker in a helper).
           2. **Settings rows** — `matchesSetting`: `matcher.matches` on label and path, case-insensitive substring on description, any one true. `matchesCommand`: `matcher.matches` on label, id, each bind's keys and each accelerator. The Leader row's check in `keymapSection` (`'leader'` and the leader keys) uses `matcher.matches`. The matcher reaches `keymapSection` and `setting-rows-view.ts` through `RowContext` (add `matcher: FuzzyMatcher` to it, filled from `api.services.fuzzy` where settings builds the context).
           3. **Docs tree** — `visibleRows`' leaf test becomes `matcher.matches(filter, title) || matcher.matches(filter, path)`; the tree's order, group expansion and the empty-filter path stay as they are. `tree-view.ts` passes the matcher from its deps.
GIVEN picker labels `['src/plugins/chat', 'docs/features']` and filter `spc` WHEN visible THEN only index 0 shows
GIVEN labels where the second matches better than the first WHEN filtered THEN the second's index comes first
GIVEN a setting whose description holds `transparent` and filter `tpt` WHEN matched THEN it does not match through the description (substring only)
GIVEN a docs tree leaf titled `claude-stream` and filter `clstr` WHEN rows are built THEN the leaf shows under its expanded groups
Tests:     `list-picker-state.test.ts` (existing tests gain a matcher; add `visibleIndexes_Fuzzy_RanksBestFirst`, `filterPicker_CursorOnHiddenRow_MovesToFirstRanked`) · `row-filter.test.ts`: `matchesSetting_FuzzyLabel_Matches`, `matchesSetting_DescriptionIsSubstringOnly`, `matchesCommand_FuzzyKeys_Matches` · `docs-state.test.ts`: `visibleRows_FuzzyTitle_ShowsLeafUnderGroups`. Each test hands in a fake `FuzzyMatcher` written in the test (in-order subsequence over lower-cased text, so case-insensitive cases such as the docs test's `STYLE` filter still hold; a `rank` fake that orders by a score the test sets) — `src/shared/page` and plugins may not import `src/renderer/fzf`, and fzf's ranking is task 01's.
Done when: `npm run typecheck`, `npm run lint` and the tests above pass; live checks in task 07
Commit:    one commit for the group

## Proof

