# 10 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 09
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files: none (verification only)

Consumes:  the built feature of 01–08, and the drive actions `agent-commands.call` and `agent-commands.result` ← 08
Produces:  the evidence below, named in the run log

Decisions:
- Every check runs in one drive run with the fake harness (`.agents/skills/drive/SKILL.md`). Pass `--run <id>` on
  every command. Start each tool call with `do agent-commands.call '{"sessionId":…,"tool":…,"args":…}'` and read it
  with `do agent-commands.result '{"callId":…}'` until it is not pending.
- Seed two chat sessions with `do chat.start` twice: A (the caller) and B (the target). Use each result's
  `sessionId` (the row id) as the tool's `sessionId` and `session`.
- One real-Claude check is optional and spends tokens: under `--harness claude`, an agent in A calls `list_commands`
  and `run_command chat.sendTo` itself. Run it only when the fake checks pass, and name it in the report.

GIVEN sessions A and B WHEN A calls `run_command {command: 'chat.sendTo', arg: {sessionId: B, text: 'hello from A'}}` THEN the result is `Ran chat.sendTo.`, B's transcript holds the framed message, and B's turn shows the Tag `from <A's name>`
GIVEN A's Chat tab is visible WHEN A calls `run_command {command: 'chat.focusBox', session: B}` THEN B's box takes focus — a page command run from main with a target
GIVEN A calls `run_command {command: 'sessions.closeSession', session: B}` WHEN the confirm form shows over A's tabs and is denied THEN the result is `The user denied sessions.closeSession.` and B's row stays
GIVEN the same call again WHEN the confirm is allowed THEN the result is `Ran sessions.closeSession.` and B's row is gone
GIVEN A is headless (`run_command workflow.toggleHeadless` with `session: A`) WHEN A calls a risky command THEN the result is the refusal pinned in 08, and no form opens
GIVEN any session WHEN it calls `read_state {slot: 'sessions.rows'}` THEN the result is the rows as JSON, A's and B's ids among them

Tests: the drive steps below. Each step records its command and what it showed in the run log.

1. `npm run drive -- start`; `do chat.start` twice → A and B.
2. sendTo: the call above; `do agent-commands.result` → `Ran chat.sendTo.`; show B's Chat tab
   (`do sessions.…` or a click on B's row); `screenshot agent-commands-from-tag`; Read the PNG: B's last user turn shows
   a neutral Tag `from <A's name>` and the body `hello from A`, no frame line. `query` the Tag's text.
3. Targeted page command: with A's tab shown, call `chat.focusBox` with `session: B`; `query` which box holds
   `.cm-focused` → B's.
4. Risky, denied: call `sessions.closeSession` with `session: B`; `result` is pending; `screenshot
   agent-commands-confirm`; Read it: the form shows over A's tabs, title `Run <label>?`, Deny recommended. Pick Deny
   and submit through the form's keys; `result` → `The user denied sessions.closeSession.`; B's row is still listed.
5. Risky, allowed: the same call; pick Allow and submit; `result` → `Ran sessions.closeSession.`; B's row is gone.
6. A tab-less caller: `do sessions.connect` a terminal-like session C; call `notes.removeSession` (or another risky
   command) from C; `screenshot agent-commands-confirm-marked`: C's row is marked with a round; deny it.
7. Headless refusal: call `workflow.toggleHeadless` with `session: A` from A; then a risky call from A → the
   headless refusal, and no form opens (`query` finds no open form).
8. `read_state`: call it with `slot: 'sessions.rows'` → JSON holding A's id; with no slot → the id list.
9. `npm run drive -- quit`.

Done when: steps 1–9 pass, each with its result text or screenshot named in the run log.
Commit:    none (verification only)
