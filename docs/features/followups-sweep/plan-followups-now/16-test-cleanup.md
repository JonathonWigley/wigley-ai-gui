# 16 — Test cleanup sweep

Status: not started
Type: Batch
Rung: standard · test-only edits and one helper reuse, each following a named pattern: sentence titles per `wigley:writing-tests` `typescript-vitest.md` § Naming (as `src/plugins/keys/page/which-key.test.ts`'s `'lists in a box only the editor binds firing in the pending scope'`), copy-free assertions as the 2026-10-27 audit left `src/plugins/forms/page/kinds/finding/verdict.test.ts` (`expect.any(String)` for chip text), and `isStringArray` from `src/shared/json.ts`
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-ups (`followups.md`): L792 "Primer tests on a full task's add-item box" · L798 "Tests that restate shipped
text" · L537 "isStringArray reuse" · L804 "One test naming style" for three of its five files
(`main-api.test.ts` and `docs-state.test.ts` go to `../plan-followups-after-lane-h/`, since Lane H edits both).

Files:     test `src/plugins/primer/page/primer-commands.test.ts` · test `src/plugins/forms/page/kinds/formats.test.ts` ·
           test `src/plugins/audio-picker/main/tool-definitions.test.ts` · test `src/plugins/sessions/page/tabs.test.ts` ·
           modify `src/shared/drive-args.ts` · modify `src/plugins/workflow/main/flow-store.ts` ·
           test `src/shared/page/layout-host/layout-loader.test.ts` · test `src/shared/layouts/layout-registry.test.ts` ·
           test `src/plugins/keys/page/which-key.test.ts`

Preconditions (checked 2026-11-17 on `main` 9b671bd16, from the `wigley-ai-gui/` folder):

| Claim | Command | Expected |
|---|---|---|
| The full-task box test mounts a box the page never shows | `grep -n "on a task holding 20 items'" src/plugins/primer/page/primer-commands.test.ts` | `608:` (the `opens the review and adds nothing…` test); `495:` (`focuses the add-item box, or refuses…`) is a different title and stays |
| A full task shows no add-item box | `grep -n "return entry.items.length < MAX_PRIMER_ITEMS" src/plugins/primer/page/boxes.ts` | one line, in `hasAddItemBox` |
| `commitNewItem` still guards a full task | `grep -n "entry.items.length >= MAX_PRIMER_ITEMS" src/plugins/primer/page/primer-commands.ts` | one line |
| `formats.test.ts` restates the rail prefixes | `grep -n "toBe('F1')\|toBe('N2')" src/plugins/forms/page/kinds/formats.test.ts` | lines 6 and 7 |
| The audio picker schema test restates the definitions' own constants | `grep -n "maxItems: MAX_\|enum: \[...PLAY_MODES\]" src/plugins/audio-picker/main/tool-definitions.ts` and `grep -n "the schema keeps parse's limits" src/plugins/audio-picker/main/tool-definitions.test.ts` | three `maxItems: MAX_…` lines and the `PLAY_MODES` enum; the test title at ≈line 62 |
| Parse's limits have their own tests | `grep -c "MAX_MOMENTS + 1\|MAX_CANDIDATES + 1\|MAX_VARIANT_FILES + 1" src/plugins/audio-picker/main/picker.test.ts` | `6` or more |
| `markToastText`'s test restates the joined copy | `grep -n "Turn finished in x — Space k s to read it" src/plugins/sessions/page/tabs.test.ts` | one line, near 287 |
| The inline copies of `isStringArray` | `grep -n "isStringList" src/shared/drive-args.ts src/plugins/workflow/main/flow-store.ts` | `drive-args.ts` 98 and 100; `flow-store.ts` 262 and 282 |
| `Name_Case_Result` titles in the three files | `grep -cE "'[a-z][A-Za-z]*_[A-Z][A-Za-z]*" src/shared/page/layout-host/layout-loader.test.ts src/shared/layouts/layout-registry.test.ts src/plugins/keys/page/which-key.test.ts` | `22`, `27`, `8` |

Consumes:  nothing
Produces:  no new symbol. `stringList` in `src/shared/drive-args.ts` and the flow-store reader keep their behaviour.

Decisions:
- **L792.** Retarget the :608 test at a stale box, the one way the guard in `commitNewItem` is reached: a box mounted
  while its task had room, the task filled while the box stayed. Setup: task `1` holds `MAX_PRIMER_ITEMS - 1` items
  (import `MAX_PRIMER_ITEMS` from `../contract`, in the existing import from that module); `setText` on
  `newItem1.target` with `'Fill the task'` and `dispatch({ type: 'addItem', formId: 'p1', entryId: '1' })` fill it to
  `MAX_PRIMER_ITEMS`; then `setText` `'Test the store'` on the same target and `logs.length = 0`. Run
  `openReview` with `{ editor: editorOf(newItem1) }`. Title: `'opens the review and adds nothing from an add-item box
  whose task filled after it mounted'`. The `:495` test and the `editFirstField` table's `a full task, as C` row stay.
- **L798**, per file:
  - `formats.test.ts`: rewrite the one test to what `itemLabel` promises without its prefix table — title
    `'labels one index apart for each kind and ends each label in the index'`; for kinds `finding`, `notice`,
    `question` at index `4`, the three labels are distinct (`new Set(labels).size` is `3`) and each ends in `'4'`.
  - `audio-picker/main/tool-definitions.test.ts`: delete the `"the schema keeps parse's limits ($field)"` table. The
    schema writes `MAX_MOMENTS`, `MAX_CANDIDATES`, `MAX_VARIANT_FILES` and `PLAY_MODES` straight in, so the test can
    only restate them; `picker.test.ts` pins parse refusing one past each cap. Delete what only it used: the
    `ListSchema` and `ObjectSchema` interfaces, `schemaOf`, `moments`, `candidates`, `candidate`, and the imports of
    `MAX_CANDIDATES`, `MAX_MOMENTS`, `MAX_VARIANT_FILES` and `PLAY_MODES`. The first test stays.
  - `sessions/page/tabs.test.ts`: rewrite the `markToastText` test so it does not spell the joining copy. With keys
    `'Space k s'`: the result starts with `mark.text` and contains `'Space k s'` and `mark.action`; with `null`: it
    equals `mark.text`. Title: `'markToastText names the keys and the action, or is the text alone with none bound'`.
  - `forms/page/kinds/finding/verdict.test.ts` and `forms/main/tool-definitions.test.ts` are not edited: see the
    item notes in the report (already copy-free; the `maxItems` assertion now pins the removed cap).
- **L537.** `stringList` in `drive-args.ts` uses `isStringArray(value)` from `./json` (joining the existing
  `isJsonObject` import) in place of its inline `isStringList`. `flow-store.ts`'s local `isStringList` is the same
  check: delete it, call `isStringArray` (add it to the existing `../../../shared/json` import). Both throw or read as
  before.
- **L804.** Every `Name_Case_Result` title in the three files becomes a sentence about the behaviour, lower-case first
  word, keeping the case's meaning and every interpolation (`($row)`, `: $row`, `$case`, `%s`, `($saved, from
  $started)`) at the same place in the title's meaning. The subject function's name may lead the sentence when the
  `describe` covers several (`layout-registry.test.ts`'s `start` and `watch` blocks need not repeat it). Examples:
  `load_SameRevision_ImportsOnce` → `'imports a layout once at the same revision'`;
  `watch_LayoutJsRemoved_SendsSetWithoutIt` → `'sends the set without a layout whose layout.js is removed'`;
  `whichKeyModel_NoCandidates_ReturnsNull` → `'returns null with no candidates'`. `describe` names and test bodies
  stay. No doc names these titles (`grep -rn` over `docs/`, `AGENTS.md`, `DESIGN.md` finds none).

GIVEN a primer task filled to `MAX_PRIMER_ITEMS` after its add-item box mounted WHEN `openReview` runs from that box
THEN the review opens, the task keeps `MAX_PRIMER_ITEMS` items, and the log is `[stringContaining('task 1'), 'review
opened']`.

GIVEN `drive-args`' `stringList` or the flow store's reader WHEN the value is not a list of strings THEN each refuses
as before (`stringList` throws naming the field).

Tests:     the rewritten or retargeted tests named in Decisions; no other new test. The existing
           `src/shared/drive-args.test.ts` (its `stringList` rows: `['a', 'b']` read, `['a', 1]` throws `/\bkeys\b/`)
           and `src/plugins/workflow/main/flow-store.test.ts` cover the L537 reuse.
Done when: compiles (`npm run typecheck`); `npm test` runs the nine test files above, `src/shared/drive-args.test.ts`
           and `src/plugins/workflow/main/flow-store.test.ts` green; the precondition's `Name_Case_Result` grep prints
           `0` for each of the three files.
Commit:    one commit: "Tests: retarget the full-task add-item test at a stale box, drop restated copy and limits,
           sentence titles in three files; reuse isStringArray (follow-ups: primer tests on a full task's add-item box,
           tests that restate shipped text, one test naming style, isStringArray reuse)".

## Proof
