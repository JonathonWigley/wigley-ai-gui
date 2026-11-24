# 06 — Doc re-read, changelog and README

Status: not started
Type: Batch
Rung: standard · doc-only work against settled code
Wave: 6 · Depends on: 05 (reads every landed task's code)
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/docs/features/work-inbox/design.md`
- modify `wigley-ai-gui/DESIGN.md`
- modify `wigley-ai-gui/docs/keymap.md`
- modify `wigley-ai-gui/CHANGELOG.md`
- modify `wigley-ai-gui/README.md`
- modify `wigley-ai-gui/AGENTS.md` (the work `contract.ts` line, about line 432 at plan time, re-verify)

Consumes:  the landed code of 01, 02, 03, 04 and 05
Produces:  docs that match the landed code, with no "planned in `board-detail-pane`" mark left
Decisions: the docs written ahead are the spec; the code is the fact. Where they differ, fix the doc and record the
           difference in the plan's Run log under Rulings · README and CHANGELOG follow `AGENTS.md` § README,
           changelog and boundary

Steps:

1. Read `design.md` § Detail pane, § Settings, § Keys and § Decisions line by line against the landed code. Fix
   every stale line. Remove every "planned in `board-detail-pane`" mark and the § Detail pane opening line that says
   `Enter` still opens Jira or Slack.
2. Replace the two `Enter` rows in § Keys: `Enter` now opens or closes the detail pane. Keep the `gx`, `i` and
   `Ctrl+j`/`Ctrl+k` rows, with the exact keys 05 bound.
3. Read `DESIGN.md`'s Inbox and Board bullets against the landed views and layouts. Fold each "Planned in
   `board-detail-pane`" sentence into the bullet as present-tense fact. Update the Inbox card description to the slim
   card and the pane.
4. In `docs/keymap.md`, add the Board pane and the Inbox pane to the list of views that take the `Ctrl+j`/`Ctrl+k`
   and `Ctrl+Shift+j`/`Ctrl+Shift+k` scroll keys (the § Ctrl+hjkl bullet). In the sentence that lists "The Inbox's and
   the Board's own keys" (about line 122 at plan time), add `Enter` the detail pane, `gx` Jira or Slack, `i` the
   pane's box on the Board, and the pane's `Ctrl+j`/`Ctrl+k` scroll.
5. In `README.md`, update the `record_work_tickets`, `record_work_items` and `read_work_state` rows of the tools
   table to say what each now carries (detail, thread detail, stored detail stamps). In the settings table's `work`
   row (about line 178), add `work.detailComments` and `work.threadReplies`. In `AGENTS.md`, the line describing the
   work plugin's `contract.ts` names only the `work.state` slot: add `work.details` and the comment contract.
6. In `CHANGELOG.md` under `## Unreleased`, creating the `### Added` and `### Changed` headings when absent, add one
   line per item listed: `### Added` — the Board and Inbox detail pane;
   comments on Jira tickets from the Board pane; a reply box on every Inbox thread; `work.detailComments` and
   `work.threadReplies`. `### Changed` — `Enter` opens the detail pane; `gx` opens Jira or Slack; Inbox cards slim
   down while the pane is open.

Done when (from `wigley-ai-gui/`): `grep -rn "board-detail-pane" docs DESIGN.md` prints only lines under the plan
           folder · `npm run lint:changelog` passes
Commit:    one commit for the group
Bookkeeping: tick this task's box in `plan.md`

## Proof

