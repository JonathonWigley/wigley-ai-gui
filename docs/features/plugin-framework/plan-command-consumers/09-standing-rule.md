# 09 — Standing rule in AGENTS.md

Status: not started
Type: Task
Wave: 6 · Depends on: 08
Plan: [plan.md](plan.md)

Files: modify `AGENTS.md` · modify `docs/features/intent-alignment/master-plan.md`

Consumes: tasks 01-08 landed, since the rule must be true when it lands.

Produces: one new bullet in `AGENTS.md` § Intent, and a ticked checkpoint box in `master-plan.md` § Wave 3.

Decisions:

- **The rule to carry,** from `master-plan.md` § Wave 3 Checkpoint: every user action runs as a command, and every state change a plugin owns is published as an event or slot typed in its `contract.ts`.
- Place it directly after the `**Everything is a plugin, and everything is hookable.**` bullet, in that list's shape: a bold lead sentence, then the rule, then its reason. This is the text:

  > **Every action is a command, every change is published.** Every user action runs as a command, and every state change a plugin owns is published as an event or slot typed in its `contract.ts`, so a plugin can hook, bind or read anything the app itself does. Drags and focus guards stay plain listeners, and a layout wanting something else writes its own listener knowingly.

- The file's first Contents line (line 5, measured at plan time) summarizes § Intent. Add `every action a command` to it.
- Run `wigley:writing-for-agents` on the edit. Keep the rule's meaning; only the wording may change to suit the file.
- Check truth before landing: `grep -rn 'kit\.run\b' src` prints nothing; `grep -n 'textButton(' src/plugins/workflow/page/layout/workflow-kit.ts` prints nothing. Any hit stops the task and reports a concern.
- Tick the box in the same commit: `- [ ] Add the standing rule to the AGENTS.md Intent…` becomes `- [x]`.

GIVEN an agent reads `AGENTS.md` § Intent WHEN it adds a button or owned state THEN the rule tells it to add a command, and an event or slot.

Tests: none. This is a doc change, and the checks above are diff-visible.

Done when: the bullet is in § Intent; the Contents line names it; the box is ticked.
Commit: one commit for the group.

## Proof
