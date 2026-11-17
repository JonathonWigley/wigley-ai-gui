# 08 — DrawnPart reports drewBundled

Status: not started
Type: Task
Rung: standard · replaces one field of `DrawnPart` with its inverse-kind twin, following the existing `drewPick` field and its table test; no other group consumes it
Wave: 4 · Depends on: 07 (`entry-list.ts`), 09 (`draw-part.ts`), 10 (`primer-view.ts`)
Plan: [plan.md](plan.md)

Fixes follow-up **`DrawnPart` reports which layout object drew** (`docs/features/followups.md`; find it with
`grep -n -F` on the title): chat's entry list re-derives `drawPart`'s bundled-pick check as
`isBundledView: !drawn.drewPick || pick.layout === defaultLayout`, copying `isBundledPick` in `draw-part.ts`. Have
`drawPart` report whether the bundled default object drew and use it in chat, so the rule lives in one place.

Files:
- modify `src/shared/page/layout-host/draw-part.ts`
- test `src/shared/page/layout-host/draw-part.test.ts`
- modify `src/plugins/chat/page/entry-list.ts`
- test `src/plugins/chat/page/entry-list.test.ts`
- modify `src/plugins/primer/page/primer-view.ts`
- test `src/plugins/scoped-agents/page/agent-pane.test.ts`
- test `src/plugins/practice/page/import-box.test.ts`

Preconditions (run from the `wigley-ai-gui/` folder of the merged `main`):

| Claim | Command | Expected |
|---|---|---|
| `drewPick` is read outside `draw-part.ts` only by chat and primer | `grep -rn 'drewPick' src --include='*.ts' \| grep -v 'test\|layout-host/draw-part.ts'` | `primer-view.ts`: `const layout = drawn.drewPick ? pick.layout : defaultLayout;` and `entry-list.ts`: `isBundledView: !drawn.drewPick \|\| pick.layout === defaultLayout,` |
| Test literals that build a `DrawnPart` | `grep -rln 'drewPick' src --include='*.test.ts'` | `draw-part.test.ts`, `agent-pane.test.ts`, `import-box.test.ts` |
| No `drewBundled` yet | `grep -rn 'drewBundled' src \| wc -l` | `0` |

Consumes: nothing. Follows 07 in `entry-list.ts`, 09 in `draw-part.ts` and 10 in `primer-view.ts` (shared files only).

Produces: in `src/shared/page/layout-host/draw-part.ts`,
`export interface DrawnPart<R> { built: R; layoutName: string; drewBundled: boolean; dispose(): void; }` —
`drewPick` is removed.

Decisions:
- **Replace, not add.** `drewBundled` is true when the `defaultLayout` object itself drew: the bundled default picked,
  or the fallback after the picked layout lacked the part or threw. Both readers need exactly that (chat: whether the
  bundled default drew; primer: which layout object drew, `drawn.drewBundled ? defaultLayout : pick.layout`), so
  `drewPick` has no reader left and goes; keeping both would leave two fields describing one fact.
- In `drawPart`, the bundled attempt passes `true` and the picked attempt `false` (`attempt`'s last parameter renamed
  `drewBundled`). The `DrawnPart` comment reads: "whether `defaultLayout` itself drew it: picked, or in the picked
  layout's place".
- Chat: `isBundledView: drawn.drewBundled`. The `DrawnEntry` comment's "`isBundledView` while it is the bundled
  default layout's or the bare line" stays true.
- Test fakes returning a `DrawnPart` literal (`agent-pane.test.ts`, `import-box.test.ts`) set `drewBundled: true` in
  place of `drewPick: false` (each fakes the bundled default drawing, layout name `default`).

GIVEN each row of the existing table WHEN `drawPart` runs THEN `drewBundled` is: user layout draws → false; user layout
lacks the part → true; user layout throws → true; the bundled default picked as default → true; a live default draws
→ false; a live default throws → true; a live default lacks the part → true. `layoutName`, text, dataset and log lines
stay as the table has them.

GIVEN the shown user layout lacks an entry kind, so the bundled default draws it, WHEN that view's `update` throws THEN
chat logs `default layout <kind> entry update failed: …` and does not set the slot's `drawsWithDefault` (no
"drawn with default" toast; each later update re-picks and logs again). This is the `true` branch of
`isBundledView: drawn.drewBundled`, which no existing chat test reaches: the `update throws …` rows of the
`buildEntry` table log `layout fancy …` or a live default's `layout default …` line, the `false` branch.

Tests:
- `draw-part.test.ts`: the table test renamed `drawPart_DrewBundled_TrueOnlyWhenTheBundledDefaultDrew: $row`, its
  `drewPick` column replaced by `drewBundled` with the values above.
- `entry-list.test.ts`, the `buildEntry: $name` table (`rows`): the `Row` interface gains
  `defaultUpdateThrows?: EntryKind` ("The kind whose default builder draws a view whose update throws"), and the
  test, beside its `breakDefault` spy, spies `defaultLayout.entries[row.defaultUpdateThrows]` with the file's
  `updateThrows` builder. New row, after `update throws under a live default`: name `'update throws in the bundled
  default drawn for a kind the shown layout leaves out'`, `shown: 'fancy'`, `fancy: { assistant: undefined }`,
  `defaultUpdateThrows: 'assistant'`, puts `assistant('one')`, `assistant('two')`, `assistant('three')`, logs
  `default layout assistant entry update failed: broken update` once per update (two lines), toasts `[]`,
  `disposedAnchors` `[]`, slots as the run draws them (one slot holding the `updateThrows` view under the default
  layout's `data-layout`). It fails if the inversion is wrong: a `false` there logs `layout fancy …` and toasts.
- Chat's and primer's existing tests that cover a user layout's entry or card falling back to the default (run the
  `entry-list.test.ts` and `primer-view.test.ts` suites) pass unchanged.

Done when: compiles (`npm run typecheck`); `npm test` runs `draw-part.test.ts`, `entry-list.test.ts` (with the new
row),
`primer-view.test.ts`, `agent-pane.test.ts` and `import-box.test.ts` green;
`grep -rn 'drewPick' src` prints nothing.

Commit: one commit, "Layout host: DrawnPart reports drewBundled, and chat and primer read it in place of re-deriving
the bundled check (follow-up: DrawnPart reports which layout object drew)".

## Proof

