# 09 — Standing rule in AGENTS.md

Status: done
Type: Task
Wave: 6 · Depends on: 08
Plan: [plan.md](plan.md)

Files: modify `AGENTS.md` · modify `docs/features/intent-alignment/master-plan.md`

Consumes: tasks 01-08 landed, since the rule must be true when it lands.

Produces: one new bullet in `AGENTS.md` § Intent, and a ticked checkpoint box in `master-plan.md` § Wave 3.

Decisions:

- **The rule to carry,** from `master-plan.md` § Wave 3 Checkpoint: every user action runs as a command, and every state change a plugin owns is published as an event or slot typed in its `contract.ts`. This task narrows "every state change a plugin owns" to the state another plugin reads or a page reload keeps. A view's private draw state, such as a hover or a scroll offset, stays in the view: this plan publishes no such state, and a rule the code breaks on the day it lands steers nothing.
- Place it directly after the `**Everything is a plugin, and everything is hookable.**` bullet, in that list's shape: a bold lead sentence, then the rule, then its reason. This is the text:

  > **Every action is a command, shared state is published.** Every user action runs as a command, and every state change another plugin reads or a page reload keeps is published as an event or slot typed in its `contract.ts`, so a plugin can hook, bind or read what the app itself does. A view's private draw state stays in the view. Drags and focus guards stay plain listeners, and a layout wanting something else writes its own listener knowingly.

- The file's first Contents line (line 5, measured at plan time) summarizes § Intent. Add `every action a command` to it.
- Run `wigley:writing-for-agents` on the edit. Keep the rule's meaning; only the wording may change to suit the file.
- Check truth before landing. Any failure stops the task and reports a concern:
  - `grep -rn 'kit\.run\b' src` prints nothing.
  - `grep -n 'textButton(' src/plugins/workflow/page/layout/workflow-kit.ts` prints nothing.
  - `grep -rn 'textButton(\|iconButton(' src --include='*.ts' --exclude='*.test.ts'` lists every plain button left. Read the click handler of each hit. A hit passes when its click runs a command (`kit.command`, `base.command`, `commands.run` or a handler that a command serves), when it changes no state the app keeps (a dialog's own close, a copy, gallery's `ignore`), or when it is the helper itself (`button.ts`, `icon-button.ts`, `base-kit.ts`). Report each `iconButton(` hit that fails as a concern, not a stop: task 01 leaves icon buttons out of the sweep, and the user decides whether the rule names them.
  - `grep -l 'PlaceSlot' src/plugins/*/contract.ts` lists chat, forms, primer, docs, notes, backlog, settings and sessions.
- Tick the box in the same commit: `- [ ] Add the standing rule to the AGENTS.md Intent…` becomes `- [x]`.

GIVEN an agent reads `AGENTS.md` § Intent WHEN it adds a button or owned state THEN the rule tells it to add a command, and an event or slot.

Tests: none. This is a doc change, and the checks above are diff-visible.

Done when: the bullet is in § Intent; the Contents line names it; the box is ticked.
Commit: one commit for the group.

## Proof

Commit a957faa9 · proof: Diff read: Intent bullet and Contents line as the task's text; truth greps re-run by worker all pass (no kit.run, no textButton in workflow-kit.ts, PlaceSlot in all eight contracts, every textButton/iconButton hit passes); master-plan Wave 3 checkpoint ticked. · concerns: none; extra scope: AGENTS.md src/shared/page and sessions entries brought up to task 08.
