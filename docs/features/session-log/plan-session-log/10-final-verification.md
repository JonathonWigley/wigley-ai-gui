# 10 — Final verification

Status: not started
Type: Task
Wave: 6 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     none, unless a check finds a defect. A step in `src/plugins/chat/main/selftest-script.ts` that the new rows change is edited here
Consumes:  the landed code of tasks 01 to 08
Produces:  none
Decisions: run the touched plugins' self-test groups only, because a whole run takes half an hour or more (`AGENTS.md` § Running and testing) · run the drive in this worktree, which has its own `.vite`

**Self-test.** Run `npm run selftest -- --plugin session-log`. Then run chat's `resume list` and `archive` groups, which the start prompt change can break: `npm run selftest -- --group "chat: resume list" --group "chat: archive"`.

A `--group` run also runs the chat groups before it, which close sent sessions, so these groups run with a live section. The cursor starts on the first folder and on New session, so their keys should still reach their rows. A step that needs other keys is a self-test edit, not a product defect.

**Compile, lint, tests.** Run the compile, `npm run lint`, and the unit tests of `sessions`, `chat`, `session-log`, `forms`, `docs`, `primer`, `workflow`, `usage` and `src/shared/page`.

**Drive run.** Use the `drive` skill (`.agents/skills/drive/SKILL.md`), on the fake harness. Read each capture against `DESIGN.md`.

The fake's `listSessions` returns only `fake past session one` and `two`, and a Session step section row needs a row from it. So seed the checks this way:

- Session step: resume `fake past session one` from the Session step, send a message, close it, then open the Session step again.
- Long title: start a session whose first message is long, and close it.
- `/clear`: type `/clear` in a session that has a sent message, then read the Folder step.

| Check | Kind | Why |
|---|---|---|
| The Folder step shows Recently closed and Folders headings, a title in full colour and dim details at the row's end, and the cursor on the first folder | expected | the look the user picked; only the screen shows it |
| `k` from the first folder lands on the newest closed row, skipping the heading, and Enter reopens it | expected | the recovery path |
| The Session step shows the section above New session, with the cursor on New session and the row absent below | expected | the second place the user asked for |
| A `/clear` lists the old conversation, and a pick opens it beside the cleared row | low-confidence | a new path through `resume` with no live check yet |
| A long title ends in an ellipsis and its details stay visible | low-confidence | the row primitive's flex rules decide this, and no test sees them |
| Typing a filter hides the headings | low-confidence | CSS and redraw wiring a fake DOM cannot see |

Done when: compile, lint and the unit tests pass, both self-test runs pass, each drive check is seen in a capture, and each defect found is fixed and committed
Commit:    none, unless a check finds a defect

## Proof

