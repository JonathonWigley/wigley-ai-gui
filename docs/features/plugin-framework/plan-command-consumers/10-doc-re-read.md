# 10 — Doc re-read

Status: not started
Type: Task
Wave: 7 · Depends on: 09
Plan: [plan.md](plan.md)

Files:
- modify `docs/features/plugin-framework/design.md` · `docs/features/layouts/design.md` · `docs/features/workflow/design.md` · `docs/features/agent-chat/design.md` · `docs/features/intent-alignment/master-plan.md` · `docs/features/followups.md` · `AGENTS.md`
- modify `docs/keymap.md` only when a re-read finds a stale line

Consumes: tasks 01-09 landed.

Produces: each doc below true against the landed code, line by line, and the stale lines fixed.

Decisions:

Re-read each section against the code. Fix each stale line. Run `wigley:writing-for-agents` on each edit.

- `docs/features/plugin-framework/design.md` § Commands and state (Waves 2 and 3), each bullet. Check in particular:
  - "The two close seams" and "The user's close key on an open round is one instant act": they say the close key on an open round cancels the round and closes the session at once, with no confirmation. Check that wording against the landed code: `closesAtOnce`, `closeSession(id, atOnce)`, `cancelHold`, and the review's Cancel prompt, which leaves the session open.
  - "Row decoration is the row part": it must name `SessionPart.tooltip`, as landed.
  - "A page reload keeps the user's work": it must name sessions' selected tab and the limits (an open markup session in notes or forms, box focus and insert mode, a Settings row's open edit box).
- `docs/features/plugin-framework/design.md` § Sessions (plan A2): the line that a tab reads `<label> · <round heading> <answered>/<total>`, and the line on `Cmd+W`, which already says the close key cancels at once. Check that its shipped wording matches the landed code.
- `grep -n "Cmd+W" docs/features/plugin-framework/design.md`: fix each hit that still names a close prompt, such as "a prompt such as Cmd+W's cancel" (measured at line 120, re-verify). The review's Cancel prompt is the true example.
- `docs/features/layouts/design.md`:
  - every place that names `kit.button` or `kit.run`
  - the sessions row contract (`status` went)
  - the reload text. At plan time `grep -n 'draft\|page reload' docs/features/layouts/design.md` prints nothing, though `followups.md` says this doc tells that a layout reload keeps chat's box and a page reload empties it. Re-run the grep. A line that says so changes. With no line, add one sentence under the decisions: a layout reload moves chat's box into the redrawn composer, and a page reload restores the draft and images through `chatPlaceSlot` and `chatDraftImagesSlot`.
- `docs/features/workflow/design.md`: the action paragraph, as task 06 landed it, and every other mention of `runAction` or a closed list of actions.
- `docs/features/agent-chat/design.md`: the "**Status**: a row's tab status…" line (measured at line 473), since `setStatus` went.
- `AGENTS.md` § Architecture: the "A command" and "A slot" entries, kit entries, sessions entries, and the new § Intent bullet. Each must match the landed names.

Master plan and follow-ups (`master-plan.md` § Intent: tick the box and remove the item, in the same commit):

- Tick in `master-plan.md` § Wave 3: `Every click runs a command`, `Workflow stage actions as commands`, `Sessions queries and row decorations`, `Sessions stops knowing forms`, `Page state survives a page reload`.
- Remove the same five items from `docs/features/followups.md`. Find each by its bold name, and remove each whole bullet. First check that every clause of the bullet landed. `Sessions queries and row decorations`: the `rows` and `sessions` slots, `tabShown`, `hidden`, the status row part, one job per close seam, and take overs released out of order. `Page state survives a page reload`: chat's draft and images, forms' place, the `pagehide` flush, and restored rounds. A clause that did not land stays as its own follow-up, and the report names it.
- Remove the sentence `Then add a standing rule to the AGENTS.md Intent…` and the sentence after it from the `Events for every state change` item in `followups.md`, when that item still stands, since task 09 landed the rule. Keep the rest of the item.
- Leave `Layout hot reload keeps the user's place` and every other item.
- Grep `followups.md` and `master-plan.md` for text pointing at the removed items. Lane L and Wave 4 mention Wave 3: keep each line that stays true, and fix each that does not.
- Add these four follow-ups in the file's shape, each `*needs a feature plan*`. Each is a limit the user chose to leave out, and task 08 names it:
  - **Reload keeps an open markup session**: notes and forms return on their fields. It needs a restore path into the live overlay.
  - **Reload keeps box focus and vim insert mode**: a box's scope comes from `shown` today.
  - **Reload keeps a Settings row's open edit box**: the typed text goes today, while cursor and filter return.
  - **Page state survives an app restart**: page slots live in main's memory, so a restart loses them.
- Any other limit this run left, from a task's Proof concerns, also becomes a follow-up in the file's shape.

GIVEN the five items landed WHEN `grep -c 'Workflow stage actions as commands\|Sessions queries and row decorations\|Sessions stops knowing forms\|Page state survives a page reload\|Every click runs a command' docs/features/followups.md` runs THEN it prints 0.
GIVEN `master-plan.md` § Wave 3 WHEN it is read THEN every box in it is ticked.
GIVEN task 09 landed WHEN `grep -n 'standing rule' docs/features/followups.md` runs THEN it prints nothing.
GIVEN task 08's limits WHEN `grep -c 'Reload keeps\|survives an app restart' docs/features/followups.md` runs THEN it prints 4.

Tests: none. This is a doc change, and the greps above are diff-visible.

Done when: each doc listed is re-read and true; the greps above hold; the `Commands and state` section carries no text that still reads as a plan.
Commit: one commit for the group.

## Proof
