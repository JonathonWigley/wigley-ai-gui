# 17 — Final verification

Status: not started
Type: Task
Wave: 14 · Depends on: 16
Plan: [plan.md](plan.md)

Files:     none (a run log line in plan.md)
Consumes:  the landed code of tasks 01–16
Produces:  each check below recorded pass or fail, with its evidence, in plan.md's Run log
Decisions: Each task's tests pin its rules; this task runs only the checks a test cannot see (plan.md § Tasks; the
           user's `wigley:writing-tests` § What earns a live run instead). The agent runs every check it can reach
           through the drive skill (`.agents/skills/drive/SKILL.md`). A check that needs the user's own Claude
           sign-in, a real `claude` binary or a manual kill runs in a drive run with `WIGLEY_DRIVE_HARNESS=claude`
           when the drive skill allows it; when it cannot be staged, it goes in the wrap-up with its steps.
           A failure is fixed in the task that owns it, then its check runs again.
Mandatory: `.agents/skills/drive/SKILL.md`; AGENTS.md § Running and testing
GIVEN the landed lane WHEN the gates below run THEN each passes
Tests:     `npm run lint`, `npm run typecheck` and the full `npm test` pass; `npm run selftest` passes, and the
           self-test starts no `claude` process. `pgrep -f claude` also matches the user's own sessions and editors, so
           the check is on the processes `claude` starts in stream mode (every Claude launch passes `--output-format
           stream-json`): run `pgrep -f 'claude.*--output-format stream-json' | sort > /tmp/claude-lane-h-plan/before.txt`
           before and `… > /tmp/claude-lane-h-plan/after.txt` after, then `comm -13 before.txt after.txt`. It prints
           nothing, or only pids whose `ps -o ppid=,command= -p <pid>` shows a parent outside the self-test run (a
           session the user started in the same minutes).
Approach:  Run the checks in this order. Each is tagged expected (the change doing what it was made to do) or
           low-confidence (a likely bug site), with its reason. A test or a self-test step pins checks 2, 5, 6 and 7
           and the strings of 8 and 3, so this run does not repeat them: they keep their numbers here and stay out of
           the Run log. The checks that remain are the look of a screen and the parts that need the drive run's
           real wiring or a real `claude`.

           **Fake drive run** (`WIGLEY_DRIVE_HARNESS=fake`):
           1. Expected (01, 10): `chat.start` with no args runs on harness `fake`; the session hub tag reads `Fake`;
              the sessions row shows `Fake`.
           2. Covered by tests (09: `fake-session-<n>` host id, one row for the round). Not run here.
           3. Smoke (10, the drive run's own setting path; the toast text is pinned by the chat page test): run, in
              order, `npm run drive -- setting chat.defaultHarness '"nope"'` (it must report `applied: true`),
              `npm run drive -- key Space b n` (`<Leader>bn`, `chat.newSession`, which opens the start prompt), then
              `npm run drive -- screenshot start-prompt-unknown-harness` and Read it: an error toast shows, and no
              Folder picker is open (`npm run drive -- query '.ui-picker'` lists no match). Restore with
              `npm run drive -- setting chat.defaultHarness '"fake"'`; the run reads `fake` again.
           4. Expected (03, 05, 10): Settings shows the Claude Code plugin's `Claude command` and profiles rows, chat's
              `Default harness` row, and no core `claude.command` or chat Profiles row.
           5. Covered by tests (05: profile order). Not run here.
           6. Covered by the chat self-test group "session controls" (11). Not run here.
           7. Covered by the chat self-test "clear" step (12). Not run here.
           8. Look only (13; the strings are pinned by `layout.test.ts` and the adapter tests): `screenshot` the
              deny-reason box and the end-session confirm; each text fits its dialog at the default width, with no
              clipped line and no overlap, read against `DESIGN.md`.
           9. Expected (14): `Space z l c` shows the `preview:sample` entry as a collapsed `Raw event` row after the
              compaction divider.
           10. Expected (07): a doc header on an indexed plugin file shows one chip, `Claude Code <state>`, and no Codex
               chip; `i` on a plugin opens its `installed_plugins.json` at the key's line; saving a file under
               `~/.codex` is refused as `outside the indexed folders`.

           **Live app on Claude** (`WIGLEY_DRIVE_HARNESS=claude`, a signed-in profile):
           11. Expected (03): a chat session starts on Claude and the usage panel shows both profiles' plan rows.
               Low-confidence for usage: it depends on the claude-code plugin starting before usage.
           12. Expected (03): with `claude-code.command` set to a bad path, a session ends with `…; set
               claude-code.command`.
           13. Expected (09): a new session asks a round and it lands in the chat row, with no second sessions row
               (needs the task-09 marketplace relay installed through `claude plugin update`). After `/clear`, a round
               still lands in the same row; the run's `app.log` (`.drive/<run-id>/app.log`, read with `command grep -a`)
               holds, after the `/clear`, one `[sessions] owned session <row> now host <id>` line and one `[sessions] relay joined
               session <row>` line for the same row, in either order (task 09 lets a relay join before the host id is
               set), and no `[sessions] refused a relay: …` line. The ids vary, so `wait-log` (which matches a whole
               line) cannot wait on them; read the file after the round lands.
           14. Expected (08): in manual mode, a Write shows a permission card; `y` lets it run; `n` with a reason shows
               Claude the reason; closing the row mid-prompt shows the card cancelled. An unattended auto-retro row
               denies at once and no unanswered card flashes.
           15. Low-confidence (04, unmeasured shape): the model picker lists the `initialize` reply's models by
               `displayName`, and a pick takes effect and survives a resume; right after start, the mode control
               shows the mode `current_permission_mode` reports.
           16. Low-confidence (15, untested wiring): start a long turn, then `core.stopPlugin claude-code`. The row
               rests with `Claude Code is not loaded. This session waits for it to load again.`; a send toasts
               `Message not sent: Claude Code is not loaded. Send again once it is.`; `core.startPlugin claude-code`
               re-attaches the row and the turn's output shows with no doubled entries. `core.restartPlugin
               claude-code` mid-turn kills no `claude` process (compare `ps` before and after).
           17. Low-confidence (13): a killed Claude process shows `Claude Code stopped (exit code …)`.

           **Wrap-up only when it cannot be staged:**
           - A terminal Codex session's sessions row shows `codex`, grouped as `codex session` when it has no folder
             (01). No drive action stages a relay hello. Steps: start `codex` in a terminal with the wigley relay
             configured, open the app, read the Sessions list.
           - A nested `claude -p` inside an app session gets its own row (09).
           - A relaunch during a fresh session's first turn re-attaches the row (09).
           - A user-folder plugin calling `addEntryRenderer` redraws open tabs and its stop returns them to `default`
             (14).
Done when: every check above not marked "Covered by tests" is recorded pass in the Run log, or listed in the wrap-up with its steps
Commit:    the Run log line, with the plan's closing commit

## Proof

