# 14 — Test naming, the rest

Status: done
Type: Task
Rung: standard · renames test titles to the sentence form `typescript-vitest.md` § Naming gives, following the sentence titles already in `src/main/plugins/main-api.test.ts` (`"disposes the plugin's file watches, …"`); no test body changes
Wave: 2 · Depends on: 01 (both list `src/plugins/docs/page/tree-view.test.ts`), 02 (02's Tests and Done when name `docs-state.test.ts` rows by their old titles)
Plan: [plan.md](plan.md)

Follow-up **One test naming style** (`docs/features/followups.md`; find it with `grep -n -F` on the title), for the
two files Lane H edits:
`main-api.test.ts` and `docs-state.test.ts`. `plan-followups-now` renames the other files the item lists.

Files:
- test `src/main/plugins/main-api.test.ts`
- test `src/plugins/docs/page/docs-state.test.ts`
- test `src/plugins/docs/page/tree-view.test.ts` (only its two `$name_<suffix>` titles, for task 13's sweep of
  **`$name_<suffix>` vitest titles lose their case name**, which leaves this file because task 01 edits it in Wave 1)

Preconditions (run from the `wigley-ai-gui/` folder of the merged tree; checked 2026-11-17 on the Lane H branch):

| Claim | Command | Expected |
|---|---|---|
| Old-form titles in `main-api.test.ts` | `grep -nE "['\"\`][a-z][A-Za-z0-9]*_[A-Z\$][A-Za-z0-9\$]*" src/main/plugins/main-api.test.ts` | 11 lines, the titles in the table below. Lane P (tasks 02 and 04) also edits this file; on the merged code, rename every line this grep prints by the same rule |
| Old-form titles in `docs-state.test.ts` | `grep -cE "['\"\`][a-z][A-Za-z0-9]*_[A-Z\$][A-Za-z0-9\$]*" src/plugins/docs/page/docs-state.test.ts` | about 110 (titles, four `name:` row values, and `expandNewGroups_$name`) |
| No doc or source line names an old title | `grep -rnE 'provisionalEntry_\|applyChange_\|visibleRows_\|createMainApi_\|onDidRun_PartStops' src docs --include='*.ts' --include='*.md' \| grep -v '\.test\.ts:' \| grep -v 'docs/features/followups'` (the `\|` inside the pattern is the table's escape: the shell gets `-E 'a_|b_|…'`) | nothing (on the Lane H tree, 2026-11-17; the last filter also drops this plan's own task documents under `docs/features/followups-sweep/`) |

Consumes: nothing.

Produces: nothing.

Decisions:
- **The rule** (`typescript-vitest.md` § Naming): `describe` names the subject, and each `it` is a sentence about
  behaviour. Every `describe` in both files already names its function (`visibleRows`, `applyChange`,
  `createMainApi commands`), so a title drops its `subject_` prefix and turns `Case_Result` into one lower-case
  sentence stating the result under the case. A title's interpolation stays at its end (`… ($filter)`).
- **Table rows.** `expandNewGroups_$name` becomes `'$name'`, and each row's `name` becomes the sentence. This also
  avoids the `$name_<suffix>` trap (**`$name_<suffix>` vitest titles lose their case name**): vitest would read `$name_…` as one key.
- **`tree-view.test.ts`'s two broken titles** (the same follow-up: vitest reads `$name_…` as one key, so the title prints the
  literal): `'rowInput_$name_SelectedRowHoldsItsFields'` becomes `'the selected row holds its fields: $name'`, and
  `'$key_WikiLinkRow_CallsOpenWikiLinkWithFocusDoc_$focusDoc'` becomes
  `'$key on a wiki link row calls openWikiLink with focusDoc $focusDoc'`. Find them on the merged code with
  `grep -n "rowInput_\$name_\|\$key_WikiLinkRow" src/plugins/docs/page/tree-view.test.ts` (two lines). No other title
  in that file changes.
- **`describe` titles and test bodies are unchanged.** Only `it` / `it.each` titles and `name` row values change.
- **Pinned renames, `main-api.test.ts`:**

  | Old | New |
  |---|---|
  | `createMainApi_Data_IsScopedToThePluginFolder` | `scopes the plugin's data to its own folder` |
  | `createMainApi_SelfTest_IsTheHostForThePlugin` | `hands the plugin the self-test host` |
  | `createMainApi_Layouts_RunUnderThePluginId` | `registers the plugin's layouts under its id` |
  | `register_DisposedWithThePart_LeavesRegistryAndSlot` | `a registered command and its bind leave the registry and the catalog when the part's registrations are disposed` |
  | `register_OtherProcessDecl_Throws` | `register throws for a command that runs in the other process` |
  | `bind_ClashesWithRuntimeBindOfEitherProcess_ThrowsAtTheCall` | `bind throws at the call when its key clashes with a runtime bind of either process` |
  | `bind_OnDefaultOrUserKey_Accepted` | `bind accepts a key a default or user bind holds` |
  | `infoOf_OtherProcessRuntimeCommand_ReadsItsSlotBeforeTheServedConfig` | `runs another process's runtime command from its slot before the served config has it` |
  | `intercept_PartStops_WrapGone` | `an intercept's wrap is gone once the part stops` |
  | `onDidRun_PartStops_ListenerGone` | `an onDidRun listener is gone once the part stops` |
  | `bind_PartStops_LeavesTheCatalog` | `a bind leaves the catalog once the part stops` |

- **Pinned renames, `docs-state.test.ts`** (the rest follow the rule):

  | Old | New |
  |---|---|
  | `visibleRows_CollapsedGroup_HidesChildren` | `hides a collapsed group's children` |
  | `visibleRows_PathIsSubstringOnly ($filter)` | `matches a path only as a substring ($filter)` |
  | `visibleRows_HeadingMatch ($filter)` | `lists a doc's heading matches under it ($filter)` |
  | `visibleRows_WikiRows ($filter)` | `filters wiki shelves, labels, links and pages ($filter)` |
  | `treeRowAction_WikiRows ($given)` | `acts on a wiki row ($given)` |
  | `changeableEntry_NotALeaf_RefusedWithGroupText ($node.type)` | `refuses a row that is not a leaf with the group text ($node.type)` |
  | `treeRowStatus_WikiRows ($node.type)` | `draws a wiki row's status ($node.type)` |
  | row `NewGroup_ExpandedAndCollapsedStays` | `expands a new group and keeps a collapsed one collapsed` |
  | row `NestedNewGroup_BothExpanded` | `expands a nested new group and its parent` |
  | row `GroupGone_KeepsTheIds` | `keeps the ids of a group that is gone` |
  | row `NewLeaf_AddsNothing` | `adds nothing for a new leaf` |

GIVEN either file WHEN its tests run THEN every title reads as a sentence and every test passes as before.

Tests: none added or changed in behaviour. The suites' own runs are the check.

Done when: compiles; `npm test` passes `main-api.test.ts` and `docs-state.test.ts` with the same test count as before
the change (compare the two files' counts in the run's output); both old-form greps in Preconditions print nothing;
`tree-view.test.ts` passes with its test count unchanged; `git diff --stat` lists only the three files.

Commit: one commit for the group: "Tests: sentence titles in main-api and docs-state tests (follow-up: One test naming style, the files
Lane H edits)".

## Proof

Commit fc63ebd3e · proof: diff read: title-only renames in main-api, docs-state and tree-view tests; old-form and old-title-in-docs greps print nothing; typecheck and lint clean · concerns: tree-view.test.ts keeps other old-form titles outside the task's two
