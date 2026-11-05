# 03 — Final verification

Status: not started
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     none

Decisions:

- Use one drive run with the real Claude CLI: `npm run drive -- start --harness claude`, then `npm run drive -- do chat.start '{}'`. Read `.agents/skills/drive/SKILL.md` first. `npm run drive -- help` lists the commands for keys, `query` and `screenshot`.
- Send only local commands and control picks. Send no message that starts a model turn, so the run costs no tokens.
- Read each value from a `screenshot` of the status line and the Session section.
- The start uses the first profile in chat's `profiles` setting. Opus 5.5, Sonnet 5.5 and Fable 5.1 default to medium on this machine (`claude-stream.md` § Effort). If the profile's model has another default, report the model and the value the capture shows. That is not a failure.

Checks, in this order:

1. Expected: before any message, the new session shows its model and its default effort, and not `unset`.
2. Expected: `e` opens the effort picker. Pick High. The chip shows `High`.
3. Low confidence, because no test covers the wiring from a local command to the chip: type `/effort auto`. The chip shows the default again.
4. Low confidence, for the same reason: type `/model sonnet`. The chip shows `Sonnet` and keeps the effort.
5. Low confidence, because the held values cross a process start: type `/clear`, which starts a new process in the row. The chip shows the process's model and effort, and not `unset`.

The arguments of the new process are not checked here: the test in Task 01 for a reported value pins that the start passes no `--effort`.

Done when: each check has a screenshot that was read, the report names what each shows, and the drive run has quit.
Commit:    none.

## Proof

