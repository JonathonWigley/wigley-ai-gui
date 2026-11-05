# 08 — Self-test group

Status: done
Type: Task
Wave: 5 · Depends on: 06, 07
Plan: [plan.md](plan.md)

Files:     create `src/plugins/session-log/main/selftest-script.ts` · modify `src/plugins/session-log/main/start.ts`
Consumes:  `sessionLogMainPart` ← 07
           the page line `resume section <title>: <n> rows` ← 06
Produces:  `export function sessionLogSelfTestScript(deps: SessionLogSelfTestDeps): SelfTestScript` in `src/plugins/session-log/main/selftest-script.ts`
Decisions: the script is new and in this plugin, so chat's existing groups stay as they are · the shape copies `agent-strip/main/selftest-script.ts`: a project folder under the self-test home, `chat.closeSessionsIn` first, because `open` runs on each page load, then `chat.launch` and `sessions.activate` · a whole run lists chat's closed sessions too, so the row count is a pattern · a session lists only after its process ends: the fake harness ends at once, so no wait step is added

`open` launches a session in the project folder `session-log-selftest` with `profile: 'work'`, shows it, and returns `shownLine: '[chat] Chat tab shown in session-log-selftest'`.

The group is named `recently closed`. Its `why` says it proves a closed session lists at the top of the start prompt and a pick reopens it. Its steps, in order:

1. No keys: expect `[chat] result entry added in session-log-selftest`, so the turn has ended and Cmd+W does not ask.
2. `<D-w>`: expect `[chat] session closed: session-log-selftest`.
3. `Space k n`: expect `[chat] picker shown: Folder`, `alsoExpect: [/^\[chat\] resume section Recently closed: \d+ rows$/]`, and take a screenshot named `first-step`.
4. `k`, then Enter: expect `[chat] Chat tab shown in session-log-selftest`. This session closed last, so its row is next to the cursor.

GIVEN a session closed by the keys WHEN `Space k n` opens THEN the page logs the section with its rows
GIVEN the Folder step WHEN `k` then Enter runs THEN the session's Chat tab shows
Tests:     this task is the self-test group. It adds no Vitest test. `selftest-script.test.ts` is not needed: the group's own run is the check, in task 10.
Done when: compiles; lint passes; the self-test's group check accepts the group at its next run, in task 10
Commit:    one commit for the group

## Proof

Commit cdc253fd · proof: diff read; typecheck and lint pass; the group's own run is in task 10 · concerns: step 1 waits on a line the launch reply logs, which may log before the step begins waiting; task 10's run settles it
