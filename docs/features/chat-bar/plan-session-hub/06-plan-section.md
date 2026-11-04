# 06 — Plan section

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/workflow/page/workflow-view.ts` · modify `src/plugins/workflow/page/start.ts` · modify `src/plugins/workflow/page/workflow.css` · modify `src/plugins/workflow/layouts/default/layout.css` · test `src/plugins/workflow/page/workflow-view.test.ts`
Consumes:  `ChatSidePart`, `ChatSideSection`, `.chat-side-section-body` ← 01
           `WorkflowView.sidePart`, `SidePaneInput.checked`, `SidePaneInput.total`, `.workflow-side-pane`, `.workflow-side-list` (the side pane plan, in the tree at the run)
Produces:  `WorkflowView.sidePart: ChatSidePart` with id `workflow.sidePane`, title `Plan`, order 20
Decisions:
- `workflow-view.ts` changes `sidePart`'s type from `ContributedPart` to `ChatSidePart`, and adds `title` and `order`. `start.ts` drops the wrap that task 01 added and passes `view.sidePart`.
- The pane sets the section's summary each time it draws: `` `${checked}/${total}` `` while it draws a plan, with `total` above 0. Otherwise null. Idle, null progress and `setSidePaneHidden(true)` all set null.
- The pane draws nothing in those states, as the side pane plan pinned, so the frame hides through 01's rule.
- The CSS moves out of the pane, in the file where the side pane plan landed the rule. Leave a file with no pane rule unedited. The pane drops its own padding, because the section body holds it (01). `.workflow-side-pane` loses `width`, `height: 100%`, the left border and the background, because the holder holds them now. It becomes `flex: 0 1 auto; min-height: 0`, a column.
- `.workflow-side-list` keeps `overflow-y: auto` and `min-height: 0`, so the actions row stays in view while the list scrolls.
- `<Leader>ws` keeps hiding only this pane. `<Leader>wf` keeps folding waves. Neither key changes.
- The pane's title line stays. The frame's `Plan` title sits over it, because the pane's title names the plan, not the section.
GIVEN a session with a plan at 5 of 7 WHEN the pane draws THEN the section's summary reads `5/7`
GIVEN that session WHEN `setSidePaneHidden(true)` runs THEN the pane draws nothing and the summary is null
GIVEN a session with no plan WHEN the part builds THEN the wrapper's body is empty and the summary is null
GIVEN a session at idle, and a plan with `checked` 0 and `total` 0 WHEN the pane draws THEN the summary is null
Tests:     rows in the `workflow-view.test.ts` test that owns the side part, passing a fake `ChatSideSection` that records each `setSummary` value. Assert the recorded values `5/7` and null
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. The pane's look inside the section is a check in [09](09-final-verification.md)
Commit:    one commit for the group

## Proof

