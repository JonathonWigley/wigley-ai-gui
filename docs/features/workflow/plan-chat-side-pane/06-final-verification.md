# 06 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     none
Decisions:
- Run `npm run selftest -- --plugin workflow`, then `npm run selftest -- --plugin chat`.
- Read the screenshots. Run the checks below through the project's drive tooling where a screenshot does not show them.
- Checks, each a live claim no test pins:
  - expected: the screenshot `side-pane-plan-ready` shows the pane beside the transcript, with `Make · ready`, the stepper, the checklist and the actions.
  - expected: the screenshot `side-pane-hidden` shows the transcript at full width and the strip still showing `Make · ready` and its main action.
  - low-confidence: the floating composer stays inside `.chat-main` and does not sit under the pane. The transcript scrolls and follows the bottom as before. Reason: the task moves the composer's positioned parent.
  - low-confidence: chat dialogs and pickers open centred on the window with the pane showing. Reason: `container-type` adds layout containment to `.chat-tab`, and `dialog.css` uses `position: fixed`, so a dialog built inside the tab would centre on the tab.
  - low-confidence: below 640 px of Chat tab width, in a split, the pane hides and returns when the split closes. Reason: this is CSS with no test.
  - expected: `Space z l w` steps through every sample, and each sample's chip, strip and pane show the pinned label.
- A failed check goes back to the group that owns it as a fix.
Done when: every check above passes, or its failure is reported with its evidence
Commit:    no commit, unless a fix lands

## Proof

